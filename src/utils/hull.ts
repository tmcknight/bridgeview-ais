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

// A hull's measurements, scaled up to any minimum size, and a way to turn
// points in its local frame (metres from the antenna: x to starboard, y
// towards the bow) into [lng, lat] at its heading
export interface HullFrame {
  toBow: number;
  toStern: number;
  toPort: number;
  toStarboard: number;
  place: (local: [number, number][]) => [number, number][];
}

export function hullFrame(
  latitude: number,
  longitude: number,
  headingDeg: number,
  dimensions: ShipDimensions,
  minLength: number,
  minBeam: number
): HullFrame | null {
  if (!hasHull(dimensions)) return null;
  const length = dimensions.toBow + dimensions.toStern;
  const beam = dimensions.toPort + dimensions.toStarboard;
  const lengthScale = Math.max(1, minLength / length);
  const beamScale = Math.max(lengthScale, minBeam / beam);

  const heading = headingDeg * DEG_TO_RAD;
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  const metresPerDegreeLng = METRES_PER_DEGREE_LAT * Math.cos(latitude * DEG_TO_RAD);

  return {
    toBow: dimensions.toBow * lengthScale,
    toStern: dimensions.toStern * lengthScale,
    toPort: dimensions.toPort * beamScale,
    toStarboard: dimensions.toStarboard * beamScale,
    place: (local) =>
      local.map(([x, y]) => {
        // Heading is clockwise from north
        const east = x * cos + y * sin;
        const north = -x * sin + y * cos;
        return [longitude + east / metresPerDegreeLng, latitude + north / METRES_PER_DEGREE_LAT];
      }),
  };
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
  const frame = hullFrame(latitude, longitude, headingDeg, dimensions, minLength, minBeam);
  if (!frame) return null;
  const { toBow, toStern, toPort, toStarboard } = frame;
  const bowLength = Math.min(toPort + toStarboard, (toBow + toStern) * 0.2);
  const centreline = (toStarboard - toPort) / 2;
  return frame.place([
    [-toPort, -toStern],
    [toStarboard, -toStern],
    [toStarboard, toBow - bowLength],
    [centreline, toBow],
    [-toPort, toBow - bowLength],
    [-toPort, -toStern],
  ]);
}

/** Rough heights in metres above the water for drawing a ship in 3D */
export function hullHeights(length: number): { deck: number; house: number } {
  const deck = Math.min(10, Math.max(1.5, length * 0.045));
  return { deck, house: deck + Math.min(14, Math.max(2.5, length * 0.06)) };
}

/** A band of a ship's wake: its outline and how strongly to draw it */
export interface WakeBand {
  outline: [number, number][];
  opacity: number;
}

// Wake length per knot, as a share of the ship's length, and the most it gets
const WAKE_LENGTH_PER_KNOT = 0.07;
const WAKE_MAX_LENGTHS = 0.8;
// Faint wedges stacked from the stern, each narrower and a little shorter
// than the last, so the wake fades out without a visible edge (map fills
// can't do gradients)
const WAKE_BANDS = 8;
const WAKE_BAND_OPACITY = 0.015;
// Bow waves: the crest's angle back from the bow and the hull side's
// (degrees off the centreline), length per knot as a share of the ship's
// length, the most they get, and how many faint wedges fill each from hull
// to crest, and how strongly each is drawn
const BOW_WAVE_CREST_ANGLE = 35;
const BOW_WAVE_HULL_ANGLE = 25;
const BOW_WAVE_LENGTH_PER_KNOT = 0.03;
const BOW_WAVE_MAX_LENGTHS = 0.35;
const BOW_WAVE_BANDS = 4;
const BOW_WAVE_OPACITY = 0.01;
// How far each side of the wake spreads per metre behind the stern
const WAKE_SPREAD = 0.1;

/**
 * A ship's wake: a V of churned water spreading back from the stern, longer
 * the faster it goes, fading out to the sides and behind, and a thin bow
 * wave angling back from each side of the bow.
 * Empty when it's barely moving or its hull isn't known; drawn to the same
 * scale as hullOutline.
 */
export function wakeOutline(
  latitude: number,
  longitude: number,
  headingDeg: number,
  dimensions: ShipDimensions,
  speedKn: number,
  minLength = 0,
  minBeam = 0
): WakeBand[] {
  const frame = hullFrame(latitude, longitude, headingDeg, dimensions, minLength, minBeam);
  if (!frame || !(speedKn >= 1)) return [];
  const { toBow, toStern, toPort, toStarboard } = frame;
  const length = Math.min(WAKE_MAX_LENGTHS, speedKn * WAKE_LENGTH_PER_KNOT) * (toBow + toStern);
  // Narrower bands stack up in the middle, each a little shorter, so the
  // wake fades out to the sides and, in the middle, behind
  const band = (share: number, opacity: number): WakeBand => {
    const back = -toStern - length * (0.5 + 0.5 * share);
    const spread = length * share * WAKE_SPREAD;
    return {
      outline: frame.place([
        [-toPort, -toStern],
        [toStarboard, -toStern],
        [toStarboard + spread, back],
        [-toPort - spread, back],
        [-toPort, -toStern],
      ]),
      opacity,
    };
  };
  const stern = Array.from({ length: WAKE_BANDS }, (_, i) =>
    band((WAKE_BANDS - i) / WAKE_BANDS, WAKE_BAND_OPACITY)
  );

  // Bow waves: fans from the bow's point, out to a crest angling back each
  // side; wedges stacked toward the crest, so it fades in toward the hull
  const bowLength = Math.min(BOW_WAVE_MAX_LENGTHS, speedKn * BOW_WAVE_LENGTH_PER_KNOT) * (toBow + toStern);
  const tip: [number, number] = [(toStarboard - toPort) / 2, toBow];
  const ray = (side: number, degrees: number): [number, number] => {
    const angle = (degrees * Math.PI) / 180;
    return [tip[0] + side * Math.sin(angle) * bowLength, tip[1] - Math.cos(angle) * bowLength];
  };
  const bowWave = (side: number, inner: number): WakeBand => ({
    outline: frame.place([tip, ray(side, inner), ray(side, BOW_WAVE_CREST_ANGLE), tip]),
    opacity: BOW_WAVE_OPACITY,
  });
  const span = BOW_WAVE_CREST_ANGLE - BOW_WAVE_HULL_ANGLE;
  const bow = [-1, 1].flatMap((side) =>
    Array.from({ length: BOW_WAVE_BANDS }, (_, i) =>
      bowWave(side, BOW_WAVE_HULL_ANGLE + (span * i) / BOW_WAVE_BANDS)
    )
  );

  return [...stern, ...bow];
}
