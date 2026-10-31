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
const MAX_BODY_BYTES = 4096;

export const RATE_LIMITS = {
  WINDOW_MS: 60_000,
  READS: 120,
  WRITES: 20,
};

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
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
  now = Date.now,
  logger,
}) {
  const allow = createRateLimiter({ now });
  let cachedSnapshot = null;
  let cachedAt = -Infinity;

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
      cargo: describeCargo(record?.destination),
      flag: flagForMmsi(mmsi),
      classB: heard?.classB || undefined,
      position,
      positionSource: heard?.source,
      approach: approach && {
        etaMinutes: round(approach.etaMinutes, 1),
        eta: new Date(Math.round((Date.parse(position.time) + approach.etaMinutes * 60_000) / 1000) * 1000).toISOString(),
        distanceNM: round(approach.distanceNM, 2),
        direction: approach.direction,
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

  function shipWithPassages(mmsi) {
    const s = ship(mmsi);
    if (!s) return undefined;
    const logged = shipLog.entries().find((entry) => entry.mmsi === mmsi);
    return { ...forClients(s), passages: logged?.passages ?? [] };
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
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/")) return false;

    const isWrite = req.method === "PUT" || req.method === "DELETE";
    if (!allow(clientIP, isWrite ? "write" : "read")) {
      sendJson(res, 429, { error: "Too many requests" }, { "retry-after": "60" });
      return true;
    }

    const shipMatch = url.pathname.match(/^\/api\/ships\/(\d{1,9})$/);
    const deviceMatch = url.pathname.match(/^\/api\/devices\/([^/]+)$/);
    const v2 = url.searchParams.get("v") === "2";

    try {
      if (url.pathname === "/api/bridge" && req.method === "GET") {
        sendJson(res, 200, snapshotForApiVersion(v2), { "cache-control": "public, max-age=5" });
      } else if (shipMatch && req.method === "GET") {
        const s = shipWithPassages(Number(shipMatch[1]));
        if (s) sendJson(res, 200, forApiVersion(s, v2), { "cache-control": "public, max-age=5" });
        else sendJson(res, 404, { error: "Unknown ship" });
      } else if (deviceMatch && isWrite) {
        handleDevice(req, res, decodeURIComponent(deviceMatch[1])).catch((err) => {
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

  return { ship, snapshot, handleRequest };
}
