import { describe, it, expect } from "vitest";
import { aircraftLabel, formatAltitude, isRotorcraft, parseAircraftMessage, verticalTrend } from "./aircraft";

describe("parseAircraftMessage", () => {
  it("returns the aircraft in an aircraft message", () => {
    const aircraft = [{ hex: "abc123", lat: 43, lon: -82 }];
    expect(parseAircraftMessage({ type: "aircraft", aircraft })).toBe(aircraft);
  });

  it("returns null for other messages", () => {
    expect(parseAircraftMessage({ type: "feedStatus", feeds: [] })).toBeNull();
    expect(parseAircraftMessage({ type: "aircraft" })).toBeNull();
    expect(parseAircraftMessage(null)).toBeNull();
  });
});

describe("aircraftLabel", () => {
  it("prefers the callsign, then the registration, then the ICAO address", () => {
    expect(aircraftLabel({ hex: "abc123", lat: 0, lon: 0, callsign: "DAL123", registration: "N1" })).toBe("DAL123");
    expect(aircraftLabel({ hex: "abc123", lat: 0, lon: 0, registration: "N1" })).toBe("N1");
    expect(aircraftLabel({ hex: "abc123", lat: 0, lon: 0 })).toBe("ABC123");
  });
});

describe("formatAltitude", () => {
  it("formats altitude in feet, or on the ground", () => {
    expect(formatAltitude({ hex: "a", lat: 0, lon: 0, altitude: 32000 })).toBe("32,000 ft");
    expect(formatAltitude({ hex: "a", lat: 0, lon: 0, onGround: true })).toBe("On ground");
    expect(formatAltitude({ hex: "a", lat: 0, lon: 0 })).toBeNull();
  });
});

describe("isRotorcraft", () => {
  it("is true only for emitter category A7", () => {
    expect(isRotorcraft({ hex: "a", lat: 0, lon: 0, category: "A7" })).toBe(true);
    expect(isRotorcraft({ hex: "a", lat: 0, lon: 0, category: "A3" })).toBe(false);
    expect(isRotorcraft({ hex: "a", lat: 0, lon: 0 })).toBe(false);
  });
});

describe("verticalTrend", () => {
  it("shows an arrow only for a real climb or descent", () => {
    expect(verticalTrend({ hex: "a", lat: 0, lon: 0, verticalRate: 1200 })).toBe("↑");
    expect(verticalTrend({ hex: "a", lat: 0, lon: 0, verticalRate: -800 })).toBe("↓");
    expect(verticalTrend({ hex: "a", lat: 0, lon: 0, verticalRate: 64 })).toBe("");
    expect(verticalTrend({ hex: "a", lat: 0, lon: 0 })).toBe("");
  });
});
