// A rough 3D model of the Blue Water Bridge for the tilted map view: two
// parallel spans built from blocks the map can extrude (each block has a
// base and a top height in metres). The 1938 span is a cantilever truss, the
// 1997 span a tied arch; both clear the river by about 46 m.

import type { FeatureCollection, Polygon } from "geojson";
import { BRIDGE_AIR_DRAFT_M, BRIDGE_CENTER } from "../constants/bridge";

type LngLat = [number, number];

interface Span {
  structure: "arch" | "truss";
  /** Centreline, west to east, from OpenStreetMap */
  line: LngLat[];
}

const SPANS: Span[] = [
  {
    // Westbound, 1997
    structure: "arch",
    line: [
      [-82.432707, 42.999294], [-82.429761, 42.999637], [-82.429219, 42.999687],
      [-82.428768, 42.9997], [-82.428255, 42.99969], [-82.427771, 42.999655],
      [-82.42718, 42.999574], [-82.426294, 42.999397], [-82.425014, 42.999119],
      [-82.423569, 42.998825], [-82.421219, 42.998371], [-82.419919, 42.998112],
      [-82.419462, 42.997998], [-82.418926, 42.997824], [-82.418401, 42.997635],
      [-82.417929, 42.997415], [-82.417648, 42.997267], [-82.416379, 42.996548],
      [-82.415025, 42.995768], [-82.413404, 42.994901],
    ],
  },
  {
    // Eastbound, 1938
    structure: "truss",
    line: [
      [-82.431367, 42.999107], [-82.430851, 42.99917], [-82.429766, 42.999279],
      [-82.429235, 42.999322], [-82.428716, 42.999329], [-82.428066, 42.999296],
      [-82.427346, 42.999201], [-82.426968, 42.99913], [-82.425176, 42.998768],
      [-82.423834, 42.998494], [-82.421221, 42.997982], [-82.419951, 42.997732],
      [-82.419028, 42.99754], [-82.418442, 42.997393], [-82.418022, 42.99724],
      [-82.417668, 42.997085], [-82.417308, 42.996891], [-82.416481, 42.996412],
      [-82.414859, 42.99549], [-82.413525, 42.994786],
    ],
  },
];

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((BRIDGE_CENTER.lat * Math.PI) / 180);

/** Main span over the river, each side of its middle (m) */
const MAIN_HALF = 140;
/** Top of the deck over the main span (m) */
const DECK_TOP = BRIDGE_AIR_DRAFT_M + 4;
const DECK_DEPTH = 3;
const DECK_WIDTH = 14;
/** Length of each deck block (m) */
const STEP = 12;
/** Approach piers this far apart (m) */
const PIER_SPACING = 72;
/** The arch rises this far above the deck at its middle (m) */
const ARCH_RISE = 34;
/** The truss stands this high over the main piers, and dips to this at midspan (m) */
const TRUSS_OVER_PIERS = 30;
const TRUSS_MIDSPAN = 12;
/** ...and runs down to the deck over this much of each side span (m) */
const TRUSS_SIDE = 110;

const COLORS = {
  deck: "#94a3b8",
  pier: "#cbd5e1",
  arch: "#e2e8f0",
  truss: "#5b8f86",
};

// Metres east/north of the bridge centre, and back
const toXY = ([lng, lat]: LngLat): [number, number] => [
  (lng - BRIDGE_CENTER.lng) * M_PER_DEG_LNG,
  (lat - BRIDGE_CENTER.lat) * M_PER_DEG_LAT,
];
const toLngLat = ([x, y]: [number, number]): LngLat => [
  BRIDGE_CENTER.lng + x / M_PER_DEG_LNG,
  BRIDGE_CENTER.lat + y / M_PER_DEG_LAT,
];

interface Station {
  /** Distance along the span from its middle over the river (m; west negative) */
  s: number;
  x: number;
  y: number;
  /** Unit vector along the span */
  dx: number;
  dy: number;
}

