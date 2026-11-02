// Ships are updated in batches rather than one AIS message at a time: a busy
// feed (or the server replaying every ship's latest position on subscribe)
// would otherwise copy the whole map and re-render the app for each message.

import type { TrackedShip } from "../types/ais";

function isStale(ship: TrackedShip, now: number, staleTimeout: number): boolean {
  // An unparseable time counts as stale, as it did when purged per message
  return !(now - Date.parse(ship.lastUpdate) <= staleTimeout);
}

/**
 * A new map with each update applied, keeping the ships that didn't change as
 * the same objects (so memoised rows and markers skip them). An update older
 * than the ship it replaces, or already stale, is dropped. Returns `state`
 * itself when nothing changes.
 */
export function applyShipUpdates(
  state: Map<number, TrackedShip>,
  updates: Iterable<TrackedShip>,
  now: number,
  staleTimeout: number
): Map<number, TrackedShip> {
  let next: Map<number, TrackedShip> | undefined;
  for (const ship of updates) {
    if (isStale(ship, now, staleTimeout)) continue;
    const existing = state.get(ship.mmsi);
    // With two feeds, one's report can land after a newer one from the
    // other; drawing it would pull the ship back
    if (existing && Date.parse(ship.lastUpdate) < Date.parse(existing.lastUpdate)) continue;
    next ??= new Map(state);
    next.set(ship.mmsi, ship);
  }
  return next ?? state;
}

/** Ships not heard from within `staleTimeout`, dropped; `state` itself when there are none */
export function purgeStaleShips(
  state: Map<number, TrackedShip>,
  now: number,
  staleTimeout: number
): Map<number, TrackedShip> {
  let next: Map<number, TrackedShip> | undefined;
  for (const [mmsi, ship] of state) {
    if (!isStale(ship, now, staleTimeout)) continue;
    next ??= new Map(state);
    next.delete(mmsi);
  }
  return next ?? state;
}
