// Rough cargo guesses from a ship's AIS destination. Great Lakes bulk
// carriers run a handful of fixed trades, so the destination port usually
// says what the ship is about to load (or deliver). These are guesses: the
// AIS destination is free text typed by the crew and is often stale.
// Only cargo ships and tankers 100 m or longer are guessed for: a tug or a
// yacht bound for Duluth isn't going to load iron ore.

interface PortCargo {
  pattern: RegExp;
  cargo: string;
  /** "load": the port ships cargo out; "deliver": the port receives it */
  role: "load" | "deliver";
}

const PORTS: PortCargo[] = [
  { pattern: /STONEPORT|CALCITE|ROGERS CITY|PORT INLAND|CEDARVILLE|DRUMMOND|MARBLEHEAD|PORT DOLOMITE/, cargo: "limestone", role: "load" },
  { pattern: /DULUTH|TWO HARBORS|SILVER BAY|MARQUETTE|ESCANABA/, cargo: "iron ore", role: "load" },
  { pattern: /SUPERIOR/, cargo: "iron ore or coal", role: "load" },
  { pattern: /THUNDER BAY/, cargo: "grain", role: "load" },
  { pattern: /ALPENA|CHARLEVOIX/, cargo: "cement", role: "load" },
  { pattern: /GODERICH/, cargo: "salt", role: "load" },
  { pattern: /BURNS HARBOR|INDIANA HARBOR|GARY|ZUG ISLAND|NANTICOKE/, cargo: "iron ore or coal", role: "deliver" },
];

/** Shortest ship guessed for, in metres */
export const MIN_CARGO_LENGTH_M = 100;

export interface CargoGuess {
  cargo: string;
  role: "load" | "deliver";
}

/**
 * Guess the cargo trade from an AIS destination, or null if the port isn't
 * one with a well-known bulk trade, or the ship isn't a cargo ship or tanker
 * (AIS types 70–89) of MIN_CARGO_LENGTH_M or more.
 */
export function guessCargo({
  destination,
  shipType,
  length,
}: {
  destination?: string;
  shipType?: number;
  length?: number;
}): CargoGuess | null {
  if (!destination || shipType === undefined || shipType < 70 || shipType > 89) return null;
  if (!(length !== undefined && length >= MIN_CARGO_LENGTH_M)) return null;
  const dest = destination.toUpperCase();
  const match = PORTS.find((port) => port.pattern.test(dest));
  return match ? { cargo: match.cargo, role: match.role } : null;
}

/**
 * Human-readable cargo guess, e.g. "Likely going to load limestone".
 */
export function describeCargo(guess: CargoGuess): string {
  return guess.role === "load"
    ? `Likely going to load ${guess.cargo}`
    : `Likely delivering ${guess.cargo}`;
}