// Points every STEP metres along a span, measured from where it crosses the
// river (the point nearest the bridge centre)
function stations(line: LngLat[]): Station[] {
  const pts = line.map(toXY);
  const out: Station[] = [];
  let start = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const length = Math.hypot(x1 - x0, y1 - y0);
    const dx = (x1 - x0) / length;
    const dy = (y1 - y0) / length;
    // Carry on from wherever the last segment's steps left off
    const first = Math.ceil(start / STEP) * STEP - start;
    for (let d = first; d < length; d += STEP) {
      out.push({ s: start + d, x: x0 + dx * d, y: y0 + dy * d, dx, dy });
    }
    start += length;
  }
  const middle = out.reduce((best, st) =>
    Math.hypot(st.x, st.y) < Math.hypot(best.x, best.y) ? st : best,
  ).s;
  return out.map((st) => ({ ...st, s: st.s - middle }));
}

// Deck top: level over the main span, ramping down to the ground at each end
function deckTop(s: number, west: number, east: number): number {
  if (Math.abs(s) <= MAIN_HALF) return DECK_TOP;
  const end = s < 0 ? west : east;
  const t = (Math.abs(s) - MAIN_HALF) / (Math.abs(end) - MAIN_HALF);
  return Math.max(2, DECK_TOP * (1 - t));
}

function archRise(s: number): number {
  const t = s / MAIN_HALF;
  return Math.abs(t) < 1 ? ARCH_RISE * (1 - t * t) : 0;
}

function trussRise(s: number): number {
  const a = Math.abs(s);
  if (a <= MAIN_HALF) return TRUSS_MIDSPAN + (TRUSS_OVER_PIERS - TRUSS_MIDSPAN) * (a / MAIN_HALF) ** 2;
  if (a <= MAIN_HALF + TRUSS_SIDE) return TRUSS_OVER_PIERS * (1 - (a - MAIN_HALF) / TRUSS_SIDE);
  return 0;
}

// A block centred on a station: `length` along the span, `width` across it,
// shifted `offset` metres to the side
function block(
  st: Station,
  length: number,
  width: number,
  base: number,
  height: number,
  color: string,
  offset = 0,
): FeatureCollection<Polygon>["features"][number] {
  const { x, y, dx, dy } = st;
  // Perpendicular, to the left of the direction of travel
  const px = -dy;
  const py = dx;
  const cx = x + px * offset;
  const cy = y + py * offset;
  const corner = (a: number, b: number): LngLat =>
    toLngLat([cx + dx * a + px * b, cy + dy * a + py * b]);
  const l = length / 2;
  const w = width / 2;
  return {
    type: "Feature",
    properties: { color, base, height },
    geometry: {
      type: "Polygon",
      coordinates: [[corner(-l, -w), corner(l, -w), corner(l, w), corner(-l, w), corner(-l, -w)]],
    },
  };
}

/** The bridge as extrudable blocks, each with `color`, `base` and `height` */
export function buildBridgeModel(): FeatureCollection<Polygon> {
  const features: FeatureCollection<Polygon>["features"] = [];
  for (const span of SPANS) {
    const points = stations(span.line);
    const west = points[0].s;
    const east = points[points.length - 1].s;
    for (const st of points) {
      const top = deckTop(st.s, west, east);
      features.push(block(st, STEP + 0.5, DECK_WIDTH, Math.max(0, top - DECK_DEPTH), top, COLORS.deck));

      // Main piers by each bank, and lighter ones under the approaches
      const a = Math.abs(st.s);
      if (Math.abs(a - MAIN_HALF) < STEP / 2) {
        features.push(block(st, 10, DECK_WIDTH + 2, 0, top - DECK_DEPTH, COLORS.pier));
      } else if (a > MAIN_HALF && a % PIER_SPACING < STEP && top > 8) {
        features.push(block(st, 3, DECK_WIDTH - 2, 0, top - DECK_DEPTH, COLORS.pier));
      }

      // Arch or truss above the deck, along both edges
      const rise = span.structure === "arch" ? archRise(st.s) : trussRise(st.s);
      if (rise <= 0) continue;
      const color = span.structure === "arch" ? COLORS.arch : COLORS.truss;
      for (const side of [-1, 1]) {
        const offset = (side * (DECK_WIDTH - 1)) / 2;
        // Top chord
        features.push(block(st, STEP + 0.5, 1.2, top + rise - 2, top + rise, color, offset));
        // Hangers (arch) or verticals (truss) every other block
        if (Math.round(st.s / STEP) % 2 === 0) {
          features.push(block(st, 0.8, 0.8, top, top + rise, color, offset));
        }
      }
    }
  }
  return { type: "FeatureCollection", features };
}
