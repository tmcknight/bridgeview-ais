import { describe, it, expect, afterEach } from "vitest";
import { createPushDevices, parseDeviceRegistration, wantsAlert, wantsLiveActivity } from "./push-devices.js";

const TOKEN = "ab".repeat(32);
const START_TOKEN = "cd".repeat(40);

function register(body = {}, token = TOKEN) {
  return parseDeviceRegistration(token, { environment: "production", ...body });
}

describe("parseDeviceRegistration", () => {
  it("fills in defaults", () => {
    expect(register().device).toEqual({
      token: TOKEN,
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

  it("keeps track of open channels", () => {
    devices = createPushDevices();
    devices.addChannel({ channelId: "abc=", environment: "sandbox", mmsi: 316001234 });
    expect(devices.channels()).toMatchObject([{ channelId: "abc=", environment: "sandbox", mmsi: 316001234 }]);
    devices.removeChannel({ channelId: "abc=", environment: "sandbox" });
    expect(devices.channels()).toEqual([]);
  });
});
