import { BRIDGE_CENTER, MAX_TRACKING_DISTANCE_NM } from "../constants/bridge";

const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_NM = 3440.065; // Earth radius in nautical miles

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
 * Calculate distance from a ship's position to the Blue Water Bridge.
 */
export function distanceToBridge(lat: number, lon: number): number {
  return haversineDistanceNM(lat, lon, BRIDGE_CENTER.lat, BRIDGE_CENTER.lng);
}

/**
 * Determine if a ship is approaching the bridge based on its course over ground.
 * Ships coming from north (Lake Huron) have COG ~180° (southbound).
 * Ships coming from south (Lake St. Clair) have COG ~0°/360° (northbound).
 * The bridge runs roughly east-west, so ships traveling roughly N or S are approaching.
 */
export function isApproaching(
  lat: number,
  lon: number,
  cog: number,
  sog: number
): boolean {
  if (sog < 0.5) return false; // Ship is essentially stationary

  const dist = haversineDistanceNM(lat, lon, BRIDGE_CENTER.lat, BRIDGE_CENTER.lng);
  const isNorthOfBridge = lat > BRIDGE_CENTER.lat;
  const isSouthOfBridge = lat < BRIDGE_CENTER.lat;

  // Normalize COG to 0-360
  const heading = ((cog % 360) + 360) % 360;

  // Only consider ships within reasonable range
  if (dist > MAX_TRACKING_DISTANCE_NM) return false;

  // Ship is north of bridge and heading south (roughly 135-225°)
  if (isNorthOfBridge && heading > 135 && heading < 225) return true;

  // Ship is south of bridge and heading north (roughly 315-360 or 0-45°)
  if (isSouthOfBridge && (heading > 315 || heading < 45)) return true;

  return false;
}

/**
 * Format distance for display
 */
export function formatDistance(distanceNM: number): string {
  if (distanceNM < 0.1) return "< 0.1 NM";
  return `${distanceNM.toFixed(1)} NM`;
}

/**
 * Format speed for display
 */
export function formatSpeed(sog: number): string {
  return `${sog.toFixed(1)} kn`;
}

/**
 * Format heading for display
 */
export function formatHeading(heading: number): string {
  if (heading === 511) return "N/A"; // 511 = not available
  return `${Math.round(heading)}°`;
}

/**
 * Estimated time to bridge in minutes based on distance and speed
 */
export function estimatedTimeToBridge(
  distanceNM: number,
  sogKnots: number
): number | null {
  if (sogKnots < 0.5) return null;
  return (distanceNM / sogKnots) * 60;
}

/**
 * Format ETA in a human-readable way
 */
export function formatETA(minutes: number | null): string {
  if (minutes === null) return "N/A";
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `~${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `~${hours}h ${mins}m`;
}
