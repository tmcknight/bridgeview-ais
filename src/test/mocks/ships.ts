import type { TrackedShip } from '../../types/ais'

/**
 * Create a mock TrackedShip with default values that can be overridden
 */
export const mockShip = (overrides?: Partial<TrackedShip>): TrackedShip => ({
  mmsi: 367123456,
  name: 'TEST VESSEL',
  latitude: 43.05,
  longitude: -82.42,
  cog: 180,
  sog: 10.5,
  trueHeading: 180,
  navStatus: 0,
  lastUpdate: new Date().toISOString(),
  distanceToBridge: 5.0,
  approaching: true,
  notified: false,
  destination: 'DETROIT',
  shipType: 70, // Cargo vessel
  length: 200,
  width: 30,
  ...overrides,
})

/**
 * Create a northbound ship (coming from Lake St. Clair, south of bridge)
 */
export const mockShipNorthbound = (overrides?: Partial<TrackedShip>): TrackedShip =>
  mockShip({
    mmsi: 367123457,
    name: 'NORTHBOUND VESSEL',
    latitude: 42.95, // South of bridge
    longitude: -82.42,
    cog: 0, // Heading north
    trueHeading: 0,
    distanceToBridge: 3.0,
    approaching: true,
    ...overrides,
  })

/**
 * Create a southbound ship (coming from Lake Huron, north of bridge)
 */
export const mockShipSouthbound = (overrides?: Partial<TrackedShip>): TrackedShip =>
  mockShip({
    mmsi: 367123458,
    name: 'SOUTHBOUND VESSEL',
    latitude: 43.05, // North of bridge
    longitude: -82.42,
    cog: 180, // Heading south
    trueHeading: 180,
    distanceToBridge: 4.0,
    approaching: true,
    ...overrides,
  })

/**
 * Create a ship at anchor (stationary)
 */
export const mockShipAtAnchor = (overrides?: Partial<TrackedShip>): TrackedShip =>
  mockShip({
    mmsi: 367123459,
    name: 'ANCHORED VESSEL',
    navStatus: 1, // At anchor
    sog: 0.1, // Almost stationary
    approaching: false,
    ...overrides,
  })

/**
 * Create a ship that is moored
 */
export const mockShipMoored = (overrides?: Partial<TrackedShip>): TrackedShip =>
  mockShip({
    mmsi: 367123460,
    name: 'MOORED VESSEL',
    navStatus: 5, // Moored
    sog: 0,
    approaching: false,
    ...overrides,
  })

/**
 * Create a ship far from bridge (not approaching)
 */
export const mockShipFarAway = (overrides?: Partial<TrackedShip>): TrackedShip =>
  mockShip({
    mmsi: 367123461,
    name: 'DISTANT VESSEL',
    latitude: 43.20, // Much farther north
    distanceToBridge: 12.0, // Beyond tracking range
    approaching: false,
    ...overrides,
  })

/**
 * Create a ship very close to bridge
 */
export const mockShipCloseToBridge = (overrides?: Partial<TrackedShip>): TrackedShip =>
  mockShip({
    mmsi: 367123462,
    name: 'CLOSE VESSEL',
    latitude: 42.998, // Very close to bridge center (42.9982)
    distanceToBridge: 0.3,
    approaching: true,
    notified: true,
    ...overrides,
  })
