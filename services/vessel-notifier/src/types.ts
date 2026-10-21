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

/** A geographic point to watch for passing vessels */
export interface WatchPoint {
  /** Stable identifier (used for cooldown tracking and in webhook payloads) */
  id: string;
  /** Human-readable name, e.g. "Blue Water Bridge" */
  name: string;
  latitude: number;
  longitude: number;
  /** A vessel counts as passing when its track comes within this many NM */
  radiusNM: number;
}

/** Tracked vessel state */
export interface TrackedVessel {
  mmsi: number;
  name: string;
  latitude: number;
  longitude: number;
  cog: number;
  sog: number;
  heading?: number;
  navStatus?: number;
  lastUpdate: number;
  destination?: string;
  shipType?: number;
  length?: number;
  beam?: number;
  imo?: number;
  callSign?: string;
}

/** Supplementary vessel details looked up from Wikidata by MMSI / IMO */
export interface VesselInfo {
  wikidataId: string;
  wikidataUrl: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  imagePageUrl?: string;
  yearBuilt?: number;
  builder?: string;
  operator?: string;
  grossTonnage?: number;
  wikipediaUrl?: string;
}

/** Fired when a vessel passes a watch point (at or just after closest approach) */
export interface PassageEvent {
  watchPoint: WatchPoint;
  mmsi: number;
  name: string;
  latitude: number;
  longitude: number;
  speed: number;
  course: number;
  heading?: number;
  navStatus?: number;
  /** Distance (NM) from the point at the time of the report */
  distance: number;
  /** Closest the vessel's track came (or is predicted to come) to the point (NM) */
  closestApproach: number;
  /** True when predicted from speed/course; false when observed after the fact */
  predicted: boolean;
  direction: "northbound" | "southbound";
  timestamp: number;
  destination?: string;
  shipType?: number;
  length?: number;
  beam?: number;
  imo?: number;
  callSign?: string;
  /** Wikidata details, when the vessel is on Wikidata and the lookup finished in time */
  vesselInfo?: VesselInfo;
}

/** Notifier service configuration */
export interface NotifierConfig {
  /** ntfy server URL (default: https://ntfy.sh) */
  ntfyServer: string;
  /** ntfy topic name (ntfy disabled when unset) */
  ntfyTopic?: string;
  /** ntfy access token (optional) */
  ntfyToken?: string;
  /** WebSocket proxy URL to connect to */
  wsProxyUrl: string;
  /** WebSocket auth token (optional) */
  wsAuthToken?: string;
  /** Webhook URL to POST passage events to (optional) */
  webhookUrl?: string;
  /** Shared secret used to sign webhook payloads (optional) */
  webhookSecret?: string;
  /** Look up vessel details on Wikidata (default: true) */
  vesselInfoLookup: boolean;
  /** Points to watch; defaults to the Blue Water Bridge */
  watchPoints?: WatchPoint[];
  /** Default radius in NM for the Blue Water Bridge watch point */
  bridgeThresholdNM: number;
  /** Cooldown in ms before re-notifying about the same vessel */
  notificationCooldownMs: number;
  /** How long to keep stale vessels in tracker (ms) */
  staleVesselTimeoutMs: number;
  /** How far ahead (s) to predict passages from speed and course */
  predictionHorizonSeconds?: number;
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
