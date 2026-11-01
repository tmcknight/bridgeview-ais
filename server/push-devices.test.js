import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, afterEach } from "vitest";
import { createPushDevices, parseDeviceRegistration, wantsAlert, wantsLiveActivity } from "./push-devices.js";

const TOKEN = "ab".repeat(32);
const START_TOKEN = "cd".repeat(40);
// FCM registration tokens are mixed case, with ':' '-' and '_'
const FCM_TOKEN = "dQw4w9WgXcQ:APA91bHun4MxP5egoKMwt2KZFBaFUH-1RYqx_Ab3Cd9EfGhIjKlMnOpQrStUvWxYz";

function registerAndroid(body = {}, token = FCM_TOKEN) {
  return parseDeviceRegistration(token, { platform: "android", environment: "production", ...body });
}

function register(body = {}, token = TOKEN) {
  return parseDeviceRegistration(token, { environment: "production", ...body });
}

describe("parseDeviceRegistration", () => {
  it("fills in defaults", () => {
    expect(register().device).toEqual({
      token: TOKEN,
      platform: "ios",
      environment: "production",
      enabled: true,
      pushToStartToken: undefined,
      liveActivities: false,
      categories: ["cargo", "tanker", "passenger"],
      minLength: 0,
      directions: ["upbound", "downbound"],
      liveActivityShips: {},
    });
  });

  it("lowercases tokens and drops duplicate choices", () => {
    const { device } = register(
      { pushToStartToken: START_TOKEN.toUpperCase(), categories: ["cargo", "cargo"] },
      TOKEN.toUpperCase()
    );
    expect(device.token).toBe(TOKEN);
    expect(device.pushToStartToken).toBe(START_TOKEN);
    expect(device.categories).toEqual(["cargo"]);
  });

  it.each([
    [{ environment: "staging" }, TOKEN],
    [{}, "not-hex"],
    [{ enabled: "yes" }, TOKEN],
    [{ pushToStartToken: "xyz" }, TOKEN],
    [{ categories: ["yachts"] }, TOKEN],
    [{ categories: "cargo" }, TOKEN],
    [{ minLength: -1 }, TOKEN],
    [{ minLength: 1.5 }, TOKEN],
    [{ directions: ["sideways"] }, TOKEN],
  ])("rejects %j", (body, token) => {
    expect(register(body, token).error).toBeTruthy();
  });

  it("keeps Android tokens as sent and refuses push-to-start tokens", () => {
    const { device } = registerAndroid({ liveActivities: true });
    expect(device).toMatchObject({ token: FCM_TOKEN, platform: "android", liveActivities: true });
    expect(device.pushToStartToken).toBeUndefined();
    expect(registerAndroid({ pushToStartToken: START_TOKEN }).error).toMatch(/pushToStartToken/);
    expect(registerAndroid({ environment: "moon" }).error).toMatch(/environment/);
    expect(registerAndroid({}, "short:token").error).toMatch(/token/);
    expect(registerAndroid({}, `${FCM_TOKEN}/x`).error).toMatch(/token/);
    expect(registerAndroid({}, "a".repeat(4097)).error).toMatch(/token/);
    // An FCM token isn't an APNs one
    expect(register({}, FCM_TOKEN).error).toMatch(/token/);
    expect(register({ platform: "windows" }).error).toMatch(/platform/);
  });

  it("rejects a body that isn't an object", () => {
    expect(parseDeviceRegistration(TOKEN, null).error).toBeTruthy();
    expect(parseDeviceRegistration(TOKEN, []).error).toBeTruthy();
  });
});

describe("wantsAlert", () => {
  const device = register({ minLength: 150, directions: ["downbound"] }).device;

  it("matches category, length and direction", () => {
    expect(wantsAlert(device, { category: "cargo", length: 200, direction: "downbound" })).toBe(true);
    expect(wantsAlert(device, { category: "other", length: 200, direction: "downbound" })).toBe(false);
    expect(wantsAlert(device, { category: "cargo", length: 100, direction: "downbound" })).toBe(false);
    expect(wantsAlert(device, { category: "cargo", length: undefined, direction: "downbound" })).toBe(false);
    expect(wantsAlert(device, { category: "cargo", length: 200, direction: "upbound" })).toBe(false);
    expect(wantsAlert({ ...device, enabled: false }, { category: "cargo", length: 200, direction: "downbound" })).toBe(false);
  });

  it("alerts for a ship the user chose a Live Activity for, unless alerts are off", () => {
    const chosen = { ...device, liveActivityShips: { 316001234: true, 366999000: false } };
    const ship = { mmsi: 316001234, category: "other", length: 50, direction: "upbound" };
    expect(wantsAlert(chosen, ship)).toBe(true);
    expect(wantsAlert(chosen, { ...ship, mmsi: 366999000 })).toBe(false);
    expect(wantsAlert({ ...chosen, enabled: false }, ship)).toBe(false);
  });
});

