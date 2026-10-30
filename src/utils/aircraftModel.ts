// Simple 3D aircraft models for the tilted map, built like the ship models
// (utils/shipModel.ts) from blocks the map can extrude, but floating at the
// aircraft's height. Each gets a generic plane or helicopter sized for its
// ADS-B emitter category.

import type { Aircraft } from "../types/aircraft";
import { isRotorcraft } from "./aircraft";
import { localPlacer } from "./hull";

/** What a part of a model is, which sets its colour */
export type AircraftPart = "body" | "wing" | "engine" | "rotor";

export interface AircraftBlock {
  outline: [number, number][];
  /** Metres above the water */
  base: number;
  height: number;
  part: AircraftPart;
  /** Seen from above, so drawn in the shadow on the ground */
  casts: boolean;
}

export interface AircraftShape {
  /** Nose to tail, metres (for a helicopter, rotor tip to tail) */
  length: number;
  /** Wingtip to wingtip, or the rotor's diameter */
  span: number;
  /** Swept-back wings and engines under them */
  jet: boolean;
  rotorcraft: boolean;
}

const FEET_TO_METRES = 0.3048;
// The map has no terrain: its ground is the river, about Lake Huron's level
// above the sea. Barometric altitudes are measured from the sea
const GROUND_ELEVATION_FT = 580;

/**
 * How high to draw an aircraft, in metres above the map: 0 on the ground,
 * null when its altitude isn't known
 */
export function aircraftHeight(aircraft: Aircraft): number | null {
  if (aircraft.onGround) return 0;
  if (aircraft.altitude === undefined) return null;
  return Math.max(0, (aircraft.altitude - GROUND_ELEVATION_FT) * FEET_TO_METRES);
}

// Rough sizes by ADS-B emitter category: A1 light (a Cessna), A2 small (a
// regional turboprop), A3 large (a 737), A4 a 757, A5 heavy (a 777), A6
// fast (a fighter), A7 rotorcraft, B1 glider, B4 ultralight, B6 drone
const SHAPES: Record<string, AircraftShape> = {
  A1: { length: 8, span: 11, jet: false, rotorcraft: false },
  A2: { length: 22, span: 26, jet: false, rotorcraft: false },
  A3: { length: 38, span: 35, jet: true, rotorcraft: false },
  A4: { length: 47, span: 38, jet: true, rotorcraft: false },
  A5: { length: 64, span: 62, jet: true, rotorcraft: false },
  A6: { length: 17, span: 11, jet: true, rotorcraft: false },
  A7: { length: 13, span: 11, jet: false, rotorcraft: true },
  B1: { length: 8, span: 15, jet: false, rotorcraft: false },
  B4: { length: 6, span: 10, jet: false, rotorcraft: false },
  B6: { length: 2, span: 3, jet: false, rotorcraft: false },
};
// Most of what flies without saying is light aircraft
const DEFAULT_SHAPE = SHAPES.A1;

export function aircraftShape(aircraft: Aircraft): AircraftShape {
  if (isRotorcraft(aircraft)) return SHAPES.A7;
  return SHAPES[aircraft.category ?? ""] ?? DEFAULT_SHAPE;
}

/**
 * An aircraft as extrudable blocks, its lowest point at `altitude` metres,
 * pointing along `headingDeg`. Blown up to minLength metres long when smaller,
 * so it stays visible from afar.
 */
export function aircraftModel(
  latitude: number,
  longitude: number,
  headingDeg: number,
  altitude: number,
  shape: AircraftShape,
  minLength = 0
): AircraftBlock[] {
  const scale = Math.max(1, minLength / shape.length);
  const L = shape.length * scale;
  const S = shape.span * scale;
  const place = localPlacer(latitude, longitude, headingDeg);
  // Outlines are in the local frame: x to the right wing, y towards the nose,
  // centred on the reported position
  const block = (
    outline: [number, number][],
    from: number,
    to: number,
    part: AircraftPart,
    casts = true
  ): AircraftBlock => {
    // Counter-clockwise, like the ship models, so the map draws the walls facing out
    const ring = signedArea(outline) < 0 ? [...outline].reverse() : outline;
    return {
      outline: place([...ring, ring[0]]),
      base: altitude + from,
      height: altitude + to,
      part,
      casts,
    };
  };
  const box = (x0: number, x1: number, y0: number, y1: number): [number, number][] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  return shape.rotorcraft ? helicopter(L, S, block, box) : plane(L, S, shape.jet, block, box);
}

function signedArea(ring: [number, number][]): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    area += x0 * y1 - x1 * y0;
  }
  return area / 2;
}

type Block = (outline: [number, number][], from: number, to: number, part: AircraftPart, casts?: boolean) => AircraftBlock;
type Box = (x0: number, x1: number, y0: number, y1: number) => [number, number][];

