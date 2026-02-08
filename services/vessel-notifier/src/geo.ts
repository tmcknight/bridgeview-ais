/** Blue Water Bridge center coordinates */
export const BRIDGE_CENTER = {
  lat: 42.9982,
  lng: -82.423,
};

/** AIS bounding box for the tracking area around the bridge */
export const AIS_BOUNDING_BOX: [[number, number], [number, number]] = [
  [42.9, -82.55],
  [43.1, -82.3],
];

/** Distance thresholds */
export const CLOSE_APPROACH_DISTANCE_NM = 0.5;

const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_NM = 3440.065;

/**
 * Calculate distance between two coordinates using the Haversine formula.
 * Returns distance in nautical miles.
 */
export function haversineDistanceNM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * DEG_TO_RAD) *
      Math.cos(lat2 * DEG_TO_RAD) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_NM * c;
}

/**
 * Calculate distance from a position to the Blue Water Bridge.
 */
export function distanceToBridge(lat: number, lon: number): number {
  return haversineDistanceNM(lat, lon, BRIDGE_CENTER.lat, BRIDGE_CENTER.lng);
}

/**
 * Determine the direction of travel relative to the bridge.
 */
export function getDirection(
  cog: number,
  lat: number
): "northbound" | "southbound" {
  const heading = ((cog % 360) + 360) % 360;
  // Northbound: heading roughly 315-45 degrees
  // Southbound: heading roughly 135-225 degrees
  // Default based on position relative to bridge
  if (heading > 315 || heading < 45) return "northbound";
  if (heading > 135 && heading < 225) return "southbound";
  // Ambiguous - use position relative to bridge
  return lat > BRIDGE_CENTER.lat ? "southbound" : "northbound";
}
