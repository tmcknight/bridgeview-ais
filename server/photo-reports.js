import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Photos reported from the iOS app ("Report this photo" on a ship's page),
// waiting for the admin page (server/admin-api.js) to hide the photo or
// dismiss the reports. Kept in SQLite (the same DB_FILE as vessel details).
// Like shared photos, a reporter is known only by the app's random ID and a
// keyed hash of their IP address, so one person's reports of a photo count once.

export const REPORT_REASONS = ["wrong-ship", "offensive", "privacy", "copyright", "other"];
// Most open reports at once; reporting is open, so cap it
export const MAX_OPEN_REPORTS = 1000;
const MAX_DETAILS = 500;
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS photo_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mmsi INTEGER NOT NULL,
    url TEXT NOT NULL,
    reason TEXT NOT NULL,
    details TEXT,
    reporter TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (url, reporter)
  );
  CREATE TABLE IF NOT EXISTS photo_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

// A report's body ({ url, reason, details }) and the app's device ID header, or { error }
export function parseReport(body, deviceId) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Expected an object" };
  const { url, reason, details } = body;
  if (typeof url !== "string" || !url || url.length > 2000) return { error: "url must be the photo's URL" };
  if (!REPORT_REASONS.includes(reason)) return { error: `reason must be one of ${REPORT_REASONS.join(", ")}` };
  if (details !== undefined && typeof details !== "string") return { error: "details must be text" };
  const text = (details ?? "").trim().replace(/\s+/g, " ");
  if (text.length > MAX_DETAILS) return { error: `details must be at most ${MAX_DETAILS} characters` };
  if (deviceId !== undefined && !DEVICE_ID.test(deviceId)) return { error: "Invalid device ID" };
  return { report: { url, reason, details: text || undefined, deviceId: deviceId?.toLowerCase() } };
}

export function createPhotoReports({ file = ":memory:", now = () => new Date() } = {}) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);

  // Shares the IP key with photo submissions (server/photo-submissions.js)
  db.prepare("INSERT OR IGNORE INTO photo_settings (key, value) VALUES ('ip_key', ?)").run(crypto.randomBytes(32).toString("hex"));
  const ipKey = db.prepare("SELECT value FROM photo_settings WHERE key = 'ip_key'").get().value;
  const reporterOf = ({ deviceId, ip }) =>
    deviceId ? `device:${deviceId}` : `ip:${crypto.createHmac("sha256", ipKey).update(String(ip)).digest("hex")}`;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO photo_reports (mmsi, url, reason, details, reporter, created_at)
    VALUES (:mmsi, :url, :reason, :details, :reporter, :now)
  `);
  const count = db.prepare("SELECT COUNT(*) AS n FROM photo_reports");
  const selectAll = db.prepare("SELECT mmsi, url, reason, details, created_at FROM photo_reports ORDER BY id");
  const removeUrl = db.prepare("DELETE FROM photo_reports WHERE url = ?");

  return {
    hasRoom() {
      return count.get().n < MAX_OPEN_REPORTS;
    },

    // Saves a report; one per photo per reporter
    add({ mmsi, url, reason, details, deviceId, ip }) {
      insert.run({ mmsi, url, reason, details: details ?? null, reporter: reporterOf({ deviceId, ip }), now: now().toISOString() });
    },

    // Reported photos, the first reported first, each with its reports
    open() {
      const byUrl = new Map();
      for (const row of selectAll.all()) {
        let photo = byUrl.get(row.url);
        if (!photo) {
          photo = { url: row.url, mmsi: row.mmsi, reports: [] };
          byUrl.set(row.url, photo);
        }
        photo.reports.push({ reason: row.reason, details: row.details ?? undefined, createdAt: row.created_at });
      }
      return [...byUrl.values()];
    },

    // Closes every report of this photo (it was hidden, or the reports dismissed)
    resolve(url) {
      return removeUrl.run(url).changes > 0;
    },

    close() {
      db.close();
    },
  };
}
