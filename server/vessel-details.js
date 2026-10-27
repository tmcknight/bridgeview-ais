import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { isValidImo, isValidMmsi } from "./wikidata.js";

// Our own record of each ship's details (name, destination, size, type), from
// either feed, kept in SQLite. Ships broadcast details only every 6 minutes, and
// a weak signal often garbles them, so the server keeps what it has heard: a
// client gets a ship's details with its first position, and the antenna's
// position reports (which carry no name) get the name filled in.
//
// With a fetchInfo function, it also looks each ship up on Wikidata (photo,
// build year, operator), stores the result, and emits "info" (mmsi, info).

// Look a ship up again after this long, or straight away once its IMO number is known
export const INFO_REFRESH_MS = 30 * 24 * 60 * 60_000;
// Wikidata often gains ships, so retry misses sooner
export const INFO_MISS_RETRY_MS = 7 * 24 * 60 * 60_000;
// After a failed lookup (e.g. Wikidata down), wait before trying that ship again
export const INFO_FAILURE_RETRY_MS = 10 * 60_000;
// Gap between Wikidata queries, to stay well within its limits
export const INFO_LOOKUP_INTERVAL_MS = 1000;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS vessels (
    mmsi INTEGER PRIMARY KEY,
    name TEXT,
    call_sign TEXT,
    imo INTEGER,
    ship_type INTEGER,
    destination TEXT,
    length INTEGER,
    width INTEGER,
    draught REAL,
    -- Latest ShipStaticData message as received, sent on to clients
    details_message TEXT,
    details_source TEXT,
    details_updated_at TEXT,
    first_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;

// Columns added after the table was first created, added to older databases on open
const ADDED_COLUMNS = {
  // Wikidata result as JSON; NULL with vessel_info_at set means no match
  vessel_info: "TEXT",
  // "mmsi:imo" the lookup used, so learning an IMO number triggers a new one
  vessel_info_key: "TEXT",
  vessel_info_at: "TEXT",
};

function openDatabase(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  const columns = new Set(db.prepare("PRAGMA table_info(vessels)").all().map((c) => c.name));
  for (const [name, type] of Object.entries(ADDED_COLUMNS)) {
    if (!columns.has(name)) db.exec(`ALTER TABLE vessels ADD COLUMN ${name} ${type}`);
  }
  return db;
}

export function createVesselDetails({
  file = ":memory:",
  logger,
  now = () => new Date(),
  fetchInfo = null,
  lookupIntervalMs = INFO_LOOKUP_INTERVAL_MS,
} = {}) {
  const emitter = new EventEmitter();
  const db = openDatabase(file);

  const upsertName = db.prepare(`
    INSERT INTO vessels (mmsi, name, first_seen_at, updated_at)
    VALUES (:mmsi, :name, :now, :now)
    ON CONFLICT (mmsi) DO UPDATE SET name = :name, updated_at = :now
  `);
  const upsertDetails = db.prepare(`
    INSERT INTO vessels (
      mmsi, name, call_sign, imo, ship_type, destination, length, width, draught,
      details_message, details_source, details_updated_at, first_seen_at, updated_at
    ) VALUES (
      :mmsi, :name, :call_sign, :imo, :ship_type, :destination, :length, :width, :draught,
      :details_message, :details_source, :now, :now, :now
    )
    ON CONFLICT (mmsi) DO UPDATE SET
      name = COALESCE(:name, name),
      call_sign = :call_sign,
      imo = COALESCE(:imo, imo),
      ship_type = :ship_type,
      destination = :destination,
      length = :length,
      width = :width,
      draught = :draught,
      details_message = :details_message,
      details_source = :details_source,
      details_updated_at = :now,
      updated_at = :now
  `);
  const updateInfo = db.prepare(`
    INSERT INTO vessels (mmsi, vessel_info, vessel_info_key, vessel_info_at, first_seen_at, updated_at)
    VALUES (:mmsi, :info, :key, :now, :now, :now)
    ON CONFLICT (mmsi) DO UPDATE SET vessel_info = :info, vessel_info_key = :key, vessel_info_at = :now
  `);
  const selectDetails = db.prepare("SELECT details_message FROM vessels WHERE mmsi = ?");
  const selectInfo = db.prepare("SELECT vessel_info, vessel_info_at FROM vessels WHERE mmsi = ?");

  // Checked on every message, so keep what's needed in memory too
  const names = new Map();
  const imos = new Map();
  const lookups = new Map(); // mmsi -> { key, at (ms), found }
  for (const row of db.prepare("SELECT mmsi, name, imo, vessel_info IS NOT NULL AS found, vessel_info_key, vessel_info_at FROM vessels").all()) {
    if (row.name) names.set(row.mmsi, row.name);
    if (row.imo) imos.set(row.mmsi, row.imo);
    if (row.vessel_info_at) {
      lookups.set(row.mmsi, { key: row.vessel_info_key, at: Date.parse(row.vessel_info_at), found: Boolean(row.found) });
    }
  }
  logger?.info(`[vessels] ${names.size} ships known${file === ":memory:" ? "" : ` (${file})`}`);

  const queue = new Set(); // mmsi waiting for a Wikidata lookup, in order
  const failedAt = new Map(); // mmsi -> ms of last failed lookup
  let lookupTimer = null;
  let lookupRunning = false;
  let closed = false;

  const lookupKey = (mmsi) => `${mmsi}:${imos.get(mmsi) ?? ""}`;

  function needsLookup(mmsi) {
    if (!fetchInfo || queue.has(mmsi)) return false;
    if (!isValidMmsi(mmsi) && !isValidImo(imos.get(mmsi))) return false;
    const t = now().getTime();
    if (t - (failedAt.get(mmsi) ?? -Infinity) < INFO_FAILURE_RETRY_MS) return false;
    const last = lookups.get(mmsi);
    if (!last || last.key !== lookupKey(mmsi)) return true;
    return t - last.at > (last.found ? INFO_REFRESH_MS : INFO_MISS_RETRY_MS);
  }

  function scheduleLookup() {
    if (lookupTimer || lookupRunning || closed || queue.size === 0) return;
    lookupTimer = setTimeout(runLookup, lookupIntervalMs);
    lookupTimer.unref?.();
  }

  async function runLookup() {
    lookupTimer = null;
    const mmsi = queue.values().next().value;
    if (mmsi === undefined) return;
    queue.delete(mmsi);
    lookupRunning = true;
    const key = lookupKey(mmsi);
    try {
      const info = await fetchInfo(mmsi, imos.get(mmsi));
      if (closed) return;
      const at = now();
      updateInfo.run({ mmsi, info: info ? JSON.stringify(info) : null, key, now: at.toISOString() });
      lookups.set(mmsi, { key, at: at.getTime(), found: Boolean(info) });
      failedAt.delete(mmsi);
      emitter.emit("info", mmsi, info);
    } catch (err) {
      failedAt.set(mmsi, now().getTime());
      logger?.warn(`[vessels] Wikidata lookup for ${mmsi} failed: ${err.message}`);
    } finally {
      lookupRunning = false;
      scheduleLookup();
    }
  }

  function queueLookupIfNeeded(mmsi) {
    if (!needsLookup(mmsi)) return;
    queue.add(mmsi);
    scheduleLookup();
  }

  function handleDetails(message, mmsi) {
    const data = message.Message.ShipStaticData;
    const name = (data.Name || "").trim() || null;
    const dim = data.Dimension ?? {};
    upsertDetails.run({
      mmsi,
      name,
      call_sign: (data.CallSign || "").trim() || null,
      imo: data.ImoNumber > 0 ? data.ImoNumber : null,
      ship_type: data.Type ?? null,
      destination: (data.Destination || "").trim() || null,
      length: (dim.A ?? 0) + (dim.B ?? 0) || null,
      width: (dim.C ?? 0) + (dim.D ?? 0) || null,
      draught: data.Draught || null,
      details_message: JSON.stringify(message),
      details_source: message.MetaData.Source ?? "aisstream",
      now: now().toISOString(),
    });
    if (name) names.set(mmsi, name);
    if (data.ImoNumber > 0) imos.set(mmsi, data.ImoNumber);
  }

  return Object.assign(emitter, {
    handleMessage(message) {
      const mmsi = message?.MetaData?.MMSI;
      if (typeof mmsi !== "number") return;
      try {
        if (message.MessageType === "ShipStaticData" && message.Message?.ShipStaticData) {
          handleDetails(message, mmsi);
        } else {
          // AISStream fills in names on position reports; only write when one changes
          const name = (message.MetaData.ShipName || "").trim();
          if (name && names.get(mmsi) !== name) {
            upsertName.run({ mmsi, name, now: now().toISOString() });
            names.set(mmsi, name);
          }
        }
        queueLookupIfNeeded(mmsi);
      } catch (err) {
        logger?.error(`[vessels] could not save details for ${mmsi}: ${err.message}`);
      }
    },

    name(mmsi) {
      return names.get(mmsi);
    },

    // The latest ShipStaticData message heard for a ship, if any
    detailsMessage(mmsi) {
      const row = selectDetails.get(mmsi);
      return row?.details_message ? JSON.parse(row.details_message) : undefined;
    },

    // The ship's stored Wikidata details: VesselInfo, null for no match, or
    // undefined when it hasn't been looked up yet
    vesselInfo(mmsi) {
      const row = selectInfo.get(mmsi);
      if (!row?.vessel_info_at) return undefined;
      return row.vessel_info ? JSON.parse(row.vessel_info) : null;
    },

    close() {
      closed = true;
      clearTimeout(lookupTimer);
      db.close();
    },
  });
}
