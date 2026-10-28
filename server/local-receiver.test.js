import net from "node:net";
import { describe, it, expect, vi } from "vitest";
import {
  toAISStreamMessage,
  inBoundingBoxes,
  matchesMessageFilter,
  createDeduper,
  createLocalReceiver,
} from "./local-receiver.js";

const position = {
  class: "AIS",
  type: 1,
  repeat: 0,
  mmsi: 316002213,
  status: 0,
  turn: 0,
  speed: 10.2,
  accuracy: true,
  lon: -82.4235,
  lat: 42.9985,
  course: 182.5,
  heading: 181,
  second: 11,
  maneuver: 0,
  raim: false,
  signalpower: -16.0734,
  rxuxtime: 1793049431,
};

const staticData = {
  class: "AIS",
  type: 5,
  repeat: 0,
  mmsi: 316002213,
  imo: 9234567,
  callsign: "CFK1234",
  shipname: "ALGOMA TEST          ",
  shiptype: 70,
  to_bow: 150,
  to_stern: 75,
  to_port: 12,
  to_starboard: 12,
  month: 10,
  day: 26,
  hour: 14,
  minute: 30,
  draught: 7.5,
  destination: "SARNIA",
  rxuxtime: 1793049440,
};

const BRIDGE_BOX = [[[42.8, -82.6], [43.2, -82.2]]];

describe("toAISStreamMessage", () => {
  it("converts a position report into AISStream shape", () => {
    const msg = toAISStreamMessage(position, new Map());

    expect(msg.MessageType).toBe("PositionReport");
    expect(msg.MetaData).toMatchObject({
      MMSI: 316002213,
      MMSI_String: "316002213",
      latitude: 42.9985,
      longitude: -82.4235,
      time_utc: new Date(1793049431 * 1000).toISOString(),
    });
    expect(msg.Message.PositionReport).toMatchObject({
      Sog: 10.2,
      Cog: 182.5,
      TrueHeading: 181,
      NavigationalStatus: 0,
      MessageID: 1,
      UserID: 316002213,
      Timestamp: 11,
    });
  });

  it("converts static data and trims the ship name", () => {
    const msg = toAISStreamMessage(staticData, new Map());

    expect(msg.MessageType).toBe("ShipStaticData");
    expect(msg.Message.ShipStaticData).toMatchObject({
      Name: "ALGOMA TEST",
      Destination: "SARNIA",
      CallSign: "CFK1234",
      ImoNumber: 9234567,
      Type: 70,
      Dimension: { A: 150, B: 75, C: 12, D: 12 },
      Eta: { Month: 10, Day: 26, Hour: 14, Minute: 30 },
    });
  });

  it("tags messages as heard by the local antenna, with signal level", () => {
    const msg = toAISStreamMessage(position, new Map());

    expect(msg.MetaData.Source).toBe("local");
    expect(msg.MetaData.SignalPower).toBe(-16.1);
  });

  it("omits SignalPower when AIS-catcher doesn't report it", () => {
    const msg = toAISStreamMessage(staticData, new Map());

    expect(msg.MetaData.Source).toBe("local");
    expect(msg.MetaData).not.toHaveProperty("SignalPower");
  });

  it("fills ShipName on position reports from earlier static data", () => {
    const vessels = new Map();
    toAISStreamMessage(staticData, vessels);
    const msg = toAISStreamMessage(position, vessels);

    expect(msg.MetaData.ShipName).toBe("ALGOMA TEST");
  });

  it("gives static data the last known position", () => {
    const vessels = new Map();
    toAISStreamMessage(position, vessels);
    const msg = toAISStreamMessage(staticData, vessels);

    expect(msg.MetaData.latitude).toBe(42.9985);
    expect(msg.MetaData.longitude).toBe(-82.4235);
  });

  it("drops position reports with no valid position", () => {
    expect(toAISStreamMessage({ ...position, lat: 91, lon: 181 }, new Map())).toBeNull();
    expect(toAISStreamMessage({ ...position, lat: 0, lon: 0 }, new Map())).toBeNull();
  });

  it("ignores message types the app does not use", () => {
    expect(toAISStreamMessage({ type: 21, mmsi: 993672218, lat: 43, lon: -82.4 }, new Map())).toBeNull();
    expect(toAISStreamMessage({ type: 4, mmsi: 3669773 }, new Map())).toBeNull();
    expect(toAISStreamMessage({ type: 1 }, new Map())).toBeNull();
  });
});

