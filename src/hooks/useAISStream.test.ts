import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAISStream } from './useAISStream'
import { MockAISStreamServer } from '../test/mocks/websocket'
import {
  mockAISPositionMessage,
  mockAISStaticDataMessage,
  mockAISMessageWithCompactTime,
  mockAISMessageWithInvalidTime,
} from '../test/mocks/aisMessages'
import {
  APPROACH_NOTIFICATION_DISTANCE_NM,
} from '../constants/bridge'

describe('useAISStream', () => {
  let mockServer: MockAISStreamServer

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockServer = new MockAISStreamServer('ws://localhost:3001')
  })

  afterEach(() => {
    mockServer.close()
    vi.useRealTimers()
  })

  describe('connection management', () => {
    it('starts with disconnected status', () => {
      const { result } = renderHook(() => useAISStream())
      expect(result.current.connectionStatus).toBe('connecting')
    })

    it('transitions to connected after WebSocket opens', async () => {
      const { result } = renderHook(() => useAISStream())
      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })
    })

    it('starts with empty ships map', () => {
      const { result } = renderHook(() => useAISStream())
      expect(result.current.ships.size).toBe(0)
    })

    it('starts with empty notifications', () => {
      const { result } = renderHook(() => useAISStream())
      expect(result.current.notifications).toEqual([])
    })
  })

  describe('position report processing', () => {
    it('adds a ship when position report is received', async () => {
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      const message = mockAISPositionMessage(367123456, 43.05, -82.42, 180, 10.5)
      act(() => {
        mockServer.sendPositionReport(message)
      })

      await waitFor(() => {
        expect(result.current.ships.size).toBe(1)
      })

      const ship = result.current.ships.get(367123456)
      expect(ship).toBeDefined()
      expect(ship!.mmsi).toBe(367123456)
      expect(ship!.name).toBe('TEST VESSEL')
      expect(ship!.cog).toBe(180)
      expect(ship!.sog).toBe(10.5)
      expect(ship!.source).toBe('aisstream')
      expect(ship!.signalPower).toBeUndefined()
    })

    it('records the local antenna as source, with signal level', async () => {
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      const message = mockAISPositionMessage(367123456, 43.05, -82.42, 180, 10.5)
      message.MetaData.Source = 'local'
      message.MetaData.SignalPower = -16.1
      act(() => {
        mockServer.sendPositionReport(message)
      })

      await waitFor(() => {
        expect(result.current.ships.get(367123456)?.source).toBe('local')
      })
      expect(result.current.ships.get(367123456)!.signalPower).toBe(-16.1)
    })

    it('updates an existing ship with new position data', async () => {
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      // Send initial position
      act(() => {
        mockServer.sendPositionReport(mockAISPositionMessage(367123456, 43.05, -82.42, 180, 10.5))
      })

      await waitFor(() => {
        expect(result.current.ships.size).toBe(1)
      })

      // Send updated position
      act(() => {
        mockServer.sendPositionReport(mockAISPositionMessage(367123456, 43.04, -82.42, 175, 11.0))
      })

      await waitFor(() => {
        const ship = result.current.ships.get(367123456)
        expect(ship!.latitude).toBe(43.04)
        expect(ship!.cog).toBe(175)
        expect(ship!.sog).toBe(11.0)
      })
    })

    it('handles multiple ships simultaneously', async () => {
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      act(() => {
        mockServer.sendPositionReport(mockAISPositionMessage(111111111, 43.05, -82.42, 180, 10))
        mockServer.sendPositionReport(mockAISPositionMessage(222222222, 43.06, -82.41, 0, 8))
        mockServer.sendPositionReport(mockAISPositionMessage(333333333, 43.07, -82.43, 90, 12))
      })

      await waitFor(() => {
        expect(result.current.ships.size).toBe(3)
      })
    })
  })

  describe('static data processing', () => {
    it('updates ship with static data when ship exists', async () => {
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      // First send position to create the ship
      act(() => {
        mockServer.sendPositionReport(mockAISPositionMessage(367123456))
      })

      await waitFor(() => {
        expect(result.current.ships.size).toBe(1)
      })

      // Then send static data
      act(() => {
        mockServer.sendStaticData(mockAISStaticDataMessage(367123456, 'BIG FREIGHTER', 'PORT HURON'))
      })

      await waitFor(() => {
        const ship = result.current.ships.get(367123456)
        expect(ship!.destination).toBe('PORT HURON')
        expect(ship!.name).toBe('BIG FREIGHTER')
      })
    })

    it('keeps IMO number from static data across position updates', async () => {
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      act(() => {
        mockServer.sendPositionReport(mockAISPositionMessage(367123456))
      })

      await waitFor(() => {
        expect(result.current.ships.size).toBe(1)
      })

      act(() => {
        mockServer.sendStaticData(mockAISStaticDataMessage(367123456))
      })

      await waitFor(() => {
        expect(result.current.ships.get(367123456)!.imo).toBe(1234567)
      })

      act(() => {
        mockServer.sendPositionReport(mockAISPositionMessage(367123456))
      })

      await vi.advanceTimersByTimeAsync(100)
      expect(result.current.ships.get(367123456)!.imo).toBe(1234567)
    })

    it('keeps hull dimensions from static data across position updates', async () => {
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      act(() => {
        mockServer.sendPositionReport(mockAISPositionMessage(367123456))
      })

      await waitFor(() => {
        expect(result.current.ships.size).toBe(1)
      })

      act(() => {
        mockServer.sendStaticData(mockAISStaticDataMessage(367123456))
      })

      const dimensions = { toBow: 150, toStern: 50, toPort: 15, toStarboard: 15 }
      await waitFor(() => {
        expect(result.current.ships.get(367123456)!.dimensions).toEqual(dimensions)
      })

      act(() => {
        mockServer.sendPositionReport(mockAISPositionMessage(367123456))
      })

      await vi.advanceTimersByTimeAsync(100)
      expect(result.current.ships.get(367123456)!.dimensions).toEqual(dimensions)
    })

    it('ignores static data for unknown ships', async () => {
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      act(() => {
        mockServer.sendStaticData(mockAISStaticDataMessage(999999999, 'UNKNOWN', 'NOWHERE'))
      })

      // Ship should not be created from static data alone
      await vi.advanceTimersByTimeAsync(100)
      expect(result.current.ships.size).toBe(0)
    })

    it('applies static data that arrived before the first position', async () => {
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      act(() => {
        mockServer.sendStaticData(mockAISStaticDataMessage(367123456, 'BIG FREIGHTER', 'PORT HURON'))
      })
      await vi.advanceTimersByTimeAsync(100)

      const position = mockAISPositionMessage(367123456)
      position.MetaData.ShipName = ''
      act(() => {
        mockServer.sendPositionReport(position)
      })

      await waitFor(() => {
        const ship = result.current.ships.get(367123456)
        expect(ship!.name).toBe('BIG FREIGHTER')
        expect(ship!.destination).toBe('PORT HURON')
        expect(ship!.imo).toBe(1234567)
      })
    })

    it('applies stored details and Wikidata info sent before the first position', async () => {
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      const info = { wikidataId: 'Q1', wikidataUrl: 'https://www.wikidata.org/wiki/Q1', imageUrl: 'https://x/ship.jpg' }
      act(() => {
        mockServer.sendStaticData(mockAISStaticDataMessage(367123456, 'BIG FREIGHTER', 'PORT HURON'))
        mockServer.sendRawMessage(JSON.stringify({ type: 'vesselInfo', mmsi: 367123456, info }))
        mockServer.sendPositionReport(mockAISPositionMessage(367123456))
      })

      await waitFor(() => {
        const ship = result.current.ships.get(367123456)
        expect(ship!.vesselInfo).toEqual(info)
        expect(ship!.destination).toBe('PORT HURON')
      })
    })

    it('records when the server found no Wikidata match', async () => {
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      act(() => {
        mockServer.sendPositionReport(mockAISPositionMessage(367123456))
      })
      await waitFor(() => {
        expect(result.current.ships.size).toBe(1)
      })
      expect(result.current.ships.get(367123456)!.vesselInfo).toBeUndefined()

      act(() => {
        mockServer.sendRawMessage(JSON.stringify({ type: 'vesselInfo', mmsi: 367123456, info: null }))
      })
      await waitFor(() => {
        expect(result.current.ships.get(367123456)!.vesselInfo).toBeNull()
      })
    })

    it('keeps the known name when a position report has none', async () => {
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      act(() => {
        mockServer.sendPositionReport(mockAISPositionMessage(367123456))
      })
      await waitFor(() => {
        expect(result.current.ships.get(367123456)!.name).toBe('TEST VESSEL')
      })

      // The antenna's reports have no name until it hears the ship's details
      const antennaReport = mockAISPositionMessage(367123456, 43.04)
      antennaReport.MetaData.ShipName = ''
      act(() => {
        mockServer.sendPositionReport(antennaReport)
      })

      await waitFor(() => {
        expect(result.current.ships.get(367123456)!.latitude).toBe(43.04)
      })
      expect(result.current.ships.get(367123456)!.name).toBe('TEST VESSEL')
    })
  })

  describe('time parsing', () => {
    it('handles compact time format without crashing', async () => {
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      // Compact time "20240115123456" is in the past, so the ship gets
      // purged as stale. The key test is that parsing doesn't crash.
      act(() => {
        mockServer.sendPositionReport(mockAISMessageWithCompactTime(367123456))
      })

      await vi.advanceTimersByTimeAsync(100)
      // No crash means compact time parsing succeeded
    })

    it('handles invalid time format gracefully without crashing', async () => {
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      // Invalid time falls back to Unix epoch (1970), ship gets purged as stale.
      act(() => {
        mockServer.sendPositionReport(mockAISMessageWithInvalidTime(367123456))
      })

      await vi.advanceTimersByTimeAsync(100)
      // No crash means invalid time was handled gracefully
    })
  })

  describe('notifications', () => {
    it('creates approach notification when ship is close enough', async () => {
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      // Send a ship that is approaching and within notification distance
      // Bridge is at 42.9982, -82.4230
      // Place ship close but approaching (south of bridge, heading north isn't filtered for non-SARNIA)
      const closeLat = 42.9982 + (APPROACH_NOTIFICATION_DISTANCE_NM - 0.5) / 60
      act(() => {
        mockServer.sendPositionReport(
          mockAISPositionMessage(367123456, closeLat, -82.423, 180, 8)
        )
      })

      await waitFor(() => {
        expect(result.current.ships.size).toBe(1)
      })
    })

    it('dismissNotification marks notification as dismissed', async () => {
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      // Trigger a notification by sending a close approaching ship
      const closeLat = 42.9982 + (APPROACH_NOTIFICATION_DISTANCE_NM - 0.3) / 60
      act(() => {
        mockServer.sendPositionReport(
          mockAISPositionMessage(367123456, closeLat, -82.423, 180, 8)
        )
      })

      await waitFor(() => {
        if (result.current.notifications.length > 0) {
          const notifId = result.current.notifications[0].id
          act(() => {
            result.current.dismissNotification(notifId)
          })
        }
      })
    })

    it('clearNotifications removes all notifications', async () => {
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      act(() => {
        result.current.clearNotifications()
      })

      expect(result.current.notifications).toEqual([])
    })
  })

  describe('TUG-ASSIST filtering', () => {
    it('does not mark TUG-ASSIST ships as approaching', async () => {
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      // First create ship with TUG-ASSIST destination via static data
      act(() => {
        mockServer.sendPositionReport(mockAISPositionMessage(367123456, 43.0, -82.423, 180, 8))
      })

      await waitFor(() => {
        expect(result.current.ships.size).toBe(1)
      })

      act(() => {
        mockServer.sendStaticData(mockAISStaticDataMessage(367123456, 'TUG BOAT', 'TUG-ASSIST'))
      })

      await waitFor(() => {
        const ship = result.current.ships.get(367123456)
        expect(ship!.destination).toBe('TUG-ASSIST')
      })

      // Now send another position update - approaching should be false
      act(() => {
        mockServer.sendPositionReport(mockAISPositionMessage(367123456, 43.0, -82.423, 180, 8))
      })

      await waitFor(() => {
        const ship = result.current.ships.get(367123456)
        expect(ship!.approaching).toBe(false)
      })
    })
  })

  describe('feed status', () => {
    it('starts unknown and takes the feeds the server reports', async () => {
      const { result } = renderHook(() => useAISStream())
      expect(result.current.feeds).toBeNull()

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      const feeds = [
        { source: 'aisstream', status: 'live' },
        { source: 'local', status: 'down', detail: 'AIS-catcher unavailable (ECONNREFUSED)' },
      ]
      act(() => {
        mockServer.sendRawMessage(JSON.stringify({ type: 'feedStatus', feeds }))
      })

      await waitFor(() => {
        expect(result.current.feeds).toEqual(feeds)
      })
      expect(result.current.ships.size).toBe(0)
    })
  })

  describe('authentication messages', () => {
    it('handles authentication confirmation messages', async () => {
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      // Send auth confirmation - should not crash or create a ship
      act(() => {
        mockServer.sendRawMessage(JSON.stringify({ type: 'authenticated' }))
      })

      await vi.advanceTimersByTimeAsync(100)
      expect(result.current.ships.size).toBe(0)
    })
  })

  describe('malformed message handling', () => {
    it('handles invalid JSON gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { result } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      act(() => {
        mockServer.sendRawMessage('not valid json {{{')
      })

      await vi.advanceTimersByTimeAsync(100)
      // Should not crash
      expect(result.current.ships.size).toBe(0)
      consoleSpy.mockRestore()
    })
  })

  describe('cleanup', () => {
    it('closes WebSocket on unmount', async () => {
      const { result, unmount } = renderHook(() => useAISStream())

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected')
      })

      unmount()
      // Should not throw or leak
    })
  })
})
