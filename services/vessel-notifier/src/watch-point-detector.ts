import {
  haversineDistanceNM,
  closestApproach,
  projectAbeam,
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
  /** How far ahead (s) to predict a passage from speed and course; 0 disables */
  predictionHorizonSeconds: number;
  /** How many seconds before the predicted passage to fire the alert */
  predictionLeadSeconds: number;
  /** Receives predicted passages, which fire on a timer between reports */
  onPredictedPassage?: (event: PassageEvent) => void;
}

/** AIS reports 511 when true heading is not available */
const HEADING_NOT_AVAILABLE = 511;
/** AIS reports COG 360 when course is not available */
const COURSE_NOT_AVAILABLE = 360;
/** Vessels slower than this (kn) are not treated as passing */
const MIN_PASSING_SPEED_KN = 0.5;
/** AIS reports SOG 102.3 kn when speed is not available */
const SPEED_NOT_AVAILABLE_KN = 102.3;

function isUnderWay(sog: number): boolean {
  return sog >= MIN_PASSING_SPEED_KN && sog < SPEED_NOT_AVAILABLE_KN;
}

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
  // AIS reports near the bridge can be several minutes apart, so look well ahead;
  // each new report reschedules or cancels the prediction
  predictionHorizonSeconds: 10 * 60, // 10 minutes
  predictionLeadSeconds: 20,
};

/**
 * Detects when vessels pass watch points (e.g. the Blue Water Bridge).
 *
 * AIS reports can be a minute or more apart, so passages are predicted: each
 * report projects the vessel's speed and course ahead, and if it will come
 * abeam of a point (within the point's radius) inside the prediction horizon,
 * a timer fires `onPredictedPassage` shortly before that moment (the lead time). Every report reschedules
 * the timer, so the prediction tracks speed and course changes.
 *
 * As a fallback (no course broadcast, or the prediction ran late), a passage
 * is also observed on the first report after the vessel has come abeam; that
 * is returned from `processMessage`. Cooldown ensures only one of the two fires.
 */
export class WatchPointDetector {
  private vessels = new Map<number, TrackedVessel>();
  private notified = new Map<string, number>(); // "pointId:mmsi" -> timestamp of last notification
  private predictions = new Map<string, ReturnType<typeof setTimeout>>(); // "pointId:mmsi" -> pending timer
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
    // Class B craft (pleasure boats, small workboats) aren't announced
    if (message.MetaData?.AisClass === "B") return [];

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

    for (const point of this.config.watchPoints) {
      this.updatePrediction(point, vessel);
    }

    // Need a previous position to know which way it is going, and must be moving
    if (!existing || !isUnderWay(report.Sog)) return [];

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
      if (this.isOnCooldown(key, now)) continue;

      this.cancelPrediction(key);
      this.notified.set(key, now);

      events.push(
        this.buildEvent(point, vessel, {
          latitude: lat,
          longitude: lon,
          distance,
          closestApproach: approach.distanceNM,
          predicted: false,
          timestamp: now,
          passesAt: now,
        })
      );
    }

    return events;
  }

  /**
   * Schedule (or reschedule, or cancel) the predicted passage of a point
   * based on the vessel's latest speed and course.
   */
  private updatePrediction(point: WatchPoint, vessel: TrackedVessel): void {
    const key = `${point.id}:${vessel.mmsi}`;
    this.cancelPrediction(key);

    const { predictionHorizonSeconds, onPredictedPassage } = this.config;
    if (!onPredictedPassage || predictionHorizonSeconds <= 0) return;
    if (!isUnderWay(vessel.sog)) return;
    if (!(vessel.cog >= 0 && vessel.cog < COURSE_NOT_AVAILABLE)) return;
    if (this.isOnCooldown(key, Date.now())) return;

    const projection = projectAbeam(
      vessel.latitude,
      vessel.longitude,
      vessel.cog,
      point.latitude,
      point.longitude
    );
    if (projection.alongNM <= 0 || projection.crossNM > point.radiusNM) return;

    const secondsToAbeam = (projection.alongNM / vessel.sog) * 3600;
    if (secondsToAbeam > predictionHorizonSeconds) return;

    console.log(
      `[notifier] Predicting ${vessel.name} abeam of ${point.name} in ${Math.round(secondsToAbeam)}s (${projection.alongNM.toFixed(2)} NM ahead, ${projection.crossNM.toFixed(2)} NM off, ${vessel.sog} kn)`
    );

    const passesAt = Date.now() + secondsToAbeam * 1000;
    const delayMs = Math.max(0, secondsToAbeam - this.config.predictionLeadSeconds) * 1000;

    const timer = setTimeout(() => {
      this.predictions.delete(key);
      const now = Date.now();
      if (this.isOnCooldown(key, now)) return;
      this.notified.set(key, now);

      // Use the latest vessel state so static data that arrived meanwhile is included
      const latest = this.vessels.get(vessel.mmsi) ?? vessel;
      onPredictedPassage(
        this.buildEvent(point, latest, {
          latitude: projection.abeam.lat,
          longitude: projection.abeam.lon,
          distance: projection.crossNM,
          closestApproach: projection.crossNM,
          predicted: true,
          timestamp: now,
          passesAt,
        })
      );
    }, delayMs);

    this.predictions.set(key, timer);
  }

  private cancelPrediction(key: string): void {
    const timer = this.predictions.get(key);
    if (timer) {
      clearTimeout(timer);
      this.predictions.delete(key);
    }
  }

  private isOnCooldown(key: string, now: number): boolean {
    const lastNotified = this.notified.get(key);
    return lastNotified !== undefined && now - lastNotified < this.config.cooldownMs;
  }

  private buildEvent(
    point: WatchPoint,
    vessel: TrackedVessel,
    position: Pick<
      PassageEvent,
      | "latitude"
      | "longitude"
      | "distance"
      | "closestApproach"
      | "predicted"
      | "timestamp"
      | "passesAt"
    >
  ): PassageEvent {
    return {
      watchPoint: point,
      mmsi: vessel.mmsi,
      name: vessel.name,
      ...position,
      speed: vessel.sog,
      course: vessel.cog,
      heading: vessel.heading,
      navStatus: vessel.navStatus,
      direction: getDirection(vessel.cog, vessel.latitude, point.latitude),
      destination: vessel.destination,
      shipType: vessel.shipType,
      length: vessel.length,
      beam: vessel.beam,
      imo: vessel.imo,
      callSign: vessel.callSign,
    };
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
        for (const point of this.config.watchPoints) {
          this.cancelPrediction(`${point.id}:${mmsi}`);
        }
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

  /** Cancel all pending predicted passages */
  dispose(): void {
    for (const timer of this.predictions.values()) clearTimeout(timer);
    this.predictions.clear();
  }

  /** Get the number of pending predicted passages */
  get pendingPredictionCount(): number {
    return this.predictions.size;
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
