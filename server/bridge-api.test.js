import { describe, it, expect, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { attributionFor, createBridgeApi, createRateLimiter, RATE_LIMITS } from "./bridge-api.js";
import { createVesselDetails } from "./vessel-details.js";
import { createLatestPositions } from "./latest-positions.js";
import { createPushDevices } from "./push-devices.js";
import { BRIDGE_CENTER } from "./ship-log.js";

const NOW = Date.parse("2026-10-30T14:00:00Z");
const TOKEN = "ab".repeat(32);
const north = (nm) => BRIDGE_CENTER.lat + nm / 60;

function position(mmsi, nm, { sog = 12, cog = 180, name = "LAKER", aisClass, source } = {}) {
  return {
    MessageType: "PositionReport",
    MetaData: {
      MMSI: mmsi,
      ShipName: name,
      latitude: north(nm),
      longitude: BRIDGE_CENTER.lng,
      ...(aisClass && { AisClass: aisClass }),
      ...(source && { Source: source }),
    },
    Message: { PositionReport: { Sog: sog, Cog: cog, TrueHeading: cog, NavigationalStatus: 0 } },
  };
}

function staticData(mmsi, name, destination, type = 70) {
  return {
    MessageType: "ShipStaticData",
    MetaData: { MMSI: mmsi, ShipName: name, latitude: 0, longitude: 0 },
    Message: { ShipStaticData: { Name: name, Destination: destination, Type: type, ImoNumber: 9613927, Dimension: { A: 150, B: 75, C: 12, D: 12 } } },
  };
}

function fakeShipLog(entries = []) {
  return Object.assign(new EventEmitter(), { entries: () => entries });
}

// A request/response pair for handleRequest
function call(api, method, url, body, ip = "1.2.3.4") {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    Object.assign(req, { method, url, destroy() {} });
    const res = {
      headersSent: false,
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
        this.headersSent = true;
      },
      end(text) {
        resolve({ status: this.status, headers: this.headers, body: text ? JSON.parse(text) : undefined });
      },
    };
    const handled = api.handleRequest(req, res, ip);
    if (!handled) resolve(null);
    if (body !== undefined) {
      req.emit("data", Buffer.from(typeof body === "string" ? body : JSON.stringify(body)));
    }
    req.emit("end");
  });
}

