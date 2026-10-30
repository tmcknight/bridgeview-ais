import http2 from "node:http2";
import crypto from "node:crypto";

// Apple Push Notification service client: alerts to device tokens, Live Activity
// push-to-start, and Live Activity broadcast channels (create, broadcast, delete).
// Token (.p8 key) auth over HTTP/2, one connection per host, no dependencies.

export const APNS_HOSTS = {
  production: {
    push: "https://api.push.apple.com",
    channels: "https://api-manage-broadcast.push.apple.com:2196",
  },
  sandbox: {
    push: "https://api.sandbox.push.apple.com",
    channels: "https://api-manage-broadcast.sandbox.push.apple.com:2195",
  },
};

// APNs rejects tokens older than an hour and throttles refreshing more than every 20 min
const TOKEN_LIFETIME_MS = 50 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

// Provider token (JWT, ES256) for APNs
export function createProviderToken({ keyId, teamId, key, now = Date.now }) {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: teamId, iat: Math.floor(now() / 1000) }));
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${claims}.${base64url(signature)}`;
}

// Error from APNs, with its HTTP status and reason (e.g. 410 "Unregistered")
export class ApnsError extends Error {
  constructor(status, reason) {
    super(`APNs ${status}${reason ? ` ${reason}` : ""}`);
    this.status = status;
    this.reason = reason;
  }

  // The device or push-to-start token will never work again
  get isBadToken() {
    return this.status === 410 || this.reason === "BadDeviceToken" || this.reason === "Unregistered";
  }
}

// Sends one HTTP/2 request: { status, headers, body }
function defaultRequest(sessions, origin, headers, body) {
  return new Promise((resolve, reject) => {
    let session = sessions.get(origin);
    if (!session || session.closed || session.destroyed) {
      session = http2.connect(origin);
      session.on("error", () => sessions.delete(origin));
      session.on("goaway", () => sessions.delete(origin));
      session.on("close", () => sessions.delete(origin));
      session.unref();
      sessions.set(origin, session);
    }
    const req = session.request(headers);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.close(http2.constants.NGHTTP2_CANCEL));
    let responseHeaders = {};
    const chunks = [];
    req.on("response", (h) => {
      responseHeaders = h;
    });
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () =>
      resolve({
        status: responseHeaders[":status"],
        headers: responseHeaders,
        body: Buffer.concat(chunks).toString("utf8"),
      })
    );
    req.on("error", reject);
    req.on("close", () => {
      if (!responseHeaders[":status"]) reject(new Error("APNs request was cancelled or timed out"));
    });
    req.end(body);
  });
}

function reasonOf(body) {
  try {
    return JSON.parse(body).reason;
  } catch {
    return undefined;
  }
}

// keyId, teamId, key (.p8 PEM contents) and bundleId from Apple's developer site.
// `request` is replaceable for tests.
export function createApnsClient({ keyId, teamId, key, bundleId, now = Date.now, request }) {
  const privateKey = crypto.createPrivateKey(key);
  const sessions = new Map();
  const send = request ?? ((origin, headers, body) => defaultRequest(sessions, origin, headers, body));
  let token = null;
  let tokenIssuedAt = 0;

  function providerToken() {
    if (!token || now() - tokenIssuedAt > TOKEN_LIFETIME_MS) {
      token = createProviderToken({ keyId, teamId, key: privateKey, now });
      tokenIssuedAt = now();
    }
    return token;
  }

  async function call(origin, headers, payload) {
    const response = await send(
      origin,
      { authorization: `bearer ${providerToken()}`, ...headers },
      payload === undefined ? undefined : JSON.stringify(payload)
    );
    if (response.status >= 300) throw new ApnsError(response.status, reasonOf(response.body));
    return response;
  }

  return {
    // A normal notification to a device token
    sendAlert({ deviceToken, environment, payload, collapseId, expiresAt = 0 }) {
      return call(
        APNS_HOSTS[environment].push,
        {
          ":method": "POST",
          ":path": `/3/device/${deviceToken}`,
          "apns-topic": bundleId,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-expiration": String(Math.floor(expiresAt / 1000)),
          ...(collapseId && { "apns-collapse-id": collapseId }),
        },
        payload
      );
    },

    // A Live Activity push (start, update or end) to one push or push-to-start token
    sendLiveActivity({ token: activityToken, environment, payload, priority = 10, expiresAt = 0 }) {
      return call(
        APNS_HOSTS[environment].push,
        {
          ":method": "POST",
          ":path": `/3/device/${activityToken}`,
          "apns-topic": `${bundleId}.push-type.liveactivity`,
          "apns-push-type": "liveactivity",
          "apns-priority": String(priority),
          "apns-expiration": String(Math.floor(expiresAt / 1000)),
        },
        payload
      );
    },

    // Opens a broadcast channel for one Live Activity event; resolves to its ID
    async createChannel({ environment }) {
      const response = await call(
        APNS_HOSTS[environment].channels,
        { ":method": "POST", ":path": `/1/apps/${bundleId}/channels` },
        { "message-storage-policy": 1, "push-type": "LiveActivity" }
      );
      const channelId = response.headers["apns-channel-id"];
      if (!channelId) throw new Error("APNs created a channel without returning its ID");
      return channelId;
    },

    // An update or end to every Live Activity on a channel. The channel stores the
    // latest message for offline devices, so give it an expiry.
    broadcast({ channelId, environment, payload, priority = 10, expiresAt }) {
      return call(
        APNS_HOSTS[environment].push,
        {
          ":method": "POST",
          ":path": `/4/broadcasts/apps/${bundleId}`,
          "apns-channel-id": channelId,
          "apns-push-type": "liveactivity",
          "apns-priority": String(priority),
          "apns-expiration": String(Math.floor(expiresAt / 1000)),
        },
        payload
      );
    },

    deleteChannel({ channelId, environment }) {
      return call(APNS_HOSTS[environment].channels, {
        ":method": "DELETE",
        ":path": `/1/apps/${bundleId}/channels`,
        "apns-channel-id": channelId,
      });
    },

    close() {
      for (const session of sessions.values()) session.close();
      sessions.clear();
    },
  };
}
