import { describe, it, expect } from 'vitest'
import { applyShipUpdates, purgeStaleShips } from './shipUpdates'
import { mockShip } from '../test/mocks/ships'

const NOW = Date.parse('2026-11-02T12:00:00Z')
const STALE = 10 * 60 * 1000
const at = (msAgo: number): string => new Date(NOW - msAgo).toISOString()

describe('applyShipUpdates', () => {
  it('adds and replaces ships, keeping unchanged ones as the same objects', () => {
    const a = mockShip({ mmsi: 1, lastUpdate: at(5000) })
    const b = mockShip({ mmsi: 2, lastUpdate: at(5000) })
    const state = new Map([[1, a], [2, b]])
    const a2 = { ...a, lastUpdate: at(1000), latitude: 43.1 }
    const c = mockShip({ mmsi: 3, lastUpdate: at(1000) })

    const next = applyShipUpdates(state, [a2, c], NOW, STALE)

    expect(next).not.toBe(state)
    expect(next.get(1)).toBe(a2)
    expect(next.get(2)).toBe(b)
    expect(next.get(3)).toBe(c)
    expect(state.size).toBe(2)
  })

  it('drops an update older than the ship it would replace', () => {
    const a = mockShip({ mmsi: 1, lastUpdate: at(1000) })
    const state = new Map([[1, a]])
    const next = applyShipUpdates(state, [{ ...a, lastUpdate: at(5000) }], NOW, STALE)
    expect(next).toBe(state)
  })

  it('drops updates that are already stale or have no valid time', () => {
    const state = new Map()
    const old = mockShip({ mmsi: 1, lastUpdate: at(STALE + 1000) })
    const invalid = mockShip({ mmsi: 2, lastUpdate: 'not a time' })
    expect(applyShipUpdates(state, [old, invalid], NOW, STALE)).toBe(state)
  })

  it('returns the same map when there are no updates', () => {
    const state = new Map([[1, mockShip({ mmsi: 1, lastUpdate: at(0) })]])
    expect(applyShipUpdates(state, [], NOW, STALE)).toBe(state)
  })
})

describe('purgeStaleShips', () => {
  it('drops ships not heard from lately', () => {
    const fresh = mockShip({ mmsi: 1, lastUpdate: at(1000) })
    const stale = mockShip({ mmsi: 2, lastUpdate: at(STALE + 1000) })
    const next = purgeStaleShips(new Map([[1, fresh], [2, stale]]), NOW, STALE)
    expect([...next.keys()]).toEqual([1])
    expect(next.get(1)).toBe(fresh)
  })

  it('returns the same map when nothing is stale', () => {
    const state = new Map([[1, mockShip({ mmsi: 1, lastUpdate: at(1000) })]])
    expect(purgeStaleShips(state, NOW, STALE)).toBe(state)
  })
})
