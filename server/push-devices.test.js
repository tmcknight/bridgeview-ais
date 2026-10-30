import { describe, it, expect, afterEach } from "vitest";
import { createPushDevices, parseDeviceRegistration, wantsAlert } from "./push-devices.js";

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
