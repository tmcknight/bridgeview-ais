import { describe, it, expect } from "vitest";
import {
  toAISStreamMessage,
  inBoundingBoxes,
  matchesMessageFilter,
  createDeduper,
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
