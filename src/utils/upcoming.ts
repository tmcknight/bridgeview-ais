import { BRIDGE_CENTER } from "../constants/bridge";
import type { TrackedShip } from "../types/ais";
import { haversineDistanceNM } from "./geo";
import { guessCargo, type CargoGuess } from "./cargo";

const DEG_TO_RAD = Math.PI / 180;

/** Ships slower than this (kn) aren't treated as under way */
const MIN_SPEED_KN = 0.5;

/** AIS reports SOG 102.3 kn when speed is not available */
const SPEED_NOT_AVAILABLE_KN = 102.3;

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

export interface UpcomingPassage {
  ship: TrackedShip;
  /** Rough minutes until the ship reaches the bridge */
  etaMinutes: number;
  /** Rough distance along the route to the bridge (NM) */
  distanceNM: number;
  /** Upbound = northbound into Lake Huron; downbound = southbound */
  direction: "upbound" | "downbound";
  cargo: CargoGuess | null;
}

/**
 * Work out whether a ship is under way toward the bridge and, if so, roughly
 * when it will get there. Straight-line distance (with an allowance for the
 * river route from the south) divided by current speed.
 */
export function getUpcomingPassage(ship: TrackedShip): UpcomingPassage | null {
  if (ship.sog < MIN_SPEED_KN || ship.sog >= SPEED_NOT_AVAILABLE_KN) return null;
  // At anchor or moored
  if (ship.navStatus === 1 || ship.navStatus === 5) return null;
  if (!(ship.cog >= 0 && ship.cog < 360)) return null;

  const northComponent = Math.cos(ship.cog * DEG_TO_RAD);
  const isNorthOfBridge = ship.latitude > BRIDGE_CENTER.lat;
  const destination = ship.destination?.toUpperCase() ?? "";

  let direction: UpcomingPassage["direction"];
  if (isNorthOfBridge && northComponent <= -MIN_HEADING_COMPONENT) {
    direction = "downbound";
  } else if (!isNorthOfBridge && northComponent >= MIN_HEADING_COMPONENT) {
    if (STOPS_SOUTH_OF_BRIDGE.test(destination)) return null;
    direction = "upbound";
  } else {
    return null;
  }

  const straightNM = haversineDistanceNM(
    ship.latitude,
    ship.longitude,
    BRIDGE_CENTER.lat,
    BRIDGE_CENTER.lng
  );
  const distanceNM = direction === "upbound" ? straightNM * SOUTH_ROUTE_FACTOR : straightNM;

  return {
    ship,
    etaMinutes: (distanceNM / ship.sog) * 60,
    distanceNM,
    direction,
    cargo: guessCargo(ship.destination),
  };
}

/**
 * Ships heading toward the bridge within `maxEtaMinutes`, soonest first.
 */
export function getUpcomingPassages(
  ships: Iterable<TrackedShip>,
  maxEtaMinutes = 24 * 60
): UpcomingPassage[] {
  const passages: UpcomingPassage[] = [];
  for (const ship of ships) {
    const passage = getUpcomingPassage(ship);
    if (passage && passage.etaMinutes <= maxEtaMinutes) passages.push(passage);
  }
  return passages.sort((a, b) => a.etaMinutes - b.etaMinutes);
}
