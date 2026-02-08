import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, userEvent } from '../test/utils/renderWithProviders'
import NotificationPanel from './NotificationPanel'
import type { Notification } from '../hooks/useAISStream'

// Helper to create mock notifications
const mockNotification = (overrides?: Partial<Notification>): Notification => ({
  id: 'test-id-123',
  shipName: 'TEST VESSEL',
  mmsi: 367123456,
  message: 'Test notification message',
  timestamp: new Date('2024-01-15T12:00:00Z'),
  type: 'info',
  dismissed: false,
  ...overrides,
})

describe('NotificationPanel', () => {
  describe('visibility', () => {
    it('should not render when there are no notifications', () => {
      const { container } = renderWithProviders(
        <NotificationPanel notifications={[]} onDismiss={() => {}} onClear={() => {}} />
      )

      // Component returns null when no active notifications
      expect(container.firstChild).toBeNull()
    })

    it('should not render when all notifications are dismissed', () => {
      const notifications = [
        mockNotification({ id: '1', dismissed: true }),
        mockNotification({ id: '2', dismissed: true }),
      ]

      const { container } = renderWithProviders(
        <NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />
      )

      expect(container.firstChild).toBeNull()
    })

    it('should render when there are active notifications', () => {
      const notifications = [mockNotification()]

      const { container } = renderWithProviders(
        <NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />
      )

      expect(container.firstChild).not.toBeNull()
    })
  })

  describe('notification display', () => {
    it('should display ship name', () => {
      const notifications = [mockNotification({ shipName: 'CARGO VESSEL' })]

      renderWithProviders(
        <NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />
      )

      expect(screen.getByText('CARGO VESSEL')).toBeInTheDocument()
    })

    it('should display notification message', () => {
      const notifications = [mockNotification({ message: 'Approaching Blue Water Bridge' })]

      renderWithProviders(
        <NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />
      )

      expect(screen.getByText('Approaching Blue Water Bridge')).toBeInTheDocument()
    })

    it('should display timestamp as locale time', () => {
      const timestamp = new Date('2024-01-15T12:34:56Z')
      const notifications = [mockNotification({ timestamp })]

      renderWithProviders(
        <NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />
      )

      // Check that timestamp is rendered (exact format depends on locale)
      const timeText = timestamp.toLocaleTimeString()
      expect(screen.getByText(timeText)).toBeInTheDocument()
    })

    it('should display multiple notifications', () => {
      const notifications = [
        mockNotification({ id: '1', shipName: 'SHIP ONE' }),
        mockNotification({ id: '2', shipName: 'SHIP TWO' }),
        mockNotification({ id: '3', shipName: 'SHIP THREE' }),
      ]

      renderWithProviders(
        <NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />
      )

      expect(screen.getByText('SHIP ONE')).toBeInTheDocument()
      expect(screen.getByText('SHIP TWO')).toBeInTheDocument()
      expect(screen.getByText('SHIP THREE')).toBeInTheDocument()
    })

    it('should limit display to first 5 notifications', () => {
      const notifications = Array.from({ length: 8 }, (_, i) =>
        mockNotification({ id: `notif-${i}`, shipName: `SHIP ${i}` })
      )

      renderWithProviders(
        <NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />
      )

      // Should show first 5
      expect(screen.getByText('SHIP 0')).toBeInTheDocument()
      expect(screen.getByText('SHIP 4')).toBeInTheDocument()

      // Should not show 6th and beyond
      expect(screen.queryByText('SHIP 5')).not.toBeInTheDocument()
      expect(screen.queryByText('SHIP 7')).not.toBeInTheDocument()
    })

    it('should not display dismissed notifications', () => {
      const notifications = [
        mockNotification({ id: '1', shipName: 'ACTIVE SHIP', dismissed: false }),
        mockNotification({ id: '2', shipName: 'DISMISSED SHIP', dismissed: true }),
      ]

      renderWithProviders(
        <NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />
      )

      expect(screen.getByText('ACTIVE SHIP')).toBeInTheDocument()
      expect(screen.queryByText('DISMISSED SHIP')).not.toBeInTheDocument()
    })
  })

  describe('notification type styling', () => {
    it('should apply approaching type border accent (red)', () => {
      const notifications = [mockNotification({ type: 'approaching' })]

      renderWithProviders(
        <NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />
      )

      const toastEl = screen.getByText('TEST VESSEL').closest('.border-l-red-500')
      expect(toastEl).toBeInTheDocument()
    })

    it('should apply passing type border accent (amber)', () => {
      const notifications = [mockNotification({ type: 'passing' })]

      renderWithProviders(
        <NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />
      )

      const toastEl = screen.getByText('TEST VESSEL').closest('.border-l-amber-500')
      expect(toastEl).toBeInTheDocument()
    })

    it('should apply info type border accent (blue)', () => {
      const notifications = [mockNotification({ type: 'info' })]

      renderWithProviders(
        <NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />
      )

      const toastEl = screen.getByText('TEST VESSEL').closest('.border-l-blue-500')
      expect(toastEl).toBeInTheDocument()
    })
  })

  describe('interactions', () => {
    it('should call onDismiss with notification id when dismiss button is clicked', async () => {
      const user = userEvent.setup()
      const onDismiss = vi.fn()
      const notifications = [mockNotification({ id: 'test-123' })]

      renderWithProviders(
        <NotificationPanel notifications={notifications} onDismiss={onDismiss} onClear={() => {}} />
      )

      const dismissButton = screen.getByTitle('Dismiss')
      await user.click(dismissButton)

      // onDismiss is called after a 300ms exit animation timeout
      await vi.waitFor(() => {
        expect(onDismiss).toHaveBeenCalledTimes(1)
        expect(onDismiss).toHaveBeenCalledWith('test-123')
      })
    })

    it('should have separate dismiss buttons for each notification', () => {
      const notifications = [
        mockNotification({ id: '1', shipName: 'SHIP ONE' }),
        mockNotification({ id: '2', shipName: 'SHIP TWO' }),
      ]

      renderWithProviders(
        <NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />
      )

      const dismissButtons = screen.getAllByTitle('Dismiss')
      expect(dismissButtons).toHaveLength(2)
    })
  })

  describe('edge cases', () => {
    it('should handle notification with very long ship name', () => {
      const notifications = [
        mockNotification({ shipName: 'VERY LONG SHIP NAME THAT MIGHT CAUSE LAYOUT ISSUES' }),
      ]

      renderWithProviders(
        <NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />
      )

      expect(screen.getByText('VERY LONG SHIP NAME THAT MIGHT CAUSE LAYOUT ISSUES')).toBeInTheDocument()
    })

    it('should handle notification with very long message', () => {
      const longMessage = 'This is a very long notification message that contains a lot of detail about the ship and its current status and position relative to the bridge'
      const notifications = [mockNotification({ message: longMessage })]

      renderWithProviders(
        <NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />
      )

      expect(screen.getByText(longMessage)).toBeInTheDocument()
    })

    it('should handle exactly 5 notifications (boundary case)', () => {
      const notifications = Array.from({ length: 5 }, (_, i) =>
        mockNotification({ id: `notif-${i}`, shipName: `SHIP ${i}` })
      )

      renderWithProviders(
        <NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />
      )

      // All 5 should be visible
      expect(screen.getByText('SHIP 0')).toBeInTheDocument()
      expect(screen.getByText('SHIP 4')).toBeInTheDocument()
      expect(screen.getAllByTitle('Dismiss')).toHaveLength(5)
    })
  })
})
