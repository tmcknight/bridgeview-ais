import { describe, it, expect } from "vitest";
import {
  haversineDistanceNM,
  distanceToBridge,
  getDirection,
  BRIDGE_CENTER,
} from "../geo.js";

describe("geo utilities", () => {
  describe("haversineDistanceNM", () => {
    it("returns 0 for same coordinates", () => {
      expect(haversineDistanceNM(42.0, -82.0, 42.0, -82.0)).toBe(0);
    });

    it("calculates distance between two known points", () => {
      // Port Huron to Detroit is roughly 55 NM
      const distance = haversineDistanceNM(42.97, -82.42, 42.33, -83.05);
      expect(distance).toBeGreaterThan(35);
      expect(distance).toBeLessThan(50);
    });

    it("is symmetric", () => {
      const d1 = haversineDistanceNM(42.0, -82.0, 43.0, -83.0);
      const d2 = haversineDistanceNM(43.0, -83.0, 42.0, -82.0);
      expect(d1).toBeCloseTo(d2, 10);
    });

    it("handles small distances correctly", () => {
      // ~0.01 degrees apart, should be a very small distance
      const distance = haversineDistanceNM(42.998, -82.423, 42.999, -82.424);
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThan(0.1);
    });
  });

  describe("distanceToBridge", () => {
    it("returns 0 for bridge center coordinates", () => {
      const distance = distanceToBridge(BRIDGE_CENTER.lat, BRIDGE_CENTER.lng);
      expect(distance).toBeCloseTo(0, 5);
    });

    it("returns small distance for nearby point", () => {
      const distance = distanceToBridge(43.0, -82.42);
      expect(distance).toBeLessThan(1);
    });

    it("returns larger distance for far point", () => {
      const distance = distanceToBridge(42.5, -82.0);
      expect(distance).toBeGreaterThan(10);
    });
  });

  describe("getDirection", () => {
    it("returns northbound for COG ~0", () => {
      expect(getDirection(0, 42.9)).toBe("northbound");
    });

    it("returns northbound for COG ~350", () => {
      expect(getDirection(350, 42.9)).toBe("northbound");
    });

    it("returns southbound for COG ~180", () => {
      expect(getDirection(180, 43.1)).toBe("southbound");
    });

    it("returns southbound for COG ~200", () => {
      expect(getDirection(200, 43.1)).toBe("southbound");
    });

    it("uses position when course is ambiguous (eastbound, north of bridge)", () => {
      expect(getDirection(90, 43.1)).toBe("southbound");
    });

    it("uses position when course is ambiguous (westbound, south of bridge)", () => {
      expect(getDirection(270, 42.9)).toBe("northbound");
    });

    it("handles COG values > 360", () => {
      expect(getDirection(370, 42.9)).toBe("northbound");
    });

    it("handles negative COG values", () => {
      expect(getDirection(-10, 42.9)).toBe("northbound");
    });
  });
});
