import { describe, it, expect } from 'vitest'
import { applyShipLogMessage, sortShipLog, type ShipLog, type ShipLogEntry } from './shipLog'

const entry = (mmsi: number, passageTime: string, lastSeen = passageTime): ShipLogEntry => ({
  mmsi,
  name: `SHIP ${mmsi}`,
  passages: [{ time: passageTime, direction: 'upbound' }],
  lastSeen,
})

describe('applyShipLogMessage', () => {
  it('replaces the log with a snapshot', () => {
    const log: ShipLog = new Map([[9, entry(9, '2026-10-26T10:00:00Z')]])
    const next = applyShipLogMessage(log, { type: 'shipLog', entries: [entry(1, '2026-10-26T12:00:00Z')] })
    expect(Array.from(next!.keys())).toEqual([1])
  })

  it('adds or updates a single entry', () => {
    const log: ShipLog = new Map([[1, entry(1, '2026-10-26T10:00:00Z')]])
    const updated = entry(1, '2026-10-26T10:00:00Z', '2026-10-26T11:00:00Z')
    const next = applyShipLogMessage(log, { type: 'shipLogEntry', entry: updated })
    expect(next!.get(1)).toEqual(updated)
    expect(log.get(1)?.lastSeen).toBe('2026-10-26T10:00:00Z')
  })

  it('returns null for other messages', () => {
    expect(applyShipLogMessage(new Map(), { MessageType: 'PositionReport' })).toBeNull()
    expect(applyShipLogMessage(new Map(), { type: 'authenticated' })).toBeNull()
    expect(applyShipLogMessage(new Map(), null)).toBeNull()
  })
})

describe('sortShipLog', () => {
  it('lists the most recent passage first', () => {
    const log: ShipLog = new Map([
      [1, entry(1, '2026-10-26T10:00:00Z', '2026-10-26T13:00:00Z')],
      [2, entry(2, '2026-10-26T12:00:00Z')],
    ])
    expect(sortShipLog(log).map((e) => e.mmsi)).toEqual([2, 1])
  })
})
