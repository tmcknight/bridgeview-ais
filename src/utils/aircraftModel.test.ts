import { describe, it, expect } from 'vitest'
import { aircraftHeight, aircraftModel, aircraftShape } from './aircraftModel'
import type { Aircraft } from '../types/aircraft'

const plane = (overrides: Partial<Aircraft> = {}): Aircraft => ({ hex: 'abc123', lat: 43, lon: -82.42, ...overrides })

describe('aircraftHeight', () => {
  it('is metres above the river, from the altitude above the sea', () => {
    expect(aircraftHeight(plane({ altitude: 3580 }))).toBeCloseTo(914.4)
  })

  it('is 0 on the ground or below the river level, and null when unknown', () => {
    expect(aircraftHeight(plane({ onGround: true, altitude: 600 }))).toBe(0)
    expect(aircraftHeight(plane({ altitude: 0 }))).toBe(0)
    expect(aircraftHeight(plane())).toBeNull()
  })
})

describe('aircraftShape', () => {
  it('sizes by emitter category, with helicopters as rotorcraft', () => {
    expect(aircraftShape(plane({ category: 'A3' })).jet).toBe(true)
    expect(aircraftShape(plane({ category: 'A5' })).length).toBeGreaterThan(aircraftShape(plane({ category: 'A3' })).length)
    expect(aircraftShape(plane({ category: 'A7' })).rotorcraft).toBe(true)
    expect(aircraftShape(plane()).jet).toBe(false)
  })
})

describe('aircraftModel', () => {
  it('builds a jet floating at its altitude, with engines at the bottom', () => {
    const blocks = aircraftModel(43, -82.42, 90, 1000, aircraftShape(plane({ category: 'A3' })))
    expect(new Set(blocks.map((b) => b.part))).toEqual(new Set(['body', 'wing', 'engine']))
    for (const b of blocks) {
      expect(b.height).toBeGreaterThan(b.base)
      expect(b.base).toBeGreaterThanOrEqual(1000)
    }
    expect(Math.min(...blocks.map((b) => b.base))).toBe(1000)
    expect(blocks.find((b) => b.part === 'engine')!.base).toBe(1000)
  })

  it('builds a helicopter with a rotor on top', () => {
    const blocks = aircraftModel(43, -82.42, 0, 0, aircraftShape(plane({ category: 'A7' })))
    const top = Math.max(...blocks.map((b) => b.height))
    expect(blocks.find((b) => b.height === top)!.part).toBe('rotor')
    expect(Math.min(...blocks.map((b) => b.base))).toBe(0)
  })

  it('points along its heading and blows up to the minimum length', () => {
    const shape = aircraftShape(plane({ category: 'A1' }))
    const lngs = (blocks: ReturnType<typeof aircraftModel>) =>
      blocks.flatMap((b) => b.outline.map(([lng]) => lng))
    const east = aircraftModel(43, -82.42, 90, 500, shape)
    const extent = Math.max(...lngs(east)) - Math.min(...lngs(east))
    // 8 m nose to tail at about 81.4 km per degree of longitude
    expect(extent * 81_400).toBeCloseTo(shape.length, 0)
    const big = aircraftModel(43, -82.42, 90, 500, shape, 80)
    expect((Math.max(...lngs(big)) - Math.min(...lngs(big))) / extent).toBeCloseTo(10, 0)
  })

  it('winds every outline counter-clockwise and closes it', () => {
    for (const category of ['A3', 'A7']) {
      for (const { outline } of aircraftModel(43, -82.42, 37, 300, aircraftShape(plane({ category })))) {
        expect(outline[0]).toEqual(outline[outline.length - 1])
        let area = 0
        for (let i = 0; i < outline.length - 1; i++) {
          area += outline[i][0] * outline[i + 1][1] - outline[i + 1][0] * outline[i][1]
        }
        expect(area).toBeGreaterThan(0)
      }
    }
  })
})
