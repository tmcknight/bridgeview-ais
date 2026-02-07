import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, userEvent } from '../test/utils/renderWithProviders'
import ShipList from './ShipList'
import { mockShip, mockShipNorthbound, mockShipAtAnchor, mockShipCloseToBridge } from '../test/mocks/ships'

describe('ShipList', () => {
  describe('empty state', () => {
    it('should show "No vessels detected" message when ships map is empty', () => {
      renderWithProviders(<ShipList ships={new Map()} />)

      expect(screen.getByText('Tracked Vessels')).toBeInTheDocument()
      expect(screen.getByText('No vessels detected in the tracking area.')).toBeInTheDocument()
      expect(screen.getByText(/Ships will appear here as AIS data is received/)).toBeInTheDocument()
    })

    it('should not show ship count in header when empty', () => {
      renderWithProviders(<ShipList ships={new Map()} />)

      // Should just say "Tracked Vessels", not "Tracked Vessels (0)"
      expect(screen.getByText('Tracked Vessels')).toBeInTheDocument()
      expect(screen.queryByText(/Tracked Vessels \(\d+\)/)).not.toBeInTheDocument()
    })
  })

  describe('ship rendering', () => {
    it('should render ship cards for all ships', () => {
      const ship1 = mockShip({ mmsi: 111, name: 'SHIP ONE' })
      const ship2 = mockShip({ mmsi: 222, name: 'SHIP TWO' })
      const ships = new Map([
        [111, ship1],
        [222, ship2],
      ])

      renderWithProviders(<ShipList ships={ships} />)

      expect(screen.getByText('SHIP ONE')).toBeInTheDocument()
      expect(screen.getByText('SHIP TWO')).toBeInTheDocument()
      expect(screen.getByText('Tracked Vessels (2)')).toBeInTheDocument()
    })

    it('should display ship name', () => {
      const ship = mockShip({ name: 'TEST VESSEL NAME' })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      expect(screen.getByText('TEST VESSEL NAME')).toBeInTheDocument()
    })

    it('should display distance to bridge', () => {
      const ship = mockShip({ distanceToBridge: 5.5 })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      expect(screen.getByText('5.5 NM')).toBeInTheDocument()
    })

    it('should display speed', () => {
      const ship = mockShip({ sog: 12.3 })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      expect(screen.getByText('12.3 kn')).toBeInTheDocument()
    })

    it('should display navigation status', () => {
      const ship = mockShip({ navStatus: 0 })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      expect(screen.getByText('Under way using engine')).toBeInTheDocument()
    })

    it('should display destination when available', () => {
      const ship = mockShip({ destination: 'DETROIT' })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      expect(screen.getByText('DETROIT')).toBeInTheDocument()
    })

    it('should not show destination field when missing', () => {
      const ship = mockShip({ destination: undefined })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      // FlagIcon should not be rendered
      expect(screen.queryByTitle('Destination')).not.toBeInTheDocument()
    })

    it('should display vessel dimensions when available', () => {
      const ship = mockShip({ length: 200, width: 30 })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      expect(screen.getByText('200m × 30m')).toBeInTheDocument()
    })

    it('should not show dimensions when length is 0', () => {
      const ship = mockShip({ length: 0, width: 0 })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      expect(screen.queryByText(/m × /)).not.toBeInTheDocument()
    })

    it('should display MMSI', () => {
      const ship = mockShip({ mmsi: 367123456 })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      expect(screen.getByText('367123456')).toBeInTheDocument()
    })

    it('should display last update timestamp', () => {
      const ship = mockShip({ lastUpdate: new Date('2024-01-15T12:34:56Z').toISOString() })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      // Should display as locale time
      const timeElement = screen.getByTitle('Last update')
      expect(timeElement).toBeInTheDocument()
    })
  })

  describe('sorting', () => {
    it('should sort ships by distance to bridge (nearest first)', () => {
      const shipFar = mockShip({ mmsi: 111, name: 'FAR SHIP', distanceToBridge: 10.0 })
      const shipClose = mockShip({ mmsi: 222, name: 'CLOSE SHIP', distanceToBridge: 2.0 })
      const shipMedium = mockShip({ mmsi: 333, name: 'MEDIUM SHIP', distanceToBridge: 5.0 })

      const ships = new Map([
        [111, shipFar],
        [222, shipClose],
        [333, shipMedium],
      ])

      renderWithProviders(<ShipList ships={ships} />)

      const shipCards = screen.getAllByRole('button')
      expect(shipCards).toHaveLength(3)

      // Verify order by checking text content
      expect(shipCards[0]).toHaveTextContent('CLOSE SHIP')
      expect(shipCards[1]).toHaveTextContent('MEDIUM SHIP')
      expect(shipCards[2]).toHaveTextContent('FAR SHIP')
    })
  })

  describe('visual states', () => {
    it('should show APPROACHING badge for approaching ships', () => {
      const ship = mockShip({ approaching: true })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      expect(screen.getByText('APPROACHING')).toBeInTheDocument()
    })

    it('should not show APPROACHING badge for non-approaching ships', () => {
      const ship = mockShip({ approaching: false })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      expect(screen.queryByText('APPROACHING')).not.toBeInTheDocument()
    })

    it('should apply red border class for approaching ships', () => {
      const ship = mockShip({ approaching: true })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      const shipCard = screen.getByRole('button')
      expect(shipCard).toHaveClass('border-red-500')
    })

    it('should apply blue border class for selected ship', () => {
      const ship = mockShip()
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} selectedShip={ship} />)

      const shipCard = screen.getByRole('button')
      expect(shipCard).toHaveClass('border-blue-500')
      expect(shipCard).toHaveClass('bg-blue-900/20')
    })

    it('should apply default border for non-approaching, non-selected ships', () => {
      const ship = mockShip({ approaching: false })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} selectedShip={null} />)

      const shipCard = screen.getByRole('button')
      expect(shipCard).toHaveClass('border-slate-700')
    })
  })

  describe('interactions', () => {
    it('should call onSelectShip when ship card is clicked', async () => {
      const user = userEvent.setup()
      const onSelectShip = vi.fn()
      const ship = mockShip()

      renderWithProviders(
        <ShipList ships={new Map([[ship.mmsi, ship]])} onSelectShip={onSelectShip} />
      )

      const shipCard = screen.getByRole('button', { name: new RegExp(ship.name) })
      await user.click(shipCard)

      expect(onSelectShip).toHaveBeenCalledTimes(1)
      expect(onSelectShip).toHaveBeenCalledWith(ship)
    })

    it('should call onSelectShip when Enter key is pressed', async () => {
      const user = userEvent.setup()
      const onSelectShip = vi.fn()
      const ship = mockShip()

      renderWithProviders(
        <ShipList ships={new Map([[ship.mmsi, ship]])} onSelectShip={onSelectShip} />
      )

      const shipCard = screen.getByRole('button', { name: new RegExp(ship.name) })
      shipCard.focus()
      await user.keyboard('{Enter}')

      expect(onSelectShip).toHaveBeenCalledTimes(1)
      expect(onSelectShip).toHaveBeenCalledWith(ship)
    })

    it('should call onSelectShip when Space key is pressed', async () => {
      const user = userEvent.setup()
      const onSelectShip = vi.fn()
      const ship = mockShip()

      renderWithProviders(
        <ShipList ships={new Map([[ship.mmsi, ship]])} onSelectShip={onSelectShip} />
      )

      const shipCard = screen.getByRole('button', { name: new RegExp(ship.name) })
      shipCard.focus()
      await user.keyboard(' ')

      expect(onSelectShip).toHaveBeenCalledTimes(1)
      expect(onSelectShip).toHaveBeenCalledWith(ship)
    })

    it('should not crash when onSelectShip is not provided', async () => {
      const user = userEvent.setup()
      const ship = mockShip()

      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      const shipCard = screen.getByRole('button')
      await user.click(shipCard)

      // Should not throw error
      expect(shipCard).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('should have role="button" on ship cards', () => {
      const ship = mockShip()
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      const shipCard = screen.getByRole('button')
      expect(shipCard).toBeInTheDocument()
    })

    it('should have aria-label with ship name and distance', () => {
      const ship = mockShip({ name: 'TEST SHIP', distanceToBridge: 5.5 })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      const shipCard = screen.getByRole('button', {
        name: /TEST SHIP.*5\.5 NM from bridge/,
      })
      expect(shipCard).toBeInTheDocument()
    })

    it('should have aria-pressed=true when selected', () => {
      const ship = mockShip()
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} selectedShip={ship} />)

      const shipCard = screen.getByRole('button')
      expect(shipCard).toHaveAttribute('aria-pressed', 'true')
    })

    it('should have aria-pressed=false when not selected', () => {
      const ship = mockShip()
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} selectedShip={null} />)

      const shipCard = screen.getByRole('button')
      expect(shipCard).toHaveAttribute('aria-pressed', 'false')
    })

    it('should be keyboard focusable with tabIndex=0', () => {
      const ship = mockShip()
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      const shipCard = screen.getByRole('button')
      expect(shipCard).toHaveAttribute('tabIndex', '0')
    })
  })

  describe('heading display', () => {
    it('should use true heading when available (not 511)', () => {
      const ship = mockShip({ trueHeading: 90, cog: 180 })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      expect(screen.getByText('90°')).toBeInTheDocument()
    })

    it('should fall back to COG when true heading is 511 (not available)', () => {
      const ship = mockShip({ trueHeading: 511, cog: 180 })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      expect(screen.getByText('180°')).toBeInTheDocument()
    })
  })

  describe('ETA calculation', () => {
    it('should display ETA when ship is moving', () => {
      const ship = mockShip({ distanceToBridge: 10, sog: 10 }) // 60 minutes = 1 hour
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      // 60 minutes is formatted as "~1h 0m"
      expect(screen.getByText('~1h 0m')).toBeInTheDocument()
    })

    it('should display N/A when ship is stationary', () => {
      const ship = mockShip({ distanceToBridge: 5, sog: 0 })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      expect(screen.getByText('N/A')).toBeInTheDocument()
    })
  })

  describe('multiple ships scenario', () => {
    it('should handle mix of approaching and non-approaching ships', () => {
      const approaching1 = mockShipNorthbound({ mmsi: 111, approaching: true })
      const approaching2 = mockShipCloseToBridge({ mmsi: 222, approaching: true })
      const notApproaching = mockShipAtAnchor({ mmsi: 333, approaching: false })

      const ships = new Map([
        [111, approaching1],
        [222, approaching2],
        [333, notApproaching],
      ])

      renderWithProviders(<ShipList ships={ships} />)

      const approachingBadges = screen.getAllByText('APPROACHING')
      expect(approachingBadges).toHaveLength(2)
    })
  })
})
