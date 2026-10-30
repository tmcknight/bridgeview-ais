import { describe, it, expect } from 'vitest'
import { hasFeed, isAdsbFiFeed, parseFeedStatusMessage } from './feedStatus'

describe('parseFeedStatusMessage', () => {
  it('returns the feeds from a feed status message', () => {
    const feeds = [{ source: 'local', status: 'quiet' }]
    expect(parseFeedStatusMessage({ type: 'feedStatus', feeds })).toEqual(feeds)
  })

  it('returns null for anything else', () => {
    expect(parseFeedStatusMessage(null)).toBeNull()
    expect(parseFeedStatusMessage({ type: 'shipLog', entries: [] })).toBeNull()
    expect(parseFeedStatusMessage({ type: 'feedStatus' })).toBeNull()
    expect(parseFeedStatusMessage({ MessageType: 'PositionReport' })).toBeNull()
  })
})

describe('hasFeed', () => {
  it('finds a feed the server uses, whatever its health', () => {
    const feeds = [{ source: 'aishub' as const, status: 'down' as const }]
    expect(hasFeed(feeds, 'aishub')).toBe(true)
    expect(hasFeed(feeds, 'aisstream')).toBe(false)
    expect(hasFeed(null, 'aishub')).toBe(false)
  })
})

describe('isAdsbFiFeed', () => {
  it('spots adsb.fi from the link the server gives its aircraft feed', () => {
    expect(isAdsbFiFeed([{ source: 'adsb', status: 'live', url: 'https://globe.adsb.fi/?lat=43' }])).toBe(true)
    expect(isAdsbFiFeed([{ source: 'adsb', status: 'live' }])).toBe(false)
    expect(isAdsbFiFeed([{ source: 'adsb', status: 'live', url: 'https://notadsb.fi.example.com' }])).toBe(false)
    expect(isAdsbFiFeed([{ source: 'local', status: 'live', url: 'https://globe.adsb.fi' }])).toBe(false)
    expect(isAdsbFiFeed(undefined)).toBe(false)
  })
})
