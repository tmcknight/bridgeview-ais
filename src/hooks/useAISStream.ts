import { useCallback, useEffect, useRef, useState } from "react";
import type { AISMessage, TrackedShip } from "../types/ais";
import { AIS_BOUNDING_BOX } from "../constants/bridge";
import {
  APPROACH_NOTIFICATION_DISTANCE_NM,
  CLOSE_APPROACH_DISTANCE_NM,
} from "../constants/bridge";
import { distanceToBridge, isApproaching } from "../utils/geo";

const WS_URL = "wss://stream.aisstream.io/v0/stream";
const STALE_TIMEOUT_MS = 10 * 60 * 1000; // Remove ships not seen for 10 minutes

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

export function useAISStream(apiKey: string): UseAISStreamReturn {
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
          lastUpdate: MetaData.time_utc,
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

  useEffect(() => {
    if (!apiKey) {
      setConnectionStatus("disconnected");
      return;
    }

    let isCleanedUp = false;

    function connect() {
      if (isCleanedUp) return;

      setConnectionStatus("connecting");
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isCleanedUp) {
          ws.close();
          return;
        }
        setConnectionStatus("connected");

        const subscription = {
          APIKey: apiKey,
          BoundingBoxes: [AIS_BOUNDING_BOX],
          FilterMessageTypes: ["PositionReport", "ShipStaticData"],
        };
        ws.send(JSON.stringify(subscription));
      };

      ws.onmessage = (event) => {
        try {
          const data: AISMessage = JSON.parse(event.data);
          processMessage(data);
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onerror = () => {
        setConnectionStatus("error");
      };

      ws.onclose = () => {
        if (isCleanedUp) return;
        setConnectionStatus("disconnected");
        // Reconnect after 5 seconds
        reconnectTimeoutRef.current = setTimeout(connect, 5000);
      };
    }

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
  }, [apiKey, processMessage]);

  return {
    ships,
    notifications,
    connectionStatus,
    dismissNotification,
    clearNotifications,
  };
}
