import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { AISMessage, TrackedShip } from "../types/ais";
import {
  AIS_BOUNDING_BOX,
  APPROACH_NOTIFICATION_DISTANCE_NM,
  BRIDGE_CENTER,
  CLOSE_APPROACH_DISTANCE_NM,
  MAX_NOTIFICATIONS,
  STALE_SHIP_TIMEOUT_MS,
} from "../constants/bridge";
import { distanceToBridge, isApproaching } from "../utils/geo";
import { logger } from "../utils/logger";

const WS_URL = import.meta.env.VITE_WS_PROXY_URL || "ws://localhost:3001";
const WS_AUTH_TOKEN = import.meta.env.VITE_WS_AUTH_TOKEN; // Optional authentication token

/** Parse aisstream.io time_utc into an ISO string that Date can handle.
 *  Formats seen: "20240115123456", "2024-01-15 12:34:56", ISO 8601 */
function parseTimeUtc(raw: string): string {
  // Already valid ISO
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString();

  // Compact: "20240115123456" → "2024-01-15T12:34:56Z"
  const compact = raw.replace(/[^0-9]/g, "");
  if (compact.length >= 14) {
    const iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(8, 10)}:${compact.slice(10, 12)}:${compact.slice(12, 14)}Z`;
    return iso;
  }

  // Fallback: return Unix epoch to signal error
  logger.error("[AIS] unparseable time_utc:", raw);
  return new Date(0).toISOString(); // Unix epoch (1970-01-01) signals invalid data
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface UseAISStreamReturn {
  ships: Map<number, TrackedShip>;
  notifications: Notification[];
  connectionStatus: ConnectionStatus;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
}

type ShipsAction =
  | { type: "UPDATE_SHIP"; mmsi: number; ship: TrackedShip }
  | { type: "UPDATE_STATIC_DATA"; mmsi: number; updates: Partial<TrackedShip> }
  | { type: "PURGE_STALE"; staleTimeout: number };

function shipsReducer(state: Map<number, TrackedShip>, action: ShipsAction): Map<number, TrackedShip> {
  switch (action.type) {
    case "UPDATE_SHIP": {
      const newState = new Map(state);
      newState.set(action.mmsi, action.ship);
      return newState;
    }
    case "UPDATE_STATIC_DATA": {
      const existing = state.get(action.mmsi);
      if (!existing) return state;
      const newState = new Map(state);
      newState.set(action.mmsi, { ...existing, ...action.updates });
      return newState;
    }
    case "PURGE_STALE": {
      const now = Date.now();
      let hasStale = false;
      const newState = new Map<number, TrackedShip>();

      for (const [mmsi, ship] of state) {
        if (now - new Date(ship.lastUpdate).getTime() <= action.staleTimeout) {
          newState.set(mmsi, ship);
        } else {
          hasStale = true;
        }
      }

      return hasStale ? newState : state;
    }
    default:
      return state;
  }
}

export interface Notification {
  id: string;
  shipName: string;
  mmsi: number;
  message: string;
  timestamp: Date;
  type: "approaching" | "passing" | "info";
  dismissed: boolean;
}

export function useAISStream(): UseAISStreamReturn {
  const [ships, dispatchShips] = useReducer(shipsReducer, new Map());
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const shipsRef = useRef<Map<number, TrackedShip>>(new Map());

  // Keep ref in sync with reducer state
  useEffect(() => {
    shipsRef.current = ships;
  }, [ships]);

  const addNotification = useCallback(
    (
      shipName: string,
      mmsi: number,
      message: string,
      type: Notification["type"]
    ) => {
      const notification: Notification = {
        id: `${mmsi}-${Date.now()}`,
        shipName,
        mmsi,
        message,
        timestamp: new Date(),
        type,
        dismissed: false,
      };
      setNotifications((prev) => [notification, ...prev].slice(0, MAX_NOTIFICATIONS));

      // Browser notification if permission granted
      if (globalThis.Notification?.permission === "granted") {
        new globalThis.Notification(`🚢 ${shipName}`, {
          body: message,
          icon: "/ship-icon.png",
          tag: `${mmsi}-${type}`,
        });
      }
    },
    []
  );

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, dismissed: true } : n))
    );
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const processMessage = useCallback(
    (msg: AISMessage, currentShips: Map<number, TrackedShip>) => {
      const { MetaData, MessageType, Message } = msg;
      const mmsi = MetaData.MMSI;
      const existing = currentShips.get(mmsi);

      if (MessageType === "PositionReport" && Message.PositionReport) {
        const pos = Message.PositionReport;
        const dist = distanceToBridge(MetaData.latitude, MetaData.longitude);
        let approaching = isApproaching(
          MetaData.latitude,
          MetaData.longitude,
          pos.Cog,
          pos.Sog,
          dist // Pass pre-calculated distance to avoid duplicate calculation
        );

        // Filter out vessels that shouldn't be considered approaching
        const destination = existing?.destination?.toUpperCase() ?? "";
        const heading = ((pos.Cog % 360) + 360) % 360;
        const isNorthbound = heading > 315 || heading < 45;
        const isSouthOfBridge = MetaData.latitude < BRIDGE_CENTER.lat;
        if (destination === "TUG-ASSIST") {
          approaching = false;
        }
        if (isSouthOfBridge && isNorthbound && destination === "SARNIA") {
          approaching = false;
        }

        const ship: TrackedShip = {
          mmsi,
          name: MetaData.ShipName?.trim() || `MMSI ${mmsi}`,
          latitude: MetaData.latitude,
          longitude: MetaData.longitude,
          cog: pos.Cog,
          sog: pos.Sog,
          trueHeading: pos.TrueHeading,
          navStatus: pos.NavigationalStatus,
          lastUpdate: parseTimeUtc(MetaData.time_utc),
          distanceToBridge: dist,
          approaching,
          notified: existing?.notified ?? false,
          destination: existing?.destination,
          shipType: existing?.shipType,
          length: existing?.length,
          width: existing?.width,
        };

        // Check for approach notification
        if (
          approaching &&
          dist <= APPROACH_NOTIFICATION_DISTANCE_NM &&
          !ship.notified
        ) {
          ship.notified = true;
          addNotification(
            ship.name,
            mmsi,
            `Approaching Blue Water Bridge — ${dist.toFixed(1)} NM away, speed ${pos.Sog.toFixed(1)} kn`,
            "approaching"
          );
        }

        // Check for "passing under" notification
        if (dist <= CLOSE_APPROACH_DISTANCE_NM && existing && existing.distanceToBridge > CLOSE_APPROACH_DISTANCE_NM) {
          addNotification(
            ship.name,
            mmsi,
            `Now passing under the Blue Water Bridge`,
            "passing"
          );
        }

        // Reset notification flag when ship moves far away
        if (dist > APPROACH_NOTIFICATION_DISTANCE_NM * 1.5) {
          ship.notified = false;
        }

        dispatchShips({ type: "UPDATE_SHIP", mmsi, ship });
      } else if (MessageType === "ShipStaticData" && Message.ShipStaticData) {
        const staticData = Message.ShipStaticData;
        const updates: Partial<TrackedShip> = {
          destination: staticData.Destination?.trim(),
          shipType: staticData.Type,
          length: (staticData.Dimension?.A ?? 0) + (staticData.Dimension?.B ?? 0),
          width: (staticData.Dimension?.C ?? 0) + (staticData.Dimension?.D ?? 0),
          name: staticData.Name?.trim() || existing?.name,
        };
        dispatchShips({ type: "UPDATE_STATIC_DATA", mmsi, updates });
      }

      // Purge stale ships
      dispatchShips({ type: "PURGE_STALE", staleTimeout: STALE_SHIP_TIMEOUT_MS });
    },
    [addNotification]
  );

  // Use a ref for processMessage so the WebSocket effect doesn't re-run on callback changes
  const processMessageRef = useRef(processMessage);
  processMessageRef.current = processMessage;

  useEffect(() => {
    let isCleanedUp = false;

    function connect() {
      if (isCleanedUp) {
        logger.log("[AIS] connect() skipped — already cleaned up");
        return;
      }

      logger.log("[AIS] connecting to", WS_URL);
      setConnectionStatus("connecting");
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        logger.log("[AIS] WebSocket opened");
        if (isCleanedUp) {
          logger.log("[AIS] opened but already cleaned up, closing");
          ws.close();
          return;
        }
        setConnectionStatus("connected");

        // Send authentication if token is configured
        if (WS_AUTH_TOKEN) {
          logger.log("[AIS] sending authentication");
          ws.send(JSON.stringify({ authToken: WS_AUTH_TOKEN }));
        }

        const subscription = {
          BoundingBoxes: [AIS_BOUNDING_BOX],
          FilterMessageTypes: ["PositionReport", "ShipStaticData"],
        };
        logger.log("[AIS] sending subscription:", JSON.stringify(subscription));
        ws.send(JSON.stringify(subscription));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle authentication confirmation
          if (data.type === "authenticated") {
            logger.log("[AIS] authenticated successfully");
            return;
          }

          // Handle AIS messages
          const aisMessage = data as AISMessage;
          if (!shipsRef.current.has(aisMessage.MetaData.MMSI)) {
            logger.log("[AIS] new ship:", aisMessage.MetaData.ShipName, "MMSI:", aisMessage.MetaData.MMSI);
          }
          processMessageRef.current(aisMessage, shipsRef.current);
        } catch (err) {
          logger.warn("[AIS] failed to parse message:", err, event.data);
        }
      };

      ws.onerror = (event) => {
        logger.error("[AIS] WebSocket error:", event);
        if (isCleanedUp) return;
        setConnectionStatus("error");
      };

      ws.onclose = (event) => {
        logger.log("[AIS] WebSocket closed — code:", event.code, "reason:", event.reason, "clean:", event.wasClean);
        if (isCleanedUp) return;
        setConnectionStatus("disconnected");
        logger.log("[AIS] reconnecting in 2s...");
        reconnectTimeoutRef.current = setTimeout(connect, 2000);
      };
    }

    // Connect immediately - isCleanedUp flag handles StrictMode double-mounting
    connect();

    return () => {
      isCleanedUp = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return {
    ships,
    notifications,
    connectionStatus,
    dismissNotification,
    clearNotifications,
  };
}
