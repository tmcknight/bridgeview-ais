import { describe, it, expect } from 'vitest'
import {
  BLEND_MS,
  aircraftFix,
  motionAt,
  motionSettled,
  sameFix,
  shipFix,
  startMotion,
  type MotionFix,
} from './motion'
import { mockShip, mockShipAtAnchor } from '../test/mocks/ships'

const LAT = 43
// One knot, in degrees of latitude per millisecond
const KNOT_DEG_PER_MS = 1 / 60 / 3_600_000

const north = (overrides?: Partial<MotionFix>): MotionFix => ({
  lat: LAT,
  lon: -82.42,
  speed: 10,
  course: 0,
  rotation: 0,
  ...overrides,
})

describe('motionAt', () => {
  it('starts at the fix', () => {
    const motion = startMotion(undefined, north(), 1000, 60_000)
    expect(motionAt(motion, 1000)).toEqual({ lat: LAT, lon: -82.42, rotation: 0 })
  })

  it('dead-reckons along the course at the reported speed', () => {
    const motion = startMotion(undefined, north(), 0, 60_000)
    const { lat, lon } = motionAt(motion, 10_000)
    expect(lat).toBeCloseTo(LAT + 10 * KNOT_DEG_PER_MS * 10_000, 9)
    expect(lon).toBe(-82.42)
  })

  it('moves east by more degrees of longitude than latitude, away from the equator', () => {
    const motion = startMotion(undefined, north({ course: 90 }), 0, 60_000)
    const { lat, lon } = motionAt(motion, 10_000)
    expect(lat).toBeCloseTo(LAT, 9)
    const expected = (10 * KNOT_DEG_PER_MS * 10_000) / Math.cos((LAT * Math.PI) / 180)
    expect(lon).toBeCloseTo(-82.42 + expected, 9)
  })

  it('stops extrapolating after the max age', () => {
    const motion = startMotion(undefined, north(), 0, 30_000)
    expect(motionAt(motion, 120_000)).toEqual(motionAt(motion, 30_000))
  })

  it('holds still without a speed or a course', () => {
    expect(motionAt(startMotion(undefined, north({ speed: 0 }), 0, 60_000), 10_000).lat).toBe(LAT)
    expect(motionAt(startMotion(undefined, north({ course: undefined }), 0, 60_000), 10_000).lat).toBe(LAT)
  })
})

describe('startMotion', () => {
  it('eases from where the previous motion was drawn to the new fix', () => {
    const prev = startMotion(undefined, north({ speed: 0 }), 0, 60_000)
    const next = startMotion(prev, north({ speed: 0, lat: LAT + 0.001 }), 5000, 60_000)

    expect(motionAt(next, 5000).lat).toBeCloseTo(LAT, 9)
    const halfway = motionAt(next, 5000 + BLEND_MS / 2).lat
    expect(halfway).toBeCloseTo(LAT + 0.0005, 9)
    // Gentle at both ends
    expect(motionAt(next, 5000 + BLEND_MS / 10).lat).toBeLessThan(LAT + 0.0001)
    expect(motionAt(next, 5000 + (BLEND_MS * 9) / 10).lat).toBeGreaterThan(LAT + 0.0009)
    expect(motionAt(next, 5000 + BLEND_MS).lat).toBeCloseTo(LAT + 0.001, 9)
  })

  it('reckons from when the report was made, not when it arrived', () => {
    const motion = startMotion(undefined, north({ reportedAt: 50_000 }), 0, 60_000, 60_000)
    // Ten seconds old on arrival, so already ten seconds along
    expect(motionAt(motion, 0).lat).toBeCloseTo(LAT + 10 * 10_000 * KNOT_DEG_PER_MS, 12)
  })

  it('does not pull a moving ship back when a delayed report lands', () => {
    const prev = startMotion(undefined, north({ reportedAt: 0 }), 0, 60_000, 0)
    // The next report was made 10s in but only arrives 15s in, where the ship is drawn
    const next = startMotion(
      prev,
      north({ lat: LAT + 10 * 10_000 * KNOT_DEG_PER_MS, reportedAt: 10_000 }),
      15_000,
      60_000,
      15_000
    )
    expect(next.offset.lat).toBeCloseTo(0, 12)
  })

  it('caps how old a report is taken to be, against a wrong clock', () => {
    const motion = startMotion(undefined, north({ reportedAt: 0 }), 0, 600_000, 3_600_000)
    expect(motion.lagMs).toBe(30_000)
  })

  it('turns the shortest way round', () => {
    const prev = startMotion(undefined, north({ rotation: 350 }), 0, 60_000)
    const next = startMotion(prev, north({ rotation: 10 }), 0, 60_000)
    const rotation = motionAt(next, BLEND_MS / 2).rotation
    expect(rotation > 350 || rotation < 10).toBe(true)
  })

  it('jumps to a fix far from where the previous motion was drawn', () => {
    const prev = startMotion(undefined, north({ speed: 0 }), 0, 60_000)
    const next = startMotion(prev, north({ speed: 0, lat: LAT + 0.5 }), 5000, 60_000)
    expect(motionAt(next, 5000).lat).toBe(LAT + 0.5)
  })
})

describe('motionSettled', () => {
  it('is unsettled while blending or extrapolating', () => {
    const motion = startMotion(undefined, north(), 0, 30_000)
    expect(motionSettled(motion, BLEND_MS / 2)).toBe(false)
    expect(motionSettled(motion, 10_000)).toBe(false)
    expect(motionSettled(motion, 31_000)).toBe(true)
  })

  it('settles once blended when not moving', () => {
    const motion = startMotion(undefined, north({ speed: 0 }), 0, 30_000)
    expect(motionSettled(motion, BLEND_MS)).toBe(true)
  })
})

describe('shipFix', () => {
  it('moves a ship underway along its course over ground, pointing at its heading', () => {
    const fix = shipFix(mockShip({ sog: 12, cog: 180, trueHeading: 175 }))
    expect(fix).toMatchObject({ speed: 12, course: 180, rotation: 175 })
  })

  it('points along the course when the heading is not available', () => {
    expect(shipFix(mockShip({ cog: 180, trueHeading: 511 })).rotation).toBe(180)
  })

  it('holds still ships at anchor, drifting slowly, or without a speed or course', () => {
    expect(shipFix(mockShipAtAnchor({ sog: 2 })).speed).toBe(0)
    expect(shipFix(mockShip({ sog: 0.2 })).speed).toBe(0)
    expect(shipFix(mockShip({ sog: 102.3 })).speed).toBe(0)
    expect(shipFix(mockShip({ cog: 360 })).course).toBeUndefined()
  })
})

describe('aircraftFix', () => {
  it('moves along the track at ground speed', () => {
    expect(aircraftFix({ hex: 'abc123', lat: 43, lon: -82, speed: 250, track: 90 })).toEqual({
      lat: 43,
      lon: -82,
      speed: 250,
      course: 90,
      rotation: 90,
    })
  })

  it('holds still without a speed', () => {
    expect(aircraftFix({ hex: 'abc123', lat: 43, lon: -82 }).speed).toBe(0)
  })
})

describe('sameFix', () => {
  it('compares every field', () => {
    expect(sameFix(north(), north())).toBe(true)
    expect(sameFix(north(), north({ rotation: 1 }))).toBe(false)
  })
})
