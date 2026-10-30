import { describe, it, expect } from 'vitest'
import { buildBridgeModel } from './bridgeModel'
import { BRIDGE_AIR_DRAFT_M } from '../constants/bridge'

describe('buildBridgeModel', () => {
  const model = buildBridgeModel()
  const heights = model.features.map((f) => f.properties!.height as number)

  it('builds blocks with a base below their top', () => {
    expect(model.features.length).toBeGreaterThan(100)
    for (const f of model.features) {
      expect(f.properties!.base).toBeLessThan(f.properties!.height)
      expect(f.properties!.base).toBeGreaterThanOrEqual(0)
    }
  })

  it('clears the river by the air draft, with structure above the deck', () => {
    const deck = model.features.filter((f) => f.properties!.color === '#94a3b8')
    const lowestMainDeck = Math.max(...deck.map((f) => f.properties!.base as number))
    expect(lowestMainDeck).toBeGreaterThanOrEqual(BRIDGE_AIR_DRAFT_M)
    expect(Math.max(...heights)).toBeGreaterThan(BRIDGE_AIR_DRAFT_M + 20)
  })
})
