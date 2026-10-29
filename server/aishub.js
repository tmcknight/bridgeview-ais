import { EventEmitter } from "node:events";
import { classBPositionReport, classBStaticData } from "./class-b.js";

// AISHub (https://www.aishub.net/api): a REST API returning each ship's latest
// position and details in an area. Only stations that share their own feed with
// AISHub get a username, and it may be polled at most once a minute, so it fills
// in around the other feeds rather than replacing them.
//
// Each record is turned into an AISStream-shaped ShipStaticData (when the details
// change) and PositionReport (when the position is newer than any already heard).

export const AISHUB_URL = "https://data.aishub.net/ws.php";
// AISHub returns nothing to a username polling more than once a minute; leave some slack
const POLL_INTERVAL_MS = 65_000;
const MAX_BACKOFF_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
// Only ask for positions this recent (minutes); matches the server's latest-positions TTL
const MAX_POSITION_AGE_MIN = 10;
// Most ships whose last report is remembered
const MAX_VESSELS = 5000;

// Format 0 ("AIS encoding") sends positions in 1/10000 minute
const COORDINATE_SCALE = 600_000;

const toNumber = (value) => {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : undefined;
};

function isValidPosition(lat, lon) {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && !(lat === 0 && lon === 0);
}

// AIS packs the ETA as month (4 bits), day (5), hour (5) and minute (6)
export function decodeEta(eta) {
  const value = toNumber(eta);
  if (value === undefined) return { Day: 0, Hour: 24, Minute: 60, Month: 0 };
  return {
    Day: (value >> 11) & 0x1f,
    Hour: (value >> 6) & 0x1f,
    Minute: value & 0x3f,
    Month: (value >> 16) & 0x0f,
  };
}

// The vessel endpoint's URL for one area, given as a bounding box [[lat, lon], [lat, lon]]
export function aishubUrl(username, [[lat1, lon1], [lat2, lon2]], baseUrl = AISHUB_URL) {
  const params = new URLSearchParams({
    username,
    format: "0",
    output: "json",
    compress: "0",
    latmin: String(Math.min(lat1, lat2)),
    latmax: String(Math.max(lat1, lat2)),
    lonmin: String(Math.min(lon1, lon2)),
    lonmax: String(Math.max(lon1, lon2)),
    interval: String(MAX_POSITION_AGE_MIN),
  });
  return `${baseUrl}?${params}`;
}

// The smallest box holding every bounding box, since one request a minute must cover them all
export function enclosingBox(boxes) {
  if (boxes.length === 0) return null;
  const lats = boxes.flatMap(([[lat1], [lat2]]) => [lat1, lat2]);
  const lons = boxes.flatMap(([[, lon1], [, lon2]]) => [lon1, lon2]);
  return [
    [Math.min(...lats), Math.min(...lons)],
    [Math.max(...lats), Math.max(...lons)],
  ];
}

// The vessel records in an AISHub JSON response: [{ERROR, USERNAME, FORMAT, RECORDS}, [records]]
export function parseAishubResponse(body) {
  if (!Array.isArray(body) || typeof body[0] !== "object" || body[0] === null) {
    throw new Error("unexpected response");
  }
  const [meta, records] = body;
  if (meta.ERROR) throw new Error(meta.ERROR_MESSAGE || "AISHub reported an error");
  return Array.isArray(records) ? records : [];
}

// One AISHub record as AISStream-shaped messages: { position, details } (either may be null).
// `classB` marks a ship the other feeds have heard as Class B, since AISHub doesn't say.
export function toAISStreamMessages(record, { classB = false } = {}) {
  const mmsi = toNumber(record?.MMSI);
  const seconds = toNumber(record?.TIME);
  if (mmsi === undefined || seconds === undefined) return { position: null, details: null };

  const time = new Date(seconds * 1000);
  const name = typeof record.NAME === "string" ? record.NAME.trim() : "";
  const rawLat = toNumber(record.LATITUDE);
  const rawLon = toNumber(record.LONGITUDE);
  const latitude = rawLat !== undefined ? rawLat / COORDINATE_SCALE : undefined;
  const longitude = rawLon !== undefined ? rawLon / COORDINATE_SCALE : undefined;
  const hasPosition = latitude !== undefined && longitude !== undefined && isValidPosition(latitude, longitude);

  const metaData = {
    MMSI: mmsi,
    MMSI_String: String(mmsi),
    ShipName: name,
    latitude: hasPosition ? latitude : 0,
    longitude: hasPosition ? longitude : 0,
    time_utc: time.toISOString(),
    Source: "aishub",
  };

  const dimension = {
    A: toNumber(record.A) ?? 0,
    B: toNumber(record.B) ?? 0,
    C: toNumber(record.C) ?? 0,
    D: toNumber(record.D) ?? 0,
  };
  const callSign = typeof record.CALLSIGN === "string" ? record.CALLSIGN.trim() : "";
  const shipType = toNumber(record.TYPE) ?? 0;

  let details = null;
  if (name) {
    details = classB
      ? classBStaticData(metaData, { name, shipType, callSign, dimension })
      : {
          MessageType: "ShipStaticData",
          MetaData: metaData,
          Message: {
            ShipStaticData: {
              AisVersion: 0,
              CallSign: callSign,
              Destination: typeof record.DEST === "string" ? record.DEST.trim() : "",
              Dimension: dimension,
              Draught: (toNumber(record.DRAUGHT) ?? 0) / 10,
              Dte: false,
              Eta: decodeEta(record.ETA),
              ImoNumber: toNumber(record.IMO) ?? 0,
              MaximumStaticDraught: (toNumber(record.DRAUGHT) ?? 0) / 10,
              MessageID: 5,
              Name: name,
              RepeatIndicator: 0,
              Spare: false,
              Type: shipType,
              UserID: mmsi,
              Valid: true,
            },
          },
        };
  }

  let position = null;
  if (hasPosition) {
    const report = {
      Cog: (toNumber(record.COG) ?? 3600) / 10,
      Latitude: latitude,
      Longitude: longitude,
      MessageID: classB ? 18 : 1,
      PositionAccuracy: toNumber(record.PAC) === 1,
      Raim: false,
      RepeatIndicator: 0,
      Sog: (toNumber(record.SOG) ?? 1023) / 10,
      Timestamp: time.getUTCSeconds(),
      TrueHeading: toNumber(record.HEADING) ?? 511,
      UserID: mmsi,
    };
    if (classB) {
      position = classBPositionReport(metaData, report);
    } else {
      // Format 0 sends the rate of turn as an unsigned byte; AIS's is signed, -128 for none
      const rot = toNumber(record.ROT) ?? 128;
      position = {
        MessageType: "PositionReport",
        MetaData: metaData,
        Message: {
          PositionReport: {
            CommunicationState: 0,
            NavigationalStatus: toNumber(record.NAVSTAT) ?? 15,
            RateOfTurn: rot > 127 ? rot - 256 : rot,
            Spare: 0,
            SpecialManoeuvreIndicator: 0,
            Valid: true,
            ...report,
          },
        },
      };
    }
  }

  return { position, details };
}

