import { describe, it, expect } from 'vitest'
import { guessCargo, describeCargo } from './cargo'

const laker = (destination: string | undefined) => ({ destination, shipType: 70, length: 225 })

describe('guessCargo', () => {
  it('recognises limestone loading ports', () => {
    expect(guessCargo(laker('STONEPORT'))).toEqual({ cargo: 'limestone', role: 'load' })
    expect(guessCargo(laker('Calcite, MI'))).toEqual({ cargo: 'limestone', role: 'load' })
  })

  it('recognises iron ore, grain, cement and salt ports', () => {
    expect(guessCargo(laker('TWO HARBORS MN'))?.cargo).toBe('iron ore')
    expect(guessCargo(laker('SUPERIOR'))?.cargo).toBe('iron ore or coal')
    expect(guessCargo(laker('THUNDER BAY'))?.cargo).toBe('grain')
    expect(guessCargo(laker('ALPENA'))?.cargo).toBe('cement')
    expect(guessCargo(laker('GODERICH'))?.cargo).toBe('salt')
  })

  it('treats steel mill ports as deliveries', () => {
    expect(guessCargo(laker('BURNS HARBOR'))).toEqual({ cargo: 'iron ore or coal', role: 'deliver' })
  })

  it('returns null for unknown or missing destinations', () => {
    expect(guessCargo(laker('DETROIT CH 88A'))).toBeNull()
    expect(guessCargo(laker(''))).toBeNull()
    expect(guessCargo(laker(undefined))).toBeNull()
  })
})

describe('guessCargo ship filter', () => {
  it('guesses only for cargo ships and tankers of 100 m or more', () => {
    expect(guessCargo({ destination: 'DULUTH', shipType: 84, length: 100 })?.cargo).toBe('iron ore')
    expect(guessCargo({ destination: 'DULUTH', shipType: 70, length: 99 })).toBeNull()
    expect(guessCargo({ destination: 'DULUTH', shipType: 70 })).toBeNull()
    expect(guessCargo({ destination: 'DULUTH', shipType: 52, length: 225 })).toBeNull()
    expect(guessCargo({ destination: 'DULUTH', length: 225 })).toBeNull()
  })
})

describe('describeCargo', () => {
  it('phrases loading and delivery guesses', () => {
    expect(describeCargo({ cargo: 'limestone', role: 'load' })).toBe('Likely going to load limestone')
    expect(describeCargo({ cargo: 'iron ore or coal', role: 'deliver' })).toBe('Likely delivering iron ore or coal')
  })
})
