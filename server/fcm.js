import crypto from "node:crypto";

// Firebase Cloud Messaging (HTTP v1) client for the Android app's bridge alerts.
// Signs in with a Google service account (a JWT exchanged for an OAuth2 access
// token) and sends one message per call. Global fetch, no dependencies.

export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
export const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWT_LIFETIME_S = 3600;
// Get a new access token this long before the old one expires
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const FCM_ERROR_TYPE = "type.googleapis.com/google.firebase.fcm.v1.FcmError";

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

// Signed JWT (RS256) to trade for an access token
export function createAssertion({ clientEmail, privateKey, now = Date.now }) {
  const iat = Math.floor(now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({ iss: clientEmail, scope: FCM_SCOPE, aud: OAUTH_TOKEN_URL, iat, exp: iat + JWT_LIFETIME_S })
  );
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${claims}`), privateKey);
  return `${header}.${claims}.${base64url(signature)}`;
}

// Error from FCM, with its HTTP status, its status (e.g. "NOT_FOUND") and the FCM
// error code (e.g. "UNREGISTERED")
export class FcmError extends Error {
  constructor(status, fcmStatus, errorCode, message) {
    super(`FCM ${status}${errorCode || fcmStatus ? ` ${errorCode || fcmStatus}` : ""}${message ? `: ${message}` : ""}`);
    this.status = status;
    this.fcmStatus = fcmStatus;
    this.errorCode = errorCode;
    this.detail = message;
  }

  // The registration token will never work again
  get isBadToken() {
    if (this.errorCode === "UNREGISTERED") return true;
    if (this.status === 404 && this.fcmStatus === "NOT_FOUND") return true;
    return this.status === 400 && this.fcmStatus === "INVALID_ARGUMENT" && /token/i.test(this.detail ?? "");
  }
}

export function parseFcmError(status, body) {
  let error;
  try {
    error = JSON.parse(body).error;
  } catch {
    // Not JSON
  }
  const errorCode = Array.isArray(error?.details)
    ? error.details.find((d) => d?.["@type"] === FCM_ERROR_TYPE)?.errorCode
    : undefined;
  return new FcmError(status, error?.status, errorCode, error?.message);
}

// Sends one HTTP request: { status, body }
async function defaultRequest(url, { method, headers, body }) {
  const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { status: response.status, body: await response.text() };
}

// serviceAccount: the service account's JSON key, parsed (project_id, client_email,
// private_key). `request` is replaceable for tests.
export function createFcmClient({ serviceAccount, now = Date.now, request = defaultRequest }) {
  const { project_id: projectId, client_email: clientEmail, private_key: key } = serviceAccount ?? {};
  if (!projectId || !clientEmail || !key) {
    throw new Error("FCM service account needs project_id, client_email and private_key");
  }
  const privateKey = crypto.createPrivateKey(key);
  const sendUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  let accessToken = null;
  let expiresAt = 0;
  let pending = null;

  async function fetchAccessToken() {
    const response = await request(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: createAssertion({ clientEmail, privateKey, now }),
      }).toString(),
    });
    let parsed;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      parsed = {};
    }
    if (response.status >= 300 || !parsed.access_token) {
      const reason = parsed.error_description || parsed.error || "";
      throw new Error(`FCM sign-in failed: ${response.status}${reason ? ` ${reason}` : ""}`);
    }
    accessToken = parsed.access_token;
    expiresAt = now() + (Number(parsed.expires_in) || JWT_LIFETIME_S) * 1000;
    return accessToken;
  }

  function token() {
    if (accessToken && now() < expiresAt - TOKEN_REFRESH_MARGIN_MS) return Promise.resolve(accessToken);
    // One sign-in at a time, however many messages are waiting for it
    pending ??= fetchAccessToken().finally(() => {
      pending = null;
    });
    return pending;
  }

  return {
    // Sends one message ({ token, data, android, … }); resolves to FCM's message name
    async send(message) {
      const response = await request(sendUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (response.status >= 300) {
        // Signed out early (key revoked or rotated): sign in again next time
        if (response.status === 401) accessToken = null;
        throw parseFcmError(response.status, response.body);
      }
      try {
        return JSON.parse(response.body).name;
      } catch {
        return undefined;
      }
    },
  };
}
