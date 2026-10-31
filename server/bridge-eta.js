import { BRIDGE_CENTER, distanceToBridgeNM } from "./ship-log.js";

// Which ships are heading for the bridge and roughly when they'll get there,
// plus the few ship facts the iOS app and its alerts need. The ETA logic
// mirrors src/utils/upcoming.ts and the cargo guesses src/utils/cargo.ts.

const DEG_TO_RAD = Math.PI / 180;

// Ships slower than this (kn) aren't treated as under way
const MIN_SPEED_KN = 0.5;
// AIS reports SOG 102.3 kn when speed is not available
const SPEED_NOT_AVAILABLE_KN = 102.3;
// Minimum north/south component of the course for a ship to count as heading
// toward the bridge; filters out ships crossing Lake Huron or turning in the river
const MIN_HEADING_COMPONENT = 0.3;
// From the south, ships follow the rivers and Lake St. Clair, ~20% longer than a straight line
const SOUTH_ROUTE_FACTOR = 1.2;
// Destinations that end south of the bridge for a northbound ship
const STOPS_SOUTH_OF_BRIDGE = /SARNIA|PORT HURON|TUG.?ASSIST/;

// Whether a ship is under way toward the bridge and, if so, roughly when it'll
// get there: { etaMinutes, distanceNM, direction }, or null.
// Takes { latitude, longitude, sog, cog, navStatus, destination }.
export function bridgeApproach({ latitude, longitude, sog, cog, navStatus, destination }) {
  if (!(sog >= MIN_SPEED_KN && sog < SPEED_NOT_AVAILABLE_KN)) return null;
  // At anchor or moored
  if (navStatus === 1 || navStatus === 5) return null;
  if (!(cog >= 0 && cog < 360)) return null;

  const northComponent = Math.cos(cog * DEG_TO_RAD);
  const isNorthOfBridge = latitude > BRIDGE_CENTER.lat;

  let direction;
  if (isNorthOfBridge && northComponent <= -MIN_HEADING_COMPONENT) {
    direction = "downbound";
  } else if (!isNorthOfBridge && northComponent >= MIN_HEADING_COMPONENT) {
    if (STOPS_SOUTH_OF_BRIDGE.test(destination?.toUpperCase() ?? "")) return null;
    direction = "upbound";
  } else {
    return null;
  }

  const straightNM = distanceToBridgeNM(latitude, longitude);
  const distanceNM = direction === "upbound" ? straightNM * SOUTH_ROUTE_FACTOR : straightNM;
  return { etaMinutes: (distanceNM / sog) * 60, distanceNM, direction };
}

const CARGO_PORTS = [
  { pattern: /STONEPORT|CALCITE|ROGERS CITY|PORT INLAND|CEDARVILLE|DRUMMOND|MARBLEHEAD|PORT DOLOMITE/, cargo: "limestone", role: "load" },
  { pattern: /DULUTH|TWO HARBORS|SILVER BAY|MARQUETTE|ESCANABA/, cargo: "iron ore", role: "load" },
  { pattern: /SUPERIOR/, cargo: "iron ore or coal", role: "load" },
  { pattern: /THUNDER BAY/, cargo: "grain", role: "load" },
  { pattern: /ALPENA|CHARLEVOIX/, cargo: "cement", role: "load" },
  { pattern: /GODERICH/, cargo: "salt", role: "load" },
  { pattern: /BURNS HARBOR|INDIANA HARBOR|GARY|ZUG ISLAND|NANTICOKE/, cargo: "iron ore or coal", role: "deliver" },
];

// Shortest ship guessed for, in metres; mirrors MIN_CARGO_LENGTH_M in src/utils/cargo.ts
const MIN_CARGO_LENGTH_M = 100;

// e.g. "Likely going to load limestone", or undefined for a port with no well-known
// trade. Only for cargo ships and tankers (AIS types 70–89) of 100 m or more.
export function describeCargo({ destination, shipType, length } = {}) {
  if (!destination || !(shipType >= 70 && shipType <= 89) || !(length >= MIN_CARGO_LENGTH_M)) return undefined;
  const dest = destination.toUpperCase();
  const port = CARGO_PORTS.find(({ pattern }) => pattern.test(dest));
  if (!port) return undefined;
  return port.role === "load" ? `Likely going to load ${port.cargo}` : `Likely delivering ${port.cargo}`;
}

// Alert preferences filter on these
export const SHIP_CATEGORIES = ["cargo", "tanker", "passenger", "other"];

export function shipCategory(shipType) {
  if (shipType >= 70 && shipType <= 79) return "cargo";
  if (shipType >= 80 && shipType <= 89) return "tanker";
  if (shipType >= 60 && shipType <= 69) return "passenger";
  return "other";
}

const SHIP_TYPE_NAMES = {
  30: "Fishing",
  31: "Tug (towing)",
  32: "Tug (towing)",
  33: "Dredger",
  34: "Dive vessel",
  35: "Military",
  36: "Sailing",
  37: "Pleasure craft",
  50: "Pilot",
  51: "Search and rescue",
  52: "Tug",
  53: "Port tender",
  55: "Law enforcement",
  58: "Medical",
};

export function shipTypeName(shipType) {
  if (typeof shipType !== "number") return undefined;
  const category = shipCategory(shipType);
  if (category === "cargo") return "Cargo";
  if (category === "tanker") return "Tanker";
  if (category === "passenger") return "Passenger";
  if (shipType >= 40 && shipType <= 49) return "High-speed craft";
  return SHIP_TYPE_NAMES[shipType];
}

// Flags of the ships seen on the Great Lakes, by the MMSI's first three digits (MID)
const FLAGS = {
  201: "AL", 205: "BE", 209: "CY", 210: "CY", 211: "DE", 212: "CY", 215: "MT", 218: "DE",
  219: "DK", 220: "DK", 224: "ES", 225: "ES", 226: "FR", 227: "FR", 228: "FR", 229: "MT",
  230: "FI", 231: "FO", 232: "GB", 233: "GB", 234: "GB", 235: "GB", 236: "GI", 237: "GR",
  238: "HR", 239: "GR", 240: "GR", 241: "GR", 244: "NL", 245: "NL", 246: "NL", 247: "IT",
  248: "MT", 249: "MT", 250: "IE", 255: "PT", 256: "MT", 257: "NO", 258: "NO", 259: "NO",
  261: "PL", 263: "PT", 265: "SE", 266: "SE", 271: "TR", 272: "UA", 273: "RU", 275: "LV",
  276: "EE", 277: "LT", 303: "US", 304: "AG", 305: "AG", 308: "BS", 309: "BS", 311: "BS",
  314: "BB", 316: "CA", 319: "KY", 338: "US", 339: "JM", 341: "KN", 345: "MX", 351: "PA",
  352: "PA", 353: "PA", 354: "PA", 355: "PA", 356: "PA", 357: "PA", 366: "US", 367: "US",
  368: "US", 369: "US", 370: "PA", 371: "PA", 372: "PA", 373: "PA", 374: "PA", 375: "VC",
  376: "VC", 377: "VC", 412: "CN", 413: "CN", 414: "CN", 431: "JP", 432: "JP", 440: "KR",
  441: "KR", 477: "HK", 503: "AU", 525: "ID", 533: "MY", 538: "MH", 548: "PH", 563: "SG",
  564: "SG", 565: "SG", 566: "SG", 636: "LR", 637: "LR",
};

export function flagForMmsi(mmsi) {
  return FLAGS[Math.floor(mmsi / 1_000_000)];
}
