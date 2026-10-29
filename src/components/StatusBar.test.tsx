import { describe, it, expect } from 'vitest'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/utils/renderWithProviders'
import StatusBar from './StatusBar'
import type { ConnectionStatus } from '../hooks/useAISStream'
import type { FeedStatus } from '../utils/feedStatus'

describe('StatusBar', () => {
  const renderStatusBar = (status: ConnectionStatus) =>
    renderWithProviders(<StatusBar connectionStatus={status} />)

  describe('feeds', () => {
    const renderFeeds = (feeds: FeedStatus[] | null, status: ConnectionStatus = 'connected') =>
      renderWithProviders(<StatusBar connectionStatus={status} feeds={feeds} />)
    const LIVE: FeedStatus[] = [
      { source: 'aisstream', status: 'live' },
      { source: 'local', status: 'live' },
      { source: 'aishub', status: 'live' },
      { source: 'adsb', status: 'live' },
    ]

    it('sums up the connection and every feed in one dot', () => {
      const { getByRole, container } = renderFeeds(LIVE)
      const button = getByRole('button', { name: 'Status: Live' })
      expect(button).toHaveAttribute(
        'title',
        'Connected. AISStream.io: live, Local antenna: live, AISHub: live, ADS-B feed: live'
      )
      expect(container.querySelectorAll('.bg-green-500')).toHaveLength(1)
    })

    it('counts feeds that are down, in amber while others still work', () => {
      const { getByRole, container } = renderFeeds([
        { source: 'aisstream', status: 'live' },
        { source: 'local', status: 'down' },
        { source: 'adsb', status: 'quiet' },
      ])
      expect(getByRole('button', { name: 'Status: 1 source down' })).toBeInTheDocument()
      expect(container.querySelector('.bg-amber-500')).toBeInTheDocument()
    })

    it('shows red when every feed is down', () => {
      const { getByRole, container } = renderFeeds([
        { source: 'aisstream', status: 'down' },
        { source: 'local', status: 'down' },
      ])
      expect(getByRole('button', { name: 'Status: 2 sources down' })).toBeInTheDocument()
      expect(container.querySelector('.bg-red-500')).toBeInTheDocument()
    })

    it('counts quiet feeds', () => {
      const { getByRole } = renderFeeds([
        { source: 'aisstream', status: 'live' },
        { source: 'local', status: 'quiet' },
      ])
      expect(getByRole('button', { name: 'Status: 1 source quiet' })).toBeInTheDocument()
    })

    it("shows the connection's own status while it isn't connected", () => {
      const { getByRole } = renderFeeds(LIVE, 'connecting')
      expect(getByRole('button', { name: 'Status: Connecting...' })).toBeInTheDocument()
    })

    it('lists the connection, then each feed with its status, reason and web page', async () => {
      const user = userEvent.setup()
      const { getByRole, findByText, getByText, getAllByRole } = renderFeeds([
        { source: 'aisstream', status: 'live', url: 'https://aisstream.io' },
        {
          source: 'local',
          status: 'down',
          detail: 'AIS-catcher unavailable (ECONNREFUSED)',
          url: 'http://192.168.1.20:8100/',
        },
        { source: 'aishub', status: 'live', url: 'https://www.aishub.net' },
        { source: 'adsb', status: 'live' },
      ])
      await user.click(getByRole('button', { name: /^Status:/ }))

      expect(await findByText('Down (AIS-catcher unavailable (ECONNREFUSED))')).toBeInTheDocument()
      const rows = getAllByRole('listitem')
      expect(rows).toHaveLength(5)
      expect(rows[0]).toHaveTextContent('BridgeView serverConnected')
      expect(getByRole('link', { name: 'Local antenna' })).toHaveAttribute('href', 'http://192.168.1.20:8100/')
      expect(getByRole('link', { name: 'AISStream.io' })).toHaveAttribute('target', '_blank')
      expect(getByRole('link', { name: 'AISHub' })).toHaveAttribute('href', 'https://www.aishub.net')
      expect(getByText('ADS-B feed').closest('a')).toBeNull()
      expect(getByText('Aircraft')).toBeInTheDocument()
    })

    it('lists only the connection before the server reports feeds', async () => {
      const user = userEvent.setup()
      const { getByRole, findAllByRole } = renderFeeds(null)
      await user.click(getByRole('button', { name: 'Status: Connected' }))
      expect(await findAllByRole('listitem')).toHaveLength(1)
    })

    it('says when a quiet feed was last heard', async () => {
      const user = userEvent.setup()
      const { getByRole, findByText } = renderFeeds([
        { source: 'local', status: 'quiet', lastMessageAt: '2026-10-26T12:00:00Z' },
      ])
      await user.click(getByRole('button', { name: /^Status:/ }))
      expect(await findByText(/^Connected, but no messages lately\. Last message /)).toBeInTheDocument()
    })
  })

  describe('connected state', () => {
    it('renders "Connected" label', () => {
      const { getByText } = renderStatusBar('connected')
      expect(getByText('Connected')).toBeInTheDocument()
    })

    it('shows ping animation indicator', () => {
      const { container } = renderStatusBar('connected')
      const pingElement = container.querySelector('.animate-ping')
      expect(pingElement).toBeInTheDocument()
    })

    it('uses green color classes', () => {
      const { container } = renderStatusBar('connected')
      const staticDot = container.querySelector('.bg-green-500')
      expect(staticDot).toBeInTheDocument()
    })
  })

  describe('connecting state', () => {
    it('renders "Connecting..." label', () => {
      const { getByText } = renderStatusBar('connecting')
      expect(getByText('Connecting...')).toBeInTheDocument()
    })

    it('does not show ping animation', () => {
      const { container } = renderStatusBar('connecting')
      const pingElement = container.querySelector('.animate-ping')
      expect(pingElement).not.toBeInTheDocument()
    })

    it('uses amber color classes', () => {
      const { container } = renderStatusBar('connecting')
      const staticDot = container.querySelector('.bg-amber-500')
      expect(staticDot).toBeInTheDocument()
    })
  })

  describe('disconnected state', () => {
    it('renders "Disconnected" label', () => {
      const { getByText } = renderStatusBar('disconnected')
      expect(getByText('Disconnected')).toBeInTheDocument()
    })

    it('does not show ping animation', () => {
      const { container } = renderStatusBar('disconnected')
      const pingElement = container.querySelector('.animate-ping')
      expect(pingElement).not.toBeInTheDocument()
    })

    it('uses slate/gray color classes', () => {
      const { container } = renderStatusBar('disconnected')
      const staticDot = container.querySelector('.bg-slate-400')
      expect(staticDot).toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('renders "Connection Error" label', () => {
      const { getByText } = renderStatusBar('error')
      expect(getByText('Connection Error')).toBeInTheDocument()
    })

    it('does not show ping animation', () => {
      const { container } = renderStatusBar('error')
      const pingElement = container.querySelector('.animate-ping')
      expect(pingElement).not.toBeInTheDocument()
    })

    it('uses red color classes', () => {
      const { container } = renderStatusBar('error')
      const staticDot = container.querySelector('.bg-red-500')
      expect(staticDot).toBeInTheDocument()
    })
  })

  describe('common elements', () => {
    it('has accessible aria-live region', () => {
      const { container } = renderStatusBar('connected')
      const liveRegion = container.querySelector('[aria-live="polite"]')
      expect(liveRegion).toBeInTheDocument()
    })

    it('has aria-atomic true on the live region', () => {
      const { container } = renderStatusBar('connected')
      const liveRegion = container.querySelector('[aria-atomic="true"]')
      expect(liveRegion).toBeInTheDocument()
    })
  })
})
