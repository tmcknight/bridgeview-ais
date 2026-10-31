import { describe, it, expect } from 'vitest'
import { parseVesselInfoMessage, photoKey } from './vesselInfo'

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

describe('photoKey', () => {
  it("is the Commons file, however it's linked, else the URL", () => {
    const thumbnail = { url: 'https://upload.wikimedia.org/thumb/A_b.jpg/480px-A_b.jpg', pageUrl: 'https://commons.wikimedia.org/wiki/File:A_b.jpg' }
    const wikidata = { url: 'https://commons.wikimedia.org/wiki/Special:FilePath/A%20b.jpg?width=480', pageUrl: 'https://commons.wikimedia.org/wiki/File:A%20b.jpg' }
    expect(photoKey(thumbnail)).toBe('commons:A b.jpg')
    expect(photoKey(wikidata)).toBe(photoKey(thumbnail))
    expect(photoKey({ url: '/api/photos/a.jpg' })).toBe('/api/photos/a.jpg')
  })
})
