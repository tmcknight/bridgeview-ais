import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ACTIVITY_TIMEOUT_MS,
  ALERT_COOLDOWN_MS,
  alertPayload,
  createApproachAlerts,
  fcmAlertMessage,
  fcmActivityStartMessage,
  pushToStartPayload,
  swiftDate,
} from "./approach-alerts.js";
import { ApnsError } from "./apns.js";
import { FcmError } from "./fcm.js";
import { createPushDevices, parseDeviceRegistration } from "./push-devices.js";

const START = Date.parse("2026-10-30T14:00:00Z");
const MMSI = 316001234;

function shipAt(etaMinutes, overrides = {}) {
  const now = Date.now();
  return {
    mmsi: MMSI,
    name: "ALGOMA EQUINOX",
    shipTypeName: "Cargo",
    category: "cargo",
    length: 225,
    destination: "THUNDER BAY",
    cargo: "Likely going to load grain",
    position: { sog: 12, time: new Date(now).toISOString() },
    approach: {
      etaMinutes,
      eta: new Date(now + etaMinutes * 60_000).toISOString(),
      distanceNM: etaMinutes / 5,
      direction: "upbound",
    },
    ...overrides,
  };
}

function position(mmsi = MMSI, aisClass) {
  return { MessageType: "PositionReport", MetaData: { MMSI: mmsi, ...(aisClass && { AisClass: aisClass }) } };
}

function device(n, body = {}) {
  return parseDeviceRegistration(String(n).padStart(2, "0").repeat(32), { environment: "production", ...body }).device;
}

const FCM_TOKEN = "dQw4w9WgXcQ:APA91bHun4MxP5egoKMwt2KZFBaFUH-1RYqx_Ab3Cd9EfGhIjKlMn";

function androidDevice(n, body = {}) {
  return parseDeviceRegistration(`${FCM_TOKEN}${n}`, { platform: "android", environment: "production", ...body }).device;
}

function fakeFcm() {
  return { send: vi.fn(async () => "projects/x/messages/1") };
}

function fakeApns() {
  let channels = 0;
  return {
    sendAlert: vi.fn(async () => {}),
    sendLiveActivity: vi.fn(async () => {}),
    createChannel: vi.fn(async () => `channel${++channels}`),
    broadcast: vi.fn(async () => {}),
    deleteChannel: vi.fn(async () => {}),
  };
}

// Let the alert's async sends finish
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("payloads", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });
  afterEach(() => vi.useRealTimers());

  it("words the notification", () => {
    expect(alertPayload(shipAt(8.4))).toEqual({
      aps: {
        alert: {
          title: "ALGOMA EQUINOX in ~8 min",
          subtitle: "Upbound · Cargo · 225 m",
          body: "Heading for Thunder Bay. Likely going to load grain.",
        },
        sound: "default",
        "thread-id": "bridge",
        "interruption-level": "time-sensitive",
        "relevance-score": 1,
      },
      mmsi: MMSI,
    });
    const plain = alertPayload(shipAt(6, { destination: undefined, cargo: undefined, length: undefined, shipTypeName: undefined }));
    expect(plain.aps.alert.subtitle).toBe("Upbound");
    expect(plain.aps.alert.body).toBe("Heading for the Blue Water Bridge.");
  });

  it("starts the Live Activity on its channel with Swift dates", () => {
    const payload = pushToStartPayload(shipAt(8), "chan==", START);
    expect(payload.aps).toMatchObject({
      timestamp: START / 1000,
      event: "start",
      "input-push-channel": "chan==",
      "attributes-type": "ShipApproachAttributes",
      attributes: { mmsi: MMSI, name: "ALGOMA EQUINOX", direction: "upbound", shipTypeName: "Cargo", length: 225, destination: "THUNDER BAY" },
      "content-state": { eta: swiftDate(START + 8 * 60_000), distanceNM: 1.6, sog: 12, phase: "approaching" },
    });
    expect(payload.aps.alert.title).toBe("ALGOMA EQUINOX in ~8 min");
    expect(swiftDate(Date.UTC(2001, 0, 1, 0, 1))).toBe(60);
  });
});