describe("wantsLiveActivity", () => {
  const device = register({ pushToStartToken: START_TOKEN, liveActivities: true, liveActivityShips: { 366999000: false } }).device;

  it("follows the user's choice for the ship, or else their default", () => {
    expect(wantsLiveActivity(device, 316001234)).toBe(true);
    expect(wantsLiveActivity(device, 366999000)).toBe(false);
    const offByDefault = { ...device, liveActivities: false, liveActivityShips: { 316001234: true } };
    expect(wantsLiveActivity(offByDefault, 316001234)).toBe(true);
    expect(wantsLiveActivity(offByDefault, 366999000)).toBe(false);
    expect(wantsLiveActivity({ ...device, pushToStartToken: undefined }, 316001234)).toBe(false);
  });

  it("needs no push-to-start token on Android", () => {
    const android = registerAndroid({ liveActivities: true, liveActivityShips: { 366999000: false } }).device;
    expect(wantsLiveActivity(android, 316001234)).toBe(true);
    expect(wantsLiveActivity(android, 366999000)).toBe(false);
    const offByDefault = { ...android, liveActivities: false, liveActivityShips: { 316001234: true } };
    expect(wantsLiveActivity(offByDefault, 316001234)).toBe(true);
    expect(wantsLiveActivity(offByDefault, 366999000)).toBe(false);
  });

  it("rejects bad per-ship choices", () => {
    expect(register({ liveActivityShips: { 123: true } }).error).toMatch(/liveActivityShips/);
    expect(register({ liveActivityShips: { 316001234: "yes" } }).error).toMatch(/liveActivityShips/);
    expect(register({ liveActivityShips: [316001234] }).error).toMatch(/liveActivityShips/);
  });
});

describe("createPushDevices", () => {
  let devices;
  afterEach(() => devices?.close());

  it("stores, updates and removes devices", () => {
    devices = createPushDevices();
    const ship = { category: "cargo", length: 200, direction: "upbound" };
    expect(devices.register(register().device)).toBe(true);
    expect(devices.matching(ship).map((d) => d.token)).toEqual([TOKEN]);

    devices.register(register({ enabled: false }).device);
    expect(devices.matching(ship)).toEqual([]);

    devices.register(register({ pushToStartToken: START_TOKEN, liveActivities: true }).device);
    expect(devices.matching(ship)[0]).toMatchObject({ pushToStartToken: START_TOKEN, liveActivities: true });

    devices.register(register({ liveActivityShips: { 316001234: true } }).device);
    expect(devices.matching(ship)[0].liveActivityShips).toEqual({ 316001234: true });
    // Sent without the push-to-start token (the app hasn't been given it again yet): keep it
    expect(devices.matching(ship)[0].pushToStartToken).toBe(START_TOKEN);

    devices.register(register({ pushToStartToken: START_TOKEN, liveActivities: true }).device);
    devices.clearPushToStartToken(START_TOKEN);
    expect(devices.matching(ship)[0].pushToStartToken).toBeUndefined();

    devices.remove(TOKEN);
    expect(devices.matching(ship)).toEqual([]);
  });

  it("stores Android devices with their platform and exact token", () => {
    devices = createPushDevices();
    const ship = { category: "cargo", length: 200, direction: "upbound" };
    devices.register(register().device);
    devices.register(registerAndroid({ liveActivities: true }).device);
    expect(devices.matching(ship).map((d) => [d.token, d.platform])).toEqual([
      [TOKEN, "ios"],
      [FCM_TOKEN, "android"],
    ]);
    // Case matters for FCM tokens
    devices.remove(FCM_TOKEN.toLowerCase());
    expect(devices.matching(ship)).toHaveLength(2);
    devices.remove(FCM_TOKEN);
    devices.remove(TOKEN.toUpperCase());
    expect(devices.matching(ship)).toEqual([]);
  });

  it("adds the platform column to an older database", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "push-devices-")), "old.db");
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE push_devices (
      token TEXT PRIMARY KEY, environment TEXT NOT NULL, enabled INTEGER NOT NULL, push_to_start_token TEXT,
      live_activities INTEGER NOT NULL, categories TEXT NOT NULL, min_length INTEGER NOT NULL,
      directions TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    old.prepare("INSERT INTO push_devices VALUES (?, 'production', 1, NULL, 0, '[\"cargo\"]', 0, '[\"upbound\"]', 'x', 'x')").run(TOKEN);
    old.close();
    devices = createPushDevices({ file });
    expect(devices.matching({ category: "cargo", length: 0, direction: "upbound" })).toMatchObject([
      { token: TOKEN, platform: "ios", liveActivityShips: {} },
    ]);
  });

  it("keeps track of open channels", () => {
    devices = createPushDevices();
    devices.addChannel({ channelId: "abc=", environment: "sandbox", mmsi: 316001234 });
    expect(devices.channels()).toMatchObject([{ channelId: "abc=", environment: "sandbox", mmsi: 316001234 }]);
    devices.removeChannel({ channelId: "abc=", environment: "sandbox" });
    expect(devices.channels()).toEqual([]);
  });
});
