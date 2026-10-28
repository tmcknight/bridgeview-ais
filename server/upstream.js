import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { fromAISStreamClassB } from "./class-b.js";

// One shared connection to AISStream.io for every client. AISStream allows
// only 3 connections per account (and per IP), so a connection per browser
// runs out fast. This subscribes to the union of every client's area and the
// server fans messages out to each client by its own subscription.

export const UPSTREAM_URL = "wss://stream.aisstream.io/v0/stream";

// AISStream closes a connection that updates its subscription more than once a second
export const MIN_SUBSCRIPTION_INTERVAL_MS = 1100;

const MIN_RETRY_MS = 1000;
const MAX_RETRY_MS = 60_000;

function normalizeBox([[lat1, lon1], [lat2, lon2]]) {
  return [
    [Math.min(lat1, lat2), Math.min(lon1, lon2)],
    [Math.max(lat1, lat2), Math.max(lon1, lon2)],
  ];
}

function contains(outer, inner) {
  return (
    outer[0][0] <= inner[0][0] &&
    outer[0][1] <= inner[0][1] &&
    outer[1][0] >= inner[1][0] &&
    outer[1][1] >= inner[1][1]
  );
}

// Combine client subscriptions into one: every bounding box (minus any inside
// another), and every message type, or no type filter if any client has none.
// Returns null when there's nothing to subscribe to.
export function mergeSubscriptions(subscriptions) {
  const boxes = [];
  let types = new Set();
  let allTypes = false;

  for (const sub of subscriptions) {
    for (const box of sub.BoundingBoxes) boxes.push(normalizeBox(box));
    if (!sub.FilterMessageTypes || sub.FilterMessageTypes.length === 0) {
      allTypes = true;
    } else {
      for (const type of sub.FilterMessageTypes) types.add(type);
    }
  }
  if (boxes.length === 0) return null;

  const kept = boxes.filter(
    (box, i) =>
      !boxes.some(
        (other, j) =>
          j !== i && contains(other, box) && (!contains(box, other) || j < i)
      )
  );

  const merged = { BoundingBoxes: kept };
  if (!allTypes) merged.FilterMessageTypes = Array.from(types).sort();
  return merged;
}

// Emits "message" (parsed AIS message, raw text) for each AIS message, with Class B
// messages turned into PositionReport and ShipStaticData (see class-b.js), and
// "link" ("connecting" | "up" | "down", detail) as the connection changes.
// Call setSubscription() whenever the merged subscription changes.
export function createUpstream({ apiKey, logger, url = UPSTREAM_URL, WebSocketImpl = WebSocket }) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0); // one listener per browser client

  let ws = null;
  let wanted = null; // subscription JSON without the key
  let sent = null; // what the current connection is subscribed to
  let lastSentAt = 0;
  let sendTimer = null;
  let retryTimer = null;
  let retryMs = MIN_RETRY_MS;
  let stopped = false;
  let retrying = false;
  let lastError = null;
  const classBDetails = new Map(); // MMSI -> Class B details heard so far

  function send() {
    clearTimeout(sendTimer);
    sendTimer = null;
    if (!ws || ws.readyState !== WebSocketImpl.OPEN || !wanted || wanted === sent) return;
    const wait = lastSentAt + MIN_SUBSCRIPTION_INTERVAL_MS - Date.now();
    if (wait > 0) {
      sendTimer = setTimeout(send, wait);
      return;
    }
    ws.send(JSON.stringify({ ...JSON.parse(wanted), Apikey: apiKey }));
    sent = wanted;
    lastSentAt = Date.now();
    logger.log(`[upstream] subscribed: ${wanted}`);
  }

  function connect() {
    retryTimer = null;
    if (stopped || !wanted) return;
    sent = null;
    lastError = null;
    // While retrying, stay "down" rather than flickering back to "connecting"
    if (!retrying) emitter.emit("link", "connecting");
    const socket = new WebSocketImpl(url);
    ws = socket;

    socket.on("open", () => {
      logger.log("[upstream] connected");
      retrying = false;
      emitter.emit("link", "up");
      send();
    });

    socket.on("message", (data) => {
      retryMs = MIN_RETRY_MS;
      const text = data.toString();
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        return;
      }
      if (message.error) {
        logger.error(`[upstream] error from AISStream: ${message.error}`);
        lastError = `AISStream error: ${message.error}`;
        emitter.emit("link", "down", lastError);
        return;
      }
      // Skip SubscriptionConfirmation and anything else without a position
      if (!message.MetaData) return;
      const converted = fromAISStreamClassB(message, classBDetails);
      if (!converted) return;
      emitter.emit("message", converted, converted === message ? text : JSON.stringify(converted));
    });

    socket.on("close", (code) => {
      if (ws === socket) ws = null;
      if (stopped) return;
      if (!wanted) {
        emitter.emit("link", "connecting");
        return;
      }
      retrying = true;
      emitter.emit("link", "down", lastError ?? `AISStream connection closed (code ${code})`);
      logger.warn(`[upstream] closed (code ${code}), reconnecting in ${retryMs / 1000}s`);
      retryTimer = setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    });

    socket.on("error", (err) => {
      logger.error(`[upstream] error: ${err.message}`);
      lastError ??= `AISStream unreachable (${err.message})`;
    });
  }

  emitter.setSubscription = (subscription) => {
    wanted = subscription ? JSON.stringify(subscription) : null;
    if (!wanted) {
      // Nobody needs data; drop the connection to free an AISStream slot
      if (ws) ws.close();
      return;
    }
    if (!ws && !retryTimer) {
      connect();
    } else {
      send();
    }
  };

  emitter.stop = () => {
    stopped = true;
    clearTimeout(sendTimer);
    clearTimeout(retryTimer);
    if (ws) ws.close();
  };

  return emitter;
}
