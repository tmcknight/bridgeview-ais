import type { ShipDimensions } from "../types/ais";

const DEG_TO_RAD = Math.PI / 180;
const METRES_PER_DEGREE_LAT = 111_320;
// MapLibre's 512px world at zoom 0, at the equator
const METRES_PER_PIXEL_Z0 = 40_075_016.686 / 512;

/** Ground metres covered by one screen pixel at this zoom and latitude */
export function metresPerPixel(zoom: number, latitude: number): number {
  return (METRES_PER_PIXEL_Z0 * Math.cos(latitude * DEG_TO_RAD)) / 2 ** zoom;
}

/** Whether a ship's measurements are known well enough to draw its hull */
export function hasHull(dimensions?: ShipDimensions): dimensions is ShipDimensions {
  if (!dimensions) return false;
  return dimensions.toBow + dimensions.toStern > 0 && dimensions.toPort + dimensions.toStarboard > 0;
}

/**
 * Outline of a ship's hull as [lng, lat] points (closed ring), drawn to scale
 * around its AIS antenna and turned to its heading. Square stern, pointed bow.
 * A hull shorter than minLength (or narrower than minBeam) metres is blown up
 * around the antenna so it stays visible when zoomed out.
 * Returns null when the measurements aren't known (AIS sends 0 for "not available").
 */
export function hullOutline(
  latitude: number,
  longitude: number,
  headingDeg: number,
  dimensions: ShipDimensions,
  minLength = 0,
  minBeam = 0
): [number, number][] | null {
  if (!hasHull(dimensions)) return null;
  const length = dimensions.toBow + dimensions.toStern;
  const beam = dimensions.toPort + dimensions.toStarboard;
  const lengthScale = Math.max(1, minLength / length);
  const beamScale = Math.max(lengthScale, minBeam / beam);
  const toBow = dimensions.toBow * lengthScale;
  const toStern = dimensions.toStern * lengthScale;
  const toPort = dimensions.toPort * beamScale;
  const toStarboard = dimensions.toStarboard * beamScale;

  // Local frame in metres from the antenna: x to starboard, y towards the bow
  const bowLength = Math.min(beam * beamScale, length * lengthScale * 0.2);
  const centreline = (toStarboard - toPort) / 2;
  const local: [number, number][] = [
    [-toPort, -toStern],
    [toStarboard, -toStern],
    [toStarboard, toBow - bowLength],
    [centreline, toBow],
    [-toPort, toBow - bowLength],
    [-toPort, -toStern],
  ];

  const heading = headingDeg * DEG_TO_RAD;
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  const metresPerDegreeLng = METRES_PER_DEGREE_LAT * Math.cos(latitude * DEG_TO_RAD);

  return local.map(([x, y]) => {
    // Heading is clockwise from north
    const east = x * cos + y * sin;
    const north = -x * sin + y * cos;
    return [longitude + east / metresPerDegreeLng, latitude + north / METRES_PER_DEGREE_LAT];
  });
}
