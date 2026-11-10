import { afterEach, describe, expect, it, vi } from 'vitest'
import { convertLength, formatLength, formatLengthNumber, lengthUnit } from './units'

describe('lengthUnit', () => {
  it('is feet for en-US and metres elsewhere', () => {
    expect(lengthUnit('en-US')).toBe('foot')
    expect(lengthUnit('en-CA')).toBe('meter')
    expect(lengthUnit('en-GB')).toBe('meter')
    expect(lengthUnit('en')).toBe('meter')
    expect(lengthUnit('fr-CA')).toBe('meter')
  })
})

describe('convertLength', () => {
  it('rounds metres to whole feet for en-US', () => {
    expect(convertLength(308.8, 'en-US')).toBe(1013)
    expect(convertLength(225, 'en-US')).toBe(738)
  })

  it('rounds metres elsewhere', () => {
    expect(convertLength(225.4, 'en-CA')).toBe(225)
  })
})

describe('formatLength', () => {
  it('shows feet for en-US', () => {
    expect(formatLength(308.8, { locale: 'en-US' })).toBe('1,013 ft')
    expect(formatLength(308.8, { locale: 'en-US', spoken: true })).toBe('1,013 feet')
  })

  it('shows metres elsewhere', () => {
    expect(formatLength(225, { locale: 'en-CA' })).toBe('225 m')
    expect(formatLength(225, { locale: 'en-CA', spoken: true })).toBe('225 metres')
    expect(formatLength(225, { locale: 'en-GB' })).toBe('225 m')
  })

  it('stays in English for other languages', () => {
    expect(formatLength(1225, { locale: 'fr-CA', spoken: true })).toBe('1,225 metres')
  })

  describe("with the browser's locale", () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('uses metres in tests (en-CA)', () => {
      expect(formatLength(225)).toBe('225 m')
    })

    it('uses feet when the browser is en-US', () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
      expect(formatLength(225)).toBe('738 ft')
    })
  })
})

describe('formatLengthNumber', () => {
  it('is the number alone, grouped for the locale', () => {
    expect(formatLengthNumber(308.8, 'en-US')).toBe('1,013')
    expect(formatLengthNumber(225, 'en-CA')).toBe('225')
  })
})
