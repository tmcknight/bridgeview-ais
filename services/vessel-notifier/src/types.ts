/** AIS message metadata from AISStream.io */
export interface AISMetaData {
  MMSI: number;
  MMSI_String: string;
  ShipName: string;
  latitude: number;
  longitude: number;
  time_utc: string;
}

/** AIS position report */
export interface PositionReport {
  Cog: number;
  Latitude: number;
  Longitude: number;
  NavigationalStatus: number;
  Sog: number;
  TrueHeading: number;
  UserID: number;
}

/** AIS static data */
export interface ShipStaticData {
  CallSign: string;
  Destination: string;
  Dimension: {
    A: number;
    B: number;
    C: number;
    D: number;
  };
  ImoNumber: number;
  Name: string;
  Type: number;
  UserID: number;
}

/** Complete AIS message from AISStream.io */
export interface AISMessage {
  Message: {
    PositionReport?: PositionReport;
    ShipStaticData?: ShipStaticData;
  };
  MessageType: string;
  MetaData: AISMetaData;
}

/** Tracked vessel state */
export interface TrackedVessel {
  mmsi: number;
  name: string;
  latitude: number;
  longitude: number;
  cog: number;
  sog: number;
  distanceToBridge: number;
  lastUpdate: number;
  destination?: string;
  shipType?: number;
  length?: number;
}

/** Bridge crossing event */
export interface BridgeCrossingEvent {
  mmsi: number;
  name: string;
  speed: number;
  course: number;
  distance: number;
  direction: "northbound" | "southbound";
  timestamp: number;
  destination?: string;
  shipType?: number;
  length?: number;
}

/** Notifier service configuration */
export interface NotifierConfig {
  /** ntfy server URL (default: https://ntfy.sh) */
  ntfyServer: string;
  /** ntfy topic name */
  ntfyTopic: string;
  /** ntfy access token (optional) */
  ntfyToken?: string;
  /** WebSocket proxy URL to connect to */
  wsProxyUrl: string;
  /** WebSocket auth token (optional) */
  wsAuthToken?: string;
  /** Distance threshold in NM to trigger "passing under" notification */
  bridgeThresholdNM: number;
  /** Cooldown in ms before re-notifying about the same vessel */
  notificationCooldownMs: number;
  /** How long to keep stale vessels in tracker (ms) */
  staleVesselTimeoutMs: number;
}

/** Navigation status labels */
export const NAV_STATUS_LABELS: Record<number, string> = {
  0: "Under way using engine",
  1: "At anchor",
  2: "Not under command",
  3: "Restricted manoeuvrability",
  4: "Constrained by draught",
  5: "Moored",
  6: "Aground",
  7: "Engaged in fishing",
  8: "Under way sailing",
};
