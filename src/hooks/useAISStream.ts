import { useCallback, useEffect, useRef, useState } from "react";
import type { AISMessage, TrackedShip } from "../types/ais";
import { AIS_BOUNDING_BOX } from "../constants/bridge";
import {
  APPROACH_NOTIFICATION_DISTANCE_NM,
  CLOSE_APPROACH_DISTANCE_NM,
} from "../constants/bridge";
import { distanceToBridge, isApproaching } from "../utils/geo";

const WS_URL = import.meta.env.VITE_WS_PROXY_URL || "ws://localhost:3001";
const STALE_TIMEOUT_MS = 10 * 60 * 1000; // Remove ships not seen for 10 minutes

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

  // Fallback: return current time
  console.warn("[AIS] unparseable time_utc:", raw);
  return new Date().toISOString();
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface UseAISStreamReturn {
  ships: Map<number, TrackedShip>;
  notifications: Notification[];
  connectionStatus: ConnectionStatus;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
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
  const [ships, setShips] = useState<Map<number, TrackedShip>>(new Map());
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const shipsRef = useRef<Map<number, TrackedShip>>(new Map());

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
      setNotifications((prev) => [notification, ...prev].slice(0, 50));

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
    (msg: AISMessage) => {
      const { MetaData, MessageType, Message } = msg;
      const mmsi = MetaData.MMSI;
      const currentShips = shipsRef.current;
      const existing = currentShips.get(mmsi);

      if (MessageType === "PositionReport" && Message.PositionReport) {
        const pos = Message.PositionReport;
        const dist = distanceToBridge(MetaData.latitude, MetaData.longitude);
        const approaching = isApproaching(
          MetaData.latitude,
          MetaData.longitude,
          pos.Cog,
          pos.Sog
        );

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

        currentShips.set(mmsi, ship);
      } else if (MessageType === "ShipStaticData" && Message.ShipStaticData) {
        const staticData = Message.ShipStaticData;
        if (existing) {
          existing.destination = staticData.Destination?.trim();
          existing.shipType = staticData.Type;
          existing.length =
            (staticData.Dimension?.A ?? 0) + (staticData.Dimension?.B ?? 0);
          existing.width =
            (staticData.Dimension?.C ?? 0) + (staticData.Dimension?.D ?? 0);
          existing.name = staticData.Name?.trim() || existing.name;
          currentShips.set(mmsi, { ...existing });
        }
      }

      // Purge stale ships
      const now = Date.now();
      for (const [key, s] of currentShips) {
        if (now - new Date(s.lastUpdate).getTime() > STALE_TIMEOUT_MS) {
          currentShips.delete(key);
        }
      }

      shipsRef.current = new Map(currentShips);
      setShips(new Map(currentShips));
    },
    [addNotification]
  );

  // Use a ref for processMessage so the WebSocket effect doesn't re-run on callback changes
  const processMessageRef = useRef(processMessage);
  processMessageRef.current = processMessage;

  useEffect(() => {
    let isCleanedUp = false;
    let connectTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      if (isCleanedUp) {
        console.log("[AIS] connect() skipped — already cleaned up");
        return;
      }

      console.log("[AIS] connecting to", WS_URL);
      setConnectionStatus("connecting");
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[AIS] WebSocket opened");
        if (isCleanedUp) {
          console.log("[AIS] opened but already cleaned up, closing");
          ws.close();
          return;
        }
        setConnectionStatus("connected");

        const subscription = {
          BoundingBoxes: [AIS_BOUNDING_BOX],
          FilterMessageTypes: ["PositionReport", "ShipStaticData"],
        };
        console.log("[AIS] sending subscription:", JSON.stringify(subscription));
        ws.send(JSON.stringify(subscription));
      };

      ws.onmessage = (event) => {
        try {
          const data: AISMessage = JSON.parse(event.data);
          if (!shipsRef.current.has(data.MetaData.MMSI)) {
            console.log("[AIS] new ship:", data.MetaData.ShipName, "MMSI:", data.MetaData.MMSI);
          }
          processMessageRef.current(data);
        } catch (err) {
          console.warn("[AIS] failed to parse message:", err, event.data);
        }
      };

      ws.onerror = (event) => {
        console.error("[AIS] WebSocket error:", event);
        if (isCleanedUp) return;
        setConnectionStatus("error");
      };

      ws.onclose = (event) => {
        console.log("[AIS] WebSocket closed — code:", event.code, "reason:", event.reason, "clean:", event.wasClean);
        if (isCleanedUp) return;
        setConnectionStatus("disconnected");
        console.log("[AIS] reconnecting in 2s...");
        reconnectTimeoutRef.current = setTimeout(connect, 2000);
      };
    }

    // Delay to survive React StrictMode's unmount/remount cycle in development
    connectTimeout = setTimeout(connect, 100);

    return () => {
      isCleanedUp = true;
      clearTimeout(connectTimeout);
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
