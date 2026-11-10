import { createHash, timingSafeEqual } from "node:crypto";

// What a WebSocket client may send: an auth token (when the server has one), then
// subscriptions in AISStream's shape. Everything here comes from the network, so
// nothing may throw on odd input: a throw in a message handler takes the server down.

export const SUBSCRIPTION_LIMITS = {
  LAT_MIN: -90,
  LAT_MAX: 90,
  LON_MIN: -180,
  LON_MAX: 180,
  MAX_BOUNDING_BOX_AREA: 100, // Limit to ~100 square degrees
  MAX_BOUNDING_BOXES: 5,
};

// Both numeric types and string names are allowed
const ALLOWED_MESSAGE_TYPES = [1, 2, 3, 18, 19, 27];
const ALLOWED_MESSAGE_NAMES = [
  "PositionReport",
  "ShipStaticData",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
  "StaticDataReport",
];

// A client's message as JSON; undefined when it isn't JSON at all
export function parseClientMessage(data) {
  try {
    return JSON.parse(data.toString());
  } catch {
    return undefined;
  }
}

// Whether a client's token is the server's, compared in constant time
export function tokenMatches(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string" || !expected) return false;
  const digest = (text) => createHash("sha256").update(text).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

const isCoordinatePair = (pair) =>
  Array.isArray(pair) && pair.length === 2 && pair.every((value) => typeof value === "number" && Number.isFinite(value));

// { valid: true, subscription } with only the fields the server uses, or { valid: false, error }
export function validateSubscription(subscription) {
  // Must be an object
  if (!subscription || typeof subscription !== "object") {
    return { valid: false, error: "Subscription must be an object" };
  }

  // Must have BoundingBoxes array
  if (!Array.isArray(subscription.BoundingBoxes)) {
    return { valid: false, error: "BoundingBoxes array is required" };
  }

  // Limit number of bounding boxes
  if (subscription.BoundingBoxes.length > SUBSCRIPTION_LIMITS.MAX_BOUNDING_BOXES) {
    return { valid: false, error: `Maximum ${SUBSCRIPTION_LIMITS.MAX_BOUNDING_BOXES} bounding boxes allowed` };
  }

  // Validate each bounding box
  const boxes = [];
  for (const box of subscription.BoundingBoxes) {
    if (!Array.isArray(box) || box.length !== 2 || !box.every(isCoordinatePair)) {
      return { valid: false, error: "Each bounding box must be an array of 2 coordinate pairs" };
    }

    const [[lat1, lon1], [lat2, lon2]] = box;

    // Validate coordinate bounds
    if (
      lat1 < SUBSCRIPTION_LIMITS.LAT_MIN || lat1 > SUBSCRIPTION_LIMITS.LAT_MAX ||
      lat2 < SUBSCRIPTION_LIMITS.LAT_MIN || lat2 > SUBSCRIPTION_LIMITS.LAT_MAX ||
      lon1 < SUBSCRIPTION_LIMITS.LON_MIN || lon1 > SUBSCRIPTION_LIMITS.LON_MAX ||
      lon2 < SUBSCRIPTION_LIMITS.LON_MIN || lon2 > SUBSCRIPTION_LIMITS.LON_MAX
    ) {
      return { valid: false, error: "Coordinates out of valid range" };
    }

    // Calculate bounding box area to prevent abuse
    const area = Math.abs(lat2 - lat1) * Math.abs(lon2 - lon1);
    if (area > SUBSCRIPTION_LIMITS.MAX_BOUNDING_BOX_AREA) {
      return {
        valid: false,
        error: `Bounding box area too large (max ${SUBSCRIPTION_LIMITS.MAX_BOUNDING_BOX_AREA} sq degrees)`,
      };
    }

    boxes.push([[lat1, lon1], [lat2, lon2]]);
  }

  // Validate FilterMessageTypes if present
  const types = subscription.FilterMessageTypes;
  if (types && !Array.isArray(types)) {
    return { valid: false, error: "FilterMessageTypes must be an array" };
  }

  if (types) {
    for (const type of types) {
      if (!ALLOWED_MESSAGE_TYPES.includes(type) && !ALLOWED_MESSAGE_NAMES.includes(type)) {
        return {
          valid: false,
          error: `Invalid message type: ${String(type).slice(0, 40)}. Allowed numbers: ${ALLOWED_MESSAGE_TYPES.join(", ")} or names: ${ALLOWED_MESSAGE_NAMES.join(", ")}`,
        };
      }
    }
  }

  // Keep only the known fields (prevent injection), and each type once
  const sanitized = { BoundingBoxes: boxes };
  if (types) sanitized.FilterMessageTypes = [...new Set(types)];

  return { valid: true, subscription: sanitized };
}
