import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useIdle } from './useIdle'

describe('useIdle', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('goes idle when the mouse is still, and wakes when it moves', () => {
    const { result } = renderHook(() => useIdle(3000))
    expect(result.current).toBe(false)

    act(() => vi.advanceTimersByTime(3000))
    expect(result.current).toBe(true)

    act(() => {
      window.dispatchEvent(new Event('pointermove'))
    })
    expect(result.current).toBe(false)

    act(() => vi.advanceTimersByTime(2000))
    expect(result.current).toBe(false)
  })

  it('is never idle while disabled', () => {
    const { result } = renderHook(() => useIdle(3000, false))
    act(() => vi.advanceTimersByTime(5000))
    expect(result.current).toBe(false)
  })
})
