import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, userEvent } from '../test/utils/renderWithProviders'
import FavouriteShips from './FavouriteShips'
import { mockShip } from '../test/mocks/ships'
import type { Favourites } from '../utils/favourites'
import type { ShipLog } from '../utils/shipLog'

const added = '2026-11-01T00:00:00Z'
const favourites: Favourites = new Map([
  [1, { mmsi: 1, name: 'AWAY', addedAt: added }],
  [2, { mmsi: 2, name: 'OLD NAME', addedAt: added }],
])
const live = mockShip({ mmsi: 2, name: 'HERE NOW', sog: 0, navStatus: 5, distanceToBridge: 1 })
const ships = new Map([[2, live]])
const log: ShipLog = new Map()

describe('FavouriteShips', () => {
  it('renders nothing with no favourites', () => {
    const { container } = renderWithProviders(
      <FavouriteShips favourites={new Map()} ships={ships} log={log} onToggleFavourite={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('lists heard ships first, with their live name, and selects them', async () => {
    const onSelectShip = vi.fn()
    renderWithProviders(
      <FavouriteShips favourites={favourites} ships={ships} log={log} onSelectShip={onSelectShip} onToggleFavourite={vi.fn()} />,
    )
    expect(screen.getByText('Favourites (1 of 2 heard)')).toBeInTheDocument()
    const names = screen.getAllByText(/HERE NOW|AWAY/).map((el) => el.textContent)
    expect(names).toEqual(['HERE NOW', 'AWAY'])
    expect(screen.getByText('Not heard now')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Select HERE NOW' }))
    expect(onSelectShip).toHaveBeenCalledWith(live)
  })

  it('removes a favourite with its star', async () => {
    const onToggleFavourite = vi.fn()
    renderWithProviders(
      <FavouriteShips favourites={favourites} ships={ships} log={log} onToggleFavourite={onToggleFavourite} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Remove AWAY from favourites' }))
    expect(onToggleFavourite).toHaveBeenCalledWith(1, 'AWAY')
  })
})
