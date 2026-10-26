import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, userEvent } from '../test/utils/renderWithProviders'
import ShipLog from './ShipLog'
import { mockShip } from '../test/mocks/ships'
import type { BridgePassage, ShipLog as ShipLogData } from '../utils/shipLog'

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

function logOf(...entries: { mmsi: number; name: string; passages: BridgePassage[] }[]): ShipLogData {
  return new Map(entries.map((e) => [e.mmsi, { ...e, lastSeen: e.passages[0].time }]))
}

async function open() {
  await userEvent.click(screen.getByRole('button', { name: /Ship Log/ }))
}

describe('ShipLog', () => {
  it('shows an empty message when no ships have passed', async () => {
    renderWithProviders(<ShipLog log={new Map()} ships={new Map()} />)
    await open()
    expect(screen.getByText('No ships have gone under the bridge yet.')).toBeInTheDocument()
  })

  it('lists logged ships with direction, passage count and last seen', async () => {
    const log = logOf(
      { mmsi: 1, name: 'OLD LAKER', passages: [{ time: minutesAgo(300), direction: 'upbound' }] },
      {
        mmsi: 2,
        name: 'BUSY LAKER',
        passages: [
          { time: minutesAgo(20), direction: 'downbound' },
          { time: minutesAgo(200), direction: 'upbound' },
        ],
      },
    )

    renderWithProviders(<ShipLog log={log} ships={new Map()} />)
    expect(screen.getByText('Ship Log (2)')).toBeInTheDocument()
    await open()

    const names = screen.getAllByText(/LAKER$/).map((el) => el.textContent)
    expect(names).toEqual(['BUSY LAKER', 'OLD LAKER'])
    expect(screen.getByText('Seen 20m ago')).toBeInTheDocument()
    expect(screen.getByText('Seen 5h ago')).toBeInTheDocument()
    expect(screen.getByText(/Downbound .* · 2 passages/)).toBeInTheDocument()
  })

  it('selects a logged ship that is still being tracked', async () => {
    const ship = mockShip({ mmsi: 1, name: 'STILL HERE', lastUpdate: minutesAgo(1) })
    const log = logOf({ mmsi: 1, name: 'STILL HERE', passages: [{ time: minutesAgo(5), direction: 'upbound' }] })
    const onSelectShip = vi.fn()

    renderWithProviders(
      <ShipLog log={log} ships={new Map([[1, ship]])} onSelectShip={onSelectShip} />,
    )
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Select STILL HERE' }))
    expect(onSelectShip).toHaveBeenCalledWith(ship)
  })
})
