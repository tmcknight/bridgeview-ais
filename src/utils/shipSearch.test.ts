import { describe, it, expect } from 'vitest'
import { mockShip } from '../test/mocks/ships'
import { MAX_SEARCH_RESULTS, normaliseQuery, searchShips } from './shipSearch'
import type { ShipLog } from './shipLog'
import type { TrackedShip } from '../types/ais'

function shipsOf(...ships: TrackedShip[]): Map<number, TrackedShip> {
  return new Map(ships.map((s) => [s.mmsi, s]))
}

const emptyLog: ShipLog = new Map()

describe('normaliseQuery', () => {
  it('upper-cases and collapses punctuation and spaces', () => {
    expect(normaliseQuery('  st.  clair--river ')).toBe('ST CLAIR RIVER')
  })
})

describe('searchShips', () => {
  const algoma = mockShip({ mmsi: 316001, name: 'ALGOMA EQUINOX', imo: 9613927, distanceToBridge: 4, destination: 'THUNDER BAY' })
  const equinox = mockShip({ mmsi: 316002, name: 'EQUINOX', distanceToBridge: 9, destination: 'SARNIA' })
  const cason = mockShip({ mmsi: 366003, name: 'CASON J. CALLAWAY', distanceToBridge: 2, destination: 'EQUINOX POINT' })
  const ships = shipsOf(algoma, equinox, cason)

  it('finds nothing for queries under 2 characters', () => {
    expect(searchShips('e', ships, emptyLog).live).toEqual([])
    expect(searchShips('  ', ships, emptyLog).live).toEqual([])
  })

  it('ranks exact names, then word starts, then destinations', () => {
    const names = searchShips('equinox', ships, emptyLog).live.map((s) => s.name)
    expect(names).toEqual(['EQUINOX', 'ALGOMA EQUINOX', 'CASON J. CALLAWAY'])
  })

  it('ignores punctuation and case in names', () => {
    expect(searchShips('cason j callaway', ships, emptyLog).live).toEqual([cason])
  })

  it('finds ships by MMSI or IMO prefix', () => {
    expect(searchShips('3160', ships, emptyLog).live.map((s) => s.mmsi)).toEqual([316001, 316002])
    expect(searchShips('IMO 9613927', ships, emptyLog).live).toEqual([algoma])
    expect(searchShips('366003', ships, emptyLog).live).toEqual([cason])
  })

  it('breaks ties by distance to the bridge', () => {
    const near = mockShip({ mmsi: 1, name: 'LAKER ONE', distanceToBridge: 1 })
    const far = mockShip({ mmsi: 2, name: 'LAKER TWO', distanceToBridge: 8 })
    expect(searchShips('laker', shipsOf(far, near), emptyLog).live).toEqual([near, far])
  })

  it('lists ship-log ships not heard now separately, newest first', () => {
    const log: ShipLog = new Map([
      [316001, { mmsi: 316001, name: 'ALGOMA EQUINOX', passages: [], lastSeen: '2026-11-01T00:00:00Z' }],
      [9, { mmsi: 9, name: 'OLD EQUINOX', passages: [], lastSeen: '2026-10-01T00:00:00Z' }],
      [8, { mmsi: 8, name: 'NEW EQUINOX', passages: [], lastSeen: '2026-11-05T00:00:00Z' }],
    ])
    const results = searchShips('equinox', ships, log)
    // ALGOMA EQUINOX is being heard, so it's only in the live list
    expect(results.logged.map((e) => e.name)).toEqual(['NEW EQUINOX', 'OLD EQUINOX'])
  })

  it('caps results and counts the rest', () => {
    const many = Array.from({ length: MAX_SEARCH_RESULTS + 5 }, (_, i) =>
      mockShip({ mmsi: 100 + i, name: `TUG ${i}` }),
    )
    const results = searchShips('tug', shipsOf(...many), emptyLog)
    expect(results.live).toHaveLength(MAX_SEARCH_RESULTS)
    expect(results.more).toBe(5)
  })
})
