import { describe, it, expect } from 'vitest'
import { hullHeights, hullOutline, hasHull, metresPerPixel, wakeOutline } from './hull'

const LAT = 43
const M_PER_DEG_LAT = 111_320
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((LAT * Math.PI) / 180)

// Convert an outline back to metres east/north of the antenna
const toMetres = (outline: [number, number][]) =>
  outline.map(([lng, lat]) => [(lng - -82.42) * M_PER_DEG_LNG, (lat - LAT) * M_PER_DEG_LAT])

describe('hullOutline', () => {
  const dims = { toBow: 150, toStern: 50, toPort: 10, toStarboard: 14 }

  it('returns null when length or beam is unknown', () => {
    expect(hullOutline(LAT, -82.42, 0, { toBow: 0, toStern: 0, toPort: 10, toStarboard: 10 })).toBeNull()
    expect(hullOutline(LAT, -82.42, 0, { toBow: 100, toStern: 50, toPort: 0, toStarboard: 0 })).toBeNull()
  })

  it('places the hull around the antenna when heading north', () => {
    const points = toMetres(hullOutline(LAT, -82.42, 0, dims)!)
    const easts = points.map(([e]) => e)
    const norths = points.map(([, n]) => n)

    expect(Math.min(...norths)).toBeCloseTo(-50)
    expect(Math.max(...norths)).toBeCloseTo(150)
    expect(Math.min(...easts)).toBeCloseTo(-10)
    expect(Math.max(...easts)).toBeCloseTo(14)
  })

  it('is a closed ring with the bow tip on the centreline', () => {
    const outline = hullOutline(LAT, -82.42, 0, dims)!
    expect(outline[0]).toEqual(outline[outline.length - 1])
    const [bowEast, bowNorth] = toMetres(outline)[3]
    expect(bowNorth).toBeCloseTo(150)
    expect(bowEast).toBeCloseTo(2)
  })

  it('turns the hull to the heading', () => {
    const points = toMetres(hullOutline(LAT, -82.42, 90, dims)!)
    const easts = points.map(([e]) => e)
    const norths = points.map(([, n]) => n)

    // Bow points east, starboard side faces south
    expect(Math.max(...easts)).toBeCloseTo(150)
    expect(Math.min(...easts)).toBeCloseTo(-50)
    expect(Math.min(...norths)).toBeCloseTo(-14)
    expect(Math.max(...norths)).toBeCloseTo(10)
  })

  it('blows a small hull up to the minimum size around the antenna', () => {
    const tug = { toBow: 20, toStern: 10, toPort: 5, toStarboard: 5 }
    const points = toMetres(hullOutline(LAT, -82.42, 0, tug, 300, 40)!)
    const easts = points.map(([e]) => e)
    const norths = points.map(([, n]) => n)

    expect(Math.max(...norths)).toBeCloseTo(200)
    expect(Math.min(...norths)).toBeCloseTo(-100)
    expect(Math.max(...easts) - Math.min(...easts)).toBeCloseTo(100)
  })

  it('widens a narrow hull to the minimum beam without lengthening it', () => {
    const points = toMetres(hullOutline(LAT, -82.42, 0, dims, 0, 48)!)
    const easts = points.map(([e]) => e)
    const norths = points.map(([, n]) => n)

    expect(Math.max(...norths) - Math.min(...norths)).toBeCloseTo(200)
    expect(Math.max(...easts) - Math.min(...easts)).toBeCloseTo(48)
  })
})

describe('hasHull', () => {
  it('needs both length and beam', () => {
    expect(hasHull(undefined)).toBe(false)
    expect(hasHull({ toBow: 0, toStern: 0, toPort: 5, toStarboard: 5 })).toBe(false)
    expect(hasHull({ toBow: 10, toStern: 5, toPort: 0, toStarboard: 0 })).toBe(false)
    expect(hasHull({ toBow: 10, toStern: 5, toPort: 2, toStarboard: 3 })).toBe(true)
  })
})

describe('metresPerPixel', () => {
  it('halves with each zoom level', () => {
    expect(metresPerPixel(13, LAT) / metresPerPixel(14, LAT)).toBeCloseTo(2)
  })

  it("matches MapLibre's 512px tiles at zoom 0 on the equator", () => {
    expect(metresPerPixel(0, 0)).toBeCloseTo(78_271.5, 0)
  })
})

describe('hullHeights', () => {
  it('puts the deckhouse above the deck, both growing with length', () => {
    const small = hullHeights(20)
    const laker = hullHeights(225)
    expect(laker.house).toBeGreaterThan(laker.deck)
    expect(laker.deck).toBeGreaterThan(small.deck)
    expect(laker.house).toBeGreaterThan(small.house)
  })
})

describe('wakeOutline', () => {
  const dims = { toBow: 150, toStern: 50, toPort: 10, toStarboard: 10 }

  it('trails behind the stern, longer when faster', () => {
    const slow = wakeOutline(LAT, -82.42, 0, dims, 4)
    const fast = wakeOutline(LAT, -82.42, 0, dims, 12)
    const tail = (bands: ReturnType<typeof wakeOutline>) =>
      Math.min(...toMetres(bands[0].outline).map(([, n]) => n))
    expect(tail(slow)).toBeLessThan(-50)
    expect(tail(fast)).toBeLessThan(tail(slow))
  })

  it('is empty for a ship barely moving', () => {
    expect(wakeOutline(LAT, -82.42, 0, dims, 0.3)).toEqual([])
  })
})

describe('bow waves', () => {
  it('angle back from the bow on both sides', () => {
    const dims = { toBow: 150, toStern: 50, toPort: 10, toStarboard: 10 }
    const bands = wakeOutline(LAT, -82.42, 0, dims, 10)
    const forward = bands.filter((b) => Math.max(...toMetres(b.outline).map(([, n]) => n)) > 100)
    expect(forward.length).toBe(8)
    const easts = forward.flatMap((b) => toMetres(b.outline).map(([e]) => e))
    expect(Math.min(...easts)).toBeLessThan(-10)
    expect(Math.max(...easts)).toBeGreaterThan(10)
  })
})
