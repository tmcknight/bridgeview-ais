import { BRIDGE_CENTER } from "../constants/bridge";
import type { TrackedShip } from "../types/ais";
import { haversineDistanceNM, isSpeedAvailable } from "./geo";
import { guessCargo, type CargoGuess } from "./cargo";

const DEG_TO_RAD = Math.PI / 180;

/** Ships slower than this (kn) aren't treated as under way */
const MIN_SPEED_KN = 0.5;

/**
 * Minimum north/south component of the course (cosine of COG) for a ship to
 * count as heading toward the bridge. Filters out ships crossing Lake Huron
 * east-west or turning in the river.
 */
const MIN_HEADING_COMPONENT = 0.3;

/**
 * From the south, ships follow the Detroit River, Lake St. Clair and the
 * St. Clair River, roughly 20% longer than the straight line.
 */
const SOUTH_ROUTE_FACTOR = 1.2;

/** Destinations that end south of the bridge for a northbound ship */
const STOPS_SOUTH_OF_BRIDGE = /SARNIA|PORT HURON|TUG.?ASSIST/;

/**
 * How far past the bridge (NM) a ship stays in "Coming up", shown as passing,
 * so it doesn't vanish the moment its countdown runs out: the ETA is rough,
 * and a long laker's GPS antenna is near the stern, well behind its bow.
 * About 3 min at 10 kn.
 */
export const PASSING_GRACE_NM = 0.5;

export interface UpcomingPassage {
  ship: TrackedShip;
  /** Rough minutes until the ship reaches the bridge */
  etaMinutes: number;
  /** Rough distance along the route to the bridge (NM) */
  distanceNM: number;
  /** Upbound = northbound into Lake Huron; downbound = southbound */
  direction: "upbound" | "downbound";
  cargo: CargoGuess | null;
  /** Just gone under the bridge (within PASSING_GRACE_NM); ETA and distance are 0 */
  passing?: boolean;
}

export interface UpcomingPassageOptions {
  /** Also count ships just past the bridge (see PASSING_GRACE_NM) */
  includePassing?: boolean;
}

/**
 * Work out whether a ship is under way toward the bridge and, if so, roughly
 * when it will get there. Straight-line distance (with an allowance for the
 * river route from the south) divided by current speed.
 */
export function getUpcomingPassage(
  ship: TrackedShip,
  { includePassing = false }: UpcomingPassageOptions = {}
): UpcomingPassage | null {
  if (ship.sog < MIN_SPEED_KN || !isSpeedAvailable(ship.sog)) return null;
  // At anchor or moored
  if (ship.navStatus === 1 || ship.navStatus === 5) return null;
  if (!(ship.cog >= 0 && ship.cog < 360)) return null;

  const northComponent = Math.cos(ship.cog * DEG_TO_RAD);
  const isNorthOfBridge = ship.latitude > BRIDGE_CENTER.lat;
  const destination = ship.destination?.toUpperCase() ?? "";
  const straightNM = haversineDistanceNM(
    ship.latitude,
    ship.longitude,
    BRIDGE_CENTER.lat,
    BRIDGE_CENTER.lng
  );

  // Just through the bridge and carrying on the same way
  if (includePassing && straightNM <= PASSING_GRACE_NM) {
    const passedDirection =
      !isNorthOfBridge && northComponent <= -MIN_HEADING_COMPONENT
        ? "downbound"
        : isNorthOfBridge && northComponent >= MIN_HEADING_COMPONENT
          ? "upbound"
          : null;
    if (passedDirection) {
      return {
        ship,
        etaMinutes: 0,
        distanceNM: 0,
        direction: passedDirection,
        cargo: guessCargo(ship),
        passing: true,
      };
    }
  }

  let direction: UpcomingPassage["direction"];
  if (isNorthOfBridge && northComponent <= -MIN_HEADING_COMPONENT) {
    direction = "downbound";
  } else if (!isNorthOfBridge && northComponent >= MIN_HEADING_COMPONENT) {
    if (STOPS_SOUTH_OF_BRIDGE.test(destination)) return null;
    direction = "upbound";
  } else {
    return null;
  }

  const distanceNM = direction === "upbound" ? straightNM * SOUTH_ROUTE_FACTOR : straightNM;

  return {
    ship,
    etaMinutes: (distanceNM / ship.sog) * 60,
    distanceNM,
    direction,
    cargo: guessCargo(ship),
  };
}

/**
 * Ships heading toward the bridge within `maxEtaMinutes`, soonest first, with
 * ships just through it (passing) at the top.
 */
export function getUpcomingPassages(
  ships: Iterable<TrackedShip>,
  maxEtaMinutes = 24 * 60
): UpcomingPassage[] {
  const passages: UpcomingPassage[] = [];
  for (const ship of ships) {
    const passage = getUpcomingPassage(ship, { includePassing: true });
    if (passage && passage.etaMinutes <= maxEtaMinutes) passages.push(passage);
  }
  return passages.sort((a, b) => a.etaMinutes - b.etaMinutes);
}
