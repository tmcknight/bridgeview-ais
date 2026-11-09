import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";

// Shared log of ships that have gone under the Blue Water Bridge. The server
// watches the river on its own feed, so passages are logged whether or not
// anyone has the app open, and saves the log to a JSON file.

// Mirrors BRIDGE_CENTER in src/constants/bridge.ts
export const BRIDGE_CENTER = { lat: 42.9982, lng: -82.423 };

// Mirrors AIS_BOUNDING_BOX in src/constants/bridge.ts, so a logged ship's
// last-seen time covers the same area the app shows
export const SHIP_LOG_BOUNDING_BOX = [[42.0, -83.3], [44.3, -81.6]];

// Both positions either side of the bridge line must be this close to the
// bridge (NM) to count as passing under it. Keeps a gap in reports or a
// position glitch from logging a passage the ship never made.
export const PASSAGE_MAX_DISTANCE_NM = 1.5;

// Oldest ships drop off the log beyond this many
export const MAX_SHIP_LOG_ENTRIES = 200;

// Passages kept per ship, newest first
export const MAX_PASSAGES_PER_SHIP = 50;

// Crossings this soon after a passage are position jitter around the bridge
// line, not the ship going back under it
export const DUPLICATE_PASSAGE_WINDOW_MS = 10 * 60_000;

// Only move a logged ship's last-seen time forward in steps this big
export const LAST_SEEN_RESOLUTION_MS = 60_000;

// Forget a ship's last position after this long without a report
const POSITION_TTL_MS = 30 * 60_000;

const SAVE_DELAY_MS = 5000;

const EARTH_RADIUS_NM = 3440.065;
const DEG_TO_RAD = Math.PI / 180;

export function distanceToBridgeNM(lat, lon) {
  const dLat = (lat - BRIDGE_CENTER.lat) * DEG_TO_RAD;
  const dLon = (lon - BRIDGE_CENTER.lng) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat * DEG_TO_RAD) * Math.cos(BRIDGE_CENTER.lat * DEG_TO_RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(a));
}

// Whether a ship went under the bridge between two positions, and which way.
// The bridge runs east-west across the river, so a passage is the ship's
// latitude crossing the bridge's. Upbound = northbound into Lake Huron.
export function detectBridgePassage(prev, next) {
  if (!prev) return null;
  if (
    distanceToBridgeNM(prev.latitude, prev.longitude) > PASSAGE_MAX_DISTANCE_NM ||
    distanceToBridgeNM(next.latitude, next.longitude) > PASSAGE_MAX_DISTANCE_NM
  ) {
    return null;
  }
  const wasNorth = prev.latitude > BRIDGE_CENTER.lat;
  const isNorth = next.latitude > BRIDGE_CENTER.lat;
  if (wasNorth === isNorth) return null;
  return isNorth ? "upbound" : "downbound";
}

// When a report was made, from MetaData.time_utc: ISO 8601 (the antenna, AISHub)
// or AISStream's "2026-11-09 12:34:56.123456789 +0000 UTC". Undefined if unreadable.
export function reportTime(timeUtc) {
  if (typeof timeUtc !== "string") return undefined;
  const iso = Date.parse(timeUtc);
  if (!Number.isNaN(iso)) return iso;
  const m = timeUtc.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?\s*\+0000/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, sec, frac = "0"] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec, Math.floor(Number(`0.${frac}`) * 1000));
}

// When the ship crossed the bridge line between two reports, assuming steady
// progress between them
function crossingTime(prev, next) {
  const span = next.latitude - prev.latitude;
  const fraction = span === 0 ? 1 : (BRIDGE_CENTER.lat - prev.latitude) / span;
  return Math.round(prev.time + (next.time - prev.time) * Math.min(1, Math.max(0, fraction)));
}

function isPlaceholderName(name, mmsi) {
  return !name || name === `MMSI ${mmsi}`;
}

function isShipLogEntry(v) {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.mmsi === "number" &&
    typeof v.name === "string" &&
    typeof v.lastSeen === "string" &&
    Array.isArray(v.passages) &&
    v.passages.length > 0
  );
}

export function loadShipLogFile(file, logger) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return new Map();
    return new Map(parsed.filter(isShipLogEntry).map((entry) => [entry.mmsi, entry]));
  } catch (err) {
    if (err.code !== "ENOENT") logger?.warn(`[ship-log] could not load ${file}: ${err.message}`);
    return new Map();
  }
}

// Write to a temp file then rename, so a crash mid-write can't corrupt the log
export function saveShipLogFile(file, entries) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries));
  fs.renameSync(tmp, file);
}

