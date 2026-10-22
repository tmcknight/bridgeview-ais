import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, userEvent } from '../test/utils/renderWithProviders'
import UpcomingShips from './UpcomingShips'
import { mockShip } from '../test/mocks/ships'
import { BRIDGE_CENTER } from '../constants/bridge'

const north = (nm: number) => BRIDGE_CENTER.lat + nm / 60

describe('UpcomingShips', () => {
  it('shows an empty message when nothing is heading for the bridge', () => {
    renderWithProviders(<UpcomingShips ships={new Map()} />)

    expect(screen.getByText('Coming Up')).toBeInTheDocument()
    expect(screen.getByText('No ships are heading for the bridge right now.')).toBeInTheDocument()
  })

  it('lists approaching ships soonest first with ETA, destination and cargo guess', () => {
    const later = mockShip({ mmsi: 1, name: 'LATER LAKER', latitude: north(30), cog: 180, sog: 10, destination: 'DETROIT' })
    const sooner = mockShip({ mmsi: 2, name: 'SOONER LAKER', latitude: north(5), cog: 180, sog: 10, destination: 'BURNS HARBOR' })
    const ships = new Map([[1, later], [2, sooner]])

    renderWithProviders(<UpcomingShips ships={ships} />)

    expect(screen.getByText('2 Coming Up')).toBeInTheDocument()
    const names = screen.getAllByText(/LAKER$/).map((el) => el.textContent)
    expect(names).toEqual(['SOONER LAKER', 'LATER LAKER'])
    expect(screen.getByText('~30 min')).toBeInTheDocument()
    expect(screen.getByText('~3h 0m')).toBeInTheDocument()
    expect(screen.getByText('To BURNS HARBOR')).toBeInTheDocument()
    expect(screen.getByText('Likely delivering iron ore or coal')).toBeInTheDocument()
  })

  it('selects a ship when clicked', async () => {
    const ship = mockShip({ name: 'CLICK ME', latitude: north(5), cog: 180, sog: 10 })
    const onSelectShip = vi.fn()
    renderWithProviders(<UpcomingShips ships={new Map([[ship.mmsi, ship]])} onSelectShip={onSelectShip} />)

    await userEvent.click(screen.getByRole('button', { name: /Select CLICK ME/ }))
    expect(onSelectShip).toHaveBeenCalledWith(ship)
  })

  it('collapses when the header is clicked', async () => {
    const ship = mockShip({ name: 'HIDE ME', latitude: north(5), cog: 180, sog: 10 })
    renderWithProviders(<UpcomingShips ships={new Map([[ship.mmsi, ship]])} />)

    await userEvent.click(screen.getByRole('button', { name: /1 Coming Up/ }))
    expect(screen.queryByText('HIDE ME')).not.toBeInTheDocument()
  })
})
