import crypto from "node:crypto";
import { createRateLimiter } from "./bridge-api.js";
import { searchCommonsPhotos } from "./commons.js";
import { createLocalPhotoStore, inspectJpeg, photoType, stripJpegMetadata } from "./photo-store.js";
import { parseSubmission } from "./photo-submissions.js";
import { parseReport } from "./photo-reports.js";
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
//
// Photos shared from the iOS app (POST /api/ships/:mmsi/photos, open to anyone)
// go to R2's "shared" folder and wait in photoSubmissions until they're
// approved here, where their senders can also be banned. Sharing is off (503)
// without the admin page or R2.
//
// Photos reported from the app (POST /api/ships/:mmsi/photos/report, open to
// anyone) wait in photoReports until they're hidden or the reports dismissed
// here. Reporting is off (503) while the admin page is.

export const SESSION_MS = 12 * 60 * 60_000;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_SESSIONS = 50;

// Login attempts per IP, so the password can't be guessed quickly
export const LOGIN_LIMITS = { WINDOW_MS: 15 * 60_000, READS: 10, WRITES: 10 };
const ADMIN_LIMITS = { WINDOW_MS: 60_000, READS: 600, WRITES: 120 };
// Photos shared from the app per IP
export const SHARE_LIMITS = { WINDOW_MS: 60 * 60_000, READS: 0, WRITES: 10 };
// Photo reports per IP
export const REPORT_LIMITS = { WINDOW_MS: 60 * 60_000, READS: 0, WRITES: 20 };
// Sizes a shared photo may be, in pixels: big enough to be worth showing, not
// so big a browser struggles with it
export const SHARED_PHOTO_SIZE = { MIN_LONG_SIDE: 640, MAX_SIDE: 8192, MAX_PIXELS: 40_000_000, MAX_ASPECT: 4 };
// Shown after the sharer's name: they keep their copyright and license the
// photo to BridgeView (public/terms.html)
export const SHARED_PHOTO_LICENSE = "Used with permission";

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
  photoSubmissions = null,
  photoReports = null,
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
  const allowShare = createRateLimiter({ now, limits: SHARE_LIMITS });
  const allowReport = createRateLimiter({ now, limits: REPORT_LIMITS });
  const reporting = enabled && Boolean(photoReports);
  const sharing = enabled && Boolean(photoSubmissions) && Boolean(photoStore);
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

  // Checks a shared JPEG is whole, a sensible size and not sent before, and
  // cleans it: without EXIF (where it was taken, the phone) and anything after
  // the picture. Returns { photo, width, height, sha256 }, or { status, error, log }.
  function checkSharedPhoto(bytes) {
    const stripped = stripJpegMetadata(bytes);
    const jpeg = inspectJpeg(stripped);
    if (jpeg.error) return { status: 415, error: "That photo couldn't be read. Try another.", log: jpeg.error };
    const { width, height } = jpeg;
    const { MIN_LONG_SIDE, MAX_SIDE, MAX_PIXELS, MAX_ASPECT } = SHARED_PHOTO_SIZE;
    if (Math.max(width, height) < MIN_LONG_SIDE) {
      return { status: 422, error: "That photo is too small. Share a bigger one.", log: `${width}×${height}` };
    }
    if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
      return { status: 422, error: "That photo is too big. Share a smaller one.", log: `${width}×${height}` };
    }
    if (Math.max(width, height) / Math.min(width, height) > MAX_ASPECT) {
      return { status: 422, error: "That photo is too long and thin. Crop it and try again.", log: `${width}×${height}` };
    }
    const photo = stripped.subarray(0, jpeg.end);
    const sha256 = crypto.createHash("sha256").update(photo).digest("hex");
    const seen = photoSubmissions.seen(sha256);
    if (seen === "pending" || seen === "approved") {
      return { status: 409, error: "This photo has already been shared.", log: `duplicate (${seen})` };
    }
    if (seen === "rejected") return { status: 422, error: "This photo can't be shared.", log: "rejected before" };
    return { photo, width, height, sha256 };
  }

  // A photo shared from the app: stored, then queued for approval
  async function sharePhoto(req, res, url, mmsi, clientIP) {
    const { submission, error } = parseSubmission(url.searchParams, req.headers["x-bridgeview-device"]);
    if (error) return sendJson(res, 400, { error });
    if (photoSubmissions.isBanned({ deviceId: submission.deviceId, ip: clientIP })) {
      return sendJson(res, 403, { error: "You can't share photos from this device" });
    }
    if (!vesselDetails.adminView(mmsi)) return sendJson(res, 404, { error: "Unknown ship" });
    if (!photoSubmissions.hasRoom(mmsi)) {
      return sendJson(res, 503, { error: "Too many photos are waiting to be checked; try again later" });
    }
    const bytes = await readBody(req, MAX_PHOTO_BYTES);
    if (photoType(bytes) !== "jpg") return sendJson(res, 415, { error: "Share a JPEG photo" });
    const checked = checkSharedPhoto(bytes);
    if (checked.error) {
      logger?.info(`[admin] shared photo of ${mmsi} refused: ${checked.log}`);
      return sendJson(res, checked.status, { error: checked.error });
    }
    const { photo, width, height, sha256 } = checked;

    let photoUrl;
    try {
      photoUrl = await photoStore.save(photo, "jpg", "shared");
    } catch (err) {
      logger?.error(`[admin] shared photo of ${mmsi} could not be stored: ${err.message}`);
      return sendJson(res, 502, { error: "Could not store the photo; try again" });
    }
    const id = photoSubmissions.add({ mmsi, url: photoUrl, ...submission, ip: clientIP, sha256, width, height });
    logger?.info(`[admin] photo of ${mmsi} shared (#${id}), waiting for approval`);
    return sendJson(res, 202, { status: "pending" });
  }

  // Approves a shared photo: it becomes the ship's first added photo, credited
  // to the name the sharer gave (none if they gave none)
  function approveSubmission(res, submission) {
    const overrides = vesselDetails.overrides(submission.mmsi);
    if ((overrides.addedPhotos?.length ?? 0) >= MAX_ADDED_PHOTOS) {
      return sendJson(res, 400, { error: `At most ${MAX_ADDED_PHOTOS} added photos; remove one first` });
    }
    const { overrides: updated, error } = parseOverrides({
      ...overrides,
      addedPhotos: [
        {
          url: submission.url,
          artist: submission.artist,
          license: submission.artist ? SHARED_PHOTO_LICENSE : undefined,
          year: new Date(submission.createdAt).getUTCFullYear(),
        },
        ...(overrides.addedPhotos ?? []),
      ],
    });
    if (error) return sendJson(res, 400, { error });
    vesselDetails.setOverrides(submission.mmsi, updated);
    photoSubmissions.remove(submission.id, "approved");
    logger?.info(`[admin] shared photo #${submission.id} added to ${submission.mmsi}`);
    return sendJson(res, 200, vesselDetails.adminView(submission.mmsi));
  }

  function rejectSubmission(submission) {
    photoSubmissions.remove(submission.id);
    removeUploaded(submission.url);
  }

  // What the admin page sees of a shared photo: not who sent it
  const submissionView = ({ deviceId: _deviceId, ipHash: _ipHash, sha256: _sha256, ...s }) => ({
    ...s,
    shipName: vesselDetails.record(s.mmsi)?.name,
  });

  async function submissionsRoute(req, res, url) {
    const { pathname } = url;
    if (!photoSubmissions) return sendJson(res, 404, { error: "Not found" });
    if (pathname === "/api/admin/submissions" && req.method === "GET") {
      return sendJson(res, 200, { submissions: photoSubmissions.pending().map(submissionView) });
    }
    if (pathname === "/api/admin/submissions/bans" && req.method === "GET") {
      return sendJson(res, 200, { bans: photoSubmissions.bans() });
    }
    const banMatch = pathname.match(/^\/api\/admin\/submissions\/bans\/(\d{1,12})$/);
    if (banMatch && req.method === "DELETE") {
      if (!photoSubmissions.unban(Number(banMatch[1]))) return sendJson(res, 404, { error: "No such ban" });
      logger?.info(`[admin] photo sharing ban #${banMatch[1]} lifted`);
      return sendJson(res, 204);
    }

    const match = pathname.match(/^\/api\/admin\/submissions\/(\d{1,12})(\/approve|\/ban)?$/);
    const submission = match && photoSubmissions.get(Number(match[1]));
    if (!submission) return sendJson(res, 404, { error: "No such photo" });
    if (match[2] === "/approve" && req.method === "POST") return approveSubmission(res, submission);
    if (match[2] === "/ban" && req.method === "POST") {
      // Rejects this photo and everything else waiting from the same sender
      const body = await readJson(req).catch(() => ({}));
      const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) || undefined : undefined;
      const rejected = photoSubmissions.ban(submission, reason);
      for (const s of rejected) rejectSubmission(s);
      logger?.info(`[admin] sender of shared photo #${submission.id} banned; ${rejected.length} photos rejected`);
      return sendJson(res, 200, { rejected: rejected.map((s) => s.id) });
    }
    if (!match[2] && req.method === "DELETE") {
      rejectSubmission(submission);
      logger?.info(`[admin] shared photo #${submission.id} of ${submission.mmsi} rejected`);
      return sendJson(res, 204);
    }
    return sendJson(res, 404, { error: "Not found" });
  }

  // The ship's photo with this URL, as stored; the app has photos uploaded
  // here as whole URLs (see withAbsolutePhotoUrls in server/bridge-api.js)
  function shipPhotoUrl(mmsi, url) {
    const info = vesselDetails.vesselInfo(mmsi);
    const photos = info?.photos ?? (info?.imageUrl ? [{ url: info.imageUrl }] : []);
    return photos.find((p) => p.url === url || (p.url.startsWith("/api/photos/") && url.endsWith(p.url)))?.url;
  }

  // A photo reported from the app: queued for the admin page
  async function reportPhoto(req, res, mmsi, clientIP) {
    const { report, error } = parseReport(await readJson(req), req.headers["x-bridgeview-device"]);
    if (error) return sendJson(res, 400, { error });
    const photoUrl = shipPhotoUrl(mmsi, report.url);
    if (!photoUrl) return sendJson(res, 404, { error: "That photo isn't on this ship's page any more" });
    if (!photoReports.hasRoom()) return sendJson(res, 503, { error: "Couldn't send the report right now; try again later" });
    photoReports.add({ mmsi, ...report, url: photoUrl, ip: clientIP });
    logger?.info(`[admin] photo of ${mmsi} reported (${report.reason}): ${photoUrl}`);
    return sendJson(res, 202, { status: "received" });
  }

  // Reported photos: hide one (removing it if it was added here) or dismiss its reports
  async function reportsRoute(req, res, pathname) {
    if (!photoReports) return sendJson(res, 404, { error: "Not found" });
    if (pathname === "/api/admin/reports" && req.method === "GET") {
      const photos = photoReports.open().map((p) => ({ ...p, shipName: vesselDetails.record(p.mmsi)?.name }));
      return sendJson(res, 200, { photos });
    }
    const action = pathname.match(/^\/api\/admin\/reports\/(hide|dismiss)$/)?.[1];
    if (!action || req.method !== "POST") return sendJson(res, 404, { error: "Not found" });
    const body = await readJson(req);
    const reported = photoReports.open().find((p) => p.url === body?.url);
    if (!reported) return sendJson(res, 404, { error: "No reports of that photo" });

    if (action === "dismiss") {
      photoReports.resolve(reported.url);
      logger?.info(`[admin] reports of ${reported.url} dismissed`);
      return sendJson(res, 204);
    }
    const overrides = vesselDetails.overrides(reported.mmsi);
    const added = overrides.addedPhotos ?? [];
    const isAdded = added.some((p) => p.url === reported.url);
    const { overrides: updated, error } = parseOverrides({
      ...overrides,
      addedPhotos: added.filter((p) => p.url !== reported.url),
      hiddenPhotos: isAdded ? (overrides.hiddenPhotos ?? []) : [...(overrides.hiddenPhotos ?? []), reported.url],
      primaryPhoto: overrides.primaryPhoto === reported.url ? undefined : overrides.primaryPhoto,
    });
    if (error) return sendJson(res, 400, { error });
    saveOverrides(reported.mmsi, updated);
    photoReports.resolve(reported.url);
    logger?.info(`[admin] reported photo ${reported.url} ${isAdded ? "removed from" : "hidden on"} ${reported.mmsi}`);
    return sendJson(res, 200, vesselDetails.adminView(reported.mmsi));
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

    if (pathname === "/api/admin/reports" || pathname.startsWith("/api/admin/reports/")) {
      return reportsRoute(req, res, pathname);
    }
    if (pathname === "/api/admin/submissions" || pathname.startsWith("/api/admin/submissions/")) {
      return submissionsRoute(req, res, url);
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

  // Handles /api/admin/, /api/photos/, and POST /api/ships/:mmsi/photos and
  // /api/ships/:mmsi/photos/report requests; returns false for any other path
  function handleRequest(req, res, clientIP) {
    const url = new URL(req.url, "http://localhost");
    const photo = url.pathname.match(/^\/api\/photos\/([^/]+)$/);
    if (photo) {
      localPhotos.serve(req, res, photo[1]);
      return true;
    }
    const report = url.pathname.match(/^\/api\/ships\/(\d{1,9})\/photos\/report$/);
    if (report && req.method === "POST") {
      if (!reporting) {
        sendJson(res, 503, { error: "Reporting photos isn't set up on this server" });
        return true;
      }
      if (!allowReport(clientIP, "write")) {
        sendJson(res, 429, { error: "You've sent a lot of reports lately; try again in an hour" });
        return true;
      }
      reportPhoto(req, res, Number(report[1]), clientIP).catch((err) => {
        if (!err.status) logger?.error(`[admin] photo report failed: ${err.message}`);
        if (!res.headersSent) sendJson(res, err.status ?? 500, { error: err.status ? err.message : "Internal error" });
      });
      return true;
    }
    const share = url.pathname.match(/^\/api\/ships\/(\d{1,9})\/photos$/);
    if (share && req.method === "POST") {
      if (!sharing) {
        sendJson(res, 503, { error: "Sharing photos isn't set up on this server" });
        return true;
      }
      if (!allowShare(clientIP, "write")) {
        sendJson(res, 429, { error: "You've shared a lot of photos lately; try again in an hour" });
        return true;
      }
      sharePhoto(req, res, url, Number(share[1]), clientIP).catch((err) => {
        if (!err.status) logger?.error(`[admin] photo share failed: ${err.message}`);
        if (!res.headersSent) sendJson(res, err.status ?? 500, { error: err.status ? err.message : "Internal error" });
      });
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

  return { handleRequest, sharing, reporting };
}
