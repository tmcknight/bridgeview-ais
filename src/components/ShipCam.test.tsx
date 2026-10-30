import { beforeEach, describe, it, expect, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../test/utils/renderWithProviders'
import ShipCam from './ShipCam'
import { SHIP_CAMS } from '../constants/shipCams'

describe('ShipCam', () => {
  beforeEach(() => localStorage.clear())

  it('plays the first cam muted, with a link to it on YouTube', () => {
    const { getByTitle, getByLabelText } = renderWithProviders(<ShipCam onClose={() => {}} />)
    const [first] = SHIP_CAMS
    const frame = getByTitle(`${first.name} live cam`)
    expect(frame).toHaveAttribute('src', expect.stringContaining(`/embed/${first.videoId}?`))
    expect(frame).toHaveAttribute('src', expect.stringContaining('mute=1'))
    expect(getByLabelText(`Open ${first.name} on YouTube`)).toHaveAttribute(
      'href',
      `https://www.youtube.com/watch?v=${first.videoId}`,
    )
  })

  it("plays the server's live video when it has one", () => {
    const [first] = SHIP_CAMS
    const { getByTitle, getByLabelText } = renderWithProviders(
      <ShipCam onClose={() => {}} videoIds={{ [first.id]: 'newVideo123' }} />,
    )
    expect(getByTitle(`${first.name} live cam`)).toHaveAttribute('src', expect.stringContaining('/embed/newVideo123?'))
    expect(getByLabelText(`Open ${first.name} on YouTube`)).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=newVideo123',
    )
  })

  it('closes', () => {
    const onClose = vi.fn()
    const { getByLabelText } = renderWithProviders(<ShipCam onClose={onClose} />)
    fireEvent.click(getByLabelText('Close ship cam'))
    expect(onClose).toHaveBeenCalled()
  })

  it('reports its size so the map can keep clear of it, and null once closed', () => {
    const onResize = vi.fn()
    const { unmount } = renderWithProviders(<ShipCam onClose={() => {}} onResize={onResize} />)
    expect(onResize).toHaveBeenLastCalledWith({ width: expect.any(Number), height: expect.any(Number) })
    unmount()
    expect(onResize).toHaveBeenLastCalledWith(null)
  })

  describe('resizing', () => {
    const panelWidth = (el: HTMLElement) =>
      el.closest('section')!.style.getPropertyValue('--cam-w')

    it('grows when the handle is dragged right or up, and remembers the size', () => {
      const { getByLabelText, unmount } = renderWithProviders(<ShipCam onClose={() => {}} />)
      const handle = getByLabelText('Resize ship cam')
      expect(panelWidth(handle)).toBe('448px')

      fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1 })
      fireEvent.pointerMove(handle, { clientX: 200, clientY: 100, pointerId: 1 })
      expect(panelWidth(handle)).toBe('548px')
      fireEvent.pointerMove(handle, { clientX: 100, clientY: 10, pointerId: 1 })
      expect(panelWidth(handle)).toBe('608px')
      fireEvent.pointerUp(handle, { pointerId: 1 })
      unmount()

      const again = renderWithProviders(<ShipCam onClose={() => {}} />)
      expect(panelWidth(again.getByLabelText('Resize ship cam'))).toBe('608px')
    })

    it('resizes with arrow keys, but not below the minimum', () => {
      const { getByLabelText } = renderWithProviders(<ShipCam onClose={() => {}} />)
      const handle = getByLabelText('Resize ship cam')
      fireEvent.keyDown(handle, { key: 'ArrowRight' })
      expect(panelWidth(handle)).toBe('480px')
      for (let i = 0; i < 20; i++) fireEvent.keyDown(handle, { key: 'ArrowDown' })
      expect(panelWidth(handle)).toBe('240px')
    })
  })
})
