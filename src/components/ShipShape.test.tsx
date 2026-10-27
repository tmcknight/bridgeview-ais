import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../test/utils/renderWithProviders'
import ShipShape from './ShipShape'

describe('ShipShape', () => {
  it('shows the length and beam when both are known', () => {
    renderWithProviders(<ShipShape length={225} width={24} />)

    expect(screen.getByText('225 × 24 m')).toBeInTheDocument()
    expect(screen.getByTitle('Length 225 m × beam 24 m')).toBeInTheDocument()
  })

  it.each([
    [undefined, undefined],
    [0, 0],
    [200, 0],
    [0, 30],
  ])('renders nothing for length %s and beam %s', (length, width) => {
    const { container } = renderWithProviders(<ShipShape length={length} width={width} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('draws a longer hull for a longer ship', () => {
    const { container, rerender } = renderWithProviders(<ShipShape length={30} width={10} />)
    const tug = container.querySelector('path')?.getAttribute('d')
    rerender(<ShipShape length={300} width={32} />)
    const laker = container.querySelector('path')?.getAttribute('d')

    const bowX = (d?: string | null) => Math.max(...(d?.match(/[\d.]+/g) ?? []).map(Number))
    expect(bowX(laker)).toBeGreaterThan(bowX(tug))
  })
})
