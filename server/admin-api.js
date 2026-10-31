import crypto from "node:crypto";
import { createRateLimiter } from "./bridge-api.js";
import { searchCommonsPhotos } from "./commons.js";
import { createLocalPhotoStore, photoType } from "./photo-store.js";
import { MAX_ADDED_PHOTOS, parseOverrides } from "./vessel-overrides.js";

// The admin page's API (/api/admin/): find a ship, correct its details, and
// add, hide or reorder its photos. Off (404) unless ADMIN_PASSWORD is set. The
// page logs in with the password for a token that lasts SESSION_MS, sent as
// "Authorization: Bearer <token>"; tokens live in memory, so a restart logs
// everyone out.
//
// Photos uploaded there go to R2 when it's set up (photoStore), else to
// photosDir (server/photo-store.js). Those in photosDir are served to everyone
// from /api/photos/, whether or not the admin page is on, so ships keep them.

export const SESSION_MS = 12 * 60 * 60_000;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_SESSIONS = 50;

// Login attempts per IP, so the password can't be guessed quickly
export const LOGIN_LIMITS = { WINDOW_MS: 15 * 60_000, READS: 10, WRITES: 10 };
const ADMIN_LIMITS = { WINDOW_MS: 60_000, READS: 600, WRITES: 120 };