describe("createApproachAlerts", () => {
  let pushDevices;
  let alerts;
  let apns;
  let current;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    pushDevices = createPushDevices();
    apns = fakeApns();
    current = undefined;
    alerts = createApproachAlerts({ apns, pushDevices, ship: () => current });
  });

  afterEach(() => {
    alerts.stop();
    pushDevices.close();
    vi.useRealTimers();
  });

  it("alerts once when the ETA falls to 10 minutes", async () => {
    pushDevices.register(device(1));
    current = shipAt(15);
    alerts.handleMessage(position());
    await settle();
    expect(apns.sendAlert).not.toHaveBeenCalled();

    current = shipAt(9);
    alerts.handleMessage(position());
    await settle();
    expect(apns.sendAlert).toHaveBeenCalledTimes(1);
    expect(apns.sendAlert.mock.calls[0][0]).toMatchObject({
      deviceToken: device(1).token,
      environment: "production",
      collapseId: `ship-${MMSI}`,
      expiresAt: START + 9 * 60_000,
    });

    current = shipAt(7);
    alerts.handleMessage(position());
    await settle();
    expect(apns.sendAlert).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(ALERT_COOLDOWN_MS);
    current = shipAt(9);
    alerts.handleMessage(position());
    await settle();
    expect(apns.sendAlert).toHaveBeenCalledTimes(2);
  });

  it("skips ships too close, too slow, Class B, or not wanted", async () => {
    pushDevices.register(device(1, { categories: ["tanker"] }));
    pushDevices.register(device(2));
    current = shipAt(2);
    alerts.handleMessage(position());
    current = shipAt(8, { position: { sog: 1 } });
    alerts.handleMessage(position());
    current = shipAt(8);
    alerts.handleMessage(position(MMSI, "B"));
    await settle();
    expect(apns.sendAlert).not.toHaveBeenCalled();

    alerts.handleMessage(position());
    await settle();
    expect(apns.sendAlert.mock.calls.map(([call]) => call.deviceToken)).toEqual([device(2).token]);
  });

  it("starts, updates and ends Live Activities on a channel per environment", async () => {
    const pushToStartToken = "ef".repeat(40);
    pushDevices.register(device(1, { liveActivities: true, pushToStartToken }));
    pushDevices.register(device(2, { environment: "sandbox", liveActivities: true, pushToStartToken: "aa".repeat(40) }));
    pushDevices.register(device(3, { liveActivities: true }));

    current = shipAt(9);
    alerts.handleMessage(position());
    await settle();
    expect(apns.createChannel).toHaveBeenCalledTimes(2);
    expect(apns.sendLiveActivity).toHaveBeenCalledTimes(2);
    expect(apns.sendLiveActivity.mock.calls[0][0]).toMatchObject({ token: pushToStartToken, environment: "production" });
    expect(apns.sendLiveActivity.mock.calls[0][0].payload.aps["input-push-channel"]).toBe("channel1");
    // No push-to-start token: a normal notification
    expect(apns.sendAlert).toHaveBeenCalledTimes(1);
    expect(pushDevices.channels()).toHaveLength(2);

    // Too soon to update
    current = shipAt(7);
    alerts.handleMessage(position());
    expect(apns.broadcast).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    current = shipAt(5);
    alerts.handleMessage(position());
    await settle();
    expect(apns.broadcast).toHaveBeenCalledTimes(2);
    expect(apns.broadcast.mock.calls[0][0]).toMatchObject({ priority: 5, payload: { aps: { event: "update" } } });

    alerts.handleShipLogEntry({ mmsi: MMSI, passages: [{ time: new Date().toISOString(), direction: "upbound" }] });
    await settle();
    const end = apns.broadcast.mock.calls[2][0].payload.aps;
    expect(end).toMatchObject({ event: "end", "content-state": { phase: "passed" } });

    vi.advanceTimersByTime(20 * 60_000);
    await settle();
    expect(apns.deleteChannel).toHaveBeenCalledTimes(2);
    expect(pushDevices.channels()).toEqual([]);
  });

  it("follows the user's Live Activity choice for each ship", async () => {
    const pushToStartToken = "ef".repeat(40);
    // Off for this ship, though on by default: a normal notification
    pushDevices.register(device(1, { liveActivities: true, pushToStartToken, liveActivityShips: { [MMSI]: false } }));
    // On for this ship, though off by default and not a category it wants
    pushDevices.register(device(2, { categories: ["tanker"], pushToStartToken: "aa".repeat(40), liveActivityShips: { [MMSI]: true } }));

    current = shipAt(9);
    alerts.handleMessage(position());
    await settle();
    expect(apns.sendAlert.mock.calls.map(([call]) => call.deviceToken)).toEqual([device(1).token]);
    expect(apns.sendLiveActivity.mock.calls.map(([call]) => call.token)).toEqual(["aa".repeat(40)]);
  });

  it("ends a Live Activity whose ship never arrives", async () => {
    pushDevices.register(device(1, { liveActivities: true, pushToStartToken: "ef".repeat(40) }));
    current = shipAt(9);
    alerts.handleMessage(position());
    await settle();
    vi.advanceTimersByTime(ACTIVITY_TIMEOUT_MS);
    await settle();
    expect(apns.broadcast.mock.calls[0][0].payload.aps).toMatchObject({ event: "end", "content-state": { phase: "lost" } });
  });

  it("ignores passages from before the alert", async () => {
    pushDevices.register(device(1, { liveActivities: true, pushToStartToken: "ef".repeat(40) }));
    current = shipAt(9);
    alerts.handleMessage(position());
    await settle();
    alerts.handleShipLogEntry({ mmsi: MMSI, passages: [{ time: new Date(START - 3600_000).toISOString() }] });
    expect(apns.broadcast).not.toHaveBeenCalled();
  });

  it("falls back to a notification when no channel can be opened", async () => {
    apns.createChannel.mockRejectedValue(new Error("Forbidden"));
    pushDevices.register(device(1, { liveActivities: true, pushToStartToken: "ef".repeat(40) }));
    current = shipAt(9);
    alerts.handleMessage(position());
    await settle();
    expect(apns.sendLiveActivity).not.toHaveBeenCalled();
    expect(apns.sendAlert).toHaveBeenCalledTimes(1);
  });

  it("forgets dead tokens", async () => {
    pushDevices.register(device(1));
    pushDevices.register(device(2, { liveActivities: true, pushToStartToken: "ef".repeat(40) }));
    apns.sendAlert.mockRejectedValue(new ApnsError(410, "Unregistered"));
    apns.sendLiveActivity.mockRejectedValue(new ApnsError(400, "BadDeviceToken"));
    current = shipAt(9);
    alerts.handleMessage(position());
    await settle();
    const remaining = pushDevices.matching({ category: "cargo", length: 225, direction: "upbound" });
    expect(remaining.map((d) => d.token)).toEqual([device(2).token]);
    expect(remaining[0].pushToStartToken).toBeUndefined();
  });

  it("ends and deletes channels left from a previous run", async () => {
    pushDevices.addChannel({ channelId: "old", environment: "production", mmsi: MMSI });
    await alerts.cleanUp();
    expect(apns.broadcast.mock.calls[0][0]).toMatchObject({ channelId: "old", payload: { aps: { event: "end" } } });
    expect(apns.deleteChannel).toHaveBeenCalledWith({ channelId: "old", environment: "production" });
    expect(pushDevices.channels()).toEqual([]);
  });
});

