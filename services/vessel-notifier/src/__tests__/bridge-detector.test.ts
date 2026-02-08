import { describe, it, expect, beforeEach } from "vitest";
import { BridgeDetector } from "../bridge-detector.js";
import { BRIDGE_CENTER } from "../geo.js";
import type { AISMessage } from "../types.js";

function makePositionMessage(
  mmsi: number,
  lat: number,
  lon: number,
  cog: number = 180,
  sog: number = 8,
  name: string = "TEST VESSEL"
): AISMessage {
  return {
    MessageType: "PositionReport",
    MetaData: {
      MMSI: mmsi,
      MMSI_String: mmsi.toString(),
      ShipName: name,
      latitude: lat,
      longitude: lon,
      time_utc: new Date().toISOString(),
    },
    Message: {
      PositionReport: {
        Cog: cog,
        Latitude: lat,
        Longitude: lon,
        NavigationalStatus: 0,
        Sog: sog,
        TrueHeading: cog,
        UserID: mmsi,
      },
    },
  };
}

function makeStaticDataMessage(
  mmsi: number,
  name: string,
  destination: string = "PORT HURON",
  type: number = 70
): AISMessage {
  return {
    MessageType: "ShipStaticData",
    MetaData: {
      MMSI: mmsi,
      MMSI_String: mmsi.toString(),
      ShipName: name,
      latitude: 43.0,
      longitude: -82.42,
      time_utc: new Date().toISOString(),
    },
    Message: {
      ShipStaticData: {
        CallSign: "TEST",
        Destination: destination,
        Dimension: { A: 100, B: 50, C: 10, D: 10 },
        ImoNumber: 1234567,
        Name: name,
        Type: type,
        UserID: mmsi,
      },
    },
  };
}

