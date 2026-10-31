import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '../test/utils/renderWithProviders'
import PhotoCarousel from './PhotoCarousel'

const photos = [
  { url: 'https://thumb/a.jpg', pageUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg', artist: 'Pete Markham', license: 'CC BY-SA 2.0' },
  { url: 'https://thumb/b.jpg', pageUrl: 'https://commons.wikimedia.org/wiki/File:B.jpg' },
  { url: 'https://thumb/c.jpg', artist: 'NOAA' },
]

describe('PhotoCarousel', () => {
  afterEach(() => vi.useRealTimers())

  it('steps through the photos both ways, wrapping round, with each credit', () => {
    renderWithProviders(<PhotoCarousel photos={photos} alt="Laker" imageClassName="" />)
    const image = () => screen.getByAltText('Laker')
    expect(image()).toHaveAttribute('src', 'https://thumb/a.jpg')
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.getByText('Photo: Pete Markham · CC BY-SA 2.0')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:A.jpg')

    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }))
    expect(image()).toHaveAttribute('src', 'https://thumb/b.jpg')
    expect(screen.queryByText(/^Photo:/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous photo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous photo' }))
    expect(image()).toHaveAttribute('src', 'https://thumb/c.jpg')
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://thumb/c.jpg')
  })

  it("doesn't select the ship card it sits in", () => {
    const onCardClick = vi.fn()
    renderWithProviders(
      <div onClick={onCardClick}>
        <PhotoCarousel photos={photos} alt="Laker" imageClassName="" />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }))
    expect(onCardClick).not.toHaveBeenCalled()
  })

  it('moves on by itself when told to, without buttons', () => {
    vi.useFakeTimers()
    renderWithProviders(<PhotoCarousel photos={photos} alt="Laker" imageClassName="" autoAdvanceMs={8000} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(8000))
    expect(screen.getByAltText('Laker')).toHaveAttribute('src', 'https://thumb/b.jpg')
  })

  it('shows a single photo without controls, and nothing without photos', () => {
    const { rerender, container } = renderWithProviders(<PhotoCarousel photos={photos.slice(0, 1)} alt="Laker" imageClassName="" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('1 / 1')).not.toBeInTheDocument()
    rerender(<PhotoCarousel photos={[]} alt="Laker" imageClassName="" />)
    expect(container).toBeEmptyDOMElement()
  })
})
