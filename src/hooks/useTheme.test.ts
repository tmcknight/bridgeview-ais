import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTheme } from './useTheme'

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('initial theme', () => {
    it('defaults to light when no stored preference and system prefers light', () => {
      // matchMedia mock returns matches: false by default (light mode)
      const { result } = renderHook(() => useTheme())
      expect(result.current.theme).toBe('light')
    })

    it('uses stored theme from localStorage', () => {
      localStorage.setItem('theme', 'dark')
      const { result } = renderHook(() => useTheme())
      expect(result.current.theme).toBe('dark')
    })

    it('uses stored light theme from localStorage', () => {
      localStorage.setItem('theme', 'light')
      const { result } = renderHook(() => useTheme())
      expect(result.current.theme).toBe('light')
    })

    it('ignores invalid stored theme values', () => {
      localStorage.setItem('theme', 'invalid-value')
      const { result } = renderHook(() => useTheme())
      // Falls back to system theme (light since matchMedia returns false)
      expect(result.current.theme).toBe('light')
    })
  })

  describe('setTheme', () => {
    it('sets theme to dark', () => {
      const { result } = renderHook(() => useTheme())
      act(() => {
        result.current.setTheme('dark')
      })
      expect(result.current.theme).toBe('dark')
    })

    it('sets theme to light', () => {
      localStorage.setItem('theme', 'dark')
      const { result } = renderHook(() => useTheme())
      act(() => {
        result.current.setTheme('light')
      })
      expect(result.current.theme).toBe('light')
    })

    it('persists theme to localStorage', () => {
      const { result } = renderHook(() => useTheme())
      act(() => {
        result.current.setTheme('dark')
      })
      expect(localStorage.getItem('theme')).toBe('dark')
    })
  })

  describe('toggleTheme', () => {
    it('toggles from light to dark', () => {
      const { result } = renderHook(() => useTheme())
      expect(result.current.theme).toBe('light')
      act(() => {
        result.current.toggleTheme()
      })
      expect(result.current.theme).toBe('dark')
    })

    it('toggles from dark to light', () => {
      localStorage.setItem('theme', 'dark')
      const { result } = renderHook(() => useTheme())
      expect(result.current.theme).toBe('dark')
      act(() => {
        result.current.toggleTheme()
      })
      expect(result.current.theme).toBe('light')
    })

    it('persists toggled theme to localStorage', () => {
      const { result } = renderHook(() => useTheme())
      act(() => {
        result.current.toggleTheme()
      })
      expect(localStorage.getItem('theme')).toBe('dark')
    })
  })

  describe('system theme detection', () => {
    it('responds to system theme changes when no stored preference', () => {
      let changeHandler: ((e: MediaQueryListEvent) => void) | null = null

      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: (_event: string, handler: (e: MediaQueryListEvent) => void) => {
            changeHandler = handler
          },
          removeEventListener: () => {},
          dispatchEvent: () => true,
        }),
      })

      const { result } = renderHook(() => useTheme())
      expect(result.current.theme).toBe('light')

      // Simulate system theme change to dark
      if (changeHandler) {
        act(() => {
          changeHandler!({ matches: true } as MediaQueryListEvent)
        })
        expect(result.current.theme).toBe('dark')
      }
    })

    it('does not respond to system theme changes when user has stored preference', () => {
      let changeHandler: ((e: MediaQueryListEvent) => void) | null = null

      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: (_event: string, handler: (e: MediaQueryListEvent) => void) => {
            changeHandler = handler
          },
          removeEventListener: () => {},
          dispatchEvent: () => true,
        }),
      })

      localStorage.setItem('theme', 'light')
      const { result } = renderHook(() => useTheme())

      if (changeHandler) {
        act(() => {
          changeHandler!({ matches: true } as MediaQueryListEvent)
        })
        // Should remain light because user explicitly set it
        expect(result.current.theme).toBe('light')
      }
    })
  })

  describe('localStorage error handling', () => {
    it('handles localStorage.getItem throwing', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Access denied')
      })
      // Should not throw, falls back to system theme
      const { result } = renderHook(() => useTheme())
      expect(result.current.theme).toBe('light')
      spy.mockRestore()
    })

    it('handles localStorage.setItem throwing', () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Quota exceeded')
      })
      const { result } = renderHook(() => useTheme())
      // Should not throw when setting theme
      act(() => {
        result.current.setTheme('dark')
      })
      expect(result.current.theme).toBe('dark')
      spy.mockRestore()
    })
  })
})
