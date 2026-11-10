import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserLocale, isAmericanLocale, spell } from './locale'

describe('isAmericanLocale', () => {
  it.each(['en-US', 'es-US', 'en-us'])('is American for %s', (locale) => {
    expect(isAmericanLocale(locale)).toBe(true)
  })

  it.each(['en-CA', 'en-GB', 'en', 'fr-CA', 'en-AU', '', 'not a locale!'])(
    'is not American for "%s"',
    (locale) => {
      expect(isAmericanLocale(locale)).toBe(false)
    },
  )
})

describe('browserLocale', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("is the browser's language", () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
    expect(browserLocale()).toBe('en-US')
    expect(isAmericanLocale()).toBe(true)
  })

  it('is en-CA in tests (set up in test/setup.ts)', () => {
    expect(browserLocale()).toBe('en-CA')
    expect(isAmericanLocale()).toBe(false)
  })
})

describe('spell', () => {
  it('keeps Canadian spelling outside the US', () => {
    expect(spell('Remove X from favourites', 'en-CA')).toBe('Remove X from favourites')
    expect(spell('Constrained by draught', 'en-GB')).toBe('Constrained by draught')
  })

  it('uses American spelling for en-US', () => {
    expect(spell('Favourites', 'en-US')).toBe('Favorites')
    expect(spell('Add X to favourites', 'en-US')).toBe('Add X to favorites')
    expect(spell('Favourite', 'en-US')).toBe('Favorite')
    expect(spell('Constrained by draught', 'en-US')).toBe('Constrained by draft')
    expect(spell('Draught', 'en-US')).toBe('Draft')
  })
})
