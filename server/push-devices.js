import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SHIP_CATEGORIES } from "./bridge-eta.js";

// iPhones registered for bridge alerts, and the Live Activity broadcast channels
// open for ships on their way, kept in SQLite (the same DB_FILE as vessel details).

export const DIRECTIONS = ["upbound", "downbound"];
export const ENVIRONMENTS = ["sandbox", "production"];
// Most devices there could ever be; registration is open, so cap it
export const MAX_DEVICES = 100_000;

const DEFAULT_CATEGORIES = ["cargo", "tanker", "passenger"];
const TOKEN_PATTERN = /^[0-9a-f]{32,400}$/i;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS push_devices (
    token TEXT PRIMARY KEY,
    environment TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    push_to_start_token TEXT,
    live_activities INTEGER NOT NULL,
    categories TEXT NOT NULL,
    min_length INTEGER NOT NULL,
    directions TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS live_activity_channels (
    channel_id TEXT NOT NULL,
    environment TEXT NOT NULL,
    mmsi INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (channel_id, environment)
  );
`;

function isSubsetOf(value, allowed) {
  return Array.isArray(value) && value.every((item) => allowed.includes(item));
}

// Check a PUT /api/devices/:token body. Returns { device } or { error }.
export function parseDeviceRegistration(token, body) {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return { error: "Invalid device token" };
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Body must be an object" };
  const {
    environment,
    enabled = true,
    pushToStartToken,
    liveActivities = false,
    categories = DEFAULT_CATEGORIES,
    minLength = 0,
    directions = DIRECTIONS,
  } = body;
  if (!ENVIRONMENTS.includes(environment)) return { error: `environment must be one of ${ENVIRONMENTS.join(", ")}` };
  if (typeof enabled !== "boolean") return { error: "enabled must be a boolean" };
  if (pushToStartToken !== undefined && (typeof pushToStartToken !== "string" || !TOKEN_PATTERN.test(pushToStartToken))) {
    return { error: "Invalid pushToStartToken" };
  }
  if (typeof liveActivities !== "boolean") return { error: "liveActivities must be a boolean" };
  if (!isSubsetOf(categories, SHIP_CATEGORIES)) return { error: `categories must be from ${SHIP_CATEGORIES.join(", ")}` };
  if (!Number.isInteger(minLength) || minLength < 0 || minLength > 500) return { error: "minLength must be 0-500" };
  if (!isSubsetOf(directions, DIRECTIONS)) return { error: `directions must be from ${DIRECTIONS.join(", ")}` };
  return {
    device: {
      token: token.toLowerCase(),
      environment,
      enabled,
      pushToStartToken: pushToStartToken?.toLowerCase(),
      liveActivities,
      categories: [...new Set(categories)],
      minLength,
      directions: [...new Set(directions)],
    },
  };
}

// Whether a device wants an alert for this ship ({ category, length, direction })
export function wantsAlert(device, { category, length, direction }) {
  return (
    device.enabled &&
    device.categories.includes(category) &&
    (length ?? 0) >= device.minLength &&
    device.directions.includes(direction)
  );
}

function rowToDevice(row) {
  return {
    token: row.token,
    environment: row.environment,
    enabled: Boolean(row.enabled),
    pushToStartToken: row.push_to_start_token ?? undefined,
    liveActivities: Boolean(row.live_activities),
    categories: JSON.parse(row.categories),
    minLength: row.min_length,
    directions: JSON.parse(row.directions),
  };
}

export function createPushDevices({ file = ":memory:", logger, now = () => new Date() } = {}) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);

  const upsert = db.prepare(`
    INSERT INTO push_devices (
      token, environment, enabled, push_to_start_token, live_activities,
      categories, min_length, directions, created_at, updated_at
    ) VALUES (
      :token, :environment, :enabled, :push_to_start_token, :live_activities,
      :categories, :min_length, :directions, :now, :now
    )
    ON CONFLICT (token) DO UPDATE SET
      environment = :environment,
      enabled = :enabled,
      push_to_start_token = :push_to_start_token,
      live_activities = :live_activities,
      categories = :categories,
      min_length = :min_length,
      directions = :directions,
      updated_at = :now
  `);
  const exists = db.prepare("SELECT 1 FROM push_devices WHERE token = ?");
  const count = db.prepare("SELECT COUNT(*) AS n FROM push_devices");
  const remove = db.prepare("DELETE FROM push_devices WHERE token = ?");
  const clearPushToStart = db.prepare("UPDATE push_devices SET push_to_start_token = NULL WHERE push_to_start_token = ?");
  const selectEnabled = db.prepare("SELECT * FROM push_devices WHERE enabled = 1");
  const insertChannel = db.prepare(
    "INSERT OR REPLACE INTO live_activity_channels (channel_id, environment, mmsi, created_at) VALUES (?, ?, ?, ?)"
  );
  const deleteChannel = db.prepare("DELETE FROM live_activity_channels WHERE channel_id = ? AND environment = ?");
  const selectChannels = db.prepare("SELECT channel_id, environment, mmsi, created_at FROM live_activity_channels");

  logger?.info(`[push] ${count.get().n} devices registered`);

  return {
    // Save a device from parseDeviceRegistration; false when the device table is full
    register(device) {
      if (!exists.get(device.token) && count.get().n >= MAX_DEVICES) return false;
      upsert.run({
        token: device.token,
        environment: device.environment,
        enabled: device.enabled ? 1 : 0,
        push_to_start_token: device.pushToStartToken ?? null,
        live_activities: device.liveActivities ? 1 : 0,
        categories: JSON.stringify(device.categories),
        min_length: device.minLength,
        directions: JSON.stringify(device.directions),
        now: now().toISOString(),
      });
      return true;
    },

    remove(token) {
      remove.run(token.toLowerCase());
    },

    // APNs said this push-to-start token is no longer valid
    clearPushToStartToken(token) {
      clearPushToStart.run(token.toLowerCase());
    },

    // Enabled devices that want an alert for this ship
    matching(ship) {
      return selectEnabled.all().map(rowToDevice).filter((device) => wantsAlert(device, ship));
    },

    addChannel({ channelId, environment, mmsi }) {
      insertChannel.run(channelId, environment, mmsi, now().toISOString());
    },

    removeChannel({ channelId, environment }) {
      deleteChannel.run(channelId, environment);
    },

    // Channels still open, e.g. left over from before a restart
    channels() {
      return selectChannels.all().map((row) => ({
        channelId: row.channel_id,
        environment: row.environment,
        mmsi: row.mmsi,
        createdAt: row.created_at,
      }));
    },

    close() {
      db.close();
    },
  };
}
