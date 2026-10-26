// The ship log lives on the WebSocket server (server/ship-log.js), which
// sends a snapshot on subscribe and each changed entry after that

export type PassageDirection = "upbound" | "downbound";

export interface BridgePassage {
  time: string;
  /** Upbound = northbound into Lake Huron; downbound = southbound */
  direction: PassageDirection;
}

export interface ShipLogEntry {
  mmsi: number;
  name: string;
  /** Newest first */
  passages: BridgePassage[];
  lastSeen: string;
}

export type ShipLog = Map<number, ShipLogEntry>;

export interface ShipLogSnapshotMessage {
  type: "shipLog";
  entries: ShipLogEntry[];
}

export interface ShipLogEntryMessage {
  type: "shipLogEntry";
  entry: ShipLogEntry;
}

/**
 * Apply a ship log message from the server. Returns null for anything that
 * isn't one, so callers can fall through to AIS message handling.
 */
export function applyShipLogMessage(log: ShipLog, data: unknown): ShipLog | null {
  const message = data as ShipLogSnapshotMessage | ShipLogEntryMessage | null;
  if (message?.type === "shipLog" && Array.isArray(message.entries)) {
    return new Map(message.entries.map((entry): [number, ShipLogEntry] => [entry.mmsi, entry]));
  }
  if (message?.type === "shipLogEntry" && message.entry) {
    const next = new Map(log);
    next.set(message.entry.mmsi, message.entry);
    return next;
  }
  return null;
}

/** Logged ships, most recent passage first */
export function sortShipLog(log: ShipLog): ShipLogEntry[] {
  return Array.from(log.values()).sort((a, b) =>
    (b.passages[0]?.time ?? "").localeCompare(a.passages[0]?.time ?? "")
  );
}
