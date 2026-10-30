import { describe, it, expect } from 'vitest'
import { shipKind, shipModel } from './shipModel'

const laker = { toBow: 180, toStern: 45, toPort: 12, toStarboard: 12 }

describe('shipKind', () => {
  it('picks a model from the AIS ship type and length', () => {
    expect(shipKind(70, 225)).toBe('freighter')
    expect(shipKind(undefined, 200)).toBe('freighter')
    expect(shipKind(80, 180)).toBe('tanker')
    expect(shipKind(52, 30)).toBe('tug')
    expect(shipKind(36, 12)).toBe('sailboat')
    expect(shipKind(0, 20)).toBe('boat')
  })
})

describe('shipModel', () => {
  it('builds a freighter with its hull, aft house, funnel and hatch covers', () => {
    const blocks = shipModel(43, -82.42, 0, laker, 'freighter')
    const parts = new Set(blocks.map((b) => b.part))
    expect(parts).toEqual(new Set(['hull', 'house', 'funnel', 'deck', 'gear']))
    for (const b of blocks) expect(b.height).toBeGreaterThan(b.base)
    const funnel = blocks.find((b) => b.part === 'funnel')!
    const tallest = Math.max(...blocks.map((b) => b.height))
    expect(funnel.height).toBe(tallest)
  })

  it('gives a sailboat a mast taller than anything else on it', () => {
    const blocks = shipModel(43, -82.42, 0, { toBow: 8, toStern: 4, toPort: 2, toStarboard: 2 }, 'sailboat')
    const mast = blocks.find((b) => b.part === 'gear')!
    expect(mast.height).toBeGreaterThan(10)
  })

  it('is empty when the measurements are unknown', () => {
    expect(shipModel(43, -82.42, 0, { toBow: 0, toStern: 0, toPort: 0, toStarboard: 0 }, 'freighter')).toEqual([])
  })
})