describe("toAISStreamMessage names", () => {
  it("uses a name heard elsewhere until the antenna hears the ship's details", () => {
    const vessels = new Map();
    const nameFor = (mmsi) => (mmsi === 316002213 ? "ALGOMA EQUINOX" : undefined);
    expect(toAISStreamMessage(position, vessels, nameFor).MetaData.ShipName).toBe("ALGOMA EQUINOX");
    expect(toAISStreamMessage(position, vessels).MetaData.ShipName).toBe("");
  });
});

describe("toAISStreamMessage Class B", () => {
  const classBPosition = {
    class: "AIS",
    type: 18,
    repeat: 0,
    mmsi: 367000001,
    speed: 6.2,
    accuracy: true,
    lon: -82.4235,
    lat: 42.9985,
    course: 12.3,
    heading: 511,
    second: 30,
    raim: false,
    signalpower: -20.5,
    rxuxtime: 1793049431,
  };
  const partA = { class: "AIS", type: 24, repeat: 0, mmsi: 367000001, partno: 0, shipname: "SEA BREEZE  " };
  const partB = {
    class: "AIS",
    type: 24,
    repeat: 0,
    mmsi: 367000001,
    partno: 1,
    shiptype: 37,
    callsign: "WDA1234",
    to_bow: 8,
    to_stern: 4,
    to_port: 2,
    to_starboard: 2,
  };

  it("converts a Class B position report into a PositionReport marked Class B", () => {
    const msg = toAISStreamMessage(classBPosition, new Map());

    expect(msg.MessageType).toBe("PositionReport");
    expect(msg.MetaData).toMatchObject({ MMSI: 367000001, AisClass: "B", Source: "local", SignalPower: -20.5 });
    expect(msg.Message.PositionReport).toMatchObject({
      MessageID: 18,
      Latitude: 42.9985,
      Longitude: -82.4235,
      Sog: 6.2,
      Cog: 12.3,
      NavigationalStatus: 15,
    });
  });

  it("joins both parts of a type 24 report and names later positions", () => {
    const vessels = new Map();
    toAISStreamMessage(classBPosition, vessels);

    const a = toAISStreamMessage(partA, vessels);
    expect(a.MessageType).toBe("ShipStaticData");
    expect(a.MetaData).toMatchObject({ ShipName: "SEA BREEZE", AisClass: "B", latitude: 42.9985 });

    const b = toAISStreamMessage(partB, vessels);
    expect(b.Message.ShipStaticData).toMatchObject({
      Name: "SEA BREEZE",
      Type: 37,
      CallSign: "WDA1234",
      Dimension: { A: 8, B: 4, C: 2, D: 2 },
    });

    expect(toAISStreamMessage(classBPosition, vessels).MetaData.ShipName).toBe("SEA BREEZE");
  });

  it("takes the name and size from a type 19 report", () => {
    const vessels = new Map();
    const msg = toAISStreamMessage(
      { ...classBPosition, type: 19, shipname: "TUG LIFE", shiptype: 52, to_bow: 10, to_stern: 5, to_port: 3, to_starboard: 3 },
      vessels
    );
    expect(msg.MetaData.ShipName).toBe("TUG LIFE");
    expect(msg.Message.PositionReport.MessageID).toBe(19);
    expect(vessels.get(367000001).classB).toMatchObject({ name: "TUG LIFE", shipType: 52 });
  });

  it("drops an empty part A", () => {
    expect(toAISStreamMessage({ ...partA, shipname: "" }, new Map())).toBeNull();
  });

  it("matches Class B filters by AISStream name", () => {
    const msg = toAISStreamMessage(classBPosition, new Map());
    expect(matchesMessageFilter(msg, ["PositionReport"])).toBe(true);
    expect(matchesMessageFilter(msg, ["StandardClassBPositionReport"])).toBe(true);
    expect(matchesMessageFilter(msg, [18])).toBe(true);
    expect(matchesMessageFilter(msg, ["ExtendedClassBPositionReport"])).toBe(false);
  });
});