// Compares in constant time, so the password can't be found a letter at a time
function samePassword(given, expected) {
  const a = crypto.createHash("sha256").update(String(given)).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "cache-control": "no-store",
    ...(body !== undefined && { "content-type": "application/json; charset=utf-8" }),
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const text = (await readBody(req, MAX_JSON_BYTES)).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

export function createAdminApi({
  password,
  vesselDetails,
  photosDir,
  photoStore = null,
  searchPhotos = searchCommonsPhotos,
  now = Date.now,
  logger,
}) {
  const localPhotos = createLocalPhotoStore({ dir: photosDir, logger });
  const uploads = photoStore ?? localPhotos;
  const stores = [localPhotos, ...(photoStore ? [photoStore] : [])];
  const enabled = Boolean(password);
  const allowLogin = createRateLimiter({ now, limits: LOGIN_LIMITS });
  const allow = createRateLimiter({ now, limits: ADMIN_LIMITS });
  const sessions = new Map(); // token -> expires at (ms)

  function startSession() {
    const t = now();
    for (const [token, expiresAt] of sessions) if (expiresAt <= t) sessions.delete(token);
    // The oldest go first if somehow there are too many
    while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    const token = crypto.randomBytes(32).toString("base64url");
    sessions.set(token, t + SESSION_MS);
    return { token, expiresAt: new Date(t + SESSION_MS).toISOString() };
  }

  function sessionToken(req) {
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
    if (!match) return undefined;
    const expiresAt = sessions.get(match[1]);
    if (expiresAt === undefined) return undefined;
    if (expiresAt <= now()) {
      sessions.delete(match[1]);
      return undefined;
    }
    return match[1];
  }

  // Deletes a photo uploaded here (to either store) once nothing uses it
  function removeUploaded(url) {
    const store = stores.find((s) => s.owns(url));
    store?.remove(url).catch((err) => logger?.warn(`[admin] could not delete photo ${url}: ${err.message}`));
  }

  // Saves a ship's corrections, deleting uploaded photos they no longer use
  function saveOverrides(mmsi, overrides) {
    const before = vesselDetails.overrides(mmsi).addedPhotos ?? [];
    vesselDetails.setOverrides(mmsi, overrides);
    const kept = new Set((overrides.addedPhotos ?? []).map((p) => p.url));
    for (const photo of before) if (!kept.has(photo.url)) removeUploaded(photo.url);
  }

  async function uploadPhoto(req, res, mmsi) {
    const overrides = vesselDetails.overrides(mmsi);
    if ((overrides.addedPhotos?.length ?? 0) >= MAX_ADDED_PHOTOS) {
      return sendJson(res, 400, { error: `At most ${MAX_ADDED_PHOTOS} added photos` });
    }
    const bytes = await readBody(req, MAX_PHOTO_BYTES);
    const type = photoType(bytes);
    if (!type) return sendJson(res, 415, { error: "Upload a JPEG, PNG or WebP image" });

    let photoUrl;
    try {
      photoUrl = await uploads.save(bytes, type);
    } catch (err) {
      logger?.error(`[admin] photo upload for ${mmsi} failed: ${err.message}`);
      return sendJson(res, 502, { error: "Could not store the photo; try again" });
    }

    const url = new URL(req.url, "http://localhost");
    const { overrides: updated, error } = parseOverrides({
      ...overrides,
      addedPhotos: [
        {
          url: photoUrl,
          title: url.searchParams.get("title") ?? undefined,
          artist: url.searchParams.get("artist") ?? undefined,
          license: url.searchParams.get("license") ?? undefined,
        },
        ...(overrides.addedPhotos ?? []),
      ],
    });
    if (error) {
      removeUploaded(photoUrl);
      return sendJson(res, 400, { error });
    }
    vesselDetails.setOverrides(mmsi, updated);
    logger?.info(`[admin] photo ${photoUrl} added to ${mmsi}`);
    return sendJson(res, 201, vesselDetails.adminView(mmsi));
  }

  async function route(req, res, url, clientIP) {
    const { pathname } = url;
    if (pathname === "/api/admin/login" && req.method === "POST") {
      if (!allowLogin(clientIP, "write")) return sendJson(res, 429, { error: "Too many attempts; try again later" });
      const body = await readJson(req);
      if (typeof body?.password !== "string" || !samePassword(body.password, password)) {
        logger?.warn(`[admin] failed login from ${clientIP}`);
        return sendJson(res, 401, { error: "Wrong password" });
      }
      logger?.info(`[admin] login from ${clientIP}`);
      return sendJson(res, 200, startSession());
    }

    const token = sessionToken(req);
    if (!token) return sendJson(res, 401, { error: "Log in first" });

    if (pathname === "/api/admin/session" && req.method === "GET") {
      return sendJson(res, 200, { expiresAt: new Date(sessions.get(token)).toISOString() });
    }
    if (pathname === "/api/admin/logout" && req.method === "POST") {
      sessions.delete(token);
      return sendJson(res, 204);
    }
    if (pathname === "/api/admin/ships" && req.method === "GET") {
      const { ships, total } = vesselDetails.search({
        query: url.searchParams.get("q") ?? "",
        overriddenOnly: url.searchParams.get("overridden") === "1",
        type: url.searchParams.get("type") ?? undefined,
        offset: Number(url.searchParams.get("offset")) || 0,
      });
      return sendJson(res, 200, { ships, total });
    }

    if (pathname === "/api/admin/photos/search" && req.method === "GET") {
      const text = (url.searchParams.get("q") ?? "").trim();
      if (text.length < 2 || text.length > 200) return sendJson(res, 400, { error: "Search for 2 to 200 characters" });
      try {
        return sendJson(res, 200, { photos: await searchPhotos(text) });
      } catch (err) {
        logger?.warn(`[admin] photo search failed: ${err.message}`);
        return sendJson(res, 502, { error: "Couldn't reach Wikimedia Commons" });
      }
    }

    const shipMatch = pathname.match(/^\/api\/admin\/ships\/(\d{1,9})(\/.*)?$/);
    if (!shipMatch) return sendJson(res, 404, { error: "Not found" });
    const mmsi = Number(shipMatch[1]);
    const rest = shipMatch[2] ?? "";
    if (!vesselDetails.adminView(mmsi)) return sendJson(res, 404, { error: "Unknown ship" });

    if (rest === "" && req.method === "GET") {
      return sendJson(res, 200, vesselDetails.adminView(mmsi));
    }
    if (rest === "/overrides" && req.method === "PUT") {
      const { overrides, error } = parseOverrides(await readJson(req));
      if (error) return sendJson(res, 400, { error });
      saveOverrides(mmsi, overrides);
      logger?.info(`[admin] details of ${mmsi} updated`);
      return sendJson(res, 200, vesselDetails.adminView(mmsi));
    }
    if (rest === "/photos" && req.method === "POST") {
      return uploadPhoto(req, res, mmsi);
    }
    if (rest === "/refresh" && req.method === "POST") {
      if (!vesselDetails.refresh(mmsi)) return sendJson(res, 503, { error: "Lookups are off on this server" });
      return sendJson(res, 202, { queued: true });
    }
    return sendJson(res, 404, { error: "Not found" });
  }

  // Handles /api/admin/ and /api/photos/ requests; returns false for any other path
  function handleRequest(req, res, clientIP) {
    const url = new URL(req.url, "http://localhost");
    const photo = url.pathname.match(/^\/api\/photos\/([^/]+)$/);
    if (photo) {
      localPhotos.serve(req, res, photo[1]);
      return true;
    }
    if (!url.pathname.startsWith("/api/admin/")) return false;
    if (!enabled) {
      sendJson(res, 404, { error: "Not found" });
      return true;
    }
    const isWrite = req.method !== "GET" && req.method !== "HEAD";
    if (!allow(clientIP, isWrite ? "write" : "read")) {
      sendJson(res, 429, { error: "Too many requests" });
      return true;
    }
    route(req, res, url, clientIP).catch((err) => {
      if (!err.status) logger?.error(`[admin] ${req.method} ${url.pathname} failed: ${err.message}`);
      if (!res.headersSent) sendJson(res, err.status ?? 500, { error: err.status ? err.message : "Internal error" });
    });
    return true;
  }

  return { handleRequest };
}
