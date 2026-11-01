import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SHIP_CATEGORIES } from "./bridge-eta.js";

// Phones registered for bridge alerts (iPhones through APNs, Android phones through
// FCM), and the Live Activity broadcast channels open for ships on their way, kept
// in SQLite (the same DB_FILE as vessel details).

export const DIRECTIONS = ["upbound", "downbound"];
export const ENVIRONMENTS = ["sandbox", "production"];
export const PLATFORMS = ["ios", "android"];
// Most devices there could ever be; registration is open, so cap it
export const MAX_DEVICES = 100_000;

const DEFAULT_CATEGORIES = ["cargo", "tanker", "passenger"];
// APNs tokens are hex (any case, stored lowercase); FCM registration tokens are
// case-sensitive and kept as sent
const TOKEN_PATTERN = /^[0-9a-f]{32,400}$/i;
const FCM_TOKEN_PATTERN = /^[A-Za-z0-9_:-]{20,4096}$/;
const MMSI_PATTERN = /^\d{9}$/;
// Ships a device can choose Live Activities for, one by one; only those coming up matter
const MAX_LIVE_ACTIVITY_SHIPS = 50;

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
    live_activity_ships TEXT NOT NULL DEFAULT '{}',
    platform TEXT NOT NULL DEFAULT 'ios',
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

// Columns added since the table was first made
function migrate(db) {
  const columns = db.prepare("PRAGMA table_info(push_devices)").all().map((c) => c.name);
  if (!columns.includes("live_activity_ships")) {
    db.exec("ALTER TABLE push_devices ADD COLUMN live_activity_ships TEXT NOT NULL DEFAULT '{}'");
  }
  if (!columns.includes("platform")) {
    db.exec("ALTER TABLE push_devices ADD COLUMN platform TEXT NOT NULL DEFAULT 'ios'");
  }
}

function isLiveActivityShips(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= MAX_LIVE_ACTIVITY_SHIPS &&
    entries.every(([mmsi, on]) => MMSI_PATTERN.test(mmsi) && typeof on === "boolean")
  );
}

function isSubsetOf(value, allowed) {
  return Array.isArray(value) && value.every((item) => allowed.includes(item));
}

// Check a PUT /api/devices/:token body. Returns { device } or { error }.
export function parseDeviceRegistration(token, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return typeof token !== "string" || !TOKEN_PATTERN.test(token)
      ? { error: "Invalid device token" }
      : { error: "Body must be an object" };
  }
  // Older iOS builds don't send a platform
  const { platform = "ios" } = body;
  if (!PLATFORMS.includes(platform)) return { error: `platform must be one of ${PLATFORMS.join(", ")}` };
  const android = platform === "android";
  if (typeof token !== "string" || !(android ? FCM_TOKEN_PATTERN : TOKEN_PATTERN).test(token)) {
    return { error: "Invalid device token" };
  }
  const {
    environment,
    enabled = true,
    pushToStartToken,
    liveActivities = false,
    categories = DEFAULT_CATEGORIES,
    minLength = 0,
    directions = DIRECTIONS,
    liveActivityShips = {},
  } = body;
  if (!ENVIRONMENTS.includes(environment)) return { error: `environment must be one of ${ENVIRONMENTS.join(", ")}` };
  if (typeof enabled !== "boolean") return { error: "enabled must be a boolean" };
  if (android && pushToStartToken !== undefined) return { error: "pushToStartToken is for iOS only" };
  if (pushToStartToken !== undefined && (typeof pushToStartToken !== "string" || !TOKEN_PATTERN.test(pushToStartToken))) {
    return { error: "Invalid pushToStartToken" };
  }
  if (typeof liveActivities !== "boolean") return { error: "liveActivities must be a boolean" };
  if (!isSubsetOf(categories, SHIP_CATEGORIES)) return { error: `categories must be from ${SHIP_CATEGORIES.join(", ")}` };
  if (!Number.isInteger(minLength) || minLength < 0 || minLength > 500) return { error: "minLength must be 0-500" };
  if (!isSubsetOf(directions, DIRECTIONS)) return { error: `directions must be from ${DIRECTIONS.join(", ")}` };
  if (!isLiveActivityShips(liveActivityShips)) {
    return { error: `liveActivityShips must map up to ${MAX_LIVE_ACTIVITY_SHIPS} MMSIs to true or false` };
  }
  return {
    device: {
      token: android ? token : token.toLowerCase(),
      platform,
      environment,
      enabled,
      pushToStartToken: pushToStartToken?.toLowerCase(),
      liveActivities,
      categories: [...new Set(categories)],
      minLength,
      directions: [...new Set(directions)],
      liveActivityShips: { ...liveActivityShips },
    },
  };
}

