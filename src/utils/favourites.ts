import type { TrackedShip } from "../types/ais";
import { NAV_STATUS_LABELS } from "../types/ais";
import { spell } from "./locale";
import { formatDistance, formatETA, formatRelativeTime, formatSpeed, isSpeedAvailable } from "./geo";
import type { ShipLog } from "./shipLog";
import { getUpcomingPassage } from "./upcoming";

// Favourite ships, kept in this browser's localStorage: no account needed,
// and nothing about them goes to the server

export const FAVOURITES_KEY = "bridgeview:favourites";

export interface FavouriteShip {
  mmsi: number;
  /** Name when added; shown when the ship is neither heard now nor in the ship log */
  name: string;
  /** ISO time it was added */
  addedAt: string;
}

/** Favourites, keyed by MMSI, in the order they were added */
export type Favourites = Map<number, FavouriteShip>;

function isFavouriteShip(value: unknown): value is FavouriteShip {
  const fav = value as FavouriteShip | null;
  return (
    typeof fav === "object" &&
    fav !== null &&
    Number.isInteger(fav.mmsi) &&
    fav.mmsi > 0 &&
    typeof fav.name === "string" &&
    typeof fav.addedAt === "string"
  );
}

/** Read favourites from stored JSON, skipping anything malformed */
export function parseFavourites(json: string | null): Favourites {
  if (!json) return new Map();
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return new Map();
    return new Map(
      parsed.filter(isFavouriteShip).map((fav): [number, FavouriteShip] => [fav.mmsi, fav]),
    );
  } catch {
    return new Map();
  }
}

export function serializeFavourites(favourites: Favourites): string {
  return JSON.stringify(Array.from(favourites.values()));
}

export function loadFavourites(): Favourites {
  try {
    return parseFavourites(localStorage.getItem(FAVOURITES_KEY));
  } catch {
    // localStorage might not be available (private mode, blocked storage)
    return new Map();
  }
}

export function saveFavourites(favourites: Favourites): void {
  try {
    localStorage.setItem(FAVOURITES_KEY, serializeFavourites(favourites));
  } catch {
    // localStorage might not be available; favourites last for this visit
  }
}

/** Add the ship if it isn't a favourite, remove it if it is */
export function toggleFavourite(
  favourites: Favourites,
  mmsi: number,
  name: string,
  now: Date = new Date(),
): Favourites {
  const next = new Map(favourites);
  if (next.has(mmsi)) next.delete(mmsi);
  else next.set(mmsi, { mmsi, name, addedAt: now.toISOString() });
  return next;
}

/** One line on what a favourite is doing now */
export function describeFavourite(ship: TrackedShip | undefined, log: ShipLog, mmsi: number): string {
  if (ship) {
    const passage = getUpcomingPassage(ship, { includePassing: true });
    const direction = passage?.direction === "upbound" ? "Upbound" : "Downbound";
    if (passage?.passing) return `${direction} · passing under the bridge now`;
    if (passage) return `${direction} · at the bridge in ${formatETA(passage.etaMinutes)}`;
    const status =
      ship.sog > 0.5 && isSpeedAvailable(ship.sog)
        ? formatSpeed(ship.sog)
        : spell(NAV_STATUS_LABELS[ship.navStatus] ?? "Stopped");
    return `${formatDistance(ship.distanceToBridge)} from the bridge · ${status}`;
  }
  const entry = log.get(mmsi);
  const latest = entry?.passages[0];
  if (entry && latest) {
    return `Not heard now · last under the bridge ${latest.direction} ${formatRelativeTime(latest.time)}`;
  }
  return "Not heard now";
}
