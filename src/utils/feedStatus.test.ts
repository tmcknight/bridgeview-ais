import { describe, it, expect } from 'vitest'
import { parseFeedStatusMessage } from './feedStatus'

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
