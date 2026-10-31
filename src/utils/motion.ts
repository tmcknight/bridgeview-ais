// Smooth movement for ships and planes between position reports.
// Each one is dead-reckoned from its last report's speed and course, and when a
// new report lands, the gap between where it was drawn and where the report puts
// it closes over BLEND_MS instead of in one jump. A report is reckoned on from
// when it was made, not when it arrived, so a feed's delay doesn't pull the
// craft back each time one lands.

import type { TrackedShip } from "../types/ais";
import type { Aircraft } from "../types/aircraft";
import { isSpeedAvailable } from "./geo";

export interface MotionFix {
  lat: number;
  lon: number;
  /** Knots; 0 holds the position still */
  speed: number;
  /** Degrees true; undefined holds the position still */
  course?: number;
  /** Degrees the icon points */
  rotation: number;
  /** When the report was made, in epoch ms; undefined takes it as made on arrival */
  reportedAt?: number;
}

export interface MotionPosition {
  lat: number;
  lon: number;
  rotation: number;
}

export interface Motion {
  fix: MotionFix;
  /** When the fix arrived, on the performance.now() clock */
  at: number;
  /** How old the report already was when it arrived */
  lagMs: number;
  /** Where it was drawn minus where the fix put it, when the fix arrived */
  offset: MotionPosition;
  /** Extrapolation stops this long after the fix, so a craft gone quiet doesn't drift off */
  maxAgeMs: number;
}

export const BLEND_MS = 2000;
// A new fix further than this from where the craft was drawn (~2 km) is jumped to
const MAX_BLEND_DEG = 0.02;
// Ships report a few tenths of a knot while sitting still
const MIN_SHIP_SPEED_KN = 0.5;

// Reports older than this on arrival (or a clock that's off) are reckoned from this far back
const MAX_LAG_MS = 30_000;

// Ships report every few seconds underway, or minutes apart on some feeds
export const SHIP_MAX_AGE_MS = 120_000;
// Planes are polled every 5s, less often while the feed backs off
export const AIRCRAFT_MAX_AGE_MS = 15_000;

const NO_OFFSET: MotionPosition = { lat: 0, lon: 0, rotation: 0 };

function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Signed shortest turn from b to a, in -180..180 */
function angleBetween(a: number, b: number): number {
  return normalizeDegrees(a - b + 180) - 180;
}

function deadReckon(fix: MotionFix, ms: number): { lat: number; lon: number } {
  if (fix.speed <= 0 || fix.course === undefined) return fix;
  const nm = (fix.speed * ms) / 3_600_000;
  const course = (fix.course * Math.PI) / 180;
  return {
    lat: fix.lat + (nm * Math.cos(course)) / 60,
    lon: fix.lon + (nm * Math.sin(course)) / (60 * Math.cos((fix.lat * Math.PI) / 180)),
  };
}

export function sameFix(a: MotionFix, b: MotionFix): boolean {
  return (
    a.lat === b.lat &&
    a.lon === b.lon &&
    a.speed === b.speed &&
    a.course === b.course &&
    a.rotation === b.rotation &&
    a.reportedAt === b.reportedAt
  );
}

/** Start moving from a new fix, easing in from wherever the previous motion had got to */
export function startMotion(
  prev: Motion | undefined,
  fix: MotionFix,
  now: number,
  maxAgeMs: number,
  /** The epoch-ms clock, to age the report by */
  wallNow: number = Date.now()
): Motion {
  const lagMs =
    fix.reportedAt === undefined ? 0 : Math.min(MAX_LAG_MS, Math.max(0, wallNow - fix.reportedAt));
  let offset = NO_OFFSET;
  if (prev) {
    const shown = motionAt(prev, now);
    // Where the fix puts it now, having moved on since the report was made
    const target = deadReckon(fix, Math.min(lagMs, maxAgeMs));
    const lat = shown.lat - target.lat;
    const lon = shown.lon - target.lon;
    if (Math.abs(lat) < MAX_BLEND_DEG && Math.abs(lon) < MAX_BLEND_DEG) {
      offset = { lat, lon, rotation: angleBetween(shown.rotation, fix.rotation) };
    }
  }
  return { fix, at: now, lagMs, offset, maxAgeMs };
}

export function motionAt(motion: Motion, now: number): MotionPosition {
  const elapsed = Math.max(0, now - motion.at);
  const { lat, lon } = deadReckon(motion.fix, Math.min(elapsed + motion.lagMs, motion.maxAgeMs));
  // Smoothstep: the correction starts and ends gently, so the craft's speed
  // never changes in a jump
  const t = Math.min(1, elapsed / BLEND_MS);
  const remaining = 1 - t * t * (3 - 2 * t);
  return {
    lat: lat + motion.offset.lat * remaining,
    lon: lon + motion.offset.lon * remaining,
    rotation: normalizeDegrees(motion.fix.rotation + motion.offset.rotation * remaining),
  };
}

/** Whether the motion has stopped changing, so it needn't be redrawn */
export function motionSettled(motion: Motion, now: number): boolean {
  const elapsed = now - motion.at;
  if (elapsed < BLEND_MS) return false;
  const { speed, course } = motion.fix;
  return speed <= 0 || course === undefined || elapsed + motion.lagMs > motion.maxAgeMs;
}

export function shipRotation(ship: TrackedShip): number {
  return ship.trueHeading !== 511 ? ship.trueHeading : ship.cog;
}

export function shipFix(ship: TrackedShip): MotionFix {
  const stationary = ship.navStatus === 1 || ship.navStatus === 5; // anchored or moored
  const moving = !stationary && isSpeedAvailable(ship.sog) && ship.sog >= MIN_SHIP_SPEED_KN;
  return {
    lat: ship.latitude,
    lon: ship.longitude,
    speed: moving ? ship.sog : 0,
    // AIS reports COG 360 when it isn't available
    course: ship.cog < 360 ? ship.cog : undefined,
    rotation: shipRotation(ship),
    reportedAt: Date.parse(ship.lastUpdate) || undefined,
  };
}

export function aircraftFix(aircraft: Aircraft): MotionFix {
  return {
    lat: aircraft.lat,
    lon: aircraft.lon,
    speed: aircraft.speed ?? 0,
    course: aircraft.track,
    rotation: aircraft.track ?? 0,
  };
}
