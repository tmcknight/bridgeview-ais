import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useFavourites } from './useFavourites'
import { FAVOURITES_KEY } from '../utils/favourites'

describe('useFavourites', () => {
  beforeEach(() => localStorage.clear())

  it('starts from what is saved', () => {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([{ mmsi: 1, name: 'ONE', addedAt: '2026-01-01T00:00:00Z' }]))
    const { result } = renderHook(() => useFavourites())
    expect(result.current.isFavourite(1)).toBe(true)
    expect(result.current.isFavourite(2)).toBe(false)
  })

  it('toggles and saves', () => {
    const { result } = renderHook(() => useFavourites())
    act(() => result.current.toggleFavourite(2, 'TWO'))
    expect(result.current.isFavourite(2)).toBe(true)
    expect(localStorage.getItem(FAVOURITES_KEY)).toContain('TWO')
    act(() => result.current.toggleFavourite(2, 'TWO'))
    expect(result.current.favourites.size).toBe(0)
    expect(localStorage.getItem(FAVOURITES_KEY)).toBe('[]')
  })

  it('follows changes from another tab', () => {
    const { result } = renderHook(() => useFavourites())
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: FAVOURITES_KEY,
          newValue: JSON.stringify([{ mmsi: 3, name: 'THREE', addedAt: '2026-01-01T00:00:00Z' }]),
        }),
      )
    })
    expect(result.current.isFavourite(3)).toBe(true)
  })
})
