import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Ship photos shared from the iOS app, waiting for the admin page
// (server/admin-api.js) to approve or reject them, and the senders banned from
// sharing. Kept in SQLite (the same DB_FILE as vessel details); the photos
// themselves are in the admin page's photo store, under random names, so
// nobody finds one before it's approved. Approving one adds it to the ship's
// photos (its addedPhotos override) and drops it from here; rejecting deletes it.
// Sharers keep their copyright and license the photo to BridgeView (see
// public/terms.html); it's credited to the name they give, if any.
//
// There are no accounts, so a sender is known by the random ID the app makes
// for itself (X-BridgeView-Device) and their IP address, kept only as a keyed
// hash. A ban covers both: the device for good, the IP address for
// IP_BAN_MS, since addresses get passed on to others.
//
// Each photo's SHA-256 is kept once it's approved or rejected (photo_hashes),
// so the same file can't be sent again, whether to try a rejected one again
// or to send one twice.

// Most photos waiting at once, in all and for one ship; sharing is open, so cap it
export const MAX_PENDING = 500;
export const MAX_PENDING_PER_SHIP = 20;
export const IP_BAN_MS = 30 * 24 * 60 * 60_000;
const MAX_NAME = 80;
const MAX_NOTE = 500;
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS photo_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mmsi INTEGER NOT NULL,
    url TEXT NOT NULL,
    artist TEXT,
    note TEXT,
    device_id TEXT,
    ip_hash TEXT,
    sha256 TEXT,
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS photo_hashes (
    sha256 TEXT PRIMARY KEY,
    outcome TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS photo_bans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    ip_hash TEXT,
    reason TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS photo_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

// From the request's query string, the name to credit the photo to and a note
// for the admin, both optional; and the app's device ID header. Or { error }.
export function parseSubmission(params, deviceId) {
  const text = (key) => (params.get(key) ?? "").trim().replace(/\s+/g, " ");
  const artist = text("artist");
  if (artist.length > MAX_NAME) return { error: `artist must be at most ${MAX_NAME} characters` };
  const note = text("note");
  if (note.length > MAX_NOTE) return { error: `note must be at most ${MAX_NOTE} characters` };
  if (deviceId !== undefined && !DEVICE_ID.test(deviceId)) return { error: "Invalid device ID" };
  return { submission: { artist: artist || undefined, note: note || undefined, deviceId: deviceId?.toLowerCase() } };
}

function rowToSubmission(row) {
  return {
    id: row.id,
    mmsi: row.mmsi,
    url: row.url,
    artist: row.artist ?? undefined,
    note: row.note ?? undefined,
    deviceId: row.device_id ?? undefined,
    ipHash: row.ip_hash ?? undefined,
    sha256: row.sha256 ?? undefined,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    createdAt: row.created_at,
  };
}

function rowToBan(row) {
  return {
    id: row.id,
    reason: row.reason ?? undefined,
    device: Boolean(row.device_id),
    createdAt: row.created_at,
  };
}

export function createPhotoSubmissions({ file = ":memory:", now = () => new Date() } = {}) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);

  // The key IP addresses are hashed with, made once and kept, so bans outlast restarts
  db.prepare("INSERT OR IGNORE INTO photo_settings (key, value) VALUES ('ip_key', ?)").run(crypto.randomBytes(32).toString("hex"));
  const ipKey = db.prepare("SELECT value FROM photo_settings WHERE key = 'ip_key'").get().value;
  const hashIp = (ip) => crypto.createHmac("sha256", ipKey).update(String(ip)).digest("hex");

  const insert = db.prepare(`
    INSERT INTO photo_submissions (mmsi, url, artist, note, device_id, ip_hash, sha256, width, height, created_at)
    VALUES (:mmsi, :url, :artist, :note, :device_id, :ip_hash, :sha256, :width, :height, :now)
  `);
  const count = db.prepare("SELECT COUNT(*) AS n FROM photo_submissions");
  const countForShip = db.prepare("SELECT COUNT(*) AS n FROM photo_submissions WHERE mmsi = ?");
  const selectAll = db.prepare("SELECT * FROM photo_submissions ORDER BY id");
  const selectOne = db.prepare("SELECT * FROM photo_submissions WHERE id = ?");
  const remove = db.prepare("DELETE FROM photo_submissions WHERE id = ?");
  const insertHash = db.prepare("INSERT OR REPLACE INTO photo_hashes (sha256, outcome, created_at) VALUES (?, ?, ?)");
  const selectHash = db.prepare("SELECT outcome FROM photo_hashes WHERE sha256 = ?");
  const selectPendingHash = db.prepare("SELECT 1 FROM photo_submissions WHERE sha256 = ? LIMIT 1");
  const selectFrom = db.prepare(
    "SELECT * FROM photo_submissions WHERE (device_id IS NOT NULL AND device_id = :device_id) OR ip_hash = :ip_hash"
  );
  const insertBan = db.prepare(
    "INSERT INTO photo_bans (device_id, ip_hash, reason, created_at) VALUES (:device_id, :ip_hash, :reason, :now)"
  );
  const selectBan = db.prepare(`
    SELECT 1 FROM photo_bans
    WHERE (device_id IS NOT NULL AND device_id = :device_id) OR (ip_hash = :ip_hash AND created_at > :since)
    LIMIT 1
  `);
  const selectBans = db.prepare("SELECT * FROM photo_bans ORDER BY id DESC");
  const deleteBan = db.prepare("DELETE FROM photo_bans WHERE id = ?");

  return {
    // Whether there's room for another photo of this ship
    hasRoom(mmsi) {
      return count.get().n < MAX_PENDING && countForShip.get(mmsi).n < MAX_PENDING_PER_SHIP;
    },

    // Whether this device or IP address is banned from sharing
    isBanned({ deviceId, ip }) {
      const since = new Date(now().getTime() - IP_BAN_MS).toISOString();
      return Boolean(selectBan.get({ device_id: deviceId ?? null, ip_hash: hashIp(ip), since }));
    },

    // What became of a photo with this SHA-256 before: "pending", "approved",
    // "rejected", or undefined for a new one
    seen(sha256) {
      if (selectPendingHash.get(sha256)) return "pending";
      return selectHash.get(sha256)?.outcome;
    },

    add({ mmsi, url, artist, note, deviceId, ip, sha256, width, height }) {
      const { lastInsertRowid } = insert.run({
        mmsi,
        url,
        artist: artist ?? null,
        note: note ?? null,
        device_id: deviceId ?? null,
        ip_hash: hashIp(ip),
        sha256: sha256 ?? null,
        width: width ?? null,
        height: height ?? null,
        now: now().toISOString(),
      });
      return Number(lastInsertRowid);
    },

    // Every photo waiting, oldest first
    pending() {
      return selectAll.all().map(rowToSubmission);
    },

    get(id) {
      const row = selectOne.get(id);
      return row ? rowToSubmission(row) : undefined;
    },

    // Drops a photo from the queue, remembering it was "approved" or "rejected"
    remove(id, outcome = "rejected") {
      const row = selectOne.get(id);
      if (row?.sha256) insertHash.run(row.sha256, outcome, now().toISOString());
      remove.run(id);
    },

    // Bans whoever shared this photo, and returns every photo waiting from
    // them (this one too), for the caller to delete
    ban(submission, reason) {
      insertBan.run({
        device_id: submission.deviceId ?? null,
        ip_hash: submission.ipHash ?? null,
        reason: reason ?? null,
        now: now().toISOString(),
      });
      return selectFrom.all({ device_id: submission.deviceId ?? null, ip_hash: submission.ipHash ?? null }).map(rowToSubmission);
    },

    // Bans, newest first; they carry no device ID or IP hash, which the admin page has no use for
    bans() {
      return selectBans.all().map(rowToBan);
    },

    unban(id) {
      return deleteBan.run(id).changes > 0;
    },

    close() {
      db.close();
    },
  };
}
