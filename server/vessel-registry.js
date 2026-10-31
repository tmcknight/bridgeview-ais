import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { isValidImo } from "./wikidata.js";

// Transport Canada's Canadian Register of Large Vessels (open data, Open
// Government Licence - Canada), stored in SQLite and looked up by IMO number.
// It covers every Canadian-flag laker: build year, gross tonnage, port of
// registry, size and engine power, which fill in what Wikidata lacks.
// The register is published as one XLSX file, refreshed here once a week.

export const TC_REGISTRY_URL = "https://opendatatc.tc.canada.ca/large-vessel-registry_dataset_en.xlsx";
export const REGISTRY_REFRESH_MS = 7 * 24 * 60 * 60_000;
// After a failed download, try again after this long
export const REGISTRY_RETRY_MS = 60 * 60_000;

const SOURCE = "transport-canada";
const HP_TO_KW = 0.7457;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS registry_vessels (
    imo INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    -- RegistryRecord as JSON
    record TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS registry_imports (
    source TEXT PRIMARY KEY,
    imported_at TEXT NOT NULL,
    count INTEGER NOT NULL
  );
`;

// --- XLSX reading: just enough of ZIP and SpreadsheetML for one plain sheet ---

// name -> Buffer for each file in a ZIP archive (stored or deflated, no ZIP64)
export function unzip(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65_535); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a ZIP file");
  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error("bad ZIP central directory");
    const method = buffer.readUInt16LE(p + 10);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const nameLength = buffer.readUInt16LE(p + 28);
    const extraLength = buffer.readUInt16LE(p + 30);
    const commentLength = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString("utf8", p + 46, p + 46 + nameLength);
    p += 46 + nameLength + extraLength + commentLength;

    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(start, start + compressedSize);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, zlib.inflateRawSync(data));
    else throw new Error(`unsupported ZIP compression ${method} for ${name}`);
  }
  return files;
}

function decodeXml(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e.toLowerCase()];
  });
}

function textRuns(xml) {
  let text = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)) text += m[1];
  return decodeXml(text);
}

function columnIndex(letters) {
  let n = 0;
  for (const c of letters) n = n * 26 + c.charCodeAt(0) - 64;
  return n - 1;
}

// The first sheet's rows, each an array of cell text
export function readXlsxRows(buffer) {
  const files = unzip(buffer);
  const sharedXml = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1]));
  const sheet = files.get("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("XLSX has no first sheet");

  const rows = [];
  for (const rowMatch of sheet.toString("utf8").matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cell of rowMatch[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, attrs, body = ""] = cell;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const value = /<v>([^<]*)<\/v>/.exec(body)?.[1];
      let text = "";
      if (type === "s" && value !== undefined) text = shared[Number(value)] ?? "";
      else if (type === "inlineStr") text = textRuns(body);
      else if (value !== undefined) text = decodeXml(value);
      row[columnIndex(ref)] = text;
    }
    rows.push(Array.from(row, (v) => v ?? ""));
  }
  return rows;
}

// --- Transport Canada rows to records ---

function number(text) {
  const n = Number(text);
  return text !== "" && Number.isFinite(n) && n > 0 ? n : undefined;
}

function year(text) {
  // "2012" or "201204" (year and month)
  const y = Number(/^\d{4}/.exec(text)?.[0]);
  return y >= 1800 ? y : undefined;
}

function powerKw(power, unit) {
  const n = number(power);
  if (n === undefined) return undefined;
  if (unit === "KILOWATTS") return Math.round(n);
  if (/HORSEPOWER/.test(unit)) return Math.round(n * HP_TO_KW);
  return undefined;
}

// The register's rows as RegistryRecords by IMO number; ships without an IMO
// number (mostly small craft) are left out, and the first row wins for an IMO
export function parseRegistryRows(rows) {
  const [header = [], ...data] = rows;
  const col = Object.fromEntries(header.map((name, i) => [name.trim(), i]));
  const get = (row, name) => (row[col[name]] ?? "").trim();

  const records = new Map();
  for (const row of data) {
    const imo = Number(get(row, "IMO Vessel Number"));
    if (!isValidImo(imo) || records.has(imo)) continue;
    const record = {
      source: SOURCE,
      officialNumber: get(row, "Official Number").replace(/\.0$/, "") || undefined,
      name: get(row, "Vessel Name") || undefined,
      hullNumber: get(row, "Hull Number") || undefined,
      vesselType: get(row, "Vessel Descriptor") || undefined,
      yearBuilt: year(get(row, "Year of Build")),
      yearRebuilt: year(get(row, "Year of Latest Rebuild")),
      portOfRegistry: get(row, "Port of Registry") || undefined,
      grossTonnage: number(get(row, "Gross Tonnage")),
      netTonnage: number(get(row, "Net Tonnage")),
      length: number(get(row, "Length")),
      breadth: number(get(row, "Breadth")),
      depth: number(get(row, "Depth")),
      speed: number(get(row, "Speed (Knots)")),
      enginePowerKw: powerKw(get(row, "Engine Propulsion Power"), get(row, "Unit/Brake Power")),
    };
    records.set(imo, Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined)));
  }
  return records;
}

export function createVesselRegistry({
  file = ":memory:",
  logger,
  now = () => new Date(),
  url = TC_REGISTRY_URL,
  fetchImpl = fetch,
  refreshMs = REGISTRY_REFRESH_MS,
  retryMs = REGISTRY_RETRY_MS,
} = {}) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);

  const selectRecord = db.prepare("SELECT record FROM registry_vessels WHERE imo = ?");
  const selectImport = db.prepare("SELECT imported_at, count FROM registry_imports WHERE source = ?");
  const deleteSource = db.prepare("DELETE FROM registry_vessels WHERE source = ?");
  const insertRecord = db.prepare("INSERT OR REPLACE INTO registry_vessels (imo, source, record) VALUES (?, ?, ?)");
  const upsertImport = db.prepare(
    "INSERT OR REPLACE INTO registry_imports (source, imported_at, count) VALUES (?, ?, ?)"
  );

  let timer = null;
  let closed = false;

  function save(records) {
    db.exec("BEGIN");
    try {
      deleteSource.run(SOURCE);
      for (const [imo, record] of records) insertRecord.run(imo, SOURCE, JSON.stringify(record));
      upsertImport.run(SOURCE, now().toISOString(), records.size);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  async function refresh() {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`download failed: ${response.status}`);
    const records = parseRegistryRows(readXlsxRows(Buffer.from(await response.arrayBuffer())));
    // A broken or reshaped file shouldn't wipe out a good register
    if (records.size === 0) throw new Error("no ships with IMO numbers in the register");
    if (closed) return;
    save(records);
    logger?.info(`[registry] ${records.size} Transport Canada ships imported`);
  }

  function schedule(ms) {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(run, Math.max(0, ms));
    timer.unref?.();
  }

  async function run() {
    try {
      await refresh();
      schedule(refreshMs);
    } catch (err) {
      logger?.warn(`[registry] Transport Canada import failed: ${err.message}`);
      schedule(retryMs);
    }
  }

  return {
    // Import now if the stored register is missing or stale, then once a week
    start() {
      const last = selectImport.get(SOURCE);
      const age = last ? now().getTime() - Date.parse(last.imported_at) : Infinity;
      if (last) logger?.info(`[registry] ${last.count} Transport Canada ships known`);
      schedule(refreshMs - age);
    },

    refresh,

    // The ship's RegistryRecord, or undefined if it isn't in the register
    lookup(imo) {
      if (!isValidImo(imo)) return undefined;
      const row = selectRecord.get(imo);
      return row ? JSON.parse(row.record) : undefined;
    },

    close() {
      closed = true;
      clearTimeout(timer);
      db.close();
    },
  };
}
