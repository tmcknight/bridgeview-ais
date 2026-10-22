import { describe, it, expect } from 'vitest'
import { guessCargo, describeCargo } from './cargo'

describe('guessCargo', () => {
  it('recognises limestone loading ports', () => {
    expect(guessCargo('STONEPORT')).toEqual({ cargo: 'limestone', role: 'load' })
    expect(guessCargo('Calcite, MI')).toEqual({ cargo: 'limestone', role: 'load' })
  })

  it('recognises iron ore, grain, cement and salt ports', () => {
    expect(guessCargo('TWO HARBORS MN')?.cargo).toBe('iron ore')
    expect(guessCargo('SUPERIOR')?.cargo).toBe('iron ore or coal')
    expect(guessCargo('THUNDER BAY')?.cargo).toBe('grain')
    expect(guessCargo('ALPENA')?.cargo).toBe('cement')
    expect(guessCargo('GODERICH')?.cargo).toBe('salt')
  })

  it('treats steel mill ports as deliveries', () => {
    expect(guessCargo('BURNS HARBOR')).toEqual({ cargo: 'iron ore or coal', role: 'deliver' })
  })

  it('returns null for unknown or missing destinations', () => {
    expect(guessCargo('DETROIT CH 88A')).toBeNull()
    expect(guessCargo('')).toBeNull()
    expect(guessCargo(undefined)).toBeNull()
  })
})

describe('describeCargo', () => {
  it('phrases loading and delivery guesses', () => {
    expect(describeCargo({ cargo: 'limestone', role: 'load' })).toBe('Likely going to load limestone')
    expect(describeCargo({ cargo: 'iron ore or coal', role: 'deliver' })).toBe('Likely delivering iron ore or coal')
  })
})
