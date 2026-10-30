import { describe, it, expect } from 'vitest'
import { CAM_ENTER_DOWNBOUND_NM, CAM_ENTER_NM, CAM_EXIT_NM, bearingToBridge, getApproachingShip, getPassingShip, passageDirection, shouldFollow } from './tvMode'
import { mockShip } from '../test/mocks/ships'
import { BRIDGE_CENTER } from '../constants/bridge'

const sized = (length: number) => ({
  dimensions: { toBow: length * 0.8, toStern: length * 0.2, toPort: 10, toStarboard: 10 },
})

// One minute of latitude is one nautical mile; downbound ships north of the bridge
const downbound = (mmsi: number, nm: number, overrides = {}) =>
  mockShip({
    mmsi,
    latitude: BRIDGE_CENTER.lat + nm / 60,
    longitude: BRIDGE_CENTER.lng,
    distanceToBridge: nm,
    cog: 180,
    sog: 10,
    ...overrides,
  })

describe('getPassingShip', () => {
  it('picks the closest ship under way near the bridge', () => {
    const far = mockShip({ mmsi: 1, distanceToBridge: 0.5 })
    const near = mockShip({ mmsi: 2, distanceToBridge: 0.2 })
    expect(getPassingShip([far, near], null)).toBe(near)
  })

  it('prefers the bigger ship', () => {
    const tug = mockShip({ mmsi: 1, distanceToBridge: 0.2, ...sized(30) })
    const laker = mockShip({ mmsi: 2, distanceToBridge: 0.8, ...sized(225) })
    expect(getPassingShip([tug, laker], null)).toBe(laker)
  })

  it('ignores ships further out', () => {
    expect(getPassingShip([mockShip({ distanceToBridge: CAM_ENTER_NM + 0.1 })], null)).toBeNull()
  })

  it('waits until a downbound ship is closer', () => {
    expect(getPassingShip([downbound(1, CAM_ENTER_DOWNBOUND_NM + 0.1)], null)).toBeNull()
    const ship = downbound(1, CAM_ENTER_DOWNBOUND_NM - 0.1)
    expect(getPassingShip([ship], null)).toBe(ship)
  })

  it('ignores stopped, anchored, moored and Class B ships', () => {
    const ships = [
      mockShip({ mmsi: 1, distanceToBridge: 0.1, sog: 0.2 }),
      mockShip({ mmsi: 2, distanceToBridge: 0.1, navStatus: 1 }),
      mockShip({ mmsi: 3, distanceToBridge: 0.1, navStatus: 5 }),
      mockShip({ mmsi: 4, distanceToBridge: 0.1, classB: true }),
      mockShip({ mmsi: 5, distanceToBridge: 0.1, sog: 102.3 }),
    ]
    expect(getPassingShip(ships, null)).toBeNull()
  })

  it('sticks with the current ship until it is well past', () => {
    const current = mockShip({ mmsi: 1, distanceToBridge: CAM_EXIT_NM - 0.1 })
    const closer = mockShip({ mmsi: 2, distanceToBridge: 0.1 })
    expect(getPassingShip([closer, current], 1)).toBe(current)
    expect(getPassingShip([closer, { ...current, distanceToBridge: CAM_EXIT_NM + 0.1 }], 1)).toBe(closer)
  })
})

describe('passageDirection', () => {
  it('reads the course', () => {
    expect(passageDirection(mockShip({ cog: 10 }))).toBe('upbound')
    expect(passageDirection(mockShip({ cog: 190 }))).toBe('downbound')
  })
})

describe('getApproachingShip', () => {
  // At 10 kn, 1 NM is 6 minutes out
  it('picks the closest ship', () => {
    const near = downbound(1, 1, { sog: 6 })
    const fast = downbound(2, 1.5, { sog: 20 })
    expect(getApproachingShip([fast, near], null)?.ship).toBe(near)
  })

  it('prefers the bigger ship', () => {
    const tug = downbound(1, 0.5, sized(30))
    const laker = downbound(2, 1.5, sized(225))
    const unknown = downbound(3, 0.3)
    expect(getApproachingShip([tug, unknown, laker], null)?.ship).toBe(laker)
    expect(getApproachingShip([unknown, tug], null)?.ship).toBe(tug)
  })

  it('keeps the ship it is following when a bigger one comes along', () => {
    // 6 minutes out, so followed; the laker is 10
    const tug = downbound(1, 1, sized(30))
    const laker = downbound(2, 1.7, sized(225))
    expect(getApproachingShip([laker, tug], 1)?.ship).toBe(tug)
    // Not yet followed at 10 minutes out
    expect(getApproachingShip([laker, downbound(1, 1.7, sized(30))], 1)?.ship).toBe(laker)
  })

  it('ignores ships further out, heading away, or Class B', () => {
    // 13 minutes out
    expect(getApproachingShip([downbound(1, 2.2)], null)).toBeNull()
    expect(getApproachingShip([downbound(1, 1, { cog: 0 })], null)).toBeNull()
    expect(getApproachingShip([downbound(1, 1, { classB: true })], null)).toBeNull()
  })

  it('keeps showing a ship a bit beyond where it started', () => {
    // 13 minutes out, then 16
    expect(getApproachingShip([downbound(1, 2.2)], 1)?.ship.mmsi).toBe(1)
    expect(getApproachingShip([downbound(1, 2.7)], 1)).toBeNull()
  })

  it('keeps showing a ship whose course wanders right by the bridge', () => {
    const ship = downbound(1, CAM_EXIT_NM - 0.1, { cog: 90 })
    expect(getApproachingShip([ship], 1)?.ship).toBe(ship)
    expect(getApproachingShip([ship], null)).toBeNull()
  })
})

describe('shouldFollow', () => {
  const passage = (etaMinutes: number) =>
    ({ ship: downbound(1, 1), etaMinutes, distanceNM: 1, direction: 'downbound', cargo: null }) as const

  it('follows from 9 minutes out, and keeps following out to 12', () => {
    expect(shouldFollow(passage(10), false)).toBe(false)
    expect(shouldFollow(passage(8), false)).toBe(true)
    expect(shouldFollow(passage(11), true)).toBe(true)
    expect(shouldFollow(passage(13), true)).toBe(false)
  })
})

describe('bearingToBridge', () => {
  it('points at the bridge', () => {
    expect(bearingToBridge(BRIDGE_CENTER.lat + 0.05, BRIDGE_CENTER.lng)).toBeCloseTo(180, 0)
    expect(bearingToBridge(BRIDGE_CENTER.lat - 0.05, BRIDGE_CENTER.lng)).toBeCloseTo(0, 0)
  })
})
