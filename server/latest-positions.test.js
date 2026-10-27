import { describe, it, expect } from "vitest";
import { createLatestPositions, POSITION_TTL_MS } from "./latest-positions.js";

const position = (mmsi, latitude = 42.99) => ({
  MessageType: "PositionReport",
  MetaData: { MMSI: mmsi, latitude, longitude: -82.42, time_utc: "2026-10-27 12:00:00" },
  Message: { PositionReport: { Latitude: latitude, Longitude: -82.42, Sog: 10, Cog: 0 } },
});

describe("createLatestPositions", () => {
  let clock = 0;
  const create = () => createLatestPositions({ now: () => clock });

  it("keeps only each ship's latest report", () => {
    const positions = create();
    positions.handleMessage(position(1, 42.9));
    positions.handleMessage(position(2));
    positions.handleMessage(position(1, 43.0));

    expect(positions.messages()).toEqual([position(2), position(1, 43.0)]);
  });

  it("ignores messages other than position reports", () => {
    const positions = create();
    positions.handleMessage({
      MessageType: "ShipStaticData",
      MetaData: { MMSI: 1 },
      Message: { ShipStaticData: { Name: "ALGOMA" } },
    });

    expect(positions.messages()).toEqual([]);
  });

  it("drops ships not heard from within the TTL", () => {
    clock = 0;
    const positions = create();
    positions.handleMessage(position(1));
    clock = 60_000;
    positions.handleMessage(position(2));

    clock = POSITION_TTL_MS + 1;
    expect(positions.messages()).toEqual([position(2)]);

    clock = POSITION_TTL_MS + 60_000;
    expect(positions.messages()).toEqual([]);
  });
});
