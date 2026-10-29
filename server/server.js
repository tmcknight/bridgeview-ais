import { WebSocketServer, WebSocket } from "ws";
import {
  createLocalReceiver,
  createDeduper,
  inBoundingBoxes,
  matchesMessageFilter,
} from "./local-receiver.js";
import { createFeedStatus } from "./feed-status.js";
import { createLatestPositions } from "./latest-positions.js";
import { createShipLog, SHIP_LOG_BOUNDING_BOX } from "./ship-log.js";
import { createUpstream, mergeSubscriptions } from "./upstream.js";
import { createVesselDetails } from "./vessel-details.js";
import { fetchVesselInfo } from "./wikidata.js";
import { withClassBTypes } from "./class-b.js";
import { createAircraftFeed, DEFAULT_ADSB_URL, DEFAULT_ADSB_WEB_URL } from "./aircraft.js";

// An http(s) URL safe to hand clients as a link; undefined for anything else
function webUrlOrUndefined(value) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.AISSTREAM_API_KEY;
const AUTH_TOKEN = process.env.WS_AUTH_TOKEN; // Optional: set for production
// Take the client's address from the reverse proxy's X-Real-IP header (Docker/nginx only)
const TRUST_PROXY = process.env.TRUST_PROXY === "true";

// Data source: "aisstream" (AISStream.io), "local" (AIS-catcher on a local SDR), or "both"
const AIS_SOURCE = (process.env.AIS_SOURCE || "both").toLowerCase();
const LOCAL_AIS_HOST = process.env.LOCAL_AIS_HOST || "127.0.0.1";
const LOCAL_AIS_PORT = Number(process.env.LOCAL_AIS_PORT) || 5012;
// The antenna's AIS-catcher web view, linked from the feed status (e.g. http://192.168.1.20:8100)
const LOCAL_AIS_WEB_URL = webUrlOrUndefined(process.env.LOCAL_AIS_WEB_URL);
const USE_AISSTREAM = AIS_SOURCE === "aisstream" || AIS_SOURCE === "both";
const USE_LOCAL = AIS_SOURCE === "local" || AIS_SOURCE === "both";
const SHIP_LOG_FILE = process.env.SHIP_LOG_FILE || "data/ship-log.json";
const DB_FILE = process.env.DB_FILE || "data/bridgeview.db";
// Look ships up on Wikidata (photo, build year, operator) and store the result
const VESSEL_INFO_LOOKUP = process.env.VESSEL_INFO_LOOKUP !== "false";
// Aircraft layer: poll an ADS-B feed (adsb.fi by default, or a local readsb's aircraft.json)
const AIRCRAFT_TRACKING = process.env.AIRCRAFT_TRACKING !== "false";
const ADSB_URL = process.env.ADSB_URL || DEFAULT_ADSB_URL;

// Logger utility - keep errors in production, suppress debug logs
const isDev = process.env.NODE_ENV !== "production";
const logger = {
  log: (...args) => isDev && console.log(...args),
  warn: (...args) => console.warn(...args), // Keep warnings in production
  error: (...args) => console.error(...args), // Keep errors in production
  info: (...args) => isDev && console.info(...args),
};

// Security configuration
const RATE_LIMITS = {
  // Everyone behind one office or home router shares an IP, so leave room for several tabs each
  MAX_CONNECTIONS_PER_IP: Number(process.env.MAX_CONNECTIONS_PER_IP) || 20,
  MAX_MESSAGES_PER_MINUTE: 60,
  SUBSCRIPTION_TIMEOUT_MS: 10000, // Must subscribe within 10s
  HEARTBEAT_INTERVAL_MS: 30000, // Drop clients that miss a ping, so dead links free their IP slot
};

// Validation bounds for AISStream.io subscription
const VALID_BOUNDS = {
  LAT_MIN: -90,
  LAT_MAX: 90,
  LON_MIN: -180,
  LON_MAX: 180,
  MAX_BOUNDING_BOX_AREA: 100, // Limit to ~100 square degrees
};

if (!USE_AISSTREAM && !USE_LOCAL) {
  logger.error(`[proxy] invalid AIS_SOURCE "${AIS_SOURCE}" (expected aisstream, local, or both)`);
  process.exit(1);
}

if (USE_AISSTREAM && !API_KEY) {
  logger.error("[proxy] AISSTREAM_API_KEY environment variable is required (or set AIS_SOURCE=local)");
  process.exit(1);
}

