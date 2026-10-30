import { describe, it, expect } from 'vitest'
import { parseShipCamsMessage, withLiveVideo } from './shipCams'
import { SHIP_CAMS } from '../constants/shipCams'

describe('parseShipCamsMessage', () => {
  it('reads the video IDs, dropping anything that isn\'t one', () => {
    expect(
      parseShipCamsMessage({ type: 'shipCams', videoIds: { a: 'AwP_Q6IGwFs', b: 'x"><script>', c: 5 } }),
    ).toEqual({ a: 'AwP_Q6IGwFs' })
  })

  it('is null for other messages', () => {
    expect(parseShipCamsMessage({ type: 'aircraft', aircraft: [] })).toBeNull()
    expect(parseShipCamsMessage({ type: 'shipCams' })).toBeNull()
    expect(parseShipCamsMessage(null)).toBeNull()
  })
})

describe('withLiveVideo', () => {
  const [cam] = SHIP_CAMS

  it("swaps in the server's video", () => {
    expect(withLiveVideo(cam, { [cam.id]: 'newVideo123' })).toEqual({ ...cam, videoId: 'newVideo123' })
  })

  it('keeps the built-in video without one', () => {
    expect(withLiveVideo(cam)).toBe(cam)
    expect(withLiveVideo(cam, { other: 'newVideo123' })).toBe(cam)
  })
})
