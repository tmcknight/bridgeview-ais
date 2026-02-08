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

      // Should just say "Tracked Vessels", not "N Tracked Vessels"
      expect(screen.getByText('Tracked Vessels')).toBeInTheDocument()
      expect(screen.queryByText(/\d+ Tracked Vessels/)).not.toBeInTheDocument()
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
      expect(screen.getByText('2 Tracked Vessels')).toBeInTheDocument()
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

    it('should display speed when sog > 0', () => {
      const ship = mockShip({ sog: 12.3 })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      expect(screen.getByText('12.3 kn')).toBeInTheDocument()
    })

    it('should not display speed when sog is 0', () => {
      const ship = mockShip({ sog: 0 })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      expect(screen.queryByText('0.0 kn')).not.toBeInTheDocument()
    })

    it('should include navigation status in title attribute', () => {
      const ship = mockShip({ navStatus: 0 })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      // Nav status is shown in the title of the name/icon container, not as visible text
      expect(screen.getByTitle(/Under way using engine/)).toBeInTheDocument()
    })

    it('should include destination in title attribute when available', () => {
      const ship = mockShip({ destination: 'DETROIT' })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      // Destination appears in the title attribute, not as visible text
      expect(screen.getByTitle(/Dest: DETROIT/)).toBeInTheDocument()
    })

    it('should not include destination in title when missing', () => {
      const ship = mockShip({ destination: undefined })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      expect(screen.queryByTitle(/Dest:/)).not.toBeInTheDocument()
    })

    it('should display MMSI as a link', () => {
      const ship = mockShip({ mmsi: 367123456 })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      const mmsiLink = screen.getByText('367123456')
      expect(mmsiLink).toBeInTheDocument()
      expect(mmsiLink.tagName).toBe('A')
      expect(mmsiLink).toHaveAttribute('href', 'https://www.vesselfinder.com/vessels/details/367123456')
    })

    it('should display relative time for last update', () => {
      const ship = mockShip({ lastUpdate: new Date().toISOString() })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      // Shows relative time like "< 1m ago"
      expect(screen.getByText('< 1m ago')).toBeInTheDocument()
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

      // Ship cards have aria-label starting with "View details for"
      const shipCards = screen.getAllByRole('button', { name: /View details for/ })
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

      const shipCard = screen.getByRole('button', { name: /View details for/ })
      expect(shipCard).toHaveClass('border-red-500')
    })

    it('should apply blue border class for selected ship', () => {
      const ship = mockShip()
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} selectedShip={ship} />)

      const shipCard = screen.getByRole('button', { name: /View details for/ })
      expect(shipCard).toHaveClass('border-blue-500')
    })

    it('should apply default border for non-approaching, non-selected ships', () => {
      const ship = mockShip({ approaching: false })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} selectedShip={null} />)

      const shipCard = screen.getByRole('button', { name: /View details for/ })
      expect(shipCard.className).toMatch(/border-slate/)
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

      const shipCard = screen.getByRole('button', { name: /View details for/ })
      await user.click(shipCard)

      // Should not throw error
      expect(shipCard).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('should have role="button" on ship cards', () => {
      const ship = mockShip()
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      const shipCard = screen.getByRole('button', { name: /View details for/ })
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

      const shipCard = screen.getByRole('button', { name: /View details for/ })
      expect(shipCard).toHaveAttribute('aria-pressed', 'true')
    })

    it('should have aria-pressed=false when not selected', () => {
      const ship = mockShip()
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} selectedShip={null} />)

      const shipCard = screen.getByRole('button', { name: /View details for/ })
      expect(shipCard).toHaveAttribute('aria-pressed', 'false')
    })

    it('should be keyboard focusable with tabIndex=0', () => {
      const ship = mockShip()
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      const shipCard = screen.getByRole('button', { name: /View details for/ })
      expect(shipCard).toHaveAttribute('tabIndex', '0')
    })
  })

  describe('ETA display', () => {
    it('should display ETA when ship is approaching and moving', () => {
      const ship = mockShip({ distanceToBridge: 10, sog: 10, approaching: true }) // 60 minutes = 1 hour
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      // 60 minutes is formatted as "~1h 0m"
      expect(screen.getByText('~1h 0m')).toBeInTheDocument()
    })

    it('should not display ETA when ship is not approaching', () => {
      const ship = mockShip({ distanceToBridge: 10, sog: 10, approaching: false })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      // ETA is only shown for approaching ships
      expect(screen.queryByText('~1h 0m')).not.toBeInTheDocument()
    })

    it('should not display ETA when ship is stationary', () => {
      const ship = mockShip({ distanceToBridge: 5, sog: 0, approaching: true })
      renderWithProviders(<ShipList ships={new Map([[ship.mmsi, ship]])} />)

      // ETA not shown because estimatedTimeToBridge returns null for sog < 0.5
      expect(screen.queryByTitle('Estimated time to bridge')).not.toBeInTheDocument()
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
