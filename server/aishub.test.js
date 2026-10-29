import { describe, it, expect, vi, afterEach } from "vitest";
import {
  aishubUrl,
  createAishubFeed,
  decodeEta,
  enclosingBox,
  parseAishubResponse,
  toAISStreamMessages,
} from "./aishub.js";
import { dedupKey } from "./local-receiver.js";

// A format 0 record near the bridge, at 2026-10-29T12:00:00Z
const TIME = 1_793_275_200;
const RECORD = {
  MMSI: 316001234,
  TIME: String(TIME),
  LATITUDE: Math.round(42.9982 * 600_000),
  LONGITUDE: Math.round(-82.423 * 600_000),
  COG: 1805,
  SOG: 112,
  HEADING: 181,
  ROT: 252,
  NAVSTAT: 0,
  IMO: 9123456,
  NAME: "ALGOMA EQUINOX ",
  CALLSIGN: "CFK1234",
  TYPE: 70,
  A: 200,
  B: 25,
  C: 12,
  D: 12,
  DRAUGHT: 82,
  DEST: "THUNDER BAY",
  // October 31, 14:30
  ETA: (10 << 16) | (31 << 11) | (14 << 6) | 30,
};

describe("decodeEta", () => {
  it("unpacks AIS's month, day, hour and minute", () => {
    expect(decodeEta(RECORD.ETA)).toEqual({ Month: 10, Day: 31, Hour: 14, Minute: 30 });
    expect(decodeEta(1596)).toEqual({ Month: 0, Day: 0, Hour: 24, Minute: 60 });
  });
});

describe("aishubUrl", () => {
  it("asks for the area's recent ships in AIS encoding as JSON", () => {
    const url = new URL(aishubUrl("me", [[44, -81], [42, -83]], "https://aishub.test/ws.php"));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      username: "me",
      format: "0",
      output: "json",
      compress: "0",
      latmin: "42",
      latmax: "44",
      lonmin: "-83",
      lonmax: "-81",
      interval: "10",
    });
  });
});

describe("enclosingBox", () => {
  it("covers every box", () => {
    expect(enclosingBox([[[42, -83], [43, -82]], [[44, -81.5], [43.5, -84]]])).toEqual([[42, -84], [44, -81.5]]);
    expect(enclosingBox([])).toBeNull();
  });
});

describe("parseAishubResponse", () => {
  it("returns the records", () => {
    expect(parseAishubResponse([{ ERROR: false, RECORDS: 1 }, [RECORD]])).toEqual([RECORD]);
    expect(parseAishubResponse([{ ERROR: false, RECORDS: 0 }])).toEqual([]);
  });

  it("throws AISHub's error", () => {
    expect(() => parseAishubResponse([{ ERROR: true, ERROR_MESSAGE: "Too frequent requests!" }])).toThrow(
      "Too frequent requests!"
    );
    expect(() => parseAishubResponse({})).toThrow("unexpected response");
  });
});

describe("toAISStreamMessages", () => {
  it("converts a record to a position report and ship details", () => {
    const { position, details } = toAISStreamMessages(RECORD);
    expect(position.MessageType).toBe("PositionReport");
    expect(position.MetaData).toEqual({
      MMSI: 316001234,
      MMSI_String: "316001234",
      ShipName: "ALGOMA EQUINOX",
      latitude: expect.closeTo(42.9982, 6),
      longitude: expect.closeTo(-82.423, 6),
      time_utc: "2026-10-29T12:00:00.000Z",
      Source: "aishub",
    });
    expect(position.Message.PositionReport).toMatchObject({
      Cog: 180.5,
      Sog: 11.2,
      TrueHeading: 181,
      RateOfTurn: -4,
      NavigationalStatus: 0,
      MessageID: 1,
      Timestamp: 0,
    });
    expect(details.MessageType).toBe("ShipStaticData");
    expect(details.Message.ShipStaticData).toMatchObject({
      Name: "ALGOMA EQUINOX",
      CallSign: "CFK1234",
      Destination: "THUNDER BAY",
      Draught: 8.2,
      ImoNumber: 9123456,
      Type: 70,
      Dimension: { A: 200, B: 25, C: 12, D: 12 },
      Eta: { Month: 10, Day: 31, Hour: 14, Minute: 30 },
    });
  });

  it("keeps a Class B ship's class", () => {
    const { position, details } = toAISStreamMessages(RECORD, { classB: true });
    expect(position.MetaData.AisClass).toBe("B");
    expect(position.Message.PositionReport.MessageID).toBe(18);
    expect(details.MetaData.AisClass).toBe("B");
  });

  it("leaves out a missing position and a missing name", () => {
    expect(toAISStreamMessages({ ...RECORD, LATITUDE: 0, LONGITUDE: 0 }).position).toBeNull();
    expect(toAISStreamMessages({ ...RECORD, NAME: "" }).details).toBeNull();
    expect(toAISStreamMessages({ NAME: "X" })).toEqual({ position: null, details: null });
  });

  it("matches the same report from another feed for deduplication", () => {
    const { position } = toAISStreamMessages(RECORD);
    const sameReport = {
      MetaData: { MMSI: 316001234 },
      Message: {
        PositionReport: {
          Latitude: RECORD.LATITUDE / 600_000,
          Longitude: RECORD.LONGITUDE / 600_000,
          Sog: 11.2,
          Cog: 180.5,
          Timestamp: 0,
        },
      },
    };
    expect(dedupKey(position)).toBe(dedupKey(sameReport));
  });
});