describe("Android payloads", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });
  afterEach(() => vi.useRealTimers());

  it("sends the alert as data with string values", () => {
    expect(fcmAlertMessage("tok", shipAt(8.4), START)).toEqual({
      token: "tok",
      data: {
        type: "alert",
        mmsi: String(MMSI),
        title: "ALGOMA EQUINOX in ~8 min",
        subtitle: "Upbound · Cargo · 225 m",
        body: "Heading for Thunder Bay. Likely going to load grain.",
      },
      android: { priority: "HIGH", ttl: "504s", collapse_key: `ship-${MMSI}` },
    });
    // At least a few seconds, even with the ETA here
    expect(fcmAlertMessage("tok", shipAt(0), START).android.ttl).toBe("5s");
  });

  it("starts the countdown with the alert's words, leaving out what's unknown", () => {
    expect(fcmActivityStartMessage("tok", shipAt(8), START)).toEqual({
      token: "tok",
      data: {
        type: "activity",
        event: "start",
        mmsi: String(MMSI),
        name: "ALGOMA EQUINOX",
        direction: "upbound",
        shipTypeName: "Cargo",
        length: "225",
        destination: "THUNDER BAY",
        eta: "2026-10-30T14:08:00.000Z",
        distanceNM: "1.6",
        sog: "12",
        phase: "approaching",
        staleAt: "2026-10-30T14:13:00.000Z",
        title: "ALGOMA EQUINOX in ~8 min",
        body: "Upbound · Cargo · 225 m. Heading for Thunder Bay. Likely going to load grain.",
      },
      android: { priority: "HIGH", ttl: "480s" },
    });
    const plain = fcmActivityStartMessage("tok", shipAt(8, { shipTypeName: undefined, length: undefined, destination: undefined }), START);
    expect(Object.keys(plain.data)).not.toEqual(expect.arrayContaining(["shipTypeName"]));
    expect(plain.data).not.toHaveProperty("length");
    expect(plain.data).not.toHaveProperty("destination");
    for (const value of Object.values(plain.data)) expect(typeof value).toBe("string");
  });
});

