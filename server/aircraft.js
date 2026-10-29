import { EventEmitter } from "node:events";

// Aircraft near the bridge from an ADS-B feed, polled by the server and sent to clients
// as {type: "aircraft", aircraft} on subscribe and after each poll.
//
// Both sources speak readsb's JSON: the public adsb.lol API (an "ac" array) and a local
// readsb/tar1090 receiver's aircraft.json (an "aircraft" array).

export const DEFAULT_ADSB_URL = "https://api.adsb.lol/v2/point/42.9982/-82.423/40";
const POLL_INTERVAL_MS = 5_000;
// Each failed poll in a row doubles the wait, up to this; a 429's Retry-After can ask for longer, up to this too
const MAX_BACKOFF_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
// Positions older than this are dropped; readsb keeps aircraft listed for a while after losing them
const MAX_POSITION_AGE_S = 60;
// After failing this long, clear the aircraft rather than leave them frozen on the map
const CLEAR_AFTER_MS = 60_000;
const USER_AGENT = "BridgeViewAIS/1.0 (https://github.com/tmcknight/bridgeview-ais)";

const roundTo = (value, places) => Math.round(value * 10 ** places) / 10 ** places;
const numberOrUndefined = (value) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

// One readsb aircraft record, trimmed to what the map shows; null without a recent position
export function parseAircraft(record) {
  if (!record || typeof record.hex !== "string") return null;
  const { lat, lon } = record;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (typeof record.seen_pos === "number" && record.seen_pos > MAX_POSITION_AGE_S) return null;

  const aircraft = {
    hex: record.hex.replace(/^~/, "").toLowerCase(),
    lat: roundTo(lat, 5),
    lon: roundTo(lon, 5),
  };
  const callsign = typeof record.flight === "string" ? record.flight.trim() : "";
  if (callsign) aircraft.callsign = callsign;
  if (typeof record.r === "string" && record.r) aircraft.registration = record.r;
  if (typeof record.t === "string" && record.t) aircraft.type = record.t;
  if (record.alt_baro === "ground") aircraft.onGround = true;
  else if (numberOrUndefined(record.alt_baro) !== undefined) aircraft.altitude = record.alt_baro;
  const speed = numberOrUndefined(record.gs);
  if (speed !== undefined) aircraft.speed = Math.round(speed);
  const track = numberOrUndefined(record.track) ?? numberOrUndefined(record.true_heading);
  if (track !== undefined) aircraft.track = Math.round(track);
  const verticalRate = numberOrUndefined(record.baro_rate) ?? numberOrUndefined(record.geom_rate);
  if (verticalRate !== undefined) aircraft.verticalRate = verticalRate;
  if (typeof record.squawk === "string" && record.squawk) aircraft.squawk = record.squawk;
  if (typeof record.category === "string" && record.category) aircraft.category = record.category;
  return aircraft;
}

// Milliseconds a Retry-After header asks for (seconds or an HTTP date); null without a usable one
export function parseRetryAfter(value, now = Date.now()) {
  if (typeof value !== "string" || !value.trim()) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : null;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export function parseAircraftResponse(body) {
  const records = Array.isArray(body?.ac) ? body.ac : Array.isArray(body?.aircraft) ? body.aircraft : null;
  if (!records) throw new Error("response has no aircraft list");
  return records.map(parseAircraft).filter(Boolean);
}

// Events: "aircraft" (list) after each poll that changes what clients see,
// "link" ("up" | "down", detail) and "activity" for feed status
export function createAircraftFeed({
  url = DEFAULT_ADSB_URL,
  logger,
  fetch = globalThis.fetch,
  pollIntervalMs = POLL_INTERVAL_MS,
  now = Date.now,
}) {
  const emitter = new EventEmitter();
  let aircraft = [];
  let lastSuccessAt = null;
  let failures = 0;
  let retryAfterMs = null;
  let timer = null;
  let stopped = false;

  async function poll() {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        if (response.status === 429) retryAfterMs = parseRetryAfter(response.headers?.get("retry-after"), now());
        throw new Error(`HTTP ${response.status}`);
      }
      aircraft = parseAircraftResponse(await response.json());
      lastSuccessAt = now();
      failures = 0;
      emitter.emit("link", "up");
      emitter.emit("activity");
      emitter.emit("aircraft", aircraft);
    } catch (err) {
      failures++;
      logger?.warn(`[adsb] poll failed: ${err.message}`);
      emitter.emit("link", "down", err.message);
      if (aircraft.length > 0 && (lastSuccessAt === null || now() - lastSuccessAt > CLEAR_AFTER_MS)) {
        aircraft = [];
        emitter.emit("aircraft", aircraft);
      }
    } finally {
      if (!stopped) timer = setTimeout(poll, nextDelay());
      retryAfterMs = null;
    }
  }

  function nextDelay() {
    if (failures === 0) return pollIntervalMs;
    const backoff = Math.min(pollIntervalMs * 2 ** failures, MAX_BACKOFF_MS);
    return Math.max(backoff, Math.min(retryAfterMs ?? 0, MAX_BACKOFF_MS));
  }

  emitter.aircraft = () => aircraft;
  emitter.start = () => {
    stopped = false;
    poll();
  };
  emitter.stop = () => {
    stopped = true;
    clearTimeout(timer);
  };

  return emitter;
}
