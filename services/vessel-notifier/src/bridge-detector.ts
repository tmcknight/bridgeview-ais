import { distanceToBridge, getDirection, CLOSE_APPROACH_DISTANCE_NM } from "./geo.js";
import type { AISMessage, TrackedVessel, BridgeCrossingEvent } from "./types.js";

export interface BridgeDetectorConfig {
  /** Distance threshold in NM to trigger crossing event */
  thresholdNM: number;
  /** Cooldown in ms before re-notifying about the same vessel */
  cooldownMs: number;
  /** How long to keep stale vessels in tracker (ms) */
  staleTimeoutMs: number;
}

const DEFAULT_CONFIG: BridgeDetectorConfig = {
  thresholdNM: CLOSE_APPROACH_DISTANCE_NM,
  cooldownMs: 30 * 60 * 1000, // 30 minutes
  staleTimeoutMs: 15 * 60 * 1000, // 15 minutes
};

/**
 * Detects when vessels pass under the Blue Water Bridge by tracking
 * position updates and detecting transitions across the distance threshold.
 */
export class BridgeDetector {
  private vessels = new Map<number, TrackedVessel>();
  private notifiedVessels = new Map<number, number>(); // mmsi -> timestamp of last notification
  private config: BridgeDetectorConfig;

  constructor(config: Partial<BridgeDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Process an AIS message and return a crossing event if the vessel
   * has just passed under the bridge.
   */
  processMessage(message: AISMessage): BridgeCrossingEvent | null {
    const positionReport = message.Message?.PositionReport;
    const staticData = message.Message?.ShipStaticData;

    if (positionReport) {
      return this.processPositionReport(message);
    }

    if (staticData) {
      this.processStaticData(message);
    }

    return null;
  }

  private processPositionReport(message: AISMessage): BridgeCrossingEvent | null {
    const report = message.Message.PositionReport!;
    const meta = message.MetaData;
    const mmsi = meta.MMSI;

    const lat = report.Latitude;
    const lon = report.Longitude;

    // Skip invalid positions
    if (lat === 0 && lon === 0) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

    const distance = distanceToBridge(lat, lon);
    const now = Date.now();

    const existing = this.vessels.get(mmsi);
    const previousDistance = existing?.distanceToBridge ?? Infinity;

    // Update tracked vessel
    const vessel: TrackedVessel = {
      mmsi,
      name: existing?.name || meta.ShipName?.trim() || `MMSI ${mmsi}`,
      latitude: lat,
      longitude: lon,
      cog: report.Cog,
      sog: report.Sog,
      distanceToBridge: distance,
      lastUpdate: now,
      destination: existing?.destination,
      shipType: existing?.shipType,
      length: existing?.length,
    };

    this.vessels.set(mmsi, vessel);

    // Check for bridge crossing: was farther than threshold, now closer
    if (
      previousDistance > this.config.thresholdNM &&
      distance <= this.config.thresholdNM &&
      report.Sog >= 0.5 // Must be moving
    ) {
      // Check cooldown
      const lastNotified = this.notifiedVessels.get(mmsi);
      if (lastNotified && now - lastNotified < this.config.cooldownMs) {
        return null;
      }

      this.notifiedVessels.set(mmsi, now);

      return {
        mmsi,
        name: vessel.name,
        speed: report.Sog,
        course: report.Cog,
        distance,
        direction: getDirection(report.Cog, lat),
        timestamp: now,
        destination: vessel.destination,
        shipType: vessel.shipType,
        length: vessel.length,
      };
    }

    return null;
  }

  private processStaticData(message: AISMessage): void {
    const data = message.Message.ShipStaticData!;
    const mmsi = message.MetaData.MMSI;

    const existing = this.vessels.get(mmsi);
    if (existing) {
      if (data.Name?.trim()) existing.name = data.Name.trim();
      if (data.Destination?.trim()) existing.destination = data.Destination.trim();
      if (data.Type) existing.shipType = data.Type;
      if (data.Dimension) {
        existing.length = data.Dimension.A + data.Dimension.B;
      }
    }
  }

  /**
   * Remove stale vessels that haven't sent updates recently.
   */
  cleanupStale(): number {
    const now = Date.now();
    let removed = 0;

    for (const [mmsi, vessel] of this.vessels) {
      if (now - vessel.lastUpdate > this.config.staleTimeoutMs) {
        this.vessels.delete(mmsi);
        removed++;
      }
    }

    // Also clean up old notification records
    for (const [mmsi, timestamp] of this.notifiedVessels) {
      if (now - timestamp > this.config.cooldownMs) {
        this.notifiedVessels.delete(mmsi);
      }
    }

    return removed;
  }

  /** Get the number of currently tracked vessels */
  get trackedCount(): number {
    return this.vessels.size;
  }

  /** Get the number of vessels on cooldown */
  get cooldownCount(): number {
    return this.notifiedVessels.size;
  }

  /** Get a tracked vessel by MMSI (for testing) */
  getVessel(mmsi: number): TrackedVessel | undefined {
    return this.vessels.get(mmsi);
  }
}