describe("createBridgeApi", () => {
  let vesselDetails;
  let pushDevices;
  afterEach(() => {
    vesselDetails?.close();
    pushDevices?.close();
  });

  function setup({ log = [], devices = false, attribution } = {}) {
    vesselDetails = createVesselDetails();
    const latestPositions = createLatestPositions({ now: () => NOW });
    pushDevices = devices ? createPushDevices() : null;
    const api = createBridgeApi({
      vesselDetails,
      latestPositions,
      shipLog: fakeShipLog(log),
      pushDevices,
      shipCamVideoId: () => "VIDEO",
      attribution,
      now: () => NOW,
    });
    const hear = (message) => {
      vesselDetails.handleMessage(message);
      latestPositions.handleMessage(message);
    };
    return { api, hear };
  }

  it("lists ships coming up, soonest first, with their details", () => {
    const { api, hear } = setup();
    hear(staticData(316001234, "ALGOMA EQUINOX", "THUNDER BAY"));
    hear(position(316001234, -2, { cog: 0, name: "ALGOMA EQUINOX" }));
    hear(position(367000001, 1, { name: "CLOSER" }));
    hear(position(367000002, 1, { name: "LEAVING", cog: 0 }));
    hear(position(367000003, 0.5, { name: "DINGHY", aisClass: "B" }));

    const snapshot = api.snapshot();
    expect(snapshot.generatedAt).toBe("2026-10-30T14:00:00.000Z");
    expect(snapshot.shipCamVideoId).toBe("VIDEO");
    expect(snapshot.upcoming.map((s) => s.name)).toEqual(["CLOSER", "ALGOMA EQUINOX"]);
    expect(snapshot.upcoming[1]).toMatchObject({
      mmsi: 316001234,
      imo: 9613927,
      shipType: 70,
      shipTypeName: "Cargo",
      category: "cargo",
      length: 225,
      width: 24,
      destination: "THUNDER BAY",
      cargo: "Likely going to load grain",
      flag: "CA",
      position: { sog: 12, cog: 0, time: "2026-10-30T14:00:00.000Z" },
      approach: { direction: "upbound", distanceNM: 2.4, etaMinutes: 12 },
    });
    expect(snapshot.upcoming[1].approach.eta).toBe("2026-10-30T14:12:00.000Z");
  });

  it("keeps AISHub positions to itself, but not the ETA worked out from them", async () => {
    const passages = [{ time: new Date(NOW - 3600_000).toISOString(), direction: "downbound" }];
    const { api, hear } = setup({ log: [{ mmsi: 316001234, name: "ALGOMA EQUINOX", passages, lastSeen: "" }] });
    hear(staticData(316001234, "ALGOMA EQUINOX", "THUNDER BAY"));
    hear(position(316001234, 2, { name: "ALGOMA EQUINOX", source: "aishub" }));
    hear(position(367000001, 1, { name: "ANTENNA", source: "local" }));

    const { upcoming, recent } = api.snapshot();
    const fromAishub = upcoming.find((s) => s.mmsi === 316001234);
    expect(fromAishub.position).toBeUndefined();
    expect(fromAishub.positionSource).toBeUndefined();
    expect(fromAishub.approach).toMatchObject({ direction: "downbound", distanceNM: 2, etaMinutes: 10 });
    expect(upcoming.find((s) => s.mmsi === 367000001).position).toMatchObject({ sog: 12 });
    expect(recent[0].position).toBeUndefined();
    expect(recent[0].passage).toEqual(passages[0]);

    const detail = await call(api, "GET", "/api/ships/316001234");
    expect(detail.body.position).toBeUndefined();
    expect(detail.body.approach.etaMinutes).toBe(10);
    expect(detail.body.passages).toEqual(passages);
    expect(JSON.stringify(detail.body)).not.toContain(String(north(2)));

    // The server's own view keeps it, for the alerts
    expect(api.ship(316001234).position).toMatchObject({ sog: 12 });

    // A newer report from another feed brings the position back
    hear(position(316001234, 1.8, { name: "ALGOMA EQUINOX" }));
    expect(api.ship(316001234).positionSource).toBe("aisstream");
  });

  it("credits the feeds in use", () => {
    const attribution = attributionFor(["local", "aishub", "aisstream"]);
    expect(attribution).toEqual([
      { text: "Data: AISHub contributors", url: "https://www.aishub.net" },
      { text: "AISStream.io", url: "https://aisstream.io" },
    ]);
    expect(attributionFor(["local"])).toEqual([]);
    expect(attributionFor(["aisstream", "local"])).toEqual([{ text: "AISStream.io", url: "https://aisstream.io" }]);

    const { api } = setup({ attribution });
    expect(api.snapshot().attribution).toEqual(attribution);
  });

  it("lists ships that passed in the last day, newest first", () => {
    const passage = (hoursAgo, direction = "upbound") => ({
      time: new Date(NOW - hoursAgo * 3600_000).toISOString(),
      direction,
    });
    const { api } = setup({
      log: [
        { mmsi: 1, name: "OLDER", passages: [passage(5)], lastSeen: "" },
        { mmsi: 2, name: "NEWER", passages: [passage(1, "downbound")], lastSeen: "" },
        { mmsi: 3, name: "YESTERDAY", passages: [passage(30)], lastSeen: "" },
      ],
    });
    const { recent } = api.snapshot();
    expect(recent.map((s) => s.name)).toEqual(["NEWER", "OLDER"]);
    expect(recent[0].passage).toEqual(passage(1, "downbound"));
  });

  it("serves the snapshot and single ships over HTTP", async () => {
    const passages = [{ time: "2026-10-30T12:00:00.000Z", direction: "downbound" }];
    const { api, hear } = setup({ log: [{ mmsi: 316001234, name: "ALGOMA EQUINOX", passages, lastSeen: "" }] });
    hear(staticData(316001234, "ALGOMA EQUINOX", "THUNDER BAY"));

    const bridge = await call(api, "GET", "/api/bridge");
    expect(bridge.status).toBe(200);
    expect(bridge.body.recent[0].name).toBe("ALGOMA EQUINOX");

    const ship = await call(api, "GET", "/api/ships/316001234");
    expect(ship.status).toBe(200);
    expect(ship.body).toMatchObject({ name: "ALGOMA EQUINOX", passages });
    expect(ship.body.position).toBeUndefined();

    expect((await call(api, "GET", "/api/ships/123")).status).toBe(404);
    expect((await call(api, "GET", "/api/nope")).status).toBe(404);
    expect(await call(api, "GET", "/")).toBeNull();
  });

  it("registers and removes devices", async () => {
    const { api } = setup({ devices: true });
    const ship = { category: "cargo", length: 225, direction: "upbound" };

    const ok = await call(api, "PUT", `/api/devices/${TOKEN}`, { environment: "sandbox", minLength: 100 });
    expect(ok.status).toBe(204);
    expect(pushDevices.matching(ship)).toMatchObject([{ token: TOKEN, environment: "sandbox", minLength: 100 }]);

    const bad = await call(api, "PUT", `/api/devices/${TOKEN}`, { environment: "moon" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/environment/);
    expect((await call(api, "PUT", `/api/devices/${TOKEN}`, "{nope")).status).toBe(400);
    expect((await call(api, "PUT", `/api/devices/${TOKEN}`, "x".repeat(5000))).status).toBe(413);

    expect((await call(api, "DELETE", `/api/devices/${TOKEN}`)).status).toBe(204);
    expect(pushDevices.matching(ship)).toEqual([]);
  });

  it("says when alerts aren't set up", async () => {
    const { api } = setup();
    expect((await call(api, "PUT", `/api/devices/${TOKEN}`, { environment: "sandbox" })).status).toBe(503);
  });

  it("rate-limits writes per IP", async () => {
    const { api } = setup({ devices: true });
    for (let i = 0; i < RATE_LIMITS.WRITES; i++) {
      await call(api, "DELETE", `/api/devices/${TOKEN}`);
    }
    const limited = await call(api, "DELETE", `/api/devices/${TOKEN}`);
    expect(limited.status).toBe(429);
    expect((await call(api, "DELETE", `/api/devices/${TOKEN}`, undefined, "5.6.7.8")).status).toBe(204);
    expect((await call(api, "GET", "/api/bridge")).status).toBe(200);
  });
});

describe("createRateLimiter", () => {
  it("resets each window", () => {
    let t = 0;
    const allow = createRateLimiter({ now: () => t, limits: { WINDOW_MS: 1000, READS: 2, WRITES: 1 } });
    expect([allow("a", "read"), allow("a", "read"), allow("a", "read")]).toEqual([true, true, false]);
    expect(allow("a", "write")).toBe(true);
    expect(allow("a", "write")).toBe(false);
    t = 1001;
    expect(allow("a", "read")).toBe(true);
  });
});
