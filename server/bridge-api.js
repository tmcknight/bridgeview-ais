import {
  bridgeApproach,
  describeCargo,
  flagForMmsi,
  shipCategory,
  shipTypeName,
} from "./bridge-eta.js";
import { parseDeviceRegistration } from "./push-devices.js";

// HTTP API for the iOS app (see ios/API.md): ships heading for the bridge, ships
// that went under it lately, one ship's details, and device registration for alerts.
// Open to anyone, since an App Store app can't keep a secret, so it's rate-limited.
//
// AISHub's terms forbid passing on its raw data (positions, live or historical) to
// others, and anyone can call this API, so a ship whose latest position came from
// AISHub is sent without one. What we work out from it (the ETA, distance and
// direction) is our own work, which the terms allow.

// Credits for each AIS feed, shown by the app near the ship data
export const FEED_ATTRIBUTION = {
  aishub: { text: "Data: AISHub contributors", url: "https://www.aishub.net" },
  aisstream: { text: "AISStream.io", url: "https://aisstream.io" },
};

// The credits for the AIS feeds in use, in FEED_ATTRIBUTION's order
export function attributionFor(sources) {
  return Object.entries(FEED_ATTRIBUTION)
    .filter(([source]) => sources.includes(source))
    .map(([, credit]) => credit);
}

// Ships further out than this aren't listed as coming up
export const UPCOMING_MAX_ETA_MINUTES = 3 * 60;
// Passages listed as recent
export const RECENT_WINDOW_MS = 24 * 60 * 60_000;
// The snapshot is rebuilt at most this often, however many phones ask
const SNAPSHOT_CACHE_MS = 5000;
// The map's ships likewise; the app polls them more often, to keep ships moving
const MAP_CACHE_MS = 2000;
const MAX_BODY_BYTES = 4096;
// Ship search results sent at most
export const SEARCH_LIMIT = 25;
// Ships asked for at once by MMSI (the app's favourites)
export const MAX_SHIPS_BY_MMSI = 100;

export const RATE_LIMITS = {
  WINDOW_MS: 60_000,
  READS: 120,
  WRITES: 20,
};

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// Photos uploaded on the admin page have paths on this server; the app needs
// whole URLs, so they're made absolute with the address it asked on
function photoUrl(url, origin) {
  return typeof url === "string" && url.startsWith("/api/photos/") ? `${origin}${url}` : url;
}

export function withAbsolutePhotoUrls(ship, origin) {
  const info = ship?.info;
  if (!info || !origin) return ship;
  const uploaded = (url) => typeof url === "string" && url.startsWith("/api/photos/");
  if (!uploaded(info.imageUrl) && !info.photos?.some((p) => uploaded(p.url))) return ship;
  return {
    ...ship,
    info: {
      ...info,
      imageUrl: photoUrl(info.imageUrl, origin),
      ...(info.photos && { photos: info.photos.map((p) => ({ ...p, url: photoUrl(p.url, origin) })) }),
    },
  };
}

function requestOrigin(req) {
  const host = req.headers?.host;
  if (!host || !/^[\w.:[\]-]+$/.test(host)) return undefined;
  const proto = String(req.headers?.["x-forwarded-proto"] ?? "").split(",")[0].trim();
  return `${proto === "https" ? "https" : "http"}://${host}`;
}

