import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DataCredits from './DataCredits'

describe('DataCredits', () => {
  const renderCredits = (props: Partial<Parameters<typeof DataCredits>[0]> = {}) =>
    render(
      <DataCredits theme="light" aishub={false} adsb={false} besideButton showShipList={false} {...props} />
    )

  it('shows nothing when no credited feed is in use', () => {
    const { container } = renderCredits()
    expect(container).toBeEmptyDOMElement()
  })

  it('credits AISHub contributors with a link to AISHub', () => {
    renderCredits({ aishub: true })
    const link = screen.getByRole('link', { name: 'Data: AISHub contributors' })
    expect(link).toHaveAttribute('href', 'https://www.aishub.net')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.queryByRole('link', { name: 'adsb.fi' })).not.toBeInTheDocument()
  })

  it('credits adsb.fi while its aircraft are shown', () => {
    renderCredits({ adsb: true })
    expect(screen.getByRole('link', { name: 'adsb.fi' })).toHaveAttribute('href', 'https://adsb.fi')
    expect(screen.getByText(/Aircraft:/)).toBeInTheDocument()
  })

  it('shows both together, in the dark theme too', () => {
    const { container } = renderCredits({ aishub: true, adsb: true, theme: 'dark' })
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(container.firstChild).toHaveClass('dark')
  })

  it('moves over to the corner when the map buttons hide (TV mode)', () => {
    const { container } = renderCredits({ aishub: true, besideButton: false })
    expect(container.firstChild).toHaveClass('right-2.5')
  })
})
