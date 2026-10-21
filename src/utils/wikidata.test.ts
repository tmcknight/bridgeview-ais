import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  buildVesselQuery,
  parseVesselBinding,
  fetchVesselInfo,
  clearVesselInfoCache,
} from './wikidata'

const literal = (value: string) => ({ type: 'literal', value })
const uri = (value: string) => ({ type: 'uri', value })

const indianaHarborRow = {
  ship: uri('http://www.wikidata.org/entity/Q6719625'),
  name: literal('Indiana Harbor'),
  description: literal('self-discharging bulk carrier'),
  img: uri('http://commons.wikimedia.org/wiki/Special:FilePath/Lakers%20Indiana%20Harbor.jpg'),
  built: literal('1979-01-01T00:00:00Z'),
  builder: literal('Bay Shipbuilding Company'),
  grossTonnage: literal('35923.0'),
  wiki: uri('https://en.wikipedia.org/wiki/MV_Indiana_Harbor'),
}

function mockFetchResponse(bindings: Record<string, unknown>[], ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => ({ results: { bindings } }),
  })
}

describe('wikidata', () => {
  describe('buildVesselQuery', () => {
    it('matches on MMSI only when no IMO is given', () => {
      const query = buildVesselQuery(366938730)
      expect(query).toContain('wdt:P587 "366938730"')
      expect(query).not.toContain('wdt:P458')
    })

    it('matches on MMSI or IMO when both are given', () => {
      const query = buildVesselQuery(366938730, 7514701)
      expect(query).toContain('{ ?ship wdt:P587 "366938730" } UNION { ?ship wdt:P458 "7514701" }')
    })

    it('ignores invalid MMSI and IMO values', () => {
      expect(buildVesselQuery(12345)).toBeNull()
      expect(buildVesselQuery(undefined, 0)).toBeNull()
      expect(buildVesselQuery(1.5, 123)).toBeNull()
      expect(buildVesselQuery(12345, 7514701)).not.toContain('P587')
    })
  })

  describe('parseVesselBinding', () => {
    it('maps a full result row to VesselInfo', () => {
      expect(parseVesselBinding(indianaHarborRow)).toEqual({
        wikidataId: 'Q6719625',
        wikidataUrl: 'https://www.wikidata.org/wiki/Q6719625',
        name: 'Indiana Harbor',
        description: 'self-discharging bulk carrier',
        imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Lakers%20Indiana%20Harbor.jpg?width=480',
        imagePageUrl: 'https://commons.wikimedia.org/wiki/File:Lakers%20Indiana%20Harbor.jpg',
        yearBuilt: 1979,
        builder: 'Bay Shipbuilding Company',
        grossTonnage: 35923,
        wikipediaUrl: 'https://en.wikipedia.org/wiki/MV_Indiana_Harbor',
      })
    })

    it('handles rows with only the entity', () => {
      expect(parseVesselBinding({ ship: uri('http://www.wikidata.org/entity/Q1') })).toEqual({
        wikidataId: 'Q1',
        wikidataUrl: 'https://www.wikidata.org/wiki/Q1',
      })
    })

    it('returns null when there is no entity', () => {
      expect(parseVesselBinding({})).toBeNull()
    })
  })

  describe('fetchVesselInfo', () => {
    beforeEach(() => {
      clearVesselInfoCache()
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('returns parsed info for a match', async () => {
      vi.stubGlobal('fetch', mockFetchResponse([indianaHarborRow]))
      const info = await fetchVesselInfo(366938730, 7514701)
      expect(info?.name).toBe('Indiana Harbor')
    })

    it('returns null when Wikidata has no match', async () => {
      vi.stubGlobal('fetch', mockFetchResponse([]))
      expect(await fetchVesselInfo(366938730)).toBeNull()
    })

    it('skips the request when there is nothing valid to look up', async () => {
      const fetchMock = mockFetchResponse([])
      vi.stubGlobal('fetch', fetchMock)
      expect(await fetchVesselInfo(42)).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('caches results, including misses', async () => {
      const fetchMock = mockFetchResponse([])
      vi.stubGlobal('fetch', fetchMock)
      await fetchVesselInfo(366938730)
      await fetchVesselInfo(366938730)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('does not cache failed requests', async () => {
      const failing = mockFetchResponse([], false, 503)
      vi.stubGlobal('fetch', failing)
      await expect(fetchVesselInfo(366938730)).rejects.toThrow('503')

      const succeeding = mockFetchResponse([indianaHarborRow])
      vi.stubGlobal('fetch', succeeding)
      expect((await fetchVesselInfo(366938730))?.wikidataId).toBe('Q6719625')
    })
  })
})