// Whether a device wants an alert for this ship ({ mmsi, category, length, direction }).
// A ship the user chose a Live Activity for is alerted even if its settings would skip it.
export function wantsAlert(device, { mmsi, category, length, direction }) {
  if (!device.enabled) return false;
  if (device.liveActivityShips?.[mmsi] === true) return true;
  return (
    device.categories.includes(category) &&
    (length ?? 0) >= device.minLength &&
    device.directions.includes(direction)
  );
}

// Whether this ship's alert should start a Live Activity on the device (on Android,
// a live countdown notification): the user's choice for that ship, or else their
// default. iPhones need a push-to-start token for it.
export function wantsLiveActivity(device, mmsi) {
  const wanted = device.liveActivityShips?.[mmsi] ?? device.liveActivities;
  if (device.platform === "android") return Boolean(wanted);
  return Boolean(device.pushToStartToken) && wanted;
}

function rowToDevice(row) {
  return {
    token: row.token,
    platform: row.platform,
    environment: row.environment,
    enabled: Boolean(row.enabled),
    pushToStartToken: row.push_to_start_token ?? undefined,
    liveActivities: Boolean(row.live_activities),
    categories: JSON.parse(row.categories),
    minLength: row.min_length,
    directions: JSON.parse(row.directions),
    liveActivityShips: JSON.parse(row.live_activity_ships),
  };
}

export function createPushDevices({ file = ":memory:", logger, now = () => new Date() } = {}) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  migrate(db);

  const upsert = db.prepare(`
    INSERT INTO push_devices (
      token, environment, enabled, push_to_start_token, live_activities,
      categories, min_length, directions, live_activity_ships, platform, created_at, updated_at
    ) VALUES (
      :token, :environment, :enabled, :push_to_start_token, :live_activities,
      :categories, :min_length, :directions, :live_activity_ships, :platform, :now, :now
    )
    ON CONFLICT (token) DO UPDATE SET
      environment = :environment,
      platform = :platform,
      enabled = :enabled,
      -- A registration without one keeps the token already stored: the app sends
      -- some (a background launch for a geofence crossing) before iOS has given it
      -- the token again, and dropping it would turn Live Activities into plain
      -- notifications. APNs rejecting a token clears it (clearPushToStartToken).
      push_to_start_token = COALESCE(:push_to_start_token, push_to_start_token),
      live_activities = :live_activities,
      categories = :categories,
      min_length = :min_length,
      directions = :directions,
      live_activity_ships = :live_activity_ships,
      updated_at = :now
  `);
  const exists = db.prepare("SELECT 1 FROM push_devices WHERE token = ?");
  const count = db.prepare("SELECT COUNT(*) AS n FROM push_devices");
  // iOS tokens are stored lowercase; FCM tokens exactly as sent
  const remove = db.prepare(
    "DELETE FROM push_devices WHERE token = :token OR (platform = 'ios' AND token = :lower)"
  );
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
        live_activity_ships: JSON.stringify(device.liveActivityShips ?? {}),
        platform: device.platform ?? "ios",
        now: now().toISOString(),
      });
      return true;
    },

    remove(token) {
      remove.run({ token, lower: token.toLowerCase() });
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