function sendJson(res, status, body, headers = {}) {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    ...(body !== undefined && { "content-type": "application/json; charset=utf-8" }),
    ...headers,
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Upper case, with runs of spaces and punctuation as one space ("St. Clair" -> "ST CLAIR")
export function normaliseSearch(text) {
  return String(text ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

// How well a ship matches a normalised query: lower is better, null for none.
// Mirrors src/utils/shipSearch.ts: whole name, start, start of a word, anywhere,
// then MMSI, IMO or call sign.
export function searchScore(query, { name, mmsi, imo, callSign }) {
  const normalName = normaliseSearch(name);
  if (normalName === query) return 0;
  if (normalName.startsWith(query)) return 1;
  if (` ${normalName}`.includes(` ${query}`)) return 2;
  if (normalName.includes(query)) return 3;
  const digits = query.replace(/^(IMO|MMSI) ?/, "");
  if (/^\d{3,}$/.test(digits) && (String(mmsi).startsWith(digits) || (imo && String(imo).startsWith(digits)))) return 4;
  if (callSign && normaliseSearch(callSign) === query) return 4;
  return null;
}

// Requests per IP in fixed one-minute windows, reads and writes counted apart
export function createRateLimiter({ now = Date.now, limits = RATE_LIMITS } = {}) {
  const windows = new Map(); // "kind:ip" -> { count, resetAt }
  return function allow(ip, kind) {
    const t = now();
    if (windows.size > 10_000) {
      for (const [key, w] of windows) if (t > w.resetAt) windows.delete(key);
    }
    const key = `${kind}:${ip}`;
    let w = windows.get(key);
    if (!w || t > w.resetAt) {
      w = { count: 0, resetAt: t + limits.WINDOW_MS };
      windows.set(key, w);
    }
    w.count++;
    return w.count <= (kind === "write" ? limits.WRITES : limits.READS);
  };
}

export function createBridgeApi({
  vesselDetails,
  latestPositions,
  shipLog,
  pushDevices = null,
  shipCamVideoId = () => undefined,
  attribution = [],
  photoSharing = false,
  photoReporting = false,
  now = Date.now,
  logger,
}) {
  const allow = createRateLimiter({ now });
  let cachedSnapshot = null;
  let cachedAt = -Infinity;
  let cachedMap = null;
  let cachedMapAt = -Infinity;

  function positionOf(mmsi) {
    const latest = latestPositions.latest(mmsi);
    const report = latest?.message.Message.PositionReport;
    if (!report) return undefined;
    const meta = latest.message.MetaData;
    return {
      position: {
        latitude: meta.latitude,
        longitude: meta.longitude,
        sog: report.Sog,
        cog: report.Cog,
        heading: report.TrueHeading,
        navStatus: report.NavigationalStatus,
        time: new Date(latest.receivedAt).toISOString(),
      },
      name: meta.ShipName?.trim() || undefined,
      classB: meta.AisClass === "B",
      source: meta.Source ?? "aisstream",
    };
  }

  // One ship (Ship in ios/API.md), without its passages, or undefined when nothing
  // is known about it. For the server's own use: it has the position whatever its
  // feed, and `positionSource`; forClients() makes it fit to send.
  function ship(mmsi) {
    const record = vesselDetails.record(mmsi);
    const heard = positionOf(mmsi);
    const logged = shipLog.entries().find((entry) => entry.mmsi === mmsi);
    if (!record && !heard && !logged) return undefined;

    const info = vesselDetails.vesselInfo(mmsi);
    const position = heard?.position;
    const approach =
      position && !heard.classB
        ? bridgeApproach({ ...position, destination: record?.destination })
        : null;

    return {
      mmsi,
      name: record?.name ?? heard?.name ?? logged?.name ?? `MMSI ${mmsi}`,
      imo: record?.imo,
      callSign: record?.callSign,
      shipType: record?.shipType,
      shipTypeName: shipTypeName(record?.shipType),
      category: shipCategory(record?.shipType),
      length: record?.length,
      width: record?.width,
      draught: record?.draught,
      destination: record?.destination,
      cargo: describeCargo({ destination: record?.destination, shipType: record?.shipType, length: record?.length }),
      flag: flagForMmsi(mmsi),
      classB: heard?.classB || undefined,
      position,
      positionSource: heard?.source,
      approach: approach && {
        etaMinutes: round(approach.etaMinutes, 1),
        eta: new Date(Math.round((Date.parse(position.time) + approach.etaMinutes * 60_000) / 1000) * 1000).toISOString(),
        distanceNM: round(approach.distanceNM, 2),
        direction: approach.direction,
        ...(approach.passing && { passing: true }),
      },
      info: info ?? undefined,
    };
  }

  // A ship as the app sees it: no position when it came from AISHub, and no
  // USCG inspection history (shown on the web map only, where it has context)
  function forClients(s) {
    const { positionSource, position, ...rest } = s;
    if (rest.info?.uscg?.inspections) {
      const { inspections: _inspections, ...uscg } = rest.info.uscg;
      rest.info = { ...rest.info, uscg };
    }
    return positionSource === "aishub" ? rest : { ...rest, position };
  }

  function buildSnapshot() {
    const t = now();
    const upcoming = [];
    for (const message of latestPositions.messages()) {
      if (message.MetaData.AisClass === "B") continue;
      const s = ship(message.MetaData.MMSI);
      if (s?.approach && s.approach.etaMinutes <= UPCOMING_MAX_ETA_MINUTES) upcoming.push(forClients(s));
    }
    upcoming.sort((a, b) => a.approach.etaMinutes - b.approach.etaMinutes);

    const recent = shipLog
      .entries()
      .filter((entry) => t - Date.parse(entry.passages[0].time) <= RECENT_WINDOW_MS)
      .sort((a, b) => b.passages[0].time.localeCompare(a.passages[0].time))
      .map((entry) => ({ ...forClients(ship(entry.mmsi)), passage: entry.passages[0] }));

    return {
      generatedAt: new Date(t).toISOString(),
      shipCamVideoId: shipCamVideoId(),
      attribution,
      photoSharing,
      photoReporting,
      upcoming,
      recent,
    };
  }

  function snapshot() {
    if (!cachedSnapshot || now() - cachedAt >= SNAPSHOT_CACHE_MS) {
      cachedSnapshot = buildSnapshot();
      cachedAt = now();
    }
    return cachedSnapshot;
  }

  // App builds before API v2 need `wikidataId` in `info` (they fail to decode
  // the whole response without it), so they get only Wikidata-backed details;
  // apps that ask for ?v=2 also get details from the registers alone
  function forApiVersion(s, v2) {
    if (v2 || !s.info || s.info.wikidataId) return s;
    const { info: _info, ...rest } = s;
    return rest;
  }

  function snapshotForApiVersion(v2) {
    const s = snapshot();
    if (v2) return s;
    return {
      ...s,
      upcoming: s.upcoming.map((x) => forApiVersion(x, false)),
      recent: s.recent.map((x) => forApiVersion(x, false)),
    };
  }

  // Every ship heard lately, for the app's map. Ships whose latest position came
  // from AISHub are left out, since there'd be nothing to draw.
  function buildMap() {
    const ships = [];
    for (const message of latestPositions.messages()) {
      const s = ship(message.MetaData.MMSI);
      if (!s?.position || s.positionSource === "aishub") continue;
      ships.push({
        mmsi: s.mmsi,
        name: s.name,
        shipTypeName: s.shipTypeName,
        category: s.category,
        length: s.length,
        width: s.width,
        flag: s.flag,
        classB: s.classB,
        position: s.position,
        approach: s.approach ?? undefined,
      });
    }
    return { generatedAt: new Date(now()).toISOString(), attribution, ships };
  }

  function map() {
    if (!cachedMap || now() - cachedMapAt >= MAP_CACHE_MS) {
      cachedMap = buildMap();
      cachedMapAt = now();
    }
    return cachedMap;
  }

  function shipWithPassages(mmsi) {
    const s = ship(mmsi);
    if (!s) return undefined;
    const logged = shipLog.entries().find((entry) => entry.mmsi === mmsi);
    return { ...forClients(s), passages: logged?.passages ?? [] };
  }

  // A ship for search results and the app's favourites: what's needed for a row
  // (no position, so nothing here is AISHub's raw data), whether it's being heard
  // now, its ETA if it's heading for the bridge, and its latest passage
  function shipSummary(mmsi, origin) {
    const s = ship(mmsi);
    if (!s) return undefined;
    const logged = shipLog.entries().find((entry) => entry.mmsi === mmsi);
    const photo = s.info?.photos?.[0]?.url ?? s.info?.imageUrl;
    return {
      mmsi: s.mmsi,
      name: s.name,
      imo: s.imo,
      callSign: s.callSign,
      shipTypeName: s.shipTypeName,
      category: s.category,
      length: s.length,
      flag: s.flag,
      destination: s.destination,
      classB: s.classB,
      heard: s.positionSource !== undefined,
      approach: s.approach ?? undefined,
      passage: logged?.passages[0],
      photoUrl: photo && photoUrl(photo, origin),
    };
  }

  // Ships matching the app's search box, best match first: the stored details of
  // every ship ever heard, ship log names, and ships heard now without details yet
  function search(rawQuery, origin) {
    const query = normaliseSearch(rawQuery).slice(0, 64);
    if (query.length < 2) return { ships: [] };
    // The database narrows by the longest word; the score checks the whole query
    const word = query.split(" ").reduce((a, b) => (b.length > a.length ? b : a), "");
    const candidates = new Map();
    for (const c of vesselDetails.matchingNames(word)) candidates.set(c.mmsi, c);
    for (const entry of shipLog.entries()) {
      if (!candidates.has(entry.mmsi)) candidates.set(entry.mmsi, { mmsi: entry.mmsi, name: entry.name });
    }
    for (const message of latestPositions.messages()) {
      const mmsi = message.MetaData.MMSI;
      if (!candidates.has(mmsi)) candidates.set(mmsi, { mmsi, name: message.MetaData.ShipName?.trim() });
    }

    const scored = [];
    for (const { mmsi } of candidates.values()) {
      const record = vesselDetails.record(mmsi);
      const name = record?.name ?? candidates.get(mmsi).name ?? "";
      const score = searchScore(query, { name, mmsi, imo: record?.imo, callSign: record?.callSign });
      if (score !== null) scored.push({ mmsi, name, score });
    }
    const summaries = scored
      .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
      // Room to put ships heard now first among equal matches
      .slice(0, SEARCH_LIMIT * 4)
      .map((c) => ({ score: c.score, summary: shipSummary(c.mmsi, origin) }))
      .filter((c) => c.summary)
      .sort(
        (a, b) =>
          a.score - b.score ||
          Number(b.summary.heard) - Number(a.summary.heard) ||
          (a.summary.approach?.etaMinutes ?? Infinity) - (b.summary.approach?.etaMinutes ?? Infinity) ||
          a.summary.name.localeCompare(b.summary.name)
      );
    return {
      ships: summaries.slice(0, SEARCH_LIMIT).map((c) => c.summary),
      more: scored.length > SEARCH_LIMIT,
    };
  }

  // The app's favourites, in the order asked; unknown ships are left out
  function shipsByMmsi(list, origin) {
    const mmsis = [...new Set(list.split(",").filter((x) => /^\d{1,9}$/.test(x)).map(Number))];
    return { ships: mmsis.slice(0, MAX_SHIPS_BY_MMSI).map((m) => shipSummary(m, origin)).filter(Boolean) };
  }

  async function handleDevice(req, res, token) {
    if (!pushDevices) return sendJson(res, 503, { error: "Bridge alerts aren't set up on this server" });
    if (req.method === "DELETE") {
      pushDevices.remove(token);
      return sendJson(res, 204);
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      return sendJson(res, err.status ?? 400, { error: err.status ? err.message : "Invalid JSON" });
    }
    const { device, error } = parseDeviceRegistration(token, body);
    if (error) return sendJson(res, 400, { error });
    if (!pushDevices.register(device)) return sendJson(res, 503, { error: "Too many devices registered" });
    return sendJson(res, 204);
  }

  // Handles /api/ requests; returns false for any other path
  function handleRequest(req, res, clientIP) {
    // A request target that isn't a path (e.g. "//") doesn't parse; it isn't ours either
    const url = URL.parse(req.url, "http://localhost");
    if (!url?.pathname.startsWith("/api/")) return false;

    const isWrite = req.method === "PUT" || req.method === "DELETE";
    if (!allow(clientIP, isWrite ? "write" : "read")) {
      sendJson(res, 429, { error: "Too many requests" }, { "retry-after": "60" });
      return true;
    }

    const shipMatch = url.pathname.match(/^\/api\/ships\/(\d{1,9})$/);
    const deviceMatch = url.pathname.match(/^\/api\/devices\/([^/]+)$/);
    const v2 = url.searchParams.get("v") === "2";
    const origin = requestOrigin(req);

    try {
      if (url.pathname === "/api/bridge" && req.method === "GET") {
        const s = snapshotForApiVersion(v2);
        const absolute = (x) => withAbsolutePhotoUrls(x, origin);
        sendJson(
          res,
          200,
          { ...s, upcoming: s.upcoming.map(absolute), recent: s.recent.map(absolute) },
          { "cache-control": "public, max-age=5" }
        );
      } else if (url.pathname === "/api/map" && req.method === "GET") {
        sendJson(res, 200, map(), { "cache-control": "public, max-age=2" });
      } else if (url.pathname === "/api/ships" && req.method === "GET") {
        const q = url.searchParams.get("q");
        const mmsi = url.searchParams.get("mmsi");
        if (q !== null) sendJson(res, 200, search(q, origin), { "cache-control": "public, max-age=10" });
        else if (mmsi !== null) sendJson(res, 200, shipsByMmsi(mmsi, origin), { "cache-control": "public, max-age=5" });
        else sendJson(res, 400, { error: "Give q (search) or mmsi (comma-separated)" });
      } else if (shipMatch && req.method === "GET") {
        const s = shipWithPassages(Number(shipMatch[1]));
        if (s) sendJson(res, 200, withAbsolutePhotoUrls(forApiVersion(s, v2), origin), { "cache-control": "public, max-age=5" });
        else sendJson(res, 404, { error: "Unknown ship" });
      } else if (deviceMatch && isWrite) {
        let token;
        try {
          token = decodeURIComponent(deviceMatch[1]);
        } catch {
          sendJson(res, 400, { error: "Invalid device token" });
          return true;
        }
        handleDevice(req, res, token).catch((err) => {
          logger?.error(`[api] device registration failed: ${err.message}`);
          if (!res.headersSent) sendJson(res, 500, { error: "Internal error" });
        });
      } else {
        sendJson(res, 404, { error: "Not found" });
      }
    } catch (err) {
      logger?.error(`[api] ${req.method} ${url.pathname} failed: ${err.message}`);
      if (!res.headersSent) sendJson(res, 500, { error: "Internal error" });
    }
    return true;
  }

  return { ship, snapshot, map, search, shipsByMmsi, handleRequest };
}
