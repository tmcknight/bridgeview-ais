import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WatchPointDetector, BLUE_WATER_BRIDGE } from "../watch-point-detector.js";
import { BRIDGE_CENTER } from "../geo.js";
import type { AISMessage, PassageEvent } from "../types.js";

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

describe("WatchPointDetector", () => {
  let detector: WatchPointDetector;

  beforeEach(() => {
    detector = new WatchPointDetector({
      watchPoints: [BLUE_WATER_BRIDGE],
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
      const [event] = detector.processMessage(msg);
      expect(event).toBeUndefined();
    });

    it("detects a passage when the vessel reaches the bridge", () => {
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
      const [event] = detector.processMessage(close);

      expect(event).toBeDefined();
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
      const [event] = detector.processMessage(close);
      expect(event).toBeUndefined();
    });

    it("respects notification cooldown", () => {
      const mmsi = 123456789;

      // First crossing
      detector.processMessage(makePositionMessage(mmsi, 43.02, -82.42));
      const [event1] = detector.processMessage(
        makePositionMessage(mmsi, BRIDGE_CENTER.lat, BRIDGE_CENTER.lng)
      );
      expect(event1).toBeDefined();

      // Move away and come back within cooldown period
      detector.processMessage(makePositionMessage(mmsi, 43.02, -82.42));
      const [event2] = detector.processMessage(
        makePositionMessage(mmsi, BRIDGE_CENTER.lat, BRIDGE_CENTER.lng)
      );
      expect(event2).toBeUndefined(); // Should be on cooldown
    });

    it("allows notification after cooldown expires", async () => {
      const mmsi = 123456789;

      // Use a very short cooldown
      detector = new WatchPointDetector({
        watchPoints: [BLUE_WATER_BRIDGE],
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
      const [event] = detector.processMessage(
        makePositionMessage(mmsi, BRIDGE_CENTER.lat, BRIDGE_CENTER.lng)
      );
      expect(event).toBeDefined();
    });

    it("ignores invalid positions (0,0)", () => {
      const msg = makePositionMessage(123456789, 0, 0);
      const [event] = detector.processMessage(msg);
      expect(event).toBeUndefined();
      expect(detector.trackedCount).toBe(0);
    });

    it("ignores out-of-range positions", () => {
      const msg = makePositionMessage(123456789, 100, 200);
      const [event] = detector.processMessage(msg);
      expect(event).toBeUndefined();
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
      const [event] = detector.processMessage(
        makePositionMessage(
          mmsi,
          BRIDGE_CENTER.lat,
          BRIDGE_CENTER.lng,
          180,
          8
        )
      );

      expect(event).toBeDefined();
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
      const [event] = detector.processMessage(
        makePositionMessage(111111111, BRIDGE_CENTER.lat, BRIDGE_CENTER.lng)
      );
      expect(event).toBeDefined();
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
      const [event] = detector.processMessage(
        makePositionMessage(
          mmsi,
          BRIDGE_CENTER.lat,
          BRIDGE_CENTER.lng,
          0,
          8
        )
      );

      expect(event).toBeDefined();
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

  describe("multiple watch points", () => {
    const SARNIA_DOCK = {
      id: "sarnia-dock",
      name: "Sarnia Dock",
      latitude: 42.96,
      longitude: -82.41,
      radiusNM: 0.5,
    };

    beforeEach(() => {
      detector = new WatchPointDetector({
        watchPoints: [BLUE_WATER_BRIDGE, SARNIA_DOCK],
        cooldownMs: 30 * 60 * 1000,
        staleTimeoutMs: 15 * 60 * 1000,
      });
    });

    it("fires for each point a vessel passes, tagged with that point", () => {
      const mmsi = 123456789;
      detector.processMessage(makePositionMessage(mmsi, 43.02, -82.42));

      const atBridge = detector.processMessage(
        makePositionMessage(mmsi, BRIDGE_CENTER.lat, BRIDGE_CENTER.lng)
      );
      expect(atBridge).toHaveLength(1);
      expect(atBridge[0].watchPoint.id).toBe("blue-water-bridge");

      const atDock = detector.processMessage(
        makePositionMessage(mmsi, SARNIA_DOCK.latitude, SARNIA_DOCK.longitude)
      );
      expect(atDock).toHaveLength(1);
      expect(atDock[0].watchPoint.id).toBe("sarnia-dock");
    });

    it("tracks cooldown per watch point", () => {
      const mmsi = 123456789;
      detector.processMessage(makePositionMessage(mmsi, 43.02, -82.42));
      detector.processMessage(
        makePositionMessage(mmsi, BRIDGE_CENTER.lat, BRIDGE_CENTER.lng)
      );
      detector.processMessage(
        makePositionMessage(mmsi, SARNIA_DOCK.latitude, SARNIA_DOCK.longitude)
      );
      expect(detector.cooldownCount).toBe(2);
    });

    it("uses the watch point radius for how close the track must pass", () => {
      // Track runs ~0.8 NM east of the bridge
      const east = BRIDGE_CENTER.lng + 0.018;
      const pass = (d: WatchPointDetector) => {
        d.processMessage(makePositionMessage(123456789, 43.0, east));
        return d.processMessage(makePositionMessage(123456789, 42.996, east));
      };

      expect(pass(new WatchPointDetector({ watchPoints: [BLUE_WATER_BRIDGE] }))).toEqual([]);

      const [event] = pass(
        new WatchPointDetector({ watchPoints: [{ ...BLUE_WATER_BRIDGE, radiusNM: 1 }] })
      );
      expect(event).toBeDefined();
      expect(event.closestApproach).toBeGreaterThan(0.7);
      expect(event.closestApproach).toBeLessThan(0.9);
    });
  });

  describe("passage timing", () => {
    it("does not fire while the vessel is still approaching inside the radius", () => {
      const mmsi = 123456789;
      detector.processMessage(makePositionMessage(mmsi, 43.02, -82.423));
      // ~0.35 NM north, heading south: near, but not yet abeam
      expect(detector.processMessage(makePositionMessage(mmsi, 43.004, -82.423))).toEqual([]);
      expect(detector.processMessage(makePositionMessage(mmsi, 43.001, -82.423))).toEqual([]);
    });

    it("fires on the first report after the vessel comes abeam", () => {
      const mmsi = 123456789;
      detector.processMessage(makePositionMessage(mmsi, 43.02, -82.423));
      detector.processMessage(makePositionMessage(mmsi, 43.0, -82.423));

      // Just south of the bridge, track passed ~0.03 NM west of it
      const [event] = detector.processMessage(
        makePositionMessage(mmsi, 42.997, -82.4237)
      );
      expect(event).toBeDefined();
      expect(event.closestApproach).toBeLessThan(0.05);
      expect(event.distance).toBeLessThan(0.1);
      expect(event.direction).toBe("southbound");
    });

    it("fires only once per passage", () => {
      const mmsi = 123456789;
      detector.processMessage(makePositionMessage(mmsi, 43.002, -82.423));
      expect(detector.processMessage(makePositionMessage(mmsi, 42.997, -82.423))).toHaveLength(1);
      expect(detector.processMessage(makePositionMessage(mmsi, 42.99, -82.423))).toEqual([]);
    });

    it("skips a passage seen only after a long reporting gap", () => {
      const mmsi = 123456789;
      // Last report 1.3 NM north, next one 1.1 NM south: passed, but stale
      detector.processMessage(makePositionMessage(mmsi, 43.02, -82.423));
      expect(detector.processMessage(makePositionMessage(mmsi, 42.98, -82.423))).toEqual([]);
    });

    it("does not fire on the first report for a vessel", () => {
      const msg = makePositionMessage(123456789, BRIDGE_CENTER.lat, BRIDGE_CENTER.lng);
      expect(detector.processMessage(msg)).toEqual([]);
    });
  });

  describe("predicted passages", () => {
    let predicted: PassageEvent[];

    beforeEach(() => {
      vi.useFakeTimers();
      predicted = [];
      detector = new WatchPointDetector({
        watchPoints: [BLUE_WATER_BRIDGE],
        onPredictedPassage: (event) => predicted.push(event),
      });
    });

    afterEach(() => {
      detector.dispose();
      vi.useRealTimers();
    });

    // 0.1 NM north of the bridge, heading due south at 6 kn: abeam in 60 s
    const approaching = (sog = 6, cog = 180) =>
      makePositionMessage(123456789, BRIDGE_CENTER.lat + 0.1 / 60, BRIDGE_CENTER.lng, cog, sog);

    it("fires at the predicted moment the vessel is abeam", () => {
      expect(detector.processMessage(approaching())).toEqual([]);
      expect(detector.pendingPredictionCount).toBe(1);

      vi.advanceTimersByTime(59_000);
      expect(predicted).toHaveLength(0);

      vi.advanceTimersByTime(1_000);
      expect(predicted).toHaveLength(1);
      expect(predicted[0].predicted).toBe(true);
      expect(predicted[0].closestApproach).toBeCloseTo(0, 3);
      expect(predicted[0].latitude).toBeCloseTo(BRIDGE_CENTER.lat, 5);
      expect(predicted[0].direction).toBe("southbound");
    });

    it("reschedules when a new report changes the speed", () => {
      detector.processMessage(approaching(6));
      vi.advanceTimersByTime(30_000);

      // Same spot (no progress), now 12 kn: abeam in 30 s from now
      detector.processMessage(approaching(12));
      vi.advanceTimersByTime(29_000);
      expect(predicted).toHaveLength(0);
      vi.advanceTimersByTime(1_000);
      expect(predicted).toHaveLength(1);
      expect(detector.pendingPredictionCount).toBe(0);
    });

    it("cancels when the vessel stops", () => {
      detector.processMessage(approaching(6));
      detector.processMessage(approaching(0));
      vi.advanceTimersByTime(10 * 60_000);
      expect(predicted).toHaveLength(0);
    });

    it("does not predict beyond the horizon", () => {
      // 1.3 NM out at 6 kn is 13 minutes away
      detector.processMessage(makePositionMessage(123456789, 43.02, BRIDGE_CENTER.lng, 180, 6));
      expect(detector.pendingPredictionCount).toBe(0);
    });

    it("does not predict when the course passes outside the radius", () => {
      // Heading due south ~1 NM east of the bridge
      const lng = BRIDGE_CENTER.lng + 1 / (60 * Math.cos((BRIDGE_CENTER.lat * Math.PI) / 180));
      detector.processMessage(makePositionMessage(123456789, BRIDGE_CENTER.lat + 0.1 / 60, lng, 180, 6));
      expect(detector.pendingPredictionCount).toBe(0);
    });

    it("does not predict when heading away", () => {
      detector.processMessage(approaching(6, 0));
      expect(detector.pendingPredictionCount).toBe(0);
    });

    it("does not predict without a course (COG 360)", () => {
      detector.processMessage(approaching(6, 360));
      expect(detector.pendingPredictionCount).toBe(0);
    });

    it("suppresses the observed passage after a predicted one", () => {
      detector.processMessage(approaching());
      vi.advanceTimersByTime(60_000);
      expect(predicted).toHaveLength(1);

      const observed = detector.processMessage(
        makePositionMessage(123456789, BRIDGE_CENTER.lat - 0.05 / 60, BRIDGE_CENTER.lng, 180, 6)
      );
      expect(observed).toEqual([]);
    });

    it("falls back to the observed passage when the prediction runs late", () => {
      // Predicted 60 s out at 6 kn, but the vessel speeds up and is past at the next report
      detector.processMessage(approaching(6));
      vi.advanceTimersByTime(20_000);
      const [observed] = detector.processMessage(
        makePositionMessage(123456789, BRIDGE_CENTER.lat - 0.05 / 60, BRIDGE_CENTER.lng, 180, 12)
      );
      expect(observed).toBeDefined();
      expect(observed.predicted).toBe(false);
      expect(detector.pendingPredictionCount).toBe(0);

      vi.advanceTimersByTime(10 * 60_000);
      expect(predicted).toHaveLength(0);
    });

    it("dispose cancels pending predictions", () => {
      detector.processMessage(approaching());
      detector.dispose();
      vi.advanceTimersByTime(10 * 60_000);
      expect(predicted).toHaveLength(0);
    });
  });

  describe("passage event details", () => {
    it("includes identity, dimensions and navigation fields", () => {
      const mmsi = 123456789;
      detector.processMessage(makePositionMessage(mmsi, 43.02, -82.42));
      detector.processMessage(makeStaticDataMessage(mmsi, "LAKE FREIGHTER"));

      const [event] = detector.processMessage(
        makePositionMessage(mmsi, BRIDGE_CENTER.lat, BRIDGE_CENTER.lng, 180, 8)
      );

      expect(event.watchPoint).toEqual(BLUE_WATER_BRIDGE);
      expect(event.imo).toBe(1234567);
      expect(event.callSign).toBe("TEST");
      expect(event.beam).toBe(20);
      expect(event.heading).toBe(180);
      expect(event.navStatus).toBe(0);
      expect(event.latitude).toBe(BRIDGE_CENTER.lat);
      expect(event.longitude).toBe(BRIDGE_CENTER.lng);
    });

    it("drops heading when AIS reports it unavailable (511)", () => {
      const mmsi = 123456789;
      detector.processMessage(makePositionMessage(mmsi, 43.02, -82.42));
      const msg = makePositionMessage(mmsi, BRIDGE_CENTER.lat, BRIDGE_CENTER.lng);
      msg.Message.PositionReport!.TrueHeading = 511;

      const [event] = detector.processMessage(msg);
      expect(event.heading).toBeUndefined();
    });
  });

  describe("cleanupStale", () => {
    it("removes vessels not updated within timeout", () => {
      detector = new WatchPointDetector({
        watchPoints: [BLUE_WATER_BRIDGE],
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
      detector = new WatchPointDetector({
        watchPoints: [BLUE_WATER_BRIDGE],
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
