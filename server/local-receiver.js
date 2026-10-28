import net from "node:net";
import { EventEmitter } from "node:events";
import { CLASS_B_MESSAGE_IDS, classBPositionReport, classBStaticData } from "./class-b.js";

// Local AIS receiver: reads AIS-catcher's JSON_FULL TCP stream
// (e.g. `AIS-catcher -S 5012 MSGFORMAT JSON_FULL`) and converts each
// message into the AISStream.io message shape the frontend already understands.

const POSITION_TYPES = new Set([1, 2, 3]);
const STATIC_TYPE = 5;
const CLASS_B_POSITION_TYPES = new Set([18, 19]);
const CLASS_B_STATIC_TYPE = 24;
const RECONNECT_DELAY_MS = 5000;
const DEDUP_TTL_MS = 60000;

function isValidPosition(lat, lon) {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    lat >= -90 && lat <= 90 &&
    lon >= -180 && lon <= 180 &&
    !(lat === 0 && lon === 0)
  );
}

function toTimeUtc(rxuxtime) {
  const ms = typeof rxuxtime === "number" ? rxuxtime * 1000 : Date.now();
  return new Date(ms).toISOString();
}

// Marks a message as heard by the local antenna, with AIS-catcher's signal level in dB when present.
function localSource(json) {
  return typeof json.signalpower === "number"
    ? { Source: "local", SignalPower: Math.round(json.signalpower * 10) / 10 }
    : { Source: "local" };
}

// The Class B details in a type 19 report or one part of a type 24 report
// (part A, partno 0: name; part B, partno 1: type, call sign and size)
function classBDetailsFrom(json) {
  const details = {};
  const name = (json.shipname || "").trim();
  if (name) details.name = name;
  if (json.type === 19 || (json.type === CLASS_B_STATIC_TYPE && json.partno === 1)) {
    details.shipType = json.shiptype ?? 0;
    if (json.type === CLASS_B_STATIC_TYPE) details.callSign = (json.callsign || "").trim();
    details.dimension = {
      A: json.to_bow ?? 0,
      B: json.to_stern ?? 0,
      C: json.to_port ?? 0,
      D: json.to_starboard ?? 0,
    };
  }
  return details;
}