describe("createApproachAlerts with Android devices", () => {
  let pushDevices;
  let alerts;
  let apns;
  let fcm;
  let current;

  function start({ withApns = true, withFcm = true } = {}) {
    apns = withApns ? fakeApns() : null;
    fcm = withFcm ? fakeFcm() : null;
    alerts = createApproachAlerts({ apns, fcm, pushDevices, ship: () => current });
  }

  const sentData = () => fcm.send.mock.calls.map(([message]) => message.data);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    pushDevices = createPushDevices();
    current = undefined;
  });

  afterEach(() => {
    alerts.stop();
    pushDevices.close();
    vi.useRealTimers();
  });

  it("sends each platform through its own service, iOS unchanged", async () => {
    start();
    pushDevices.register(device(1));
    pushDevices.register(androidDevice(1));
    current = shipAt(9);
    alerts.handleMessage(position());
    await settle();

    expect(apns.sendAlert).toHaveBeenCalledTimes(1);
    expect(apns.sendAlert.mock.calls[0][0]).toEqual({
      deviceToken: device(1).token,
      environment: "production",
      payload: alertPayload(current),
      collapseId: `ship-${MMSI}`,
      expiresAt: START + 9 * 60_000,
    });
    expect(fcm.send).toHaveBeenCalledTimes(1);
    expect(fcm.send.mock.calls[0][0]).toEqual(fcmAlertMessage(`${FCM_TOKEN}1`, current, START));
  });

  it("skips devices whose platform isn't set up", async () => {
    start({ withApns: false });
    pushDevices.register(device(1, { liveActivities: true, pushToStartToken: "ef".repeat(40) }));
    pushDevices.register(androidDevice(1));
    current = shipAt(9);
    alerts.handleMessage(position());
    await settle();
    expect(fcm.send.mock.calls.map(([m]) => m.token)).toEqual([`${FCM_TOKEN}1`]);
    await alerts.cleanUp();
  });

  it("leaves Android devices alone without FCM", async () => {
    start({ withFcm: false });
    pushDevices.register(androidDevice(1, { liveActivities: true }));
    current = shipAt(9);
    alerts.handleMessage(position());
    await settle();
    expect(apns.sendAlert).not.toHaveBeenCalled();
    expect(apns.sendLiveActivity).not.toHaveBeenCalled();
    expect(apns.createChannel).not.toHaveBeenCalled();
  });

  it("follows the user's countdown choice for each ship", async () => {
    start();
    pushDevices.register(androidDevice(1, { liveActivities: true }));
    pushDevices.register(androidDevice(2, { liveActivities: true, liveActivityShips: { [MMSI]: false } }));
    pushDevices.register(androidDevice(3, { categories: ["tanker"], liveActivityShips: { [MMSI]: true } }));
    current = shipAt(9);
    alerts.handleMessage(position());
    await settle();
    const byToken = Object.fromEntries(fcm.send.mock.calls.map(([m]) => [m.token, m.data]));
    expect(byToken[`${FCM_TOKEN}1`]).toMatchObject({ type: "activity", event: "start" });
    expect(byToken[`${FCM_TOKEN}2`]).toMatchObject({ type: "alert" });
    expect(byToken[`${FCM_TOKEN}3`]).toMatchObject({ type: "activity", event: "start" });
    // An Android countdown needs no APNs channel
    expect(apns.createChannel).not.toHaveBeenCalled();
  });

  it("updates and ends the countdown alongside the iOS Live Activity", async () => {
    start();
    pushDevices.register(device(1, { liveActivities: true, pushToStartToken: "ef".repeat(40) }));
    pushDevices.register(androidDevice(1, { liveActivities: true }));
    pushDevices.register(androidDevice(2));
    current = shipAt(9);
    alerts.handleMessage(position());
    await settle();
    expect(apns.sendLiveActivity).toHaveBeenCalledTimes(1);
    expect(sentData().map((d) => d.type)).toEqual(["activity", "alert"]);

    // Too soon to update
    current = shipAt(7);
    alerts.handleMessage(position());
    await settle();
    expect(fcm.send).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(60_000);
    current = shipAt(5, { position: { sog: 11.5 } });
    alerts.handleMessage(position());
    await settle();
    expect(apns.broadcast).toHaveBeenCalledTimes(1);
    expect(fcm.send).toHaveBeenCalledTimes(3);
    const [update] = fcm.send.mock.calls[2];
    expect(update.token).toBe(`${FCM_TOKEN}1`);
    expect(update.data).toEqual({
      type: "activity",
      event: "update",
      mmsi: String(MMSI),
      name: "ALGOMA EQUINOX",
      direction: "upbound",
      shipTypeName: "Cargo",
      length: "225",
      destination: "THUNDER BAY",
      eta: "2026-10-30T14:06:00.000Z",
      distanceNM: "1",
      sog: "11.5",
      phase: "approaching",
      staleAt: "2026-10-30T14:11:00.000Z",
    });

    alerts.handleShipLogEntry({ mmsi: MMSI, passages: [{ time: new Date().toISOString(), direction: "upbound" }] });
    await settle();
    expect(apns.broadcast.mock.calls[1][0].payload.aps).toMatchObject({ event: "end", "content-state": { phase: "passed" } });
    const [end] = fcm.send.mock.calls[3];
    expect(end.token).toBe(`${FCM_TOKEN}1`);
    expect(end.data).toMatchObject({
      type: "activity",
      event: "end",
      mmsi: String(MMSI),
      name: "ALGOMA EQUINOX",
      direction: "upbound",
      phase: "passed",
      dismissAt: "2026-10-30T14:16:00.000Z",
    });
    expect(end.data).not.toHaveProperty("title");
    expect(end.android.ttl).toBe("900s");
  });

  it("ends an Android-only countdown whose ship never arrives", async () => {
    start({ withApns: false });
    pushDevices.register(androidDevice(1, { liveActivities: true }));
    current = shipAt(9);
    alerts.handleMessage(position());
    await settle();
    current = undefined;
    vi.advanceTimersByTime(ACTIVITY_TIMEOUT_MS);
    await settle();
    expect(sentData()[1]).toMatchObject({
      type: "activity",
      event: "end",
      name: "ALGOMA EQUINOX",
      direction: "upbound",
      phase: "lost",
      eta: "2026-10-30T14:30:00.000Z",
      distanceNM: "0",
      sog: "0",
    });
  });

  it("forgets tokens FCM says are gone, at the alert and later", async () => {
    start({ withApns: false });
    pushDevices.register(androidDevice(1));
    pushDevices.register(androidDevice(2, { liveActivities: true }));
    pushDevices.register(androidDevice(3, { liveActivities: true }));
    const gone = new FcmError(404, "NOT_FOUND", "UNREGISTERED", "Requested entity was not found.");
    fcm.send.mockImplementation(async (message) => {
      if (message.token === `${FCM_TOKEN}1`) throw gone;
      if (message.token === `${FCM_TOKEN}3` && message.data.event === "update") throw gone;
      if (message.token === `${FCM_TOKEN}2`) throw new FcmError(503, "UNAVAILABLE", "UNAVAILABLE");
    });
    const ship = { category: "cargo", length: 225, direction: "upbound" };
    current = shipAt(9);
    alerts.handleMessage(position());
    await settle();
    // Device 2's start failed for now: kept, but not followed
    expect(pushDevices.matching(ship).map((d) => d.token)).toEqual([`${FCM_TOKEN}2`, `${FCM_TOKEN}3`]);

    vi.advanceTimersByTime(60_000);
    current = shipAt(5);
    alerts.handleMessage(position());
    await settle();
    expect(pushDevices.matching(ship).map((d) => d.token)).toEqual([`${FCM_TOKEN}2`]);

    // Nobody left following it
    alerts.handleShipLogEntry({ mmsi: MMSI, passages: [{ time: new Date().toISOString() }] });
    await settle();
    expect(sentData().filter((d) => d.event === "end")).toEqual([]);
  });

  it("drops an Android-only countdown whose every start failed", async () => {
    start({ withApns: false });
    pushDevices.register(androidDevice(1, { liveActivities: true }));
    fcm.send.mockRejectedValue(new FcmError(500, "INTERNAL"));
    current = shipAt(9);
    alerts.handleMessage(position());
    await settle();
    fcm.send.mockClear();
    vi.advanceTimersByTime(ACTIVITY_TIMEOUT_MS);
    await settle();
    expect(fcm.send).not.toHaveBeenCalled();
  });
});
