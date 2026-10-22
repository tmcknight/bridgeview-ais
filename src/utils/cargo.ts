// Rough cargo guesses from a ship's AIS destination. Great Lakes bulk
// carriers run a handful of fixed trades, so the destination port usually
// says what the ship is about to load (or deliver). These are guesses: the
// AIS destination is free text typed by the crew and is often stale.

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

export interface CargoGuess {
  cargo: string;
  role: "load" | "deliver";
}

/**
 * Guess the cargo trade from an AIS destination, or null if the port
 * isn't one with a well-known bulk trade.
 */
export function guessCargo(destination: string | undefined): CargoGuess | null {
  if (!destination) return null;
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