// Convert one AIS-catcher JSON_FULL object to an AISStream-style message.
// `vessels` caches name and last position per MMSI, since AIS splits them across message types.
// `nameFor` looks up a name heard elsewhere (e.g. from AISStream) for ships the
// antenna hasn't heard details from yet.
// Returns null for message types the app doesn't use.
export function toAISStreamMessage(json, vessels, nameFor = () => undefined) {
  if (!json || typeof json.mmsi !== "number") return null;

  const mmsi = json.mmsi;
  const known = vessels.get(mmsi) || {};
  const time_utc = toTimeUtc(json.rxuxtime);

  if (POSITION_TYPES.has(json.type)) {
    if (!isValidPosition(json.lat, json.lon)) return null;
    vessels.set(mmsi, { ...known, latitude: json.lat, longitude: json.lon });

    return {
      MessageType: "PositionReport",
      MetaData: {
        MMSI: mmsi,
        MMSI_String: String(mmsi),
        ShipName: known.name || nameFor(mmsi) || "",
        latitude: json.lat,
        longitude: json.lon,
        time_utc,
        ...localSource(json),
      },
      Message: {
        PositionReport: {
          Cog: json.course ?? 360,
          CommunicationState: 0,
          Latitude: json.lat,
          Longitude: json.lon,
          MessageID: json.type,
          NavigationalStatus: json.status ?? 15,
          PositionAccuracy: Boolean(json.accuracy),
          Raim: Boolean(json.raim),
          RateOfTurn: json.turn ?? -128,
          RepeatIndicator: json.repeat ?? 0,
          Sog: json.speed ?? 102.3,
          Spare: 0,
          SpecialManoeuvreIndicator: json.maneuver ?? 0,
          Timestamp: json.second ?? 60,
          TrueHeading: json.heading ?? 511,
          UserID: mmsi,
          Valid: true,
        },
      },
    };
  }

  if (CLASS_B_POSITION_TYPES.has(json.type)) {
    if (!isValidPosition(json.lat, json.lon)) return null;
    // Type 19 also carries the name, type and size
    const classB = json.type === 19 ? { ...known.classB, ...classBDetailsFrom(json) } : known.classB;
    const name = classB?.name || known.name;
    vessels.set(mmsi, { ...known, latitude: json.lat, longitude: json.lon, classB, name });

    return classBPositionReport(
      {
        MMSI: mmsi,
        MMSI_String: String(mmsi),
        ShipName: name || nameFor(mmsi) || "",
        latitude: json.lat,
        longitude: json.lon,
        time_utc,
        ...localSource(json),
      },
      {
        Cog: json.course ?? 360,
        Latitude: json.lat,
        Longitude: json.lon,
        MessageID: json.type,
        PositionAccuracy: Boolean(json.accuracy),
        Raim: Boolean(json.raim),
        RepeatIndicator: json.repeat ?? 0,
        Sog: json.speed ?? 102.3,
        Timestamp: json.second ?? 60,
        TrueHeading: json.heading ?? 511,
        UserID: mmsi,
      }
    );
  }

  if (json.type === CLASS_B_STATIC_TYPE) {
    const part = classBDetailsFrom(json);
    if (Object.keys(part).length === 0) return null;
    const classB = { ...known.classB, ...part };
    vessels.set(mmsi, { ...known, classB, ...(classB.name && { name: classB.name }) });

    return classBStaticData(
      {
        MMSI: mmsi,
        MMSI_String: String(mmsi),
        ShipName: classB.name || known.name || nameFor(mmsi) || "",
        latitude: known.latitude ?? 0,
        longitude: known.longitude ?? 0,
        time_utc,
        ...localSource(json),
      },
      classB
    );
  }

  if (json.type === STATIC_TYPE) {
    const name = (json.shipname || "").trim();
    if (name) vessels.set(mmsi, { ...known, name });

    return {
      MessageType: "ShipStaticData",
      MetaData: {
        MMSI: mmsi,
        MMSI_String: String(mmsi),
        ShipName: name,
        latitude: known.latitude ?? 0,
        longitude: known.longitude ?? 0,
        time_utc,
        ...localSource(json),
      },
      Message: {
        ShipStaticData: {
          AisVersion: json.ais_version ?? 0,
          CallSign: json.callsign || "",
          Destination: json.destination || "",
          Dimension: {
            A: json.to_bow ?? 0,
            B: json.to_stern ?? 0,
            C: json.to_port ?? 0,
            D: json.to_starboard ?? 0,
          },
          Draught: json.draught ?? 0,
          Dte: Boolean(json.dte),
          Eta: {
            Day: json.day ?? 0,
            Hour: json.hour ?? 24,
            Minute: json.minute ?? 60,
            Month: json.month ?? 0,
          },
          ImoNumber: json.imo ?? 0,
          MaximumStaticDraught: json.draught ?? 0,
          MessageID: STATIC_TYPE,
          Name: name,
          RepeatIndicator: json.repeat ?? 0,
          Spare: false,
          Type: json.shiptype ?? 0,
          UserID: mmsi,
          Valid: true,
        },
      },
    };
  }

  return null;
}

// Whether a message falls inside any of the subscription's bounding boxes.
// Static data with no known position passes, since the receiver only hears nearby vessels.
export function inBoundingBoxes(message, boxes) {
  const { latitude, longitude } = message.MetaData;
  if (message.MessageType === "ShipStaticData" && latitude === 0 && longitude === 0) {
    return true;
  }
  return boxes.some(([[lat1, lon1], [lat2, lon2]]) =>
    latitude >= Math.min(lat1, lat2) && latitude <= Math.max(lat1, lat2) &&
    longitude >= Math.min(lon1, lon2) && longitude <= Math.max(lon1, lon2)
  );
}

