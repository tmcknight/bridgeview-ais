import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useLiveStream } from './useLiveStream'

describe('useLiveStream', () => {
  let frame: HTMLIFrameElement
  let posted: Array<{ event: string; func?: string; args?: unknown[] }>

  beforeEach(() => {
    vi.useFakeTimers()
    frame = document.createElement('iframe')
    document.body.appendChild(frame)
    posted = []
    vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation((message: unknown) => {
      posted.push(JSON.parse(message as string))
    })
  })

  afterEach(() => {
    frame.remove()
    vi.useRealTimers()
  })

  const fromPlayer = (info: object, source: Window | null = frame.contentWindow) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify({ event: 'infoDelivery', info }), source }),
      )
    })
  const commands = () => posted.filter((m) => m.event === 'command')

  const render = () => renderHook(() => useLiveStream({ current: frame }, 'https://example.test/embed'))

  it('says hello to the player until it answers', () => {
    render()
    act(() => vi.advanceTimersByTime(3000))
    expect(posted.filter((m) => m.event === 'listening')).toHaveLength(3)

    fromPlayer({ playerState: 1 })
    act(() => vi.advanceTimersByTime(3000))
    expect(posted.filter((m) => m.event === 'listening')).toHaveLength(3)
  })

  it('leaves a stream at the live edge alone', () => {
    render()
    fromPlayer({ playerState: 1, progressState: { current: 100, seekableEnd: 100, isAtLiveHead: true } })
    act(() => vi.advanceTimersByTime(10000))
    expect(commands()).toEqual([])
  })

  it('jumps back to live when it falls behind', () => {
    render()
    fromPlayer({ playerState: 1, progressState: { current: 50, seekableEnd: 100, isAtLiveHead: false } })
    act(() => vi.advanceTimersByTime(5000))
    expect(commands()).toEqual([
      expect.objectContaining({ func: 'seekTo', args: [3700, true] }),
      expect.objectContaining({ func: 'playVideo' }),
    ])
  })

  it('plays again from live when paused', () => {
    render()
    fromPlayer({ playerState: 2, progressState: { current: 100, seekableEnd: 100, isAtLiveHead: true } })
    act(() => vi.advanceTimersByTime(5000))
    expect(commands().map((m) => m.func)).toEqual(['seekTo', 'playVideo'])
  })

  it('checks as soon as the tab is shown again', () => {
    render()
    fromPlayer({ playerState: 1, progressState: { current: 50, seekableEnd: 100, isAtLiveHead: false } })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(commands().map((m) => m.func)).toEqual(['seekTo', 'playVideo'])
  })

  it("ignores other frames' messages", () => {
    render()
    fromPlayer({ playerState: 2 }, window)
    act(() => vi.advanceTimersByTime(5000))
    expect(commands()).toEqual([])
  })

  it('keeps a moving stream alone', () => {
    render()
    for (let t = 1; t <= 12; t++) {
      fromPlayer({ playerState: 1, currentTime: t * 5 })
      act(() => vi.advanceTimersByTime(5000))
    }
    expect(commands()).toEqual([])
  })

  it('jumps to live when the stream freezes, then loads it again', () => {
    render()
    const setSrc = vi.spyOn(frame, 'src', 'set')
    fromPlayer({ playerState: 1, currentTime: 10, progressState: { current: 10, seekableEnd: 10, isAtLiveHead: true } })
    act(() => vi.advanceTimersByTime(10000))
    expect(commands()).toEqual([])
    act(() => vi.advanceTimersByTime(5000))
    expect(commands().map((m) => m.func)).toEqual(['seekTo', 'playVideo'])
    expect(setSrc).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(30000))
    expect(setSrc).toHaveBeenCalledWith('https://example.test/embed')
  })

  it('loads the embed again when the player never answers', () => {
    render()
    const setSrc = vi.spyOn(frame, 'src', 'set')
    act(() => vi.advanceTimersByTime(45000))
    expect(setSrc).toHaveBeenCalledTimes(1)
  })

  it('does nothing without a stream', () => {
    renderHook(() => useLiveStream({ current: frame }, null))
    act(() => vi.advanceTimersByTime(60000))
    expect(posted).toEqual([])
  })

  it('stops when unmounted', () => {
    const { unmount } = render()
    unmount()
    fromPlayer({ playerState: 2 })
    act(() => vi.advanceTimersByTime(10000))
    expect(posted).toEqual([])
  })
})