describe("createAishubFeed", () => {
  let feed;
  afterEach(() => {
    feed?.stop();
    vi.useRealTimers();
  });

  const BOX = [[42, -83], [44, -81]];
  const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });
  const records = (...list) => response([{ ERROR: false, RECORDS: list.length }, list]);

  it("polls the area, emitting details then position, and the link going up", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(records(RECORD));
    feed = createAishubFeed({ username: "me", area: () => BOX, fetch, pollIntervalMs: 60_000 });
    const onMessage = vi.fn();
    const onLink = vi.fn();
    const onActivity = vi.fn();
    feed.on("message", onMessage);
    feed.on("link", onLink);
    feed.on("activity", onActivity);

    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch.mock.calls[0][0]).toContain("latmin=42");
    expect(onMessage.mock.calls.map(([m]) => m.MessageType)).toEqual(["ShipStaticData", "PositionReport"]);
    expect(onLink).toHaveBeenCalledWith("up");
    expect(onActivity).toHaveBeenCalledTimes(1);

    // The same report and details again send nothing new
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onMessage).toHaveBeenCalledTimes(2);
  });

  it("sends a newer report and changed details", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(records(RECORD))
      .mockResolvedValue(records({ ...RECORD, TIME: String(TIME + 60), DEST: "DULUTH" }));
    feed = createAishubFeed({ username: "me", area: () => BOX, fetch, pollIntervalMs: 60_000 });
    const onMessage = vi.fn();
    feed.on("message", onMessage);

    feed.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onMessage).toHaveBeenCalledTimes(4);
    expect(onMessage.mock.calls[2][0].Message.ShipStaticData.Destination).toBe("DULUTH");
  });

  it("drops a report another feed has already beaten", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(records(RECORD));
    const latest = () => ({
      message: { MetaData: { Source: "local", AisClass: "B" } },
      receivedAt: TIME * 1000 + 5_000,
    });
    feed = createAishubFeed({ username: "me", area: () => BOX, latest, fetch });
    const onMessage = vi.fn();
    feed.on("message", onMessage);

    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    // Details still go out, marked Class B as the other feed heard it
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0]).toMatchObject({ MessageType: "ShipStaticData", MetaData: { AisClass: "B" } });
  });

  it("reports AISHub's errors and backs off", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response([{ ERROR: true, ERROR_MESSAGE: "Too frequent requests!" }]))
      .mockResolvedValue(records());
    feed = createAishubFeed({ username: "me", area: () => BOX, fetch, pollIntervalMs: 1000, logger: { warn: () => {} } });
    const onLink = vi.fn();
    const onActivity = vi.fn();
    feed.on("link", onLink);
    feed.on("activity", onActivity);

    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onLink).toHaveBeenLastCalledWith("down", "Too frequent requests!");
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    // Up again, but no ships is no activity
    expect(onLink).toHaveBeenLastCalledWith("up");
    expect(onActivity).not.toHaveBeenCalled();
  });
});