// Whether a message passes the subscription's FilterMessageTypes (names or numeric IDs).
export function matchesMessageFilter(message, filter) {
  if (!filter || filter.length === 0) return true;
  if (filter.includes(message.MessageType)) return true;
  const payload = message.Message.PositionReport || message.Message.ShipStaticData;
  // Class B messages arrive as PositionReport or ShipStaticData; match their own names too
  return filter.some((type) => type === payload?.MessageID || CLASS_B_MESSAGE_IDS[type] === payload?.MessageID);
}

// Key identifying one over-the-air transmission, so the same report heard by both
// the local antenna and AISStream.io is only delivered once.
export function dedupKey(message) {
  const { MMSI } = message.MetaData;
  const pos = message.Message.PositionReport;
  if (pos) {
    return `P:${MMSI}:${pos.Latitude.toFixed(4)}:${pos.Longitude.toFixed(4)}:${pos.Sog}:${pos.Cog}:${pos.Timestamp}`;
  }
  const data = message.Message.ShipStaticData;
  if (data) {
    return `S:${MMSI}:${data.Name}:${data.Destination}:${data.CallSign}`;
  }
  return null;
}

// Per-client duplicate filter. Returns true the first time a transmission is seen
// within the TTL window, false for repeats.
export function createDeduper(ttlMs = DEDUP_TTL_MS, now = Date.now) {
  const seen = new Map(); // key -> expiry

  return function isFirstSeen(message) {
    const key = dedupKey(message);
    if (!key) return true;

    const t = now();
    if (seen.size > 5000) {
      for (const [k, expiry] of seen) {
        if (expiry <= t) seen.delete(k);
      }
    }

    const expiry = seen.get(key);
    if (expiry && expiry > t) return false;
    seen.set(key, t + ttlMs);
    return true;
  };
}

// Connect to AIS-catcher's TCP JSON stream and emit "message" events with
// AISStream-shaped messages. Reconnects automatically if AIS-catcher restarts.
// Also emits "link" ("connecting" | "up" | "down", detail) as the connection
// changes, and "activity" for every message AIS-catcher sends, used or not.
export function createLocalReceiver({ host, port, logger, nameFor }) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0); // one listener per browser client
  const vessels = new Map();
  let socket = null;
  let buffer = "";
  let stopped = false;
  let connected = false;
  let warnedUnavailable = false;
  let reconnectTimer = null;
  let lastError = null;
  let retrying = false;

  function handleLine(line) {
    if (!line.trim()) return;
    let json;
    try {
      json = JSON.parse(line);
    } catch {
      logger.warn("[local] ignoring non-JSON line (is AIS-catcher using MSGFORMAT JSON_FULL?)");
      return;
    }
    emitter.emit("activity");
    const message = toAISStreamMessage(json, vessels, nameFor);
    if (message) emitter.emit("message", message);
  }

  function connect() {
    if (stopped) return;
    buffer = "";
    lastError = null;
    // While retrying, stay "down" rather than flickering back to "connecting"
    if (!retrying) emitter.emit("link", "connecting");
    socket = net.connect({ host, port });

    socket.on("connect", () => {
      connected = true;
      warnedUnavailable = false;
      retrying = false;
      emitter.emit("link", "up");
      logger.info(`[local] connected to AIS-catcher at ${host}:${port}`);
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    });

    socket.on("error", (err) => {
      lastError = err.message;
      if (!warnedUnavailable) {
        logger.warn(`[local] AIS-catcher unavailable at ${host}:${port} (${err.message}), retrying every ${RECONNECT_DELAY_MS / 1000}s`);
        warnedUnavailable = true;
      }
    });

    socket.on("close", () => {
      if (connected) {
        logger.warn("[local] AIS-catcher connection closed, reconnecting");
        connected = false;
      }
      if (!stopped) {
        emitter.emit("link", "down", lastError ? `AIS-catcher unavailable (${lastError})` : "AIS-catcher connection closed");
        retrying = true;
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    });
  }

  // Let callers attach listeners before the first "link" event
  process.nextTick(connect);

  emitter.stop = () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    socket?.destroy();
  };

  return emitter;
}
