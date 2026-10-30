import { describe, it, expect, vi, afterEach } from "vitest";
import { createAircraftFeed, DEFAULT_ADSB_URL, isAdsbFi, parseAircraft, parseAircraftResponse, parseRetryAfter } from "./aircraft.js";

const RECORD = {
  hex: "AAB922",
  flight: "ENY3531 ",
  r: "N790MK",
  t: "E170",
  alt_baro: 32000,
  gs: 396.2,
  track: 263.92,
  baro_rate: -64,
  squawk: "7320",
  category: "A3",
  lat: 43.0017921,
  lon: -83.1867112,
  seen_pos: 0.2,
};

describe("parseAircraft", () => {
  it("keeps what the map shows", () => {
    expect(parseAircraft(RECORD)).toEqual({
      hex: "aab922",
      lat: 43.00179,
      lon: -83.18671,
      callsign: "ENY3531",
      registration: "N790MK",
      type: "E170",
      altitude: 32000,
      speed: 396,
      track: 264,
      verticalRate: -64,
      squawk: "7320",
      category: "A3",
    });
  });

  it("marks aircraft on the ground", () => {
    expect(parseAircraft({ ...RECORD, alt_baro: "ground" })).toMatchObject({ onGround: true });
    expect(parseAircraft({ ...RECORD, alt_baro: "ground" })).not.toHaveProperty("altitude");
  });

  it("strips readsb's ~ prefix from non-ICAO addresses", () => {
    expect(parseAircraft({ ...RECORD, hex: "~2a1b3c" }).hex).toBe("2a1b3c");
  });

  it("drops aircraft without a recent position", () => {
    expect(parseAircraft({ hex: "abc123" })).toBeNull();
    expect(parseAircraft({ ...RECORD, seen_pos: 120 })).toBeNull();
  });

  it("leaves out missing fields", () => {
    expect(parseAircraft({ hex: "abc123", lat: 43, lon: -82, flight: "   " })).toEqual({
      hex: "abc123",
      lat: 43,
      lon: -82,
    });
  });
});

describe("parseAircraftResponse", () => {
  it("reads adsb.lol's ac list and readsb's aircraft list", () => {
    expect(parseAircraftResponse({ ac: [RECORD] })).toHaveLength(1);
    expect(parseAircraftResponse({ aircraft: [RECORD, { hex: "nopos" }] })).toHaveLength(1);
  });

  it("rejects a response with no list", () => {
    expect(() => parseAircraftResponse({ msg: "rate limited" })).toThrow("no aircraft list");
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds and HTTP dates", () => {
    expect(parseRetryAfter("120")).toBe(120_000);
    expect(parseRetryAfter("Wed, 28 Oct 2026 20:01:00 GMT", Date.parse("Wed, 28 Oct 2026 20:00:00 GMT"))).toBe(60_000);
  });

  it("ignores a missing or unreadable header", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
    expect(parseRetryAfter("-5")).toBeNull();
  });
});

describe("createAircraftFeed", () => {
  let feed;
  afterEach(() => {
    feed?.stop();
    vi.useRealTimers();
  });

  const response = (body, ok = true, status = 200, headers = {}) => ({
    ok,
    status,
    headers: new Headers(headers),
    json: async () => body,
  });

  it("polls, emitting the aircraft and the link going up", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(response({ ac: [RECORD] }));
    feed = createAircraftFeed({ url: "http://adsb.test", fetch, pollIntervalMs: 1000 });
    const onAircraft = vi.fn();
    const onLink = vi.fn();
    feed.on("aircraft", onAircraft);
    feed.on("link", onLink);

    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onAircraft).toHaveBeenCalledWith([expect.objectContaining({ hex: "aab922" })]);
    expect(onLink).toHaveBeenCalledWith("up");
    expect(feed.aircraft()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports failures, keeping the aircraft until the feed has been down a minute", async () => {
    vi.useFakeTimers();
    let clock = 0;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ ac: [RECORD] }))
      .mockResolvedValue(response({}, false, 429));
    feed = createAircraftFeed({
      url: "http://adsb.test",
      fetch,
      pollIntervalMs: 30_000,
      now: () => clock,
      logger: { warn: () => {} },
    });
    const onAircraft = vi.fn();
    const onLink = vi.fn();
    feed.on("aircraft", onAircraft);
    feed.on("link", onLink);

    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    clock = 30_000;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onLink).toHaveBeenLastCalledWith("down", "HTTP 429");
    expect(feed.aircraft()).toHaveLength(1);

    // The failure doubles the wait, so the next poll comes a minute later
    clock = 90_000;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(feed.aircraft()).toEqual([]);
    expect(onAircraft).toHaveBeenLastCalledWith([]);
  });

  it("backs off after failures in a row and goes back to the normal interval on success", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({}, false, 429))
      .mockResolvedValueOnce(response({}, false, 429))
      .mockResolvedValue(response({ ac: [RECORD] }));
    feed = createAircraftFeed({ url: "http://adsb.test", fetch, pollIntervalMs: 1000, logger: { warn: () => {} } });

    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("waits as long as a 429's Retry-After asks", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({}, false, 429, { "Retry-After": "30" }))
      .mockResolvedValue(response({ ac: [RECORD] }));
    feed = createAircraftFeed({ url: "http://adsb.test", fetch, pollIntervalMs: 1000, logger: { warn: () => {} } });

    feed.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("isAdsbFi", () => {
  it("recognises adsb.fi's feeds, which must be credited", () => {
    expect(isAdsbFi(DEFAULT_ADSB_URL)).toBe(true);
    expect(isAdsbFi("https://adsb.fi/api")).toBe(true);
    expect(isAdsbFi("http://127.0.0.1:8080/data/aircraft.json")).toBe(false);
    expect(isAdsbFi("https://evil-adsb.fi.example.com/")).toBe(false);
    expect(isAdsbFi("not a url")).toBe(false);
  });
});
