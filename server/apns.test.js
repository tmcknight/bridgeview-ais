import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { ApnsError, createApnsClient, createProviderToken } from "./apns.js";

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" });

function fakeApns(response = { status: 200, headers: {}, body: "" }) {
  const requests = [];
  const request = async (origin, headers, body) => {
    requests.push({ origin, headers, body: body === undefined ? undefined : JSON.parse(body) });
    return typeof response === "function" ? response(origin, headers) : response;
  };
  const client = createApnsClient({ keyId: "KEY123", teamId: "TEAM456", key: KEY_PEM, bundleId: "com.example.app", request });
  return { client, requests };
}

describe("createProviderToken", () => {
  it("signs an ES256 JWT APNs can verify", () => {
    const token = createProviderToken({ keyId: "KEY123", teamId: "TEAM456", key: privateKey, now: () => 1_700_000_000_000 });
    const [header, claims, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url"))).toEqual({ alg: "ES256", kid: "KEY123" });
    expect(JSON.parse(Buffer.from(claims, "base64url"))).toEqual({ iss: "TEAM456", iat: 1_700_000_000 });
    const valid = crypto.verify(
      "sha256",
      Buffer.from(`${header}.${claims}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url")
    );
    expect(valid).toBe(true);
  });
});

describe("createApnsClient", () => {
  it("sends alerts to the device's environment", async () => {
    const { client, requests } = fakeApns();
    await client.sendAlert({ deviceToken: "ab12", environment: "sandbox", payload: { aps: {} }, collapseId: "ship-1", expiresAt: 5000 });
    expect(requests[0].origin).toBe("https://api.sandbox.push.apple.com");
    expect(requests[0].headers).toMatchObject({
      ":method": "POST",
      ":path": "/3/device/ab12",
      "apns-topic": "com.example.app",
      "apns-push-type": "alert",
      "apns-collapse-id": "ship-1",
      "apns-expiration": "5",
    });
    expect(requests[0].headers.authorization).toMatch(/^bearer .+\..+\..+$/);
  });

  it("sends Live Activity pushes on the liveactivity topic", async () => {
    const { client, requests } = fakeApns();
    await client.sendLiveActivity({ token: "cd34", environment: "production", payload: { aps: {} } });
    expect(requests[0].origin).toBe("https://api.push.apple.com");
    expect(requests[0].headers).toMatchObject({
      "apns-topic": "com.example.app.push-type.liveactivity",
      "apns-push-type": "liveactivity",
    });
  });

  it("creates, broadcasts to and deletes channels", async () => {
    const { client, requests } = fakeApns((origin, headers) =>
      headers[":method"] === "POST" && headers[":path"].endsWith("/channels")
        ? { status: 201, headers: { "apns-channel-id": "Y2hhbm5lbA==" }, body: "" }
        : { status: headers[":method"] === "DELETE" ? 204 : 200, headers: {}, body: "" }
    );
    const channelId = await client.createChannel({ environment: "production" });
    expect(channelId).toBe("Y2hhbm5lbA==");
    expect(requests[0].origin).toBe("https://api-manage-broadcast.push.apple.com:2196");
    expect(requests[0].headers[":path"]).toBe("/1/apps/com.example.app/channels");
    expect(requests[0].body).toEqual({ "message-storage-policy": 1, "push-type": "LiveActivity" });

    await client.broadcast({ channelId, environment: "production", payload: { aps: {} }, priority: 5, expiresAt: 60_000 });
    expect(requests[1].headers).toMatchObject({
      ":path": "/4/broadcasts/apps/com.example.app",
      "apns-channel-id": channelId,
      "apns-priority": "5",
      "apns-expiration": "60",
    });
    expect(requests[1].headers["apns-topic"]).toBeUndefined();

    await client.deleteChannel({ channelId, environment: "production" });
    expect(requests[2].headers).toMatchObject({ ":method": "DELETE", "apns-channel-id": channelId });
  });

  it("reuses its provider token", async () => {
    const { client, requests } = fakeApns();
    await client.sendAlert({ deviceToken: "a1", environment: "production", payload: {} });
    await client.sendAlert({ deviceToken: "a2", environment: "production", payload: {} });
    expect(requests[0].headers.authorization).toBe(requests[1].headers.authorization);
  });

  it("rejects with the APNs reason, flagging dead tokens", async () => {
    const { client } = fakeApns({ status: 410, headers: {}, body: JSON.stringify({ reason: "Unregistered" }) });
    const err = await client.sendAlert({ deviceToken: "a1", environment: "production", payload: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApnsError);
    expect(err.reason).toBe("Unregistered");
    expect(err.isBadToken).toBe(true);
    expect(new ApnsError(429, "TooManyRequests").isBadToken).toBe(false);
  });
});
