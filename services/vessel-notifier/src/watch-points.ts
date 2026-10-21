import type { WatchPoint } from "./types.js";

/** AISStream proxy accepts at most 5 bounding boxes per subscription */
export const MAX_WATCH_POINTS = 5;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Parse the WATCH_POINTS environment variable: a JSON array of
 * `{ "name", "lat", "lon", "radiusNM"?, "id"? }` objects.
 * Throws with a readable message when the value is invalid.
 */
export function parseWatchPoints(raw: string, defaultRadiusNM: number): WatchPoint[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("WATCH_POINTS must be valid JSON");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("WATCH_POINTS must be a non-empty JSON array");
  }
  if (parsed.length > MAX_WATCH_POINTS) {
    throw new Error(`WATCH_POINTS supports at most ${MAX_WATCH_POINTS} points`);
  }

  const ids = new Set<string>();

  return parsed.map((entry, index) => {
    const label = `WATCH_POINTS[${index}]`;
    if (!entry || typeof entry !== "object") {
      throw new Error(`${label} must be an object`);
    }

    const { name, lat, lon, radiusNM = defaultRadiusNM, id } = entry as Record<string, unknown>;

    if (typeof name !== "string" || !name.trim()) {
      throw new Error(`${label}.name is required`);
    }
    if (!isFiniteNumber(lat) || lat < -90 || lat > 90) {
      throw new Error(`${label}.lat must be a number between -90 and 90`);
    }
    if (!isFiniteNumber(lon) || lon < -180 || lon > 180) {
      throw new Error(`${label}.lon must be a number between -180 and 180`);
    }
    if (!isFiniteNumber(radiusNM) || radiusNM <= 0) {
      throw new Error(`${label}.radiusNM must be a positive number`);
    }
    if (id !== undefined && (typeof id !== "string" || !id.trim())) {
      throw new Error(`${label}.id must be a non-empty string`);
    }

    const pointId = id ?? slugify(name);
    if (ids.has(pointId)) {
      throw new Error(`${label} has duplicate id "${pointId}"`);
    }
    ids.add(pointId);

    return {
      id: pointId,
      name: name.trim(),
      latitude: lat,
      longitude: lon,
      radiusNM,
    };
  });
}
