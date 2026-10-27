import { describe, it, expect } from 'vitest'
import { parseVesselInfoMessage } from './vesselInfo'

describe('parseVesselInfoMessage', () => {
  it('accepts a match or a miss', () => {
    const info = { wikidataId: 'Q1', wikidataUrl: 'https://www.wikidata.org/wiki/Q1' }
    expect(parseVesselInfoMessage({ type: 'vesselInfo', mmsi: 1, info })).toEqual({ type: 'vesselInfo', mmsi: 1, info })
    expect(parseVesselInfoMessage({ type: 'vesselInfo', mmsi: 1, info: null })?.info).toBeNull()
  })

  it('returns null for anything else', () => {
    expect(parseVesselInfoMessage(null)).toBeNull()
    expect(parseVesselInfoMessage({ type: 'vesselInfo', mmsi: 1 })).toBeNull()
    expect(parseVesselInfoMessage({ type: 'feedStatus', feeds: [] })).toBeNull()
  })
})
