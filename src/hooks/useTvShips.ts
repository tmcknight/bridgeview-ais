import { useMemo, useState } from "react";
import type { TrackedShip } from "../types/ais";
import type { UpcomingPassage } from "../utils/upcoming";
import { getApproachingShip, getPassingShip, shouldFollow } from "../utils/tvMode";

export interface TvShips {
  /** Going by the bridge now: show it on the cam */
  passing: TrackedShip | null;
  /** Heading for the bridge: show its details until it's passing */
  approaching: UpcomingPassage | null;
  /** Close enough to follow on the map: the approaching ship, or null */
  following: TrackedShip | null;
}

/**
 * The ships TV mode shows, each kept until it's well past or turned away so
 * the screen doesn't jump between ships. Nothing while disabled.
 */
export function useTvShips(ships: Map<number, TrackedShip>, enabled: boolean): TvShips {
  const [passingMmsi, setPassingMmsi] = useState<number | null>(null);
  const [approachingMmsi, setApproachingMmsi] = useState<number | null>(null);
  const [followingMmsi, setFollowingMmsi] = useState<number | null>(null);

  const passing = useMemo(
    () => (enabled ? getPassingShip(ships.values(), passingMmsi) : null),
    [ships, passingMmsi, enabled],
  );
  const approaching = useMemo(
    () => (enabled ? getApproachingShip(ships.values(), approachingMmsi) : null),
    [ships, approachingMmsi, enabled],
  );

  const nextPassing = passing?.mmsi ?? null;
  if (nextPassing !== passingMmsi) setPassingMmsi(nextPassing);
  const nextApproaching = approaching?.ship.mmsi ?? null;
  if (nextApproaching !== approachingMmsi) setApproachingMmsi(nextApproaching);
  const following =
    approaching && shouldFollow(approaching, approaching.ship.mmsi === followingMmsi)
      ? approaching.ship
      : null;
  const nextFollowing = following?.mmsi ?? null;
  if (nextFollowing !== followingMmsi) setFollowingMmsi(nextFollowing);

  return { passing, approaching, following };
}
