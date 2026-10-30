// Simple 3D ship models for the tilted map, built from blocks the map can
// extrude (each a flat outline with a base and top height in metres). There's
// no source of real models by MMSI, so each ship gets a generic one for its
// kind, scaled to its AIS measurements like its hull outline.

import type { ShipDimensions } from "../types/ais";
import { hullFrame, hullHeights, hullOutline } from "./hull";

export type ShipKind = "freighter" | "tanker" | "tug" | "sailboat" | "boat";

/** What a part of a model is, which sets its colour */
export type ModelPart = "hull" | "deck" | "house" | "funnel" | "gear";

export interface ModelBlock {
  outline: [number, number][];
  base: number;
  height: number;
  part: ModelPart;
}

/**
 * The kind of model for a ship, from its AIS ship type (first digit: 3x
 * special craft, 5x service, 7x cargo, 8x tanker) and length
 */
export function shipKind(shipType: number | undefined, length: number): ShipKind {
  const type = shipType ?? 0;
  if (type === 36) return "sailboat";
  if (type >= 80 && type <= 89) return "tanker";
  if (type === 31 || type === 32 || type === 52) return "tug";
  if (length < 60) return "boat";
  return "freighter";
}

// A rectangle in a hull's local frame: x to starboard, y towards the bow
const rect = (x0: number, x1: number, y0: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];

/**
 * A ship as extrudable blocks: its hull and, by kind, what stands on its
 * deck. Drawn to the same scale as hullOutline (blown up to minLength and
 * minBeam metres when small on screen). Empty when its measurements aren't known.
 */
export function shipModel(
  latitude: number,
  longitude: number,
  headingDeg: number,
  dimensions: ShipDimensions,
  kind: ShipKind,
  minLength = 0,
  minBeam = 0
): ModelBlock[] {
  const frame = hullFrame(latitude, longitude, headingDeg, dimensions, minLength, minBeam);
  const outline = hullOutline(latitude, longitude, headingDeg, dimensions, minLength, minBeam);
  if (!frame || !outline) return [];
  const { toBow, toStern, toPort, toStarboard, place } = frame;
  const L = toBow + toStern;
  const B = toPort + toStarboard;
  const mid = (toStarboard - toPort) / 2;
  const { deck, house } = hullHeights(L);
  const houseRise = house - deck;
  // Along the hull from the stern (0) to the bow (1), and across it from the
  // centreline (as a share of the beam)
  const at = (share: number): number => -toStern + L * share;
  const across = (share: number): [number, number] => [mid - (B * share) / 2, mid + (B * share) / 2];
  const block = (
    width: number,
    from: number,
    to: number,
    base: number,
    height: number,
    part: ModelPart,
    offset = 0
  ): ModelBlock => {
    const [x0, x1] = across(width);
    return { outline: place(rect(x0 + offset, x1 + offset, at(from), at(to))), base, height, part };
  };

  const blocks: ModelBlock[] = [{ outline, base: 0, height: deck, part: "hull" }];

  if (kind === "freighter" || kind === "tanker") {
    // Raised bow (forecastle), following the hull's point
    const bowLength = Math.min(B, L * 0.2);
    const fore = at(0.9);
    blocks.push({
      outline: place([
        [-toPort, fore],
        [toStarboard, fore],
        [toStarboard, toBow - bowLength],
        [mid, toBow],
        [-toPort, toBow - bowLength],
        [-toPort, fore],
      ]),
      base: deck,
      height: deck + 2.5,
      part: "hull",
    });
    // Accommodation aft: a broad base, a narrower tier, and the bridge across
    // the full beam on top, with the funnel behind
    blocks.push(block(0.92, 0.02, 0.14, deck, deck + houseRise * 0.45, "house"));
    blocks.push(block(0.78, 0.04, 0.12, deck, deck + houseRise * 0.8, "house"));
    blocks.push(block(1, 0.09, 0.125, deck + houseRise * 0.8, house, "house"));
    blocks.push(block(0.16, 0.045, 0.075, deck + houseRise * 0.6, house + 4, "funnel"));
  }

  if (kind === "freighter") {
    // A row of hatch covers down the cargo deck
    const hatches = Math.max(4, Math.round(L / 14));
    const start = 0.17;
    const end = 0.87;
    const pitch = (end - start) / hatches;
    for (let i = 0; i < hatches; i++) {
      const from = start + pitch * i;
      blocks.push(block(0.72, from + pitch * 0.1, from + pitch * 0.9, deck, deck + 0.9, "deck"));
    }
    // Self-unloader boom, stowed along the deck from the aft house
    blocks.push(block(0.05, 0.14, 0.5, deck + 1.5, deck + 2.8, "gear", -B * 0.3));
  }

  if (kind === "tanker") {
    // Pipe run along the centreline, and a catwalk over it
    blocks.push(block(0.4, 0.15, 0.88, deck, deck + 0.8, "deck"));
    blocks.push(block(0.06, 0.15, 0.88, deck + 0.8, deck + 2, "gear"));
  }

  if (kind === "tug" || kind === "boat") {
    // House amidships, wheelhouse on top, funnel behind
    blocks.push(block(0.7, 0.35, 0.7, deck, deck + houseRise * 0.6, "house"));
    blocks.push(block(0.6, 0.55, 0.7, deck + houseRise * 0.6, deck + houseRise, "house"));
    if (kind === "tug") blocks.push(block(0.2, 0.42, 0.5, deck + houseRise * 0.6, house + 1, "funnel"));
  }

  if (kind === "sailboat") {
    // Cabin and a mast about as tall as the boat is long
    blocks.push(block(0.55, 0.3, 0.6, deck, deck + 1.2, "house"));
    blocks.push(block(0.06, 0.6, 0.62, deck, deck + L * 1.1, "gear"));
  }

  return blocks;
}