// Key of the details AISHub reports for a ship, to send them on only when they change
function detailsKey(details) {
  const data = details.Message.ShipStaticData;
  return JSON.stringify([data.Name, data.CallSign, data.Destination, data.Type, data.Dimension, data.Draught, data.Eta, data.ImoNumber]);
}

// Polls AISHub for the area `area()` returns ([[lat, lon], [lat, lon]], or null to skip a poll).
// `latest(mmsi)` gives the server's latest position for a ship ({ message, receivedAt }),
// so positions another feed has already beaten are dropped and Class B ships keep their class.
// Events: "message" (AISStream-shaped message), "link" ("up" | "down", detail) and
// "activity" after each poll that returned ships
export function createAishubFeed({
  username,
  area,
  latest = () => undefined,
  logger,
  baseUrl = AISHUB_URL,
  fetch = globalThis.fetch,
  pollIntervalMs = POLL_INTERVAL_MS,
}) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0); // one listener per browser client
  const vessels = new Map(); // MMSI -> { time, detailsKey }
  let failures = 0;
  let timer = null;
  let stopped = false;

  function remember(mmsi, update) {
    const known = vessels.get(mmsi);
    // Re-insert so the least recently reported ship is first to go
    vessels.delete(mmsi);
    vessels.set(mmsi, { ...known, ...update });
    if (vessels.size > MAX_VESSELS) vessels.delete(vessels.keys().next().value);
  }

  function handleRecord(record) {
    const mmsi = toNumber(record?.MMSI);
    if (mmsi === undefined) return;
    const known = vessels.get(mmsi);
    const heard = latest(mmsi);
    const { position, details } = toAISStreamMessages(record, {
      classB: heard?.message?.MetaData?.AisClass === "B",
    });

    if (details) {
      const key = detailsKey(details);
      if (key !== known?.detailsKey) {
        remember(mmsi, { detailsKey: key });
        emitter.emit("message", details);
      }
    }

    if (position) {
      const time = Date.parse(position.MetaData.time_utc);
      // AISHub repeats a ship's last report until it sends another
      if (known?.time !== undefined && time <= known.time) return;
      remember(mmsi, { time });
      // Another feed already delivered this report, or a newer one
      const otherFeed = heard && heard.message?.MetaData?.Source !== "aishub";
      if (otherFeed && heard.receivedAt >= time) return;
      emitter.emit("message", position);
    }
  }

  async function poll() {
    const box = area();
    if (!box) return;
    try {
      const response = await fetch(aishubUrl(username, box, baseUrl), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const records = parseAishubResponse(await response.json());
      failures = 0;
      emitter.emit("link", "up");
      if (records.length > 0) emitter.emit("activity");
      for (const record of records) handleRecord(record);
    } catch (err) {
      failures++;
      logger?.warn(`[aishub] poll failed: ${err.message}`);
      emitter.emit("link", "down", err.message);
    }
  }

  function nextDelay() {
    if (failures === 0) return pollIntervalMs;
    return Math.min(pollIntervalMs * 2 ** failures, MAX_BACKOFF_MS);
  }

  async function loop() {
    await poll();
    if (!stopped) timer = setTimeout(loop, nextDelay());
  }

  emitter.start = () => {
    stopped = false;
    loop();
  };
  emitter.stop = () => {
    stopped = true;
    clearTimeout(timer);
  };

  return emitter;
}
