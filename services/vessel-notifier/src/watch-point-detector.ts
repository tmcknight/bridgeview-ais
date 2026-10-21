import {
  haversineDistanceNM,
  closestApproach,
  getDirection,
  BRIDGE_CENTER,
  CLOSE_APPROACH_DISTANCE_NM,
} from "./geo.js";
import type { AISMessage, TrackedVessel, PassageEvent, WatchPoint } from "./types.js";

export interface WatchPointDetectorConfig {
  /** Points to watch for passing vessels */
  watchPoints: WatchPoint[];
  /** Cooldown in ms before re-notifying about the same vessel at the same point */
  cooldownMs: number;
  /** How long to keep stale vessels in tracker (ms) */
  staleTimeoutMs: number;
}

/** AIS reports 511 when true heading is not available */
const HEADING_NOT_AVAILABLE = 511;

export const BLUE_WATER_BRIDGE: WatchPoint = {
  id: "blue-water-bridge",
  name: "Blue Water Bridge",
  latitude: BRIDGE_CENTER.lat,
  longitude: BRIDGE_CENTER.lng,
  radiusNM: CLOSE_APPROACH_DISTANCE_NM,
};

const DEFAULT_CONFIG: WatchPointDetectorConfig = {
  watchPoints: [BLUE_WATER_BRIDGE],
  cooldownMs: 30 * 60 * 1000, // 30 minutes
  staleTimeoutMs: 15 * 60 * 1000, // 15 minutes
};

/**
 * Detects when vessels pass watch points (e.g. the Blue Water Bridge).
 *
 * A passage fires on the first position report after the vessel comes abeam
 * of the point (its closest approach), so the alert lands as the vessel is
 * going by rather than when it first gets near. Both the closest approach and
 * the current position must be within the point's radius.
 */
export class WatchPointDetector {
  private vessels = new Map<number, TrackedVessel>();
  private notified = new Map<string, number>(); // "pointId:mmsi" -> timestamp of last notification
  private config: WatchPointDetectorConfig;

  constructor(config: Partial<WatchPointDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get watchPoints(): WatchPoint[] {
    return this.config.watchPoints;
  }

  /**
   * Process an AIS message and return a passage event for every watch point
   * the vessel has just passed.
   */
  processMessage(message: AISMessage): PassageEvent[] {
    const positionReport = message.Message?.PositionReport;
    const staticData = message.Message?.ShipStaticData;

    if (positionReport) {
      return this.processPositionReport(message);
    }

    if (staticData) {
      this.processStaticData(message);
    }

    return [];
  }

  private processPositionReport(message: AISMessage): PassageEvent[] {
    const report = message.Message.PositionReport!;
    const meta = message.MetaData;
    const mmsi = meta.MMSI;

    const lat = report.Latitude;
    const lon = report.Longitude;

    // Skip invalid positions
    if (lat === 0 && lon === 0) return [];
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return [];

    const now = Date.now();
    const existing = this.vessels.get(mmsi);

    // Update tracked vessel
    const vessel: TrackedVessel = {
      ...existing,
      mmsi,
      name: existing?.name || meta.ShipName?.trim() || `MMSI ${mmsi}`,
      latitude: lat,
      longitude: lon,
      cog: report.Cog,
      sog: report.Sog,
      heading:
        report.TrueHeading === HEADING_NOT_AVAILABLE ? undefined : report.TrueHeading,
      navStatus: report.NavigationalStatus,
      lastUpdate: now,
    };

    this.vessels.set(mmsi, vessel);

    // Need a previous position to know which way it is going, and must be moving
    if (!existing || report.Sog < 0.5) return [];

    const events: PassageEvent[] = [];

    for (const point of this.config.watchPoints) {
      const approach = closestApproach(
        existing.latitude,
        existing.longitude,
        lat,
        lon,
        point.latitude,
        point.longitude
      );

      // Passage: the point went from ahead of the vessel to abeam/behind it
      // during this segment (t in (0, 1]), close enough to count
      if (approach.t <= 0 || approach.t > 1) continue;
      if (approach.distanceNM > point.radiusNM) continue;

      // Skip if a reporting gap means the vessel is already well past
      const distance = haversineDistanceNM(lat, lon, point.latitude, point.longitude);
      if (distance > point.radiusNM) continue;

      const key = `${point.id}:${mmsi}`;
      const lastNotified = this.notified.get(key);
      if (lastNotified && now - lastNotified < this.config.cooldownMs) continue;

      this.notified.set(key, now);

      events.push({
        watchPoint: point,
        mmsi,
        name: vessel.name,
        latitude: lat,
        longitude: lon,
        speed: report.Sog,
        course: report.Cog,
        heading: vessel.heading,
        navStatus: vessel.navStatus,
        distance,
        closestApproach: approach.distanceNM,
        direction: getDirection(report.Cog, lat, point.latitude),
        timestamp: now,
        destination: vessel.destination,
        shipType: vessel.shipType,
        length: vessel.length,
        beam: vessel.beam,
        imo: vessel.imo,
        callSign: vessel.callSign,
      });
    }

    return events;
  }

  private processStaticData(message: AISMessage): void {
    const data = message.Message.ShipStaticData!;
    const mmsi = message.MetaData.MMSI;

    const existing = this.vessels.get(mmsi);
    if (existing) {
      if (data.Name?.trim()) existing.name = data.Name.trim();
      if (data.Destination?.trim()) existing.destination = data.Destination.trim();
      if (data.CallSign?.trim()) existing.callSign = data.CallSign.trim();
      if (data.ImoNumber) existing.imo = data.ImoNumber;
      if (data.Type) existing.shipType = data.Type;
      if (data.Dimension) {
        existing.length = data.Dimension.A + data.Dimension.B;
        existing.beam = data.Dimension.C + data.Dimension.D;
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
    for (const [key, timestamp] of this.notified) {
      if (now - timestamp > this.config.cooldownMs) {
        this.notified.delete(key);
      }
    }

    return removed;
  }

  /** Get the number of currently tracked vessels */
  get trackedCount(): number {
    return this.vessels.size;
  }

  /** Get the number of vessel/watch point pairs on cooldown */
  get cooldownCount(): number {
    return this.notified.size;
  }

  /** Get a tracked vessel by MMSI (for testing) */
  getVessel(mmsi: number): TrackedVessel | undefined {
    return this.vessels.get(mmsi);
  }
}
