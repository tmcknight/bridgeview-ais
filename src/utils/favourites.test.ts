import { describe, it, expect, beforeEach } from 'vitest'
import { mockShip } from '../test/mocks/ships'
import {
  FAVOURITES_KEY,
  describeFavourite,
  loadFavourites,
  parseFavourites,
  saveFavourites,
  serializeFavourites,
  toggleFavourite,
  type Favourites,
} from './favourites'
import type { ShipLog } from './shipLog'

const NOW = new Date('2026-11-09T12:00:00Z')

describe('favourites storage', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips through JSON', () => {
    const favs = toggleFavourite(new Map(), 316001, 'ALGOMA EQUINOX', NOW)
    expect(parseFavourites(serializeFavourites(favs))).toEqual(favs)
  })

  it('skips malformed entries and bad JSON', () => {
    expect(parseFavourites('not json')).toEqual(new Map())
    expect(parseFavourites('{"mmsi":1}')).toEqual(new Map())
    const parsed = parseFavourites(
      JSON.stringify([{ mmsi: 1, name: 'OK', addedAt: NOW.toISOString() }, { mmsi: 'x' }, null, { mmsi: -1, name: 'NO', addedAt: '' }]),
    )
    expect(Array.from(parsed.keys())).toEqual([1])
  })

  it('saves to and loads from localStorage', () => {
    const favs = toggleFavourite(new Map(), 7, 'SEVEN', NOW)
    saveFavourites(favs)
    expect(localStorage.getItem(FAVOURITES_KEY)).toContain('SEVEN')
    expect(loadFavourites()).toEqual(favs)
  })
})

describe('toggleFavourite', () => {
  it('adds a ship, then removes it, without changing the original', () => {
    const empty: Favourites = new Map()
    const added = toggleFavourite(empty, 5, 'FIVE', NOW)
    expect(added.get(5)).toEqual({ mmsi: 5, name: 'FIVE', addedAt: NOW.toISOString() })
    expect(empty.size).toBe(0)
    expect(toggleFavourite(added, 5, 'FIVE').size).toBe(0)
  })
})

describe('describeFavourite', () => {
  it('gives the ETA for a ship heading for the bridge', () => {
    const ship = mockShip({ latitude: 43.05, cog: 180, sog: 10, navStatus: 0 })
    expect(describeFavourite(ship, new Map(), ship.mmsi)).toMatch(/^Downbound · at the bridge in /)
  })

  it('gives distance and status for a ship that is stopped', () => {
    const ship = mockShip({ sog: 0, navStatus: 5, distanceToBridge: 2 })
    expect(describeFavourite(ship, new Map(), ship.mmsi)).toMatch(/from the bridge · Moored$/)
  })

  it('falls back to the ship log for ships not heard now', () => {
    const log: ShipLog = new Map([
      [9, { mmsi: 9, name: 'NINE', passages: [{ time: new Date().toISOString(), direction: 'upbound' }], lastSeen: new Date().toISOString() }],
    ])
    expect(describeFavourite(undefined, log, 9)).toMatch(/^Not heard now · last under the bridge upbound/)
    expect(describeFavourite(undefined, log, 10)).toBe('Not heard now')
  })
})