function plane(L: number, S: number, jet: boolean, block: Block, box: Box): AircraftBlock[] {
  // Fuselage width (and height), raised on jets to clear the engines
  const f = L * 0.1;
  const floor = jet ? f * 0.35 : 0;
  const top = floor + f;
  const blocks: AircraftBlock[] = [];

  // Fuselage: tapering to the tail and to a point at the nose
  blocks.push(
    block(
      [
        [-f * 0.2, -L * 0.5],
        [f * 0.2, -L * 0.5],
        [f / 2, -L * 0.25],
        [f / 2, L * 0.36],
        [f * 0.3, L * 0.46],
        [0, L * 0.5],
        [-f * 0.3, L * 0.46],
        [-f / 2, L * 0.36],
        [-f / 2, -L * 0.25],
      ],
      floor,
      top,
      "body"
    )
  );

  // Wings: swept back on jets, straight and on top of the cabin otherwise.
  // Thicker than true, as the map can't draw their undersides
  const sweep = jet ? 0.45 : 0;
  const wing = (
    span: number,
    rootLead: number,
    rootChord: number,
    tipChord: number,
    from: number,
    to: number
  ): AircraftBlock => {
    const tipLead = rootLead - (span / 2) * sweep;
    return block(
      [
        [0, rootLead],
        [span / 2, tipLead],
        [span / 2, tipLead - tipChord],
        [0, rootLead - rootChord],
        [-span / 2, tipLead - tipChord],
        [-span / 2, tipLead],
      ],
      from,
      to,
      "wing"
    );
  };
  const wingAt = jet ? floor + f * 0.15 : floor + f * 0.75;
  blocks.push(wing(S, L * 0.12, L * 0.2, L * 0.06, wingAt, wingAt + f * 0.25));
  // Tailplane and fin
  blocks.push(wing(S * 0.38, -L * 0.36, L * 0.12, L * 0.05, floor + f * 0.55, floor + f * 0.7));
  blocks.push(block(box(-f * 0.07, f * 0.07, -L * 0.5, -L * 0.33), top - f * 0.2, top + L * 0.16, "body", false));

  if (jet) {
    // An engine under each wing
    const x = S * 0.17;
    const y = L * 0.12 - x * sweep;
    const w = f * 0.3;
    for (const side of [-1, 1]) {
      blocks.push(block(box(side * x - w, side * x + w, y - L * 0.08, y + L * 0.04), 0, f * 0.5, "engine"));
    }
  }
  return blocks;
}

function helicopter(L: number, D: number, block: Block, box: Box): AircraftBlock[] {
  // Skids, cabin, tail boom and fin, and two blades crossed over the cabin
  const w = L * 0.2;
  const skidTop = L * 0.04;
  const cabinTop = L * 0.25;
  const mast = L * 0.12;
  const blade = L * 0.05;
  const blocks: AircraftBlock[] = [];
  for (const side of [-1, 1]) {
    blocks.push(block(box(side * w * 0.6 - L * 0.015, side * w * 0.6 + L * 0.015, -L * 0.1, L * 0.3), 0, skidTop, "rotor"));
  }
  blocks.push(
    block(
      [
        [-w * 0.35, -L * 0.1],
        [w * 0.35, -L * 0.1],
        [w / 2, L * 0.02],
        [w / 2, L * 0.25],
        [w * 0.3, L * 0.36],
        [-w * 0.3, L * 0.36],
        [-w / 2, L * 0.25],
        [-w / 2, L * 0.02],
      ],
      skidTop,
      cabinTop,
      "body"
    )
  );
  blocks.push(block(box(-L * 0.03, L * 0.03, -L * 0.5, -L * 0.08), cabinTop - L * 0.12, cabinTop - L * 0.06, "body"));
  blocks.push(block(box(-L * 0.015, L * 0.015, -L * 0.5, -L * 0.42), cabinTop - L * 0.1, cabinTop + L * 0.02, "body", false));
  blocks.push(block(box(-L * 0.03, L * 0.03, L * 0.1, L * 0.16), cabinTop, cabinTop + mast, "rotor", false));
  // Rotor hub over the mast; blades at 45° to the boom
  const hubY = L * 0.13;
  const r = D / 2;
  const diagonal = (sign: number): [number, number][] => {
    const c = Math.SQRT1_2;
    const along: [number, number] = [r * c, sign * r * c];
    const across: [number, number] = [-sign * (blade / 2) * c, (blade / 2) * c];
    return [
      [-along[0] - across[0], hubY - along[1] - across[1]],
      [-along[0] + across[0], hubY - along[1] + across[1]],
      [along[0] + across[0], hubY + along[1] + across[1]],
      [along[0] - across[0], hubY + along[1] - across[1]],
    ];
  };
  for (const sign of [-1, 1]) {
    blocks.push(block(diagonal(sign), cabinTop + mast, cabinTop + mast + L * 0.025, "rotor"));
  }
  return blocks;
}
