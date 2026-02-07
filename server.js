import { WebSocketServer, WebSocket } from "ws";

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.AISSTREAM_API_KEY;
const UPSTREAM = "wss://stream.aisstream.io/v0/stream";
const AUTH_TOKEN = process.env.WS_AUTH_TOKEN; // Optional: set for production

// Security configuration
const RATE_LIMITS = {
  MAX_CONNECTIONS_PER_IP: 5,
  MAX_MESSAGES_PER_MINUTE: 60,
  SUBSCRIPTION_TIMEOUT_MS: 10000, // Must subscribe within 10s
};

// Validation bounds for AISStream.io subscription
const VALID_BOUNDS = {
  LAT_MIN: -90,
  LAT_MAX: 90,
  LON_MIN: -180,
  LON_MAX: 180,
  MAX_BOUNDING_BOX_AREA: 100, // Limit to ~100 square degrees
};

if (!API_KEY) {
  console.error("[proxy] AISSTREAM_API_KEY environment variable is required");
  process.exit(1);
}

// Rate limiting tracking
const connectionsByIP = new Map(); // IP -> count
const messageRateLimits = new Map(); // clientId -> { count, resetTime }

// Helper: Extract client IP
function getClientIP(req) {
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

wss.on("connection", (client, req) => {
  const clientIP = getClientIP(req);
  const clientId = Math.random().toString(36).substring(7);

  console.log(`[proxy] client ${clientId} connected from ${clientIP}`);

  // Check IP rate limit
  if (!checkIPRateLimit(clientIP)) {
    console.warn(`[proxy] rate limit exceeded for IP ${clientIP}`);
    client.close(1008, "Too many connections from your IP");
    return;
  }

  let upstream = null;
  let authenticated = !AUTH_TOKEN; // Auto-auth if no token configured
  let subscriptionTimeout = null;

  // Set subscription timeout
  subscriptionTimeout = setTimeout(() => {
    if (!upstream) {
      console.warn(`[proxy] client ${clientId} did not subscribe in time`);
      client.close(1008, "Subscription timeout");
      releaseIPConnection(clientIP);
    }
  }, RATE_LIMITS.SUBSCRIPTION_TIMEOUT_MS);

  client.on("message", (data) => {
    // Check message rate limit
    if (!checkMessageRateLimit(clientId)) {
      console.warn(`[proxy] message rate limit exceeded for client ${clientId}`);
      client.close(1008, "Rate limit exceeded");
      return;
    }

    // First message: handle authentication and subscription
    if (!upstream) {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        console.error(`[proxy] client ${clientId} sent invalid JSON`);
        client.close(1007, "Invalid JSON");
        clearTimeout(subscriptionTimeout);
        releaseIPConnection(clientIP);
        return;
      }

      // Check authentication if required
      if (AUTH_TOKEN && !authenticated) {
        if (message.authToken !== AUTH_TOKEN) {
          console.warn(`[proxy] client ${clientId} failed authentication`);
          client.close(1008, "Authentication failed");
          clearTimeout(subscriptionTimeout);
          releaseIPConnection(clientIP);
          return;
        }
        authenticated = true;
        client.send(JSON.stringify({ type: "authenticated" }));
        return;
      }

      // Validate subscription
      const validation = validateSubscription(message);
      if (!validation.valid) {
        console.error(`[proxy] client ${clientId} invalid subscription: ${validation.error}`);
        client.close(1007, validation.error);
        clearTimeout(subscriptionTimeout);
        releaseIPConnection(clientIP);
        return;
      }

      // Clear subscription timeout
      clearTimeout(subscriptionTimeout);

      // Inject API key into sanitized subscription
      const subscription = validation.subscription;
      subscription.Apikey = API_KEY;
      const subscriptionStr = JSON.stringify(subscription);

      console.log(`[proxy] client ${clientId} subscription validated, connecting to upstream`);

      upstream = new WebSocket(UPSTREAM);

      upstream.on("open", () => {
        console.log(`[proxy] client ${clientId} upstream connected`);
        upstream.send(subscriptionStr);
      });

      upstream.on("message", (data) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data.toString());
        }
      });

      upstream.on("close", (code, reason) => {
        console.log(`[proxy] client ${clientId} upstream closed — code: ${code}, reason: ${reason.toString()}`);
        if (client.readyState === WebSocket.OPEN) {
          client.close();
        }
      });

      upstream.on("error", (err) => {
        console.error(`[proxy] client ${clientId} upstream error: ${err.message}`);
        if (client.readyState === WebSocket.OPEN) {
          client.close();
        }
      });

      return;
    }

    // Subsequent messages: forward to upstream (with validation)
    if (upstream.readyState === WebSocket.OPEN) {
      // Optional: validate subsequent messages if needed
      upstream.send(data);
    }
  });

  client.on("close", () => {
    console.log(`[proxy] client ${clientId} disconnected`);
    clearTimeout(subscriptionTimeout);
    releaseIPConnection(clientIP);
    messageRateLimits.delete(clientId);
    if (upstream && upstream.readyState === WebSocket.OPEN) {
      upstream.close();
    }
  });

  client.on("error", (err) => {
    console.error(`[proxy] client ${clientId} error: ${err.message}`);
    clearTimeout(subscriptionTimeout);
    releaseIPConnection(clientIP);
    messageRateLimits.delete(clientId);
    if (upstream && upstream.readyState === WebSocket.OPEN) {
      upstream.close();
    }
  });
});

console.log(`[proxy] WebSocket proxy listening on ws://localhost:${PORT}`);
if (AUTH_TOKEN) {
  console.log(`[proxy] Authentication enabled`);
} else {
  console.log(`[proxy] Warning: No authentication configured (set WS_AUTH_TOKEN for production)`);
}
