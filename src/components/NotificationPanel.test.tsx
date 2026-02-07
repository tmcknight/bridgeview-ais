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
    it('should not be visible when there are no notifications', () => {
      renderWithProviders(<NotificationPanel notifications={[]} onDismiss={() => {}} onClear={() => {}} />)

      // Transition component won't render children when show=false
      expect(screen.queryByText(/Notifications/)).not.toBeInTheDocument()
    })

    it('should not be visible when all notifications are dismissed', () => {
      const notifications = [
        mockNotification({ id: '1', dismissed: true }),
        mockNotification({ id: '2', dismissed: true }),
      ]

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />)

      expect(screen.queryByText(/Notifications/)).not.toBeInTheDocument()
    })

    it('should be visible when there are active notifications', () => {
      const notifications = [mockNotification()]

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />)

      expect(screen.getByText('Notifications (1)')).toBeInTheDocument()
    })

    it('should only count non-dismissed notifications', () => {
      const notifications = [
        mockNotification({ id: '1', dismissed: false }),
        mockNotification({ id: '2', dismissed: true }),
        mockNotification({ id: '3', dismissed: false }),
      ]

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />)

      expect(screen.getByText('Notifications (2)')).toBeInTheDocument()
    })
  })

  describe('notification display', () => {
    it('should display ship name', () => {
      const notifications = [mockNotification({ shipName: 'CARGO VESSEL' })]

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />)

      expect(screen.getByText('CARGO VESSEL')).toBeInTheDocument()
    })

    it('should display notification message', () => {
      const notifications = [mockNotification({ message: 'Approaching Blue Water Bridge' })]

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />)

      expect(screen.getByText('Approaching Blue Water Bridge')).toBeInTheDocument()
    })

    it('should display timestamp as locale time', () => {
      const timestamp = new Date('2024-01-15T12:34:56Z')
      const notifications = [mockNotification({ timestamp })]

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />)

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

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />)

      expect(screen.getByText('SHIP ONE')).toBeInTheDocument()
      expect(screen.getByText('SHIP TWO')).toBeInTheDocument()
      expect(screen.getByText('SHIP THREE')).toBeInTheDocument()
    })

    it('should limit display to first 10 notifications', () => {
      const notifications = Array.from({ length: 15 }, (_, i) =>
        mockNotification({ id: `notif-${i}`, shipName: `SHIP ${i}` })
      )

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />)

      // Should show first 10
      expect(screen.getByText('SHIP 0')).toBeInTheDocument()
      expect(screen.getByText('SHIP 9')).toBeInTheDocument()

      // Should not show 11th and beyond
      expect(screen.queryByText('SHIP 10')).not.toBeInTheDocument()
      expect(screen.queryByText('SHIP 14')).not.toBeInTheDocument()
    })

    it('should not display dismissed notifications', () => {
      const notifications = [
        mockNotification({ id: '1', shipName: 'ACTIVE SHIP', dismissed: false }),
        mockNotification({ id: '2', shipName: 'DISMISSED SHIP', dismissed: true }),
      ]

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />)

      expect(screen.getByText('ACTIVE SHIP')).toBeInTheDocument()
      expect(screen.queryByText('DISMISSED SHIP')).not.toBeInTheDocument()
    })
  })

  describe('notification types and styling', () => {
    it('should apply approaching type styles (red)', () => {
      const notifications = [mockNotification({ type: 'approaching' })]

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />)

      const notificationDiv = screen.getByText('TEST VESSEL').parentElement?.parentElement
      expect(notificationDiv).toHaveClass('bg-red-500/10')
      expect(notificationDiv).toHaveClass('border-l-red-500')
    })

    it('should apply passing type styles (amber)', () => {
      const notifications = [mockNotification({ type: 'passing' })]

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />)

      const notificationDiv = screen.getByText('TEST VESSEL').parentElement?.parentElement
      expect(notificationDiv).toHaveClass('bg-amber-500/10')
      expect(notificationDiv).toHaveClass('border-l-amber-500')
    })

    it('should apply info type styles (blue)', () => {
      const notifications = [mockNotification({ type: 'info' })]

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />)

      const notificationDiv = screen.getByText('TEST VESSEL').parentElement?.parentElement
      expect(notificationDiv).toHaveClass('bg-blue-500/10')
      expect(notificationDiv).toHaveClass('border-l-blue-500')
    })
  })

  describe('interactions', () => {
    it('should call onDismiss with notification id when dismiss button is clicked', async () => {
      const user = userEvent.setup()
      const onDismiss = vi.fn()
      const notifications = [mockNotification({ id: 'test-123' })]

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={onDismiss} onClear={() => {}} />)

      const dismissButton = screen.getByTitle('Dismiss')
      await user.click(dismissButton)

      expect(onDismiss).toHaveBeenCalledTimes(1)
      expect(onDismiss).toHaveBeenCalledWith('test-123')
    })

    it('should call onClear when "Clear all" button is clicked', async () => {
      const user = userEvent.setup()
      const onClear = vi.fn()
      const notifications = [mockNotification()]

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={onClear} />)

      const clearButton = screen.getByText('Clear all')
      await user.click(clearButton)

      expect(onClear).toHaveBeenCalledTimes(1)
    })

    it('should have separate dismiss buttons for each notification', async () => {
      const user = userEvent.setup()
      const onDismiss = vi.fn()
      const notifications = [
        mockNotification({ id: '1', shipName: 'SHIP ONE' }),
        mockNotification({ id: '2', shipName: 'SHIP TWO' }),
      ]

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={onDismiss} onClear={() => {}} />)

      const dismissButtons = screen.getAllByTitle('Dismiss')
      expect(dismissButtons).toHaveLength(2)

      // Click first dismiss button
      await user.click(dismissButtons[0])

      expect(onDismiss).toHaveBeenCalledWith('1')
    })
  })

  describe('header', () => {
    it('should show count of active notifications in header', () => {
      const notifications = [
        mockNotification({ id: '1' }),
        mockNotification({ id: '2' }),
        mockNotification({ id: '3' }),
      ]

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />)

      expect(screen.getByText('Notifications (3)')).toBeInTheDocument()
    })

    it('should show "Clear all" button in header', () => {
      const notifications = [mockNotification()]

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />)

      expect(screen.getByText('Clear all')).toBeInTheDocument()
    })
  })

  describe('edge cases', () => {
    it('should handle notification with very long ship name', () => {
      const notifications = [
        mockNotification({ shipName: 'VERY LONG SHIP NAME THAT MIGHT CAUSE LAYOUT ISSUES' }),
      ]

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />)

      expect(screen.getByText('VERY LONG SHIP NAME THAT MIGHT CAUSE LAYOUT ISSUES')).toBeInTheDocument()
    })

    it('should handle notification with very long message', () => {
      const longMessage = 'This is a very long notification message that contains a lot of detail about the ship and its current status and position relative to the bridge'
      const notifications = [mockNotification({ message: longMessage })]

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />)

      expect(screen.getByText(longMessage)).toBeInTheDocument()
    })

    it('should handle exactly 10 notifications (boundary case)', () => {
      const notifications = Array.from({ length: 10 }, (_, i) =>
        mockNotification({ id: `notif-${i}`, shipName: `SHIP ${i}` })
      )

      renderWithProviders(<NotificationPanel notifications={notifications} onDismiss={() => {}} onClear={() => {}} />)

      // All 10 should be visible
      expect(screen.getByText('SHIP 0')).toBeInTheDocument()
      expect(screen.getByText('SHIP 9')).toBeInTheDocument()
      expect(screen.getAllByTitle('Dismiss')).toHaveLength(10)
    })
  })
})
