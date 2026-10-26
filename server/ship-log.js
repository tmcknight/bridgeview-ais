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

  function recordPassage(mmsi, name, direction, time) {
    const existing = log.get(mmsi);
    const last = existing?.passages[0];
    if (last && new Date(time).getTime() - new Date(last.time).getTime() < DUPLICATE_PASSAGE_WINDOW_MS) {
      recordSighting(mmsi, name, time);
      return;
    }
    logger?.log(`[ship-log] ${name} passed under the bridge ${direction}`);
    update({
      mmsi,
      name,
      passages: [{ time, direction }, ...(existing?.passages ?? [])].slice(0, MAX_PASSAGES_PER_SHIP),
      lastSeen: time,
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
    const mmsi = MetaData.MMSI;
    const t = now();
    const time = new Date(t).toISOString();
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

    const name = MetaData.ShipName?.trim() || known?.name || log.get(mmsi)?.name || `MMSI ${mmsi}`;
    const prev = known && t - known.time <= POSITION_TTL_MS ? known : undefined;
    vessels.set(mmsi, { latitude, longitude, time: t, name });
    pruneVessels(t);

    const direction = detectBridgePassage(prev, { latitude, longitude });
    if (direction) {
      recordPassage(mmsi, name, direction, time);
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
