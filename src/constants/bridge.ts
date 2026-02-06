// Blue Water Bridge coordinates (Sarnia, ON / Port Huron, MI)
// The bridge spans the St. Clair River at approximately these coordinates
export const BRIDGE_CENTER = {
  lat: 42.9982,
  lng: -82.4230,
};

// Bounding box for the area around the bridge
// Covers a generous area up and down the St. Clair River
// to track ships approaching from Lake Huron (north) or Lake St. Clair (south)
export const TRACKING_BOUNDS = {
  // Southwest corner, Northeast corner
  // Roughly from south of the bridge to north into Lake Huron
  southWest: { lat: 42.90, lng: -82.55 },
  northEast: { lat: 43.10, lng: -82.30 },
};

// AIS Stream bounding box format: [[lat_min, lon_min], [lat_max, lon_max]]
export const AIS_BOUNDING_BOX: [[number, number], [number, number]] = [
  [TRACKING_BOUNDS.southWest.lat, TRACKING_BOUNDS.southWest.lng],
  [TRACKING_BOUNDS.northEast.lat, TRACKING_BOUNDS.northEast.lng],
];

// Distance thresholds in nautical miles
export const APPROACH_NOTIFICATION_DISTANCE_NM = 2.0; // Notify when within 2 NM
export const CLOSE_APPROACH_DISTANCE_NM = 0.5; // "Passing under" threshold

// Bridge clearance (approximate) in meters
export const BRIDGE_AIR_DRAFT_M = 46; // ~152 ft air draft

// Map defaults
export const DEFAULT_ZOOM = 13;
export const MIN_ZOOM = 10;
export const MAX_ZOOM = 18;