// Each ship's latest details from both feeds, and its Wikidata details, stored in SQLite at DB_FILE
const vesselDetails = createVesselDetails({
  file: DB_FILE,
  logger,
  fetchInfo: VESSEL_INFO_LOOKUP ? fetchVesselInfo : null,
});
// Each ship's latest position, replayed to a client when it subscribes
const latestPositions = createLatestPositions();
// client -> MMSIs it has been sent, so new Wikidata details reach clients showing that ship
const shipsSentToClient = new Map();

vesselDetails.on("info", (mmsi, info) => {
  const text = JSON.stringify({ type: "vesselInfo", mmsi, info });
  for (const [client, sent] of shipsSentToClient) {
    if (sent.has(mmsi) && client.readyState === WebSocket.OPEN) client.send(text);
  }
});

const localReceiver = USE_LOCAL
  ? createLocalReceiver({
      host: LOCAL_AIS_HOST,
      port: LOCAL_AIS_PORT,
      logger,
      nameFor: (mmsi) => vesselDetails.name(mmsi),
    })
  : null;

// Health of each configured feed, pushed to every subscribed client
const feedStatus = createFeedStatus({
  sources: [
    ...(USE_AISSTREAM ? ["aisstream"] : []),
    ...(USE_LOCAL ? ["local"] : []),
    ...(AIRCRAFT_TRACKING ? ["adsb"] : []),
  ],
  links: {
    aisstream: "https://aisstream.io",
    local: LOCAL_AIS_WEB_URL,
    adsb: ADSB_URL === DEFAULT_ADSB_URL ? DEFAULT_ADSB_WEB_URL : undefined,
  },
});
const subscribedClients = new Set();

function broadcast(text) {
  for (const client of subscribedClients) {
    if (client.readyState === WebSocket.OPEN) client.send(text);
  }
}

feedStatus.on("change", (feeds) => {
  logger.log(`[proxy] feed status: ${feeds.map((f) => `${f.source}=${f.status}`).join(", ")}`);
  broadcast(JSON.stringify({ type: "feedStatus", feeds }));
});

if (localReceiver) {
  localReceiver.on("link", (link, detail) => feedStatus.setLink("local", link, detail));
  localReceiver.on("activity", () => feedStatus.messageReceived("local"));
}

const aircraftFeed = AIRCRAFT_TRACKING ? createAircraftFeed({ url: ADSB_URL, logger }) : null;
if (aircraftFeed) {
  aircraftFeed.on("link", (link, detail) => feedStatus.setLink("adsb", link, detail));
  aircraftFeed.on("activity", () => feedStatus.messageReceived("adsb"));
  aircraftFeed.on("aircraft", (aircraft) => broadcast(JSON.stringify({ type: "aircraft", aircraft })));
  aircraftFeed.start();
}

// Shared ship log: fed by the server's own connection to the AIS sources, so
// passages are logged whether or not any browser is connected
const shipLog = createShipLog({ file: SHIP_LOG_FILE, logger });
const isFirstSeenByShipLog = USE_LOCAL && USE_AISSTREAM ? createDeduper() : () => true;

function feedShipLog(message) {
  if (inBoundingBoxes(message, [SHIP_LOG_BOUNDING_BOX]) && isFirstSeenByShipLog(message)) {
    shipLog.handleMessage(message);
  }
}

shipLog.on("entry", (entry) => {
  broadcast(JSON.stringify({ type: "shipLogEntry", entry }));
});

if (localReceiver) {
  localReceiver.on("message", (message) => vesselDetails.handleMessage(message));
  localReceiver.on("message", (message) => latestPositions.handleMessage(message));
  localReceiver.on("message", feedShipLog);
}

// One AISStream connection shared by every client and the ship log
const SHIP_LOG_SUBSCRIPTION = {
  BoundingBoxes: [SHIP_LOG_BOUNDING_BOX],
  FilterMessageTypes: ["PositionReport", "ShipStaticData"],
};
const clientSubscriptions = new Map(); // client -> sanitized subscription
const upstream = USE_AISSTREAM ? createUpstream({ apiKey: API_KEY, logger }) : null;

function updateUpstreamSubscription() {
  // Clients ask for PositionReport and ShipStaticData; Class B ships send their own
  // messages, which the upstream turns into those
  upstream?.setSubscription(
    withClassBTypes(mergeSubscriptions([SHIP_LOG_SUBSCRIPTION, ...clientSubscriptions.values()]))
  );
}