describe("inBoundingBoxes", () => {
  it("accepts positions inside a box and rejects those outside", () => {
    const inside = toAISStreamMessage(position, new Map());
    const outside = toAISStreamMessage({ ...position, lat: 41.5 }, new Map());

    expect(inBoundingBoxes(inside, BRIDGE_BOX)).toBe(true);
    expect(inBoundingBoxes(outside, BRIDGE_BOX)).toBe(false);
  });

  it("accepts boxes given in either corner order", () => {
    const msg = toAISStreamMessage(position, new Map());
    expect(inBoundingBoxes(msg, [[[43.2, -82.2], [42.8, -82.6]]])).toBe(true);
  });

  it("passes static data with no known position", () => {
    const msg = toAISStreamMessage(staticData, new Map());
    expect(inBoundingBoxes(msg, BRIDGE_BOX)).toBe(true);
  });
});

describe("matchesMessageFilter", () => {
  const msg = toAISStreamMessage(position, new Map());

  it("passes everything when no filter is set", () => {
    expect(matchesMessageFilter(msg, undefined)).toBe(true);
  });

  it("matches by message name or numeric ID", () => {
    expect(matchesMessageFilter(msg, ["PositionReport"])).toBe(true);
    expect(matchesMessageFilter(msg, [1])).toBe(true);
    expect(matchesMessageFilter(msg, ["ShipStaticData"])).toBe(false);
  });
});

describe("createDeduper", () => {
  it("delivers the same transmission once within the TTL", () => {
    let t = 0;
    const isFirstSeen = createDeduper(60000, () => t);
    const local = toAISStreamMessage(position, new Map());
    const fromAISStream = {
      ...local,
      MetaData: { ...local.MetaData, time_utc: "2026-10-25 21:17:12.5 +0000 UTC" },
    };

    expect(isFirstSeen(local)).toBe(true);
    expect(isFirstSeen(fromAISStream)).toBe(false);

    t = 60001;
    expect(isFirstSeen(local)).toBe(true);
  });

  it("treats a new report from the same vessel as distinct", () => {
    const isFirstSeen = createDeduper();
    const first = toAISStreamMessage(position, new Map());
    const next = toAISStreamMessage({ ...position, second: 21, lat: 42.9975 }, new Map());

    expect(isFirstSeen(first)).toBe(true);
    expect(isFirstSeen(next)).toBe(true);
  });
});

describe("createLocalReceiver", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), log: vi.fn(), error: vi.fn() };

  it("reports the link and every message as activity", async () => {
    const server = net.createServer((socket) => {
      socket.write(JSON.stringify({ type: 21, mmsi: 1 }) + "\n");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const receiver = createLocalReceiver({ host: "127.0.0.1", port: server.address().port, logger });
    const links = [];
    receiver.on("link", (...args) => links.push(args));

    await new Promise((resolve) => receiver.once("activity", resolve));
    expect(links).toEqual([["connecting"], ["up"]]);

    receiver.stop();
    await new Promise((resolve) => server.close(resolve));
  });

  it("reports the link down when AIS-catcher is not running", async () => {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));

    const receiver = createLocalReceiver({ host: "127.0.0.1", port, logger });
    const down = await new Promise((resolve) =>
      receiver.on("link", (link, detail) => link === "down" && resolve(detail))
    );
    expect(down).toMatch(/^AIS-catcher unavailable \(.*ECONNREFUSED/);
    receiver.stop();
  });
});
