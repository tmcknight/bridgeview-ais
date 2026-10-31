import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { isValidImo, isValidMmsi } from "./wikidata.js";
import { completeVesselInfo } from "./vessel-info.js";
import { applyOverrides, hasOverrides } from "./vessel-overrides.js";

// Our own record of each ship's details (name, destination, size, type), from
// either feed, kept in SQLite. Ships broadcast details only every 6 minutes, and
// a weak signal often garbles them, so the server keeps what it has heard: a
// client gets a ship's details with its first position, and the antenna's
// position reports (which carry no name) get the name filled in.
//
// With a fetchInfo function (server/vessel-info.js), it also looks each ship
// up (Wikidata, USCG PSIX, Commons photos), stores the result, and emits "info" (mmsi, info).
// With a registry (server/vessel-registry.js), a ship's register record is
// added at read time, so register updates show up at once. Corrections made on
// the admin page (server/vessel-overrides.js) are stored apart and applied last.

// Look a ship up again after this long, or straight away once its IMO number or call sign is known
export const INFO_REFRESH_MS = 30 * 24 * 60 * 60_000;
// Wikidata often gains ships, so retry misses sooner
export const INFO_MISS_RETRY_MS = 7 * 24 * 60 * 60_000;
// After a failed lookup (e.g. Wikidata down), wait before trying that ship again
export const INFO_FAILURE_RETRY_MS = 10 * 60_000;
// Gap between lookups, to stay well within Wikidata's, PSIX's and Commons' limits
export const INFO_LOOKUP_INTERVAL_MS = 1000;

