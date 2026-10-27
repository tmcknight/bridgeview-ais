import { describe, it, expect } from 'vitest'
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

    it('credits aisstream.io without a health dot before the server reports feeds', () => {
      const { getByText, queryByText } = renderFeeds(null)
      expect(getByText('aisstream.io').closest('[title]')).toBeNull()
      expect(queryByText('local antenna')).not.toBeInTheDocument()
    })

    it('shows each configured feed with its own health dot', () => {
      const { getByTitle } = renderFeeds([
        { source: 'aisstream', status: 'live' },
        { source: 'local', status: 'down', detail: 'AIS-catcher unavailable (ECONNREFUSED)' },
      ])
      const aisstream = getByTitle('AISStream.io: live')
      expect(aisstream.querySelector('.animate-ping')).toBeInTheDocument()
      const antenna = getByTitle('Local antenna: down (AIS-catcher unavailable (ECONNREFUSED))')
      expect(antenna.querySelector('.bg-red-500')).toBeInTheDocument()
      expect(antenna.querySelector('.animate-ping')).not.toBeInTheDocument()
    })

    it('shows a quiet feed in amber with when it was last heard', () => {
      const { getByTitle } = renderFeeds([
        { source: 'local', status: 'quiet', lastMessageAt: '2026-10-26T12:00:00Z' },
      ])
      const antenna = getByTitle(/^Local antenna: connected, but no messages lately\. Last message /)
      expect(antenna.querySelector('.bg-amber-500')).toBeInTheDocument()
    })

    it('leaves out feeds the server does not use', () => {
      const { queryByText, getByText } = renderFeeds([{ source: 'local', status: 'live' }])
      expect(getByText('local antenna')).toBeInTheDocument()
      expect(queryByText('aisstream.io')).not.toBeInTheDocument()
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
