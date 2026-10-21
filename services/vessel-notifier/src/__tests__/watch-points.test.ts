import { describe, it, expect } from "vitest";
import { parseWatchPoints, MAX_WATCH_POINTS } from "../watch-points.js";

describe("parseWatchPoints", () => {
  it("parses points and derives ids from names", () => {
    const points = parseWatchPoints(
      JSON.stringify([
        { name: "Blue Water Bridge", lat: 42.9982, lon: -82.423, radiusNM: 0.5 },
        { name: "Sarnia Dock", lat: 42.96, lon: -82.41 },
      ]),
      0.75
    );

    expect(points).toEqual([
      {
        id: "blue-water-bridge",
        name: "Blue Water Bridge",
        latitude: 42.9982,
        longitude: -82.423,
        radiusNM: 0.5,
      },
      {
        id: "sarnia-dock",
        name: "Sarnia Dock",
        latitude: 42.96,
        longitude: -82.41,
        radiusNM: 0.75,
      },
    ]);
  });

  it("uses an explicit id when given", () => {
    const [point] = parseWatchPoints(
      JSON.stringify([{ id: "bwb", name: "Bridge", lat: 43, lon: -82 }]),
      0.5
    );
    expect(point.id).toBe("bwb");
  });

  it("rejects invalid JSON", () => {
    expect(() => parseWatchPoints("not json", 0.5)).toThrow(/valid JSON/);
  });

  it("rejects an empty array", () => {
    expect(() => parseWatchPoints("[]", 0.5)).toThrow(/non-empty/);
  });

  it("rejects too many points", () => {
    const points = Array.from({ length: MAX_WATCH_POINTS + 1 }, (_, i) => ({
      name: `P${i}`,
      lat: 43,
      lon: -82,
    }));
    expect(() => parseWatchPoints(JSON.stringify(points), 0.5)).toThrow(/at most/);
  });

  it("rejects missing name", () => {
    expect(() => parseWatchPoints(JSON.stringify([{ lat: 43, lon: -82 }]), 0.5)).toThrow(
      /name is required/
    );
  });

  it("rejects out-of-range coordinates", () => {
    expect(() =>
      parseWatchPoints(JSON.stringify([{ name: "X", lat: 91, lon: -82 }]), 0.5)
    ).toThrow(/lat/);
    expect(() =>
      parseWatchPoints(JSON.stringify([{ name: "X", lat: 43, lon: "-82" }]), 0.5)
    ).toThrow(/lon/);
  });

  it("rejects non-positive radius", () => {
    expect(() =>
      parseWatchPoints(JSON.stringify([{ name: "X", lat: 43, lon: -82, radiusNM: 0 }]), 0.5)
    ).toThrow(/radiusNM/);
  });

  it("rejects duplicate ids", () => {
    expect(() =>
      parseWatchPoints(
        JSON.stringify([
          { name: "Dock", lat: 43, lon: -82 },
          { name: "dock", lat: 42, lon: -82 },
        ]),
        0.5
      )
    ).toThrow(/duplicate/);
  });
});