// Feed AISStream-shaped messages to handleMessage(). Emits "entry" with the
// updated ShipLogEntry whenever a ship's log entry changes.
export function createShipLog({ file, logger, now = Date.now, saveDelayMs = SAVE_DELAY_MS }) {
  const emitter = new EventEmitter();
  const log = file ? loadShipLogFile(file, logger) : new Map();
  const vessels = new Map(); // mmsi -> { latitude, longitude, time, name }
  let saveTimer = null;

  logger?.info(`[ship-log] ${log.size} ships in log${file ? ` (${file})` : ""}`);

  function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!file) return;
    try {
      saveShipLogFile(file, Array.from(log.values()));
    } catch (err) {
      logger?.error(`[ship-log] could not save ${file}: ${err.message}`);
    }
  }

  function scheduleSave() {
    if (!saveTimer) saveTimer = setTimeout(save, saveDelayMs);
  }

  function update(entry) {
    log.set(entry.mmsi, entry);
    if (log.size > MAX_SHIP_LOG_ENTRIES) {
      const oldest = Array.from(log.values()).sort((a, b) => a.lastSeen.localeCompare(b.lastSeen))[0];
      log.delete(oldest.mmsi);
    }
    scheduleSave();
    emitter.emit("entry", entry);
  }

  // `time` is when the ship crossed, `seen` the report that showed it had
  function recordPassage(mmsi, name, direction, time, seen) {
    const existing = log.get(mmsi);
    const last = existing?.passages[0];
    if (last && new Date(time).getTime() - new Date(last.time).getTime() < DUPLICATE_PASSAGE_WINDOW_MS) {
      recordSighting(mmsi, name, seen);
      return;
    }
    logger?.log(`[ship-log] ${name} passed under the bridge ${direction}`);
    update({
      mmsi,
      name,
      passages: [{ time, direction }, ...(existing?.passages ?? [])].slice(0, MAX_PASSAGES_PER_SHIP),
      lastSeen: seen,
    });
  }

  function recordSighting(mmsi, name, time) {
    const existing = log.get(mmsi);
    if (!existing) return;
    const elapsed = new Date(time).getTime() - new Date(existing.lastSeen).getTime();
    const renamed = name !== existing.name && !isPlaceholderName(name, mmsi);
    if (elapsed < LAST_SEEN_RESOLUTION_MS && !renamed) return;
    update({
      ...existing,
      name: renamed ? name : existing.name,
      lastSeen: elapsed > 0 ? time : existing.lastSeen,
    });
  }

  function pruneVessels(t) {
    if (vessels.size < 5000) return;
    for (const [mmsi, v] of vessels) {
      if (t - v.time > POSITION_TTL_MS) vessels.delete(mmsi);
    }
  }

  function handleMessage(message) {
    const { MessageType, MetaData, Message } = message ?? {};
    if (!MetaData || typeof MetaData.MMSI !== "number") return;
    // Class B craft (pleasure boats, small workboats) are shown but not logged
    if (MetaData.AisClass === "B") return;
    const mmsi = MetaData.MMSI;
    const t = now();
    // Reports can arrive late (AISHub is polled once a minute and its reports can be
    // minutes old), so go by when the report was made, never later than now
    const reported = reportTime(MetaData.time_utc);
    const r = reported === undefined ? t : Math.min(reported, t);
    const time = new Date(r).toISOString();
    const known = vessels.get(mmsi);

    if (MessageType === "ShipStaticData" && Message?.ShipStaticData) {
      const name = Message.ShipStaticData.Name?.trim();
      if (!isPlaceholderName(name, mmsi)) {
        if (known) known.name = name;
        recordSighting(mmsi, name, time);
      }
      return;
    }

    if (MessageType !== "PositionReport") return;
    const { latitude, longitude } = MetaData;
    if (typeof latitude !== "number" || typeof longitude !== "number") return;

    // An older report than one already handled (a slower feed catching up) would
    // put the ship back where it was and log a crossing it never made
    if (known && r < known.time) return;

    const name = MetaData.ShipName?.trim() || known?.name || log.get(mmsi)?.name || `MMSI ${mmsi}`;
    const prev = known && r - known.time <= POSITION_TTL_MS ? known : undefined;
    const next = { latitude, longitude, time: r, name };
    vessels.set(mmsi, next);
    pruneVessels(t);

    const direction = detectBridgePassage(prev, next);
    if (direction) {
      recordPassage(mmsi, name, direction, new Date(crossingTime(prev, next)).toISOString(), time);
    } else {
      recordSighting(mmsi, name, time);
    }
  }

  emitter.handleMessage = handleMessage;
  emitter.entries = () => Array.from(log.values());
  emitter.flush = () => {
    if (saveTimer) save();
  };
  return emitter;
}
