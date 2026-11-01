import { describe, it, expect } from 'vitest'
import { getUpcomingPassage, getUpcomingPassages } from './upcoming'
import { mockShip } from '../test/mocks/ships'
import { BRIDGE_CENTER } from '../constants/bridge'

// One minute of latitude is one nautical mile
const north = (nm: number) => BRIDGE_CENTER.lat + nm / 60
const south = (nm: number) => BRIDGE_CENTER.lat - nm / 60

describe('getUpcomingPassage', () => {
  it('includes a downbound ship in Lake Huron heading for the bridge', () => {
    const ship = mockShip({ latitude: north(10), longitude: BRIDGE_CENTER.lng, cog: 170, sog: 10 })
    const passage = getUpcomingPassage(ship)

    expect(passage?.direction).toBe('downbound')
    expect(passage?.distanceNM).toBeCloseTo(10, 1)
    expect(passage?.etaMinutes).toBeCloseTo(60, 0)
  })

  it('includes an upbound ship from the south, allowing for the river route', () => {
    const ship = mockShip({ latitude: south(10), longitude: BRIDGE_CENTER.lng, cog: 20, sog: 10, destination: 'STONEPORT' })
    const passage = getUpcomingPassage(ship)

    expect(passage?.direction).toBe('upbound')
    expect(passage?.distanceNM).toBeCloseTo(12, 1)
    expect(passage?.cargo).toEqual({ cargo: 'limestone', role: 'load' })
  })

  it('excludes ships heading away from the bridge', () => {
    expect(getUpcomingPassage(mockShip({ latitude: north(5), cog: 10 }))).toBeNull()
    expect(getUpcomingPassage(mockShip({ latitude: south(5), cog: 190 }))).toBeNull()
  })

  it('excludes ships crossing rather than approaching', () => {
    expect(getUpcomingPassage(mockShip({ latitude: north(20), cog: 260 }))).toBeNull()
  })

  it('excludes stopped, anchored and moored ships', () => {
    expect(getUpcomingPassage(mockShip({ latitude: north(5), cog: 180, sog: 0.2 }))).toBeNull()
    expect(getUpcomingPassage(mockShip({ latitude: north(5), cog: 180, navStatus: 1 }))).toBeNull()
    expect(getUpcomingPassage(mockShip({ latitude: north(5), cog: 180, navStatus: 5 }))).toBeNull()
  })

  it('excludes ships reporting speed not available (102.3 kn)', () => {
    expect(getUpcomingPassage(mockShip({ latitude: north(5), cog: 180, sog: 102.3 }))).toBeNull()
  })

  it('excludes ships without a course', () => {
    expect(getUpcomingPassage(mockShip({ latitude: north(5), cog: 360 }))).toBeNull()
  })

  it('excludes upbound ships stopping south of the bridge', () => {
    expect(getUpcomingPassage(mockShip({ latitude: south(5), cog: 0, destination: 'SARNIA' }))).toBeNull()
    expect(getUpcomingPassage(mockShip({ latitude: south(5), cog: 0, destination: 'TUG-ASSIST' }))).toBeNull()
  })
})

describe('getUpcomingPassage just past the bridge', () => {
  it('counts a ship just through the bridge as passing only when asked', () => {
    const ship = mockShip({ latitude: south(0.3), longitude: BRIDGE_CENTER.lng, cog: 180, sog: 10 })
    expect(getUpcomingPassage(ship)).toBeNull()
    expect(getUpcomingPassage(ship, { includePassing: true })).toMatchObject({
      direction: 'downbound',
      etaMinutes: 0,
      distanceNM: 0,
      passing: true,
    })
  })

  it('drops it once it is well past, turning or stopped', () => {
    const opts = { includePassing: true }
    expect(getUpcomingPassage(mockShip({ latitude: north(0.6), longitude: BRIDGE_CENTER.lng, cog: 0 }), opts)).toBeNull()
    expect(getUpcomingPassage(mockShip({ latitude: north(0.3), longitude: BRIDGE_CENTER.lng, cog: 90 }), opts)).toBeNull()
    expect(getUpcomingPassage(mockShip({ latitude: north(0.3), longitude: BRIDGE_CENTER.lng, cog: 0, sog: 0.2 }), opts)).toBeNull()
  })
})

describe('getUpcomingPassages', () => {
  it('keeps a ship that has just gone under the bridge at the top', () => {
    const near = mockShip({ mmsi: 1, name: 'NEAR', latitude: north(5), longitude: BRIDGE_CENTER.lng, cog: 180, sog: 10 })
    const passing = mockShip({ mmsi: 2, name: 'PASSING', latitude: south(0.2), longitude: BRIDGE_CENTER.lng, cog: 180, sog: 10 })

    const passages = getUpcomingPassages([near, passing])
    expect(passages.map((p) => p.ship.name)).toEqual(['PASSING', 'NEAR'])
    expect(passages[0].passing).toBe(true)
  })

  it('sorts by ETA and drops ships beyond the window', () => {
    const far = mockShip({ mmsi: 1, name: 'FAR', latitude: north(30), cog: 180, sog: 10 })
    const near = mockShip({ mmsi: 2, name: 'NEAR', latitude: north(5), cog: 180, sog: 10 })
    const slow = mockShip({ mmsi: 3, name: 'SLOW', latitude: north(30), cog: 180, sog: 1 })
    const away = mockShip({ mmsi: 4, name: 'AWAY', latitude: north(5), cog: 0, sog: 10 })

    const names = getUpcomingPassages([far, near, slow, away], 6 * 60).map((p) => p.ship.name)
    expect(names).toEqual(['NEAR', 'FAR'])
  })
})
