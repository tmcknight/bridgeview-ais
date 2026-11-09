import type { TrackedShip } from "../types/ais";
import type { ShipLog, ShipLogEntry } from "./shipLog";

/** Results past this are cut off; the search box asks for more letters */
export const MAX_SEARCH_RESULTS = 30;

export interface ShipSearchResults {
  /** Ships heard lately, best match first */
  live: TrackedShip[];
  /** Ships in the ship log that aren't being heard now, best match first */
  logged: ShipLogEntry[];
  /** Matches left out past MAX_SEARCH_RESULTS */
  more: number;
}

/** Upper case, with runs of spaces and punctuation as one space */
export function normaliseQuery(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/**
 * How well a ship matches: lower is better, null for no match. Names count
 * most (whole name, start, start of a word, anywhere), then MMSI, IMO and
 * destination.
 */
function matchScore(
  query: string,
  digits: string | null,
  name: string,
  mmsi: number,
  imo?: number,
  destination?: string,
): number | null {
  const normalName = normaliseQuery(name);
  if (normalName === query) return 0;
  if (normalName.startsWith(query)) return 1;
  if (` ${normalName}`.includes(` ${query}`)) return 2;
  if (normalName.includes(query)) return 3;
  if (digits) {
    if (String(mmsi).startsWith(digits)) return 4;
    if (imo && String(imo).startsWith(digits)) return 4;
  }
  if (destination && normaliseQuery(destination).includes(query)) return 5;
  return null;
}

/**
 * Find ships by name, MMSI, IMO number or destination: those being heard now
 * (selectable on the map) and, separately, those only in the ship log.
 * Queries shorter than 2 characters find nothing, except for MMSI/IMO digits.
 */
export function searchShips(
  rawQuery: string,
  ships: Map<number, TrackedShip>,
  log: ShipLog,
): ShipSearchResults {
  const query = normaliseQuery(rawQuery);
  if (query.length < 2) return { live: [], logged: [], more: 0 };
  // "IMO 9123456" and "MMSI 316..." search by number
  const digitsOnly = query.replace(/^(IMO|MMSI) ?/, "");
  const digits = /^\d{3,}$/.test(digitsOnly) ? digitsOnly : null;

  const live: { ship: TrackedShip; score: number }[] = [];
  for (const ship of ships.values()) {
    const score = matchScore(query, digits, ship.name, ship.mmsi, ship.imo, ship.destination);
    if (score !== null) live.push({ ship, score });
  }
  live.sort(
    (a, b) =>
      a.score - b.score ||
      a.ship.distanceToBridge - b.ship.distanceToBridge ||
      a.ship.name.localeCompare(b.ship.name),
  );

  const logged: { entry: ShipLogEntry; score: number }[] = [];
  for (const entry of log.values()) {
    if (ships.has(entry.mmsi)) continue;
    const score = matchScore(query, digits, entry.name, entry.mmsi);
    if (score !== null) logged.push({ entry, score });
  }
  logged.sort(
    (a, b) =>
      a.score - b.score || b.entry.lastSeen.localeCompare(a.entry.lastSeen),
  );

  const liveShown = live.slice(0, MAX_SEARCH_RESULTS);
  const loggedShown = logged.slice(0, MAX_SEARCH_RESULTS - liveShown.length);
  return {
    live: liveShown.map(({ ship }) => ship),
    logged: loggedShown.map(({ entry }) => entry),
    more: live.length + logged.length - liveShown.length - loggedShown.length,
  };
}