// The admin page's ship type filter: AIS ship type ranges, by name
export const SHIP_TYPE_FILTERS = {
  cargo: "ship_type BETWEEN 70 AND 79",
  tanker: "ship_type BETWEEN 80 AND 89",
  passenger: "ship_type BETWEEN 60 AND 69",
  tug: "ship_type IN (31, 32, 52)",
  pleasure: "ship_type IN (36, 37)",
  fishing: "ship_type = 30",
  other: "ship_type NOT BETWEEN 60 AND 89 AND ship_type NOT IN (0, 30, 31, 32, 36, 37, 52)",
  unknown: "(ship_type IS NULL OR ship_type = 0)",
};

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
  // Lookup result (Wikidata, USCG) as JSON; NULL with vessel_info_at set means no match
  vessel_info: "TEXT",
  // "mmsi:imo:callsign" the lookup used, so learning either triggers a new one
  vessel_info_key: "TEXT",
  vessel_info_at: "TEXT",
  // Corrections from the admin page as JSON (server/vessel-overrides.js)
  admin_overrides: "TEXT",
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
  registry = null,
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
  const updateOverrides = db.prepare(`
    INSERT INTO vessels (mmsi, admin_overrides, first_seen_at, updated_at)
    VALUES (:mmsi, :overrides, :now, :now)
    ON CONFLICT (mmsi) DO UPDATE SET admin_overrides = :overrides
  `);
  const selectInfo = db.prepare("SELECT vessel_info, vessel_info_at, admin_overrides FROM vessels WHERE mmsi = ?");
  const selectOverrides = db.prepare("SELECT admin_overrides FROM vessels WHERE mmsi = ?");
  const selectRecord = db.prepare(
    "SELECT name, call_sign, imo, ship_type, destination, length, width, draught FROM vessels WHERE mmsi = ?"
  );

  // Checked on every message, so keep what's needed in memory too
  const names = new Map();
  const imos = new Map();
  const callSigns = new Map();
  const lookups = new Map(); // mmsi -> { key, at (ms), found }
  for (const row of db.prepare("SELECT mmsi, name, imo, call_sign, vessel_info IS NOT NULL AS found, vessel_info_key, vessel_info_at FROM vessels").all()) {
    if (row.name) names.set(row.mmsi, row.name);
    if (row.imo) imos.set(row.mmsi, row.imo);
    if (row.call_sign) callSigns.set(row.mmsi, row.call_sign);
    if (row.vessel_info_at) {
      lookups.set(row.mmsi, { key: row.vessel_info_key, at: Date.parse(row.vessel_info_at), found: Boolean(row.found) });
    }
  }
  logger?.info(`[vessels] ${names.size} ships known${file === ":memory:" ? "" : ` (${file})`}`);

  const queue = new Set(); // mmsi waiting for a details lookup, in order
  const failedAt = new Map(); // mmsi -> ms of last failed lookup
  let lookupTimer = null;
  let lookupRunning = false;
  let closed = false;

  const withRegistry = (mmsi, info) => completeVesselInfo(info, registry?.lookup(imos.get(mmsi)));
  const overridesOf = (mmsi) => {
    const row = selectOverrides.get(mmsi);
    return row?.admin_overrides ? JSON.parse(row.admin_overrides) : undefined;
  };

  const lookupKey = (mmsi) => `${mmsi}:${imos.get(mmsi) ?? ""}:${callSigns.get(mmsi) ?? ""}`;

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
      const info = await fetchInfo(mmsi, { imo: imos.get(mmsi), callSign: callSigns.get(mmsi), name: names.get(mmsi) });
      if (closed) return;
      const at = now();
      updateInfo.run({ mmsi, info: info ? JSON.stringify(info) : null, key, now: at.toISOString() });
      lookups.set(mmsi, { key, at: at.getTime(), found: Boolean(info) });
      failedAt.delete(mmsi);
      emitter.emit("info", mmsi, applyOverrides(withRegistry(mmsi, info), overridesOf(mmsi)));
    } catch (err) {
      failedAt.set(mmsi, now().getTime());
      logger?.warn(`[vessels] details lookup for ${mmsi} failed: ${err.message}`);
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
    const callSign = (data.CallSign || "").trim() || null;
    const dim = data.Dimension ?? {};
    upsertDetails.run({
      mmsi,
      name,
      call_sign: callSign,
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
    if (callSign) callSigns.set(mmsi, callSign);
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

    // What's stored about a ship ({ name, callSign, imo, shipType, destination,
    // length, width, draught }, missing fields left out), or undefined if unknown
    record(mmsi) {
      const row = selectRecord.get(mmsi);
      if (!row) return undefined;
      const record = {
        name: row.name,
        callSign: row.call_sign,
        imo: row.imo,
        shipType: row.ship_type,
        destination: row.destination,
        length: row.length,
        width: row.width,
        draught: row.draught,
      };
      return Object.fromEntries(Object.entries(record).filter(([, value]) => value != null));
    },

    // The ship's stored details (Wikidata, USCG, Transport Canada): VesselInfo,
    // null for no match, or undefined when it hasn't been looked up yet
    vesselInfo(mmsi) {
      const row = selectInfo.get(mmsi);
      const overrides = row?.admin_overrides ? JSON.parse(row.admin_overrides) : undefined;
      if (!row?.vessel_info_at) return hasOverrides(overrides) ? applyOverrides({}, overrides) : undefined;
      return applyOverrides(withRegistry(mmsi, row.vessel_info ? JSON.parse(row.vessel_info) : null), overrides);
    },

    // Ships matching the admin page's search, most recently updated first, a
    // page at a time, with how many match in all and how many photos each shows
    search({ query = "", overriddenOnly = false, type, limit = 50, offset = 0 } = {}) {
      const q = query.trim();
      const conditions = [];
      const params = {};
      if (q) {
        conditions.push("(name LIKE :like ESCAPE '\\' OR call_sign LIKE :like ESCAPE '\\' OR CAST(mmsi AS TEXT) LIKE :prefix OR CAST(imo AS TEXT) LIKE :prefix)");
        const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
        params.like = `%${escaped}%`;
        params.prefix = `${escaped}%`;
      }
      if (overriddenOnly) conditions.push("admin_overrides IS NOT NULL");
      if (type && Object.hasOwn(SHIP_TYPE_FILTERS, type)) conditions.push(`(${SHIP_TYPE_FILTERS[type]})`);
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const { total } = db.prepare(`SELECT COUNT(*) AS total FROM vessels ${where}`).get(params);
      const rows = db
        .prepare(`
          SELECT mmsi, name, imo, call_sign, ship_type, length, updated_at,
            vessel_info IS NOT NULL AS found, admin_overrides IS NOT NULL AS overridden
          FROM vessels ${where}
          ORDER BY updated_at DESC LIMIT :limit OFFSET :offset
        `)
        .all({ ...params, limit: Math.min(Math.max(limit, 1), 200), offset: Math.max(offset, 0) });
      const ships = rows.map((row) => ({
        mmsi: row.mmsi,
        name: row.name ?? undefined,
        imo: row.imo ?? undefined,
        callSign: row.call_sign ?? undefined,
        shipType: row.ship_type ?? undefined,
        length: row.length ?? undefined,
        updatedAt: row.updated_at,
        found: Boolean(row.found),
        overridden: Boolean(row.overridden),
        photoCount: this.vesselInfo(row.mmsi)?.photos?.length ?? 0,
      }));
      return { ships, total };
    },

    // For the admin page: what the lookups found (with the registers), the
    // corrections, and the result, or undefined for a ship never heard of
    adminView(mmsi) {
      const row = selectInfo.get(mmsi);
      if (!row) return undefined;
      const lookedUp = row.vessel_info_at ? withRegistry(mmsi, row.vessel_info ? JSON.parse(row.vessel_info) : null) : undefined;
      const overrides = row.admin_overrides ? JSON.parse(row.admin_overrides) : {};
      return {
        mmsi,
        record: this.record(mmsi),
        lookedUp: lookedUp ?? null,
        lookedUpAt: row.vessel_info_at ?? null,
        overrides,
        info: this.vesselInfo(mmsi) ?? null,
      };
    },

    overrides(mmsi) {
      return overridesOf(mmsi) ?? {};
    },

    // Stores a ship's corrections (from parseOverrides; {} clears them) and
    // sends its details on to clients
    setOverrides(mmsi, overrides) {
      updateOverrides.run({
        mmsi,
        overrides: hasOverrides(overrides) ? JSON.stringify(overrides) : null,
        now: now().toISOString(),
      });
      emitter.emit("info", mmsi, this.vesselInfo(mmsi) ?? null);
    },

    // Looks a ship up again now, whenever it was last looked up; false when
    // lookups are off
    refresh(mmsi) {
      if (!fetchInfo) return false;
      failedAt.delete(mmsi);
      queue.delete(mmsi);
      queue.add(mmsi);
      scheduleLookup();
      return true;
    },

    close() {
      closed = true;
      clearTimeout(lookupTimer);
      db.close();
    },
  });
}
