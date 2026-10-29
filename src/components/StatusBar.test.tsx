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
    const renderFeeds = (feeds: FeedStatus[] | null) =>
      renderWithProviders(<StatusBar connectionStatus="connected" feeds={feeds} />)

    it('credits aisstream.io without a sources menu before the server reports feeds', () => {
      const { getByText, queryByRole } = renderFeeds(null)
      expect(getByText('aisstream.io')).toBeInTheDocument()
      expect(queryByRole('button', { name: /sources/i })).not.toBeInTheDocument()
    })

    it('sums up every feed on the sources button', () => {
      const { getByRole } = renderFeeds([
        { source: 'aisstream', status: 'live' },
        { source: 'local', status: 'down' },
        { source: 'adsb', status: 'quiet' },
      ])
      const button = getByRole('button', { name: /sources/i })
      expect(button).toHaveAttribute(
        'title',
        'AISStream.io: live, Local antenna: down, ADS-B feed: connected, but no messages lately'
      )
      expect(button.querySelector('.bg-green-500')).toBeInTheDocument()
      expect(button.querySelector('.bg-red-500')).toBeInTheDocument()
      expect(button.querySelector('.bg-amber-500')).toBeInTheDocument()
    })

    it('lists each feed with its status, reason and web page when opened', async () => {
      const user = userEvent.setup()
      const { getByRole, findByText, getByText } = renderFeeds([
        { source: 'aisstream', status: 'live', url: 'https://aisstream.io' },
        {
          source: 'local',
          status: 'down',
          detail: 'AIS-catcher unavailable (ECONNREFUSED)',
          url: 'http://192.168.1.20:8100/',
        },
        { source: 'adsb', status: 'live' },
      ])
      await user.click(getByRole('button', { name: /sources/i }))

      expect(await findByText('Down (AIS-catcher unavailable (ECONNREFUSED))')).toBeInTheDocument()
      expect(getByRole('link', { name: 'Local antenna' })).toHaveAttribute('href', 'http://192.168.1.20:8100/')
      expect(getByRole('link', { name: 'AISStream.io' })).toHaveAttribute('target', '_blank')
      expect(getByText('ADS-B feed').closest('a')).toBeNull()
      expect(getByText('Aircraft')).toBeInTheDocument()
    })

    it('says when a quiet feed was last heard', async () => {
      const user = userEvent.setup()
      const { getByRole, findByText } = renderFeeds([
        { source: 'local', status: 'quiet', lastMessageAt: '2026-10-26T12:00:00Z' },
      ])
      await user.click(getByRole('button', { name: /sources/i }))
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
    it('renders aisstream.io attribution link', () => {
      const { getByText } = renderStatusBar('connected')
      const link = getByText('aisstream.io')
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('href', 'https://aisstream.io')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

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