if (upstream) {
  upstream.on("link", (link, detail) => feedStatus.setLink("aisstream", link, detail));
  upstream.on("message", () => feedStatus.messageReceived("aisstream"));
  upstream.on("message", (message) => vesselDetails.handleMessage(message));
  upstream.on("message", (message) => latestPositions.handleMessage(message));
  upstream.on("message", feedShipLog);
  updateUpstreamSubscription();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shipLog.flush();
    vesselDetails.close();
    upstream?.stop();
    aircraftFeed?.stop();
    process.exit(0);
  });
}

// Rate limiting tracking
const connectionsByIP = new Map(); // IP -> count
const messageRateLimits = new Map(); // clientId -> { count, resetTime }

// Helper: Extract client IP
// Behind nginx every client arrives from nginx's address, so with TRUST_PROXY set use the
// X-Real-IP it passes on. Only set it when nothing but the proxy can reach this port.
function getClientIP(req) {
  if (TRUST_PROXY) {
    const realIP = req.headers["x-real-ip"];
    if (typeof realIP === "string" && realIP) return realIP;
  }
  return req.socket.remoteAddress || "unknown";
}

// Helper: Check IP rate limit
function checkIPRateLimit(ip) {
  const count = connectionsByIP.get(ip) || 0;
  if (count >= RATE_LIMITS.MAX_CONNECTIONS_PER_IP) {
    return false;
  }
  connectionsByIP.set(ip, count + 1);
  return true;
}

// Helper: Release IP connection slot
function releaseIPConnection(ip) {
  const count = connectionsByIP.get(ip) || 0;
  if (count > 0) {
    connectionsByIP.set(ip, count - 1);
  }
}

// Helper: Check message rate limit
function checkMessageRateLimit(clientId) {
  const now = Date.now();
  const limit = messageRateLimits.get(clientId);

  if (!limit || now > limit.resetTime) {
    // Reset window
    messageRateLimits.set(clientId, {
      count: 1,
      resetTime: now + 60000, // 1 minute window
    });
    return true;
  }

  if (limit.count >= RATE_LIMITS.MAX_MESSAGES_PER_MINUTE) {
    return false;
  }

  limit.count++;
  return true;
}

// Helper: Validate subscription object
function validateSubscription(subscription) {
  // Must be an object
  if (!subscription || typeof subscription !== "object") {
    return { valid: false, error: "Subscription must be an object" };
  }

  // Must have BoundingBoxes array
  if (!Array.isArray(subscription.BoundingBoxes)) {
    return { valid: false, error: "BoundingBoxes array is required" };
  }

  // Validate each bounding box
  for (const box of subscription.BoundingBoxes) {
    if (!Array.isArray(box) || box.length !== 2) {
      return { valid: false, error: "Each bounding box must be an array of 2 coordinate pairs" };
    }

    const [[lat1, lon1], [lat2, lon2]] = box;

    // Validate coordinate bounds
    if (
      lat1 < VALID_BOUNDS.LAT_MIN || lat1 > VALID_BOUNDS.LAT_MAX ||
      lat2 < VALID_BOUNDS.LAT_MIN || lat2 > VALID_BOUNDS.LAT_MAX ||
      lon1 < VALID_BOUNDS.LON_MIN || lon1 > VALID_BOUNDS.LON_MAX ||
      lon2 < VALID_BOUNDS.LON_MIN || lon2 > VALID_BOUNDS.LON_MAX
    ) {
      return { valid: false, error: "Coordinates out of valid range" };
    }

    // Calculate bounding box area to prevent abuse
    const latDiff = Math.abs(lat2 - lat1);
    const lonDiff = Math.abs(lon2 - lon1);
    const area = latDiff * lonDiff;

    if (area > VALID_BOUNDS.MAX_BOUNDING_BOX_AREA) {
      return { valid: false, error: `Bounding box area too large (max ${VALID_BOUNDS.MAX_BOUNDING_BOX_AREA} sq degrees)` };
    }
  }

  // Limit number of bounding boxes
  if (subscription.BoundingBoxes.length > 5) {
    return { valid: false, error: "Maximum 5 bounding boxes allowed" };
  }

  // Validate FilterMessageTypes if present
  if (subscription.FilterMessageTypes && !Array.isArray(subscription.FilterMessageTypes)) {
    return { valid: false, error: "FilterMessageTypes must be an array" };
  }

  // Allow both numeric types and string names
  const allowedMessageTypes = [1, 2, 3, 18, 19, 27];
  const allowedMessageNames = [
    "PositionReport",
    "ShipStaticData",
    "StandardClassBPositionReport",
    "ExtendedClassBPositionReport",
    "StaticDataReport",
  ];

  if (subscription.FilterMessageTypes) {
    for (const type of subscription.FilterMessageTypes) {
      const isValidNumber = allowedMessageTypes.includes(type);
      const isValidString = typeof type === "string" && allowedMessageNames.includes(type);

      if (!isValidNumber && !isValidString) {
        return {
          valid: false,
          error: `Invalid message type: ${type}. Allowed numbers: ${allowedMessageTypes.join(", ")} or names: ${allowedMessageNames.join(", ")}`
        };
      }
    }
  }

  // Strip any suspicious fields (prevent injection)
  const sanitized = {
    BoundingBoxes: subscription.BoundingBoxes,
  };

  if (subscription.FilterMessageTypes) {
    sanitized.FilterMessageTypes = subscription.FilterMessageTypes;
  }

  return { valid: true, subscription: sanitized };
}