describe("BridgeDetector", () => {
  let detector: BridgeDetector;

  beforeEach(() => {
    detector = new BridgeDetector({
      thresholdNM: 0.5,
      cooldownMs: 30 * 60 * 1000,
      staleTimeoutMs: 15 * 60 * 1000,
    });
  });

  describe("processMessage", () => {
    it("tracks a vessel from a position report", () => {
      const msg = makePositionMessage(123456789, 43.05, -82.42);
      detector.processMessage(msg);
      expect(detector.trackedCount).toBe(1);
    });

    it("returns null when vessel is far from bridge", () => {
      const msg = makePositionMessage(123456789, 43.5, -82.42);
      const event = detector.processMessage(msg);
      expect(event).toBeNull();
    });

    it("detects bridge crossing when distance transitions below threshold", () => {
      const mmsi = 123456789;

      // First position: far from bridge (> 0.5 NM)
      const far = makePositionMessage(mmsi, 43.02, -82.42, 180, 8);
      detector.processMessage(far);

      // Second position: at the bridge (< 0.5 NM)
      const close = makePositionMessage(
        mmsi,
        BRIDGE_CENTER.lat,
        BRIDGE_CENTER.lng,
        180,
        8
      );
      const event = detector.processMessage(close);

      expect(event).not.toBeNull();
      expect(event!.mmsi).toBe(mmsi);
      expect(event!.name).toBe("TEST VESSEL");
      expect(event!.speed).toBe(8);
      expect(event!.direction).toBe("southbound");
    });

    it("does not fire for stationary vessels", () => {
      const mmsi = 123456789;

      const far = makePositionMessage(mmsi, 43.02, -82.42, 180, 0);
      detector.processMessage(far);

      const close = makePositionMessage(
        mmsi,
        BRIDGE_CENTER.lat,
        BRIDGE_CENTER.lng,
        180,
        0 // not moving
      );
      const event = detector.processMessage(close);
      expect(event).toBeNull();
    });

    it("respects notification cooldown", () => {
      const mmsi = 123456789;

      // First crossing
      detector.processMessage(makePositionMessage(mmsi, 43.02, -82.42));
      const event1 = detector.processMessage(
        makePositionMessage(mmsi, BRIDGE_CENTER.lat, BRIDGE_CENTER.lng)
      );
      expect(event1).not.toBeNull();

      // Move away and come back within cooldown period
      detector.processMessage(makePositionMessage(mmsi, 43.02, -82.42));
      const event2 = detector.processMessage(
        makePositionMessage(mmsi, BRIDGE_CENTER.lat, BRIDGE_CENTER.lng)
      );
      expect(event2).toBeNull(); // Should be on cooldown
    });

    it("allows notification after cooldown expires", async () => {
      const mmsi = 123456789;

      // Use a very short cooldown
      detector = new BridgeDetector({
        thresholdNM: 0.5,
        cooldownMs: 50, // 50ms cooldown
        staleTimeoutMs: 15 * 60 * 1000,
      });

      // First crossing
      detector.processMessage(makePositionMessage(mmsi, 43.02, -82.42));
      detector.processMessage(
        makePositionMessage(mmsi, BRIDGE_CENTER.lat, BRIDGE_CENTER.lng)
      );

      // Move away
      detector.processMessage(makePositionMessage(mmsi, 43.02, -82.42));

      // Wait for cooldown to pass
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Come back - should fire after cooldown
      const event = detector.processMessage(
        makePositionMessage(mmsi, BRIDGE_CENTER.lat, BRIDGE_CENTER.lng)
      );
      expect(event).not.toBeNull();
    });

    it("ignores invalid positions (0,0)", () => {
      const msg = makePositionMessage(123456789, 0, 0);
      const event = detector.processMessage(msg);
      expect(event).toBeNull();
      expect(detector.trackedCount).toBe(0);
    });

    it("ignores out-of-range positions", () => {
      const msg = makePositionMessage(123456789, 100, 200);
      const event = detector.processMessage(msg);
      expect(event).toBeNull();
      expect(detector.trackedCount).toBe(0);
    });

    it("enriches vessel with static data", () => {
      const mmsi = 123456789;

      // Position first
      detector.processMessage(makePositionMessage(mmsi, 43.02, -82.42));

      // Then static data
      detector.processMessage(
        makeStaticDataMessage(mmsi, "BIG FREIGHTER", "DULUTH", 70)
      );

      const vessel = detector.getVessel(mmsi);
      expect(vessel).toBeDefined();
      expect(vessel!.name).toBe("BIG FREIGHTER");
      expect(vessel!.destination).toBe("DULUTH");
      expect(vessel!.shipType).toBe(70);
      expect(vessel!.length).toBe(150); // A + B = 100 + 50
    });

    it("includes static data in crossing event", () => {
      const mmsi = 123456789;

      // Position far away
      detector.processMessage(
        makePositionMessage(mmsi, 43.02, -82.42, 180, 8, "UNKNOWN")
      );

      // Add static data
      detector.processMessage(
        makeStaticDataMessage(mmsi, "LAKE FREIGHTER", "DETROIT", 70)
      );

      // Position at bridge
      const event = detector.processMessage(
        makePositionMessage(
          mmsi,
          BRIDGE_CENTER.lat,
          BRIDGE_CENTER.lng,
          180,
          8
        )
      );

      expect(event).not.toBeNull();
      expect(event!.name).toBe("LAKE FREIGHTER");
      expect(event!.destination).toBe("DETROIT");
      expect(event!.shipType).toBe(70);
      expect(event!.length).toBe(150);
    });

    it("tracks multiple vessels independently", () => {
      detector.processMessage(makePositionMessage(111111111, 43.02, -82.42));
      detector.processMessage(makePositionMessage(222222222, 43.05, -82.42));
      expect(detector.trackedCount).toBe(2);

      // Only vessel 1 crosses
      const event = detector.processMessage(
        makePositionMessage(111111111, BRIDGE_CENTER.lat, BRIDGE_CENTER.lng)
      );
      expect(event).not.toBeNull();
      expect(event!.mmsi).toBe(111111111);
    });

    it("uses name from metadata when no static data", () => {
      const msg = makePositionMessage(
        123456789,
        43.02,
        -82.42,
        180,
        8,
        "  METADATA NAME  "
      );
      detector.processMessage(msg);
      const vessel = detector.getVessel(123456789);
      expect(vessel!.name).toBe("METADATA NAME");
    });

    it("falls back to MMSI when name is empty", () => {
      const msg = makePositionMessage(123456789, 43.02, -82.42, 180, 8, "");
      detector.processMessage(msg);
      const vessel = detector.getVessel(123456789);
      expect(vessel!.name).toBe("MMSI 123456789");
    });

    it("detects northbound crossing", () => {
      const mmsi = 123456789;

      // South of bridge
      detector.processMessage(makePositionMessage(mmsi, 42.98, -82.42, 0, 8));

      // At bridge
      const event = detector.processMessage(
        makePositionMessage(
          mmsi,
          BRIDGE_CENTER.lat,
          BRIDGE_CENTER.lng,
          0,
          8
        )
      );

      expect(event).not.toBeNull();
      expect(event!.direction).toBe("northbound");
    });

    it("ignores static data for unknown vessels", () => {
      // Static data without prior position - should not crash
      detector.processMessage(
        makeStaticDataMessage(999999999, "UNKNOWN SHIP")
      );
      expect(detector.trackedCount).toBe(0);
    });
  });

  describe("cleanupStale", () => {
    it("removes vessels not updated within timeout", () => {
      detector = new BridgeDetector({
        thresholdNM: 0.5,
        cooldownMs: 30 * 60 * 1000,
        staleTimeoutMs: 100, // 100ms timeout for testing
      });

      detector.processMessage(makePositionMessage(123456789, 43.02, -82.42));
      expect(detector.trackedCount).toBe(1);

      // Wait for stale timeout
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const removed = detector.cleanupStale();
          expect(removed).toBe(1);
          expect(detector.trackedCount).toBe(0);
          resolve();
        }, 150);
      });
    });

    it("keeps recently updated vessels", () => {
      detector.processMessage(makePositionMessage(123456789, 43.02, -82.42));
      const removed = detector.cleanupStale();
      expect(removed).toBe(0);
      expect(detector.trackedCount).toBe(1);
    });

    it("cleans up expired notification cooldowns", () => {
      detector = new BridgeDetector({
        thresholdNM: 0.5,
        cooldownMs: 100, // 100ms cooldown for testing
        staleTimeoutMs: 15 * 60 * 1000,
      });

      // Trigger a notification
      detector.processMessage(makePositionMessage(123456789, 43.02, -82.42));
      detector.processMessage(
        makePositionMessage(
          123456789,
          BRIDGE_CENTER.lat,
          BRIDGE_CENTER.lng
        )
      );
      expect(detector.cooldownCount).toBe(1);

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          detector.cleanupStale();
          expect(detector.cooldownCount).toBe(0);
          resolve();
        }, 150);
      });
    });
  });
});
