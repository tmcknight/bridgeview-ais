import { useCallback, useEffect, useRef, useState } from "react";
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
import { applyShipUpdates, purgeStaleShips } from "../utils/shipUpdates";
import { logger } from "../utils/logger";
import { applyShipLogMessage, type ShipLog } from "../utils/shipLog";
import { parseFeedStatusMessage, type FeedStatus } from "../utils/feedStatus";
import { parseVesselInfoMessage } from "../utils/vesselInfo";
import { parseAircraftMessage } from "../utils/aircraft";
import { parseShipCamsMessage, type ShipCamVideoIds } from "../utils/shipCams";
import type { Aircraft } from "../types/aircraft";

// Unset in a production build, connect to /ws on the host that served the page (nginx proxies it)
const WS_URL =
  import.meta.env.VITE_WS_PROXY_URL ||
  (import.meta.env.DEV
    ? "ws://localhost:3001"
    : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`);
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

const MAX_PENDING_DETAILS = 2000;
// Ship updates are gathered and applied together this often, so a busy feed
// re-renders the app a few times a second rather than once per message
const SHIP_FLUSH_MS = 250;
// How often ships gone quiet are dropped
const PURGE_INTERVAL_MS = 30_000;
const MIN_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 60000;

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface UseAISStreamReturn {
  ships: Map<number, TrackedShip>;
  notifications: Notification[];
  connectionStatus: ConnectionStatus;
  /** Health of each feed the server uses; null until the server reports it */
  feeds: FeedStatus[] | null;
  shipLog: ShipLog;
  /** Aircraft near the bridge from the server's ADS-B feed */
  aircraft: Aircraft[];
  /** Each ship cam's current live video, when the server looks them up */
  shipCamVideoIds: ShipCamVideoIds;
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
  const [ships, setShips] = useState<Map<number, TrackedShip>>(() => new Map());
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [shipLog, setShipLog] = useState<ShipLog>(() => new Map());
  const [feeds, setFeeds] = useState<FeedStatus[] | null>(null);
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [shipCamVideoIds, setShipCamVideoIds] = useState<ShipCamVideoIds>({});
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The ships as last shown, kept here too so messages can read them between renders
  const shipsRef = useRef<Map<number, TrackedShip>>(ships);
  // Updates waiting for the next flush, newest per ship
  const pendingShipsRef = useRef<Map<number, TrackedShip>>(new Map());
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Details that arrived before the ship's first position, applied when it shows up
  const pendingDetailsRef = useRef<Map<number, Partial<TrackedShip>>>(new Map());

  /** A ship as it stands, counting updates not yet shown */
  const latestShip = useCallback(
    (mmsi: number): TrackedShip | undefined => pendingShipsRef.current.get(mmsi) ?? shipsRef.current.get(mmsi),
    []
  );

  const flushShips = useCallback(() => {
    flushTimeoutRef.current = undefined;
    const pending = pendingShipsRef.current;
    if (pending.size === 0) return;
    const next = applyShipUpdates(shipsRef.current, pending.values(), Date.now(), STALE_SHIP_TIMEOUT_MS);
    pending.clear();
    if (next === shipsRef.current) return;
    shipsRef.current = next;
    setShips(next);
  }, []);

  const queueShip = useCallback(
    (ship: TrackedShip) => {
      pendingShipsRef.current.set(ship.mmsi, ship);
      flushTimeoutRef.current ??= setTimeout(flushShips, SHIP_FLUSH_MS);
    },
    [flushShips]
  );

  // Drop ships gone quiet, and any update still waiting at unmount
  useEffect(() => {
    const purge = setInterval(() => {
      const next = purgeStaleShips(shipsRef.current, Date.now(), STALE_SHIP_TIMEOUT_MS);
      if (next === shipsRef.current) return;
      shipsRef.current = next;
      setShips(next);
    }, PURGE_INTERVAL_MS);
    return () => {
      clearInterval(purge);
      clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = undefined;
    };
  }, []);

  const addNotification = useCallback(
    (
      shipName: string,
      mmsi: number,
      message: string,
      type: Notification["type"]
    ) => {
      const notification: Notification = {
        // The type too: one report can raise both "approaching" and "passing"
        id: `${mmsi}-${type}-${Date.now()}`,
        shipName,
        mmsi,
        message,
        timestamp: new Date(),
        type,
        dismissed: false,
      };
      setNotifications((prev) => [notification, ...prev].slice(0, MAX_NOTIFICATIONS));

      // Browser notification if permission granted
      // Chrome on Android has the permission but throws on the constructor; a throw
      // here would drop the position report that raised the notification
      try {
        if (globalThis.Notification?.permission === "granted") {
          new globalThis.Notification(`🚢 ${shipName}`, {
            body: message,
            icon: "/ship-icon.png",
            tag: `${mmsi}-${type}`,
          });
        }
      } catch (err) {
        logger.warn("Browser notification failed:", err);
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

  // Apply details to a tracked ship, or hold them until its first position arrives
  const applyDetails = useCallback(
    (mmsi: number, updates: Partial<TrackedShip>) => {
      const existing = latestShip(mmsi);
      if (existing) {
        // A feed that doesn't know a detail sends it blank; keep what the ship already has
        const known = Object.fromEntries(
          Object.entries(updates).filter(([, value]) => {
            if (value === undefined || value === "" || value === 0) return false;
            if (value && typeof value === "object" && "toBow" in value) {
              return value.toBow + value.toStern + value.toPort + value.toStarboard > 0;
            }
            return true;
          })
        );
        queueShip({ ...existing, ...known });
        return;
      }
      const pendingDetails = pendingDetailsRef.current;
      const earlier = pendingDetails.get(mmsi);
      pendingDetails.delete(mmsi);
      // Drop missing fields so they can't blank out details the ship gains meanwhile
      pendingDetails.set(mmsi, {
        ...earlier,
        ...Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined)),
      });
      // Ships whose position never arrives (e.g. outside the area) shouldn't pile up
      if (pendingDetails.size > MAX_PENDING_DETAILS) {
        pendingDetails.delete(pendingDetails.keys().next().value!);
      }
    },
    [latestShip, queueShip]
  );

  const processMessage = useCallback(
    (msg: AISMessage) => {
      const { MetaData, MessageType, Message } = msg;
      const mmsi = MetaData.MMSI;
      const existing = latestShip(mmsi);

      if (MessageType === "PositionReport" && Message.PositionReport) {
        const pos = Message.PositionReport;
        const lastUpdate = parseTimeUtc(MetaData.time_utc);
        // With two feeds, one's report can land after a newer one from the
        // other; drawing it would pull the ship back
        if (existing && Date.parse(lastUpdate) < Date.parse(existing.lastUpdate)) return;
        const pending = pendingDetailsRef.current.get(mmsi);
        pendingDetailsRef.current.delete(mmsi);
        const details = { ...existing, ...pending };
        const dist = distanceToBridge(MetaData.latitude, MetaData.longitude);
        let approaching = isApproaching(
          MetaData.latitude,
          MetaData.longitude,
          pos.Cog,
          pos.Sog,
          dist // Pass pre-calculated distance to avoid duplicate calculation
        );

        // Filter out vessels that shouldn't be considered approaching
        const destination = details.destination?.toUpperCase() ?? "";
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
          // The antenna's reports carry no name until it has heard the ship's details
          name: MetaData.ShipName?.trim() || details.name || `MMSI ${mmsi}`,
          latitude: MetaData.latitude,
          longitude: MetaData.longitude,
          cog: pos.Cog,
          sog: pos.Sog,
          trueHeading: pos.TrueHeading,
          navStatus: pos.NavigationalStatus,
          lastUpdate,
          source: MetaData.Source ?? "aisstream",
          signalPower: MetaData.SignalPower,
          ...(MetaData.AisClass === "B" && { classB: true }),
          distanceToBridge: dist,
          approaching,
          notified: existing?.notified ?? false,
          destination: details.destination,
          shipType: details.shipType,
          length: details.length,
          width: details.width,
          dimensions: details.dimensions,
          imo: details.imo,
          vesselInfo: details.vesselInfo,
        };

        // Check for approach notification (not for Class B pleasure craft)
        if (
          !ship.classB &&
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
        if (!ship.classB && dist <= CLOSE_APPROACH_DISTANCE_NM && existing && existing.distanceToBridge > CLOSE_APPROACH_DISTANCE_NM) {
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

        queueShip(ship);
      } else if (MessageType === "ShipStaticData" && Message.ShipStaticData) {
        const staticData = Message.ShipStaticData;
        const updates: Partial<TrackedShip> = {
          destination: staticData.Destination?.trim(),
          shipType: staticData.Type,
          length: (staticData.Dimension?.A ?? 0) + (staticData.Dimension?.B ?? 0),
          width: (staticData.Dimension?.C ?? 0) + (staticData.Dimension?.D ?? 0),
          dimensions: staticData.Dimension && {
            toBow: staticData.Dimension.A,
            toStern: staticData.Dimension.B,
            toPort: staticData.Dimension.C,
            toStarboard: staticData.Dimension.D,
          },
          name: staticData.Name?.trim() || existing?.name,
          imo: staticData.ImoNumber > 0 ? staticData.ImoNumber : existing?.imo,
        };
        applyDetails(mmsi, updates);
      }
    },
    [addNotification, applyDetails, latestShip, queueShip]
  );

  // Use a ref for processMessage so the WebSocket effect doesn't re-run on callback changes
  const processMessageRef = useRef(processMessage);
  useEffect(() => {
    processMessageRef.current = processMessage;
  }, [processMessage]);

  useEffect(() => {
    let isCleanedUp = false;
    // Doubles after each connection that closes before the server sends anything (such as one
    // refused for too many connections from this IP), so a refusal isn't retried every 2s
    let reconnectDelay = MIN_RECONNECT_DELAY_MS;

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
        reconnectDelay = MIN_RECONNECT_DELAY_MS;
        try {
          const data = JSON.parse(event.data);

          // Handle authentication confirmation
          if (data.type === "authenticated") {
            logger.log("[AIS] authenticated successfully");
            return;
          }

          // Shared ship log, kept by the server
          if (data.type === "shipLog" || data.type === "shipLogEntry") {
            setShipLog((prev) => applyShipLogMessage(prev, data) ?? prev);
            return;
          }

          // Wikidata details (photo, build year) the server looked up for a ship
          const vesselInfo = parseVesselInfoMessage(data);
          if (vesselInfo) {
            applyDetails(vesselInfo.mmsi, { vesselInfo: vesselInfo.info });
            return;
          }

          // Aircraft from the server's ADS-B feed, replacing the previous list
          const aircraftList = parseAircraftMessage(data);
          if (aircraftList) {
            setAircraft(aircraftList);
            return;
          }

          // Ship cams' live videos, followed by the server when a stream restarts
          const videoIds = parseShipCamsMessage(data);
          if (videoIds) {
            setShipCamVideoIds(videoIds);
            return;
          }

          // Health of the server's AIS feeds
          const feedStatus = parseFeedStatusMessage(data);
          if (feedStatus) {
            setFeeds(feedStatus);
            return;
          }

          // Handle AIS messages
          const aisMessage = data as AISMessage;
          if (!latestShip(aisMessage.MetaData.MMSI)) {
            logger.log("[AIS] new ship:", aisMessage.MetaData.ShipName, "MMSI:", aisMessage.MetaData.MMSI);
          }
          processMessageRef.current(aisMessage);
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
        // Feed health is unknown until the server reports it again
        setFeeds(null);
        // Aircraft move too fast to leave on the map while disconnected
        setAircraft([]);
        logger.log(`[AIS] reconnecting in ${reconnectDelay / 1000}s...`);
        reconnectTimeoutRef.current = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
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
  }, [applyDetails, latestShip]);

  return {
    ships,
    notifications,
    connectionStatus,
    feeds,
    shipLog,
    aircraft,
    shipCamVideoIds,
    dismissNotification,
    clearNotifications,
  };
}