const wss = new WebSocketServer({ port: PORT });

// client -> heartbeat check. A link that dies without a close (a sleeping laptop, a dropped
// tunnel) would otherwise hold its IP's connection slot until TCP gives up, hours later.
const heartbeats = new Map();
setInterval(() => {
  for (const beat of heartbeats.values()) beat();
}, RATE_LIMITS.HEARTBEAT_INTERVAL_MS);

wss.on("connection", (client, req) => {
  const clientIP = getClientIP(req);
  const clientId = Math.random().toString(36).substring(7);

  logger.log(`[proxy] client ${clientId} connected from ${clientIP}`);

  // Check IP rate limit
  if (!checkIPRateLimit(clientIP)) {
    logger.warn(`[proxy] rate limit exceeded for IP ${clientIP}`);
    client.close(1008, "Too many connections from your IP");
    return;
  }

  // Answered pings keep the connection; see the heartbeat below
  let alive = true;
  client.on("pong", () => {
    alive = true;
  });
  heartbeats.set(client, () => {
    if (!alive) {
      logger.warn(`[proxy] client ${clientId} missed a heartbeat, dropping it`);
      client.terminate();
      return;
    }
    alive = false;
    client.ping();
  });

  let subscribed = false;
  let localListener = null;
  let upstreamListener = null;
  let authenticated = !AUTH_TOKEN; // Auto-auth if no token configured
  let subscriptionTimeout = null;

  // Set subscription timeout
  subscriptionTimeout = setTimeout(() => {
    if (!subscribed) {
      logger.warn(`[proxy] client ${clientId} did not subscribe in time`);
      client.close(1008, "Subscription timeout");
    }
  }, RATE_LIMITS.SUBSCRIPTION_TIMEOUT_MS);

  client.on("message", (data) => {
    // Check message rate limit
    if (!checkMessageRateLimit(clientId)) {
      logger.warn(`[proxy] message rate limit exceeded for client ${clientId}`);
      client.close(1008, "Rate limit exceeded");
      return;
    }

    // First message: handle authentication and subscription
    if (!subscribed) {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        logger.error(`[proxy] client ${clientId} sent invalid JSON`);
        client.close(1007, "Invalid JSON");
        clearTimeout(subscriptionTimeout);
        return;
      }

      // Check authentication if required
      if (AUTH_TOKEN && !authenticated) {
        if (message.authToken !== AUTH_TOKEN) {
          logger.warn(`[proxy] client ${clientId} failed authentication`);
          client.close(1008, "Authentication failed");
          clearTimeout(subscriptionTimeout);
          return;
        }
        authenticated = true;
        client.send(JSON.stringify({ type: "authenticated" }));
        return;
      }

      // Validate subscription
      const validation = validateSubscription(message);
      if (!validation.valid) {
        logger.error(`[proxy] client ${clientId} invalid subscription: ${validation.error}`);
        client.close(1007, validation.error);
        clearTimeout(subscriptionTimeout);
        return;
      }

      // Clear subscription timeout
      clearTimeout(subscriptionTimeout);
      subscribed = true;

      clientSubscriptions.set(client, validation.subscription);
      updateUpstreamSubscription();

      subscribedClients.add(client);
      client.send(JSON.stringify({ type: "shipLog", entries: shipLog.entries() }));
      client.send(JSON.stringify({ type: "feedStatus", feeds: feedStatus.snapshot() }));
      if (aircraftFeed) client.send(JSON.stringify({ type: "aircraft", aircraft: aircraftFeed.aircraft() }));

      // With both sources, the same transmission can arrive twice; deliver it once
      const isFirstSeen = USE_LOCAL && USE_AISSTREAM ? createDeduper() : () => true;
      // Read the subscription on each message, so updates from the client apply
      const wants = (message) => {
        const subscription = clientSubscriptions.get(client);
        return (
          client.readyState === WebSocket.OPEN &&
          subscription !== undefined &&
          inBoundingBoxes(message, subscription.BoundingBoxes) &&
          matchesMessageFilter(message, subscription.FilterMessageTypes) &&
          isFirstSeen(message)
        );
      };

      // Send each ship's stored details just before its first position, so the
      // client needn't wait for the ship's next broadcast
      const detailsSent = new Set();
      shipsSentToClient.set(client, detailsSent);
      const sendStoredDetails = (message) => {
        const mmsi = message.MetaData.MMSI;
        if (message.MessageType !== "PositionReport" || detailsSent.has(mmsi)) return;
        detailsSent.add(mmsi);
        const details = vesselDetails.detailsMessage(mmsi);
        const subscription = clientSubscriptions.get(client);
        if (details && matchesMessageFilter(details, subscription?.FilterMessageTypes)) {
          client.send(JSON.stringify(details));
        }
        const info = vesselDetails.vesselInfo(mmsi);
        if (info !== undefined) client.send(JSON.stringify({ type: "vesselInfo", mmsi, info }));
      };

      // Every ship already being tracked, so the map fills in at once
      for (const message of latestPositions.messages()) {
        if (!wants(message)) continue;
        sendStoredDetails(message);
        client.send(JSON.stringify(message));
      }

      if (localReceiver) {
        localListener = (message) => {
          if (!wants(message)) return;
          sendStoredDetails(message);
          client.send(JSON.stringify(message));
        };
        localReceiver.on("message", localListener);
        logger.log(`[proxy] client ${clientId} subscribed to local receiver`);
      }

      if (upstream) {
        upstreamListener = (message, text) => {
          if (!wants(message)) return;
          sendStoredDetails(message);
          client.send(text);
        };
        upstream.on("message", upstreamListener);
        logger.log(`[proxy] client ${clientId} subscribed to shared upstream`);
      }

      return;
    }

    // Subsequent messages: a new subscription replaces the client's current one
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    const validation = validateSubscription(message);
    if (!validation.valid) {
      logger.warn(`[proxy] client ${clientId} invalid subscription update: ${validation.error}`);
      return;
    }
    clientSubscriptions.set(client, validation.subscription);
    updateUpstreamSubscription();
  });

  client.on("close", () => {
    logger.log(`[proxy] client ${clientId} disconnected`);
    clearTimeout(subscriptionTimeout);
    releaseIPConnection(clientIP);
    heartbeats.delete(client);
    messageRateLimits.delete(clientId);
    subscribedClients.delete(client);
    shipsSentToClient.delete(client);
    if (localListener) {
      localReceiver.off("message", localListener);
      localListener = null;
    }
    if (upstreamListener) {
      upstream.off("message", upstreamListener);
      upstreamListener = null;
    }
    if (clientSubscriptions.delete(client)) {
      updateUpstreamSubscription();
    }
  });

  // ws always emits "close" after "error", and the close handler cleans up
  client.on("error", (err) => {
    logger.error(`[proxy] client ${clientId} error: ${err.message}`);
  });
});

logger.info(`[proxy] WebSocket proxy listening on ws://localhost:${PORT}`);
logger.info(`[proxy] AIS source: ${AIS_SOURCE}${USE_LOCAL ? ` (AIS-catcher at ${LOCAL_AIS_HOST}:${LOCAL_AIS_PORT})` : ""}`);
logger.info(`[proxy] Aircraft: ${AIRCRAFT_TRACKING ? ADSB_URL : "off"}`);
if (AUTH_TOKEN) {
  logger.info(`[proxy] Authentication enabled`);
} else {
  logger.warn(`[proxy] Warning: No authentication configured (set WS_AUTH_TOKEN for production)`);
}
