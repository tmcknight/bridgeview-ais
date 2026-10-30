import type { TrackedShip } from "../types/ais";
import { BRIDGE_CENTER } from "../constants/bridge";
import { isSpeedAvailable } from "./geo";
import { getUpcomingPassage, type UpcomingPassage } from "./upcoming";

/** A ship this close to the bridge (NM) switches TV mode to the cam */
export const CAM_ENTER_NM = 1;
/** ...and the cam stays on it until it's this far away, so it doesn't flicker */
export const CAM_EXIT_NM = 1.3;
/** A ship this many minutes from the bridge and heading for it gets its
 * details shown, until it's close enough for the cam */
export const SHOW_ENTER_MIN = 12;
/** ...and keeps them until it's this far out again */
const SHOW_EXIT_MIN = 15;
/** From this many minutes out, the map follows it too */
export const FOLLOW_ENTER_MIN = 9;
/** ...until it's this far out again */
const FOLLOW_EXIT_MIN = 12;
/** Slower than this (kn) counts as stopped */
const MIN_SPEED_KN = 1;

function isUnderWay(ship: TrackedShip): boolean {
  if (ship.classB) return false;
  // At anchor or moored
  if (ship.navStatus === 1 || ship.navStatus === 5) return false;
  return isSpeedAvailable(ship.sog) && ship.sog >= MIN_SPEED_KN;
}

/** A ship's length (m), or 0 when it isn't known */
function shipLength(ship: TrackedShip): number {
  return ship.dimensions ? ship.dimensions.toBow + ship.dimensions.toStern : 0;
}

/** Whether `a` is a better pick than `b`: bigger, or as big and closer */
function isBetterPick(a: TrackedShip, aDistanceNM: number, b: TrackedShip, bDistanceNM: number): boolean {
  const [aLength, bLength] = [shipLength(a), shipLength(b)];
  return aLength !== bLength ? aLength > bLength : aDistanceNM < bDistanceNM;
}

/**
 * The ship going by the bridge for TV mode to show on the cam, or null.
 * Sticks with `currentMmsi` while it's still within CAM_EXIT_NM, otherwise
 * picks the biggest ship under way within CAM_ENTER_NM (the closest of
 * equal ones).
 */
export function getPassingShip(
  ships: Iterable<TrackedShip>,
  currentMmsi: number | null,
): TrackedShip | null {
  let best: TrackedShip | null = null;
  for (const ship of ships) {
    if (!isUnderWay(ship)) continue;
    if (ship.mmsi === currentMmsi && ship.distanceToBridge <= CAM_EXIT_NM) {
      return ship;
    }
    if (
      ship.distanceToBridge <= CAM_ENTER_NM &&
      (!best || isBetterPick(ship, ship.distanceToBridge, best, best.distanceToBridge))
    ) {
      best = ship;
    }
  }
  return best;
}

/** Upbound = northbound into Lake Huron; downbound = southbound */
export function passageDirection(ship: TrackedShip): "upbound" | "downbound" {
  return Math.cos((ship.cog * Math.PI) / 180) >= 0 ? "upbound" : "downbound";
}

/**
 * The ship heading for the bridge for TV mode to show, or null: the biggest
 * within SHOW_ENTER_MIN (the closest of equal ones). `currentMmsi` stays a
 * candidate out to SHOW_EXIT_MIN, and right by the bridge, where its course
 * can wander, and once it's within FOLLOW_ENTER_MIN it keeps the screen even
 * if a bigger ship comes along, so the map doesn't swing away mid-follow.
 */
export function getApproachingShip(
  ships: Iterable<TrackedShip>,
  currentMmsi: number | null,
): UpcomingPassage | null {
  let best: UpcomingPassage | null = null;
  for (const ship of ships) {
    if (ship.classB) continue;
    let passage = getUpcomingPassage(ship);
    const isCurrent = ship.mmsi === currentMmsi;
    if (!passage && isCurrent && isUnderWay(ship) && ship.distanceToBridge <= CAM_EXIT_NM) {
      passage = {
        ship,
        etaMinutes: (ship.distanceToBridge / ship.sog) * 60,
        distanceNM: ship.distanceToBridge,
        direction: passageDirection(ship),
        cargo: null,
      };
    }
    if (!passage || passage.etaMinutes > (isCurrent ? SHOW_EXIT_MIN : SHOW_ENTER_MIN)) continue;
    if (isCurrent && passage.etaMinutes <= FOLLOW_ENTER_MIN) return passage;
    if (!best || isBetterPick(ship, passage.distanceNM, best.ship, best.distanceNM)) best = passage;
  }
  return best;
}

/**
 * Whether the map should follow the ship TV mode is showing: from
 * FOLLOW_ENTER_MIN out, or FOLLOW_EXIT_MIN if it already is
 */
export function shouldFollow(passage: UpcomingPassage, following: boolean): boolean {
  return passage.etaMinutes <= (following ? FOLLOW_EXIT_MIN : FOLLOW_ENTER_MIN);
}


/** Compass bearing (degrees) from a point to the bridge */
export function bearingToBridge(lat: number, lon: number): number {
  const rad = Math.PI / 180;
  const dLon = (BRIDGE_CENTER.lng - lon) * rad;
  const y = Math.sin(dLon) * Math.cos(BRIDGE_CENTER.lat * rad);
  const x =
    Math.cos(lat * rad) * Math.sin(BRIDGE_CENTER.lat * rad) -
    Math.sin(lat * rad) * Math.cos(BRIDGE_CENTER.lat * rad) * Math.cos(dLon);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}
