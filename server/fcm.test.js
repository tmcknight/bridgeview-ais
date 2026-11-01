import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { FCM_SCOPE, FcmError, OAUTH_TOKEN_URL, createAssertion, createFcmClient, parseFcmError } from "./fcm.js";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const SERVICE_ACCOUNT = {
  project_id: "bridgeview-test",
  client_email: "fcm@bridgeview-test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
};
const SEND_URL = "https://fcm.googleapis.com/v1/projects/bridgeview-test/messages:send";

function fakeGoogle({ send = () => ({ status: 200, body: JSON.stringify({ name: "projects/x/messages/1" }) }), expiresIn = 3599 } = {}) {
  let t = 1_700_000_000_000;
  let tokens = 0;
  const requests = [];
  const request = async (url, init) => {
    requests.push({ url, ...init });
    if (url === OAUTH_TOKEN_URL) {
      return { status: 200, body: JSON.stringify({ access_token: `token${++tokens}`, expires_in: expiresIn, token_type: "Bearer" }) };
    }
    return send(url, init);
  };
  const client = createFcmClient({ serviceAccount: SERVICE_ACCOUNT, now: () => t, request });
  return { client, requests, advance: (ms) => (t += ms) };
}

function errorBody(status, message, errorCode) {
  return JSON.stringify({
    error: {
      code: 0,
      message,
      status,
      details: errorCode ? [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }] : [],
    },
  });
}

describe("createAssertion", () => {
  it("signs an RS256 JWT Google can verify", () => {
    const jwt = createAssertion({ clientEmail: SERVICE_ACCOUNT.client_email, privateKey, now: () => 1_700_000_000_000 });
    const [header, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url"))).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(claims, "base64url"))).toEqual({
      iss: SERVICE_ACCOUNT.client_email,
      scope: FCM_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    expect(crypto.verify("sha256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, "base64url"))).toBe(true);
  });
});

describe("createFcmClient", () => {
  it("signs in, then posts the message to the project", async () => {
    const { client, requests } = fakeGoogle();
    const message = { token: "abc:def", data: { type: "alert" }, android: { priority: "HIGH" } };
    expect(await client.send(message)).toBe("projects/x/messages/1");

    expect(requests[0].url).toBe(OAUTH_TOKEN_URL);
    expect(requests[0].method).toBe("POST");
    const form = new URLSearchParams(requests[0].body);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(form.get("assertion").split(".")).toHaveLength(3);

    expect(requests[1].url).toBe(SEND_URL);
    expect(requests[1].headers.authorization).toBe("Bearer token1");
    expect(JSON.parse(requests[1].body)).toEqual({ message });
  });

  it("keeps its access token until 5 minutes before it expires", async () => {
    const { client, requests, advance } = fakeGoogle({ expiresIn: 3600 });
    await Promise.all([client.send({ token: "a" }), client.send({ token: "b" })]);
    advance(54 * 60_000);
    await client.send({ token: "c" });
    expect(requests.filter((r) => r.url === OAUTH_TOKEN_URL)).toHaveLength(1);

    advance(2 * 60_000);
    await client.send({ token: "d" });
    const sends = requests.filter((r) => r.url === SEND_URL);
    expect(sends.map((r) => r.headers.authorization)).toEqual(["Bearer token1", "Bearer token1", "Bearer token1", "Bearer token2"]);
  });

  it("signs in again after a 401", async () => {
    let status = 401;
    const { client, requests } = fakeGoogle({ send: () => ({ status, body: errorBody("UNAUTHENTICATED", "Bad credentials") }) });
    await expect(client.send({ token: "a" })).rejects.toBeInstanceOf(FcmError);
    status = 200;
    await client.send({ token: "a" });
    expect(requests.filter((r) => r.url === OAUTH_TOKEN_URL)).toHaveLength(2);
  });

  it("rejects when sign-in fails", async () => {
    const client = createFcmClient({
      serviceAccount: SERVICE_ACCOUNT,
      request: async () => ({ status: 400, body: JSON.stringify({ error: "invalid_grant", error_description: "Invalid JWT" }) }),
    });
    await expect(client.send({ token: "a" })).rejects.toThrow(/sign-in failed: 400 Invalid JWT/);
  });

  it("rejects with FCM's error, flagging dead tokens", async () => {
    const { client } = fakeGoogle({
      send: () => ({ status: 404, body: errorBody("NOT_FOUND", "Requested entity was not found.", "UNREGISTERED") }),
    });
    const err = await client.send({ token: "a" }).catch((e) => e);
    expect(err).toBeInstanceOf(FcmError);
    expect(err).toMatchObject({ status: 404, fcmStatus: "NOT_FOUND", errorCode: "UNREGISTERED" });
    expect(err.isBadToken).toBe(true);
  });

  it("needs a complete service account", () => {
    expect(() => createFcmClient({ serviceAccount: { project_id: "x" } })).toThrow(/client_email/);
  });
});

describe("parseFcmError", () => {
  it("tells bad tokens from other errors", () => {
    const invalidToken = parseFcmError(400, errorBody("INVALID_ARGUMENT", "The registration token is not a valid FCM registration token", "INVALID_ARGUMENT"));
    expect(invalidToken.isBadToken).toBe(true);
    expect(parseFcmError(404, errorBody("NOT_FOUND", "Requested entity was not found.")).isBadToken).toBe(true);
    const badPayload = parseFcmError(400, errorBody("INVALID_ARGUMENT", "Invalid value at 'message.data[0].value'", "INVALID_ARGUMENT"));
    expect(badPayload.isBadToken).toBe(false);
    const quota = parseFcmError(429, errorBody("RESOURCE_EXHAUSTED", "Quota exceeded", "QUOTA_EXCEEDED"));
    expect(quota).toMatchObject({ status: 429, errorCode: "QUOTA_EXCEEDED" });
    expect(quota.isBadToken).toBe(false);
    expect(parseFcmError(502, "<html>Bad gateway</html>")).toMatchObject({ status: 502, fcmStatus: undefined, isBadToken: false });
  });
});
