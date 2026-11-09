import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders, userEvent } from '../test/utils/renderWithProviders'
import ShipSearch from './ShipSearch'
import { mockShip } from '../test/mocks/ships'
import type { TrackedShip } from '../types/ais'
import type { ShipLog } from '../utils/shipLog'

const algoma = mockShip({ mmsi: 316001, name: 'ALGOMA EQUINOX', distanceToBridge: 4 })
const cason = mockShip({ mmsi: 366003, name: 'CASON J. CALLAWAY', distanceToBridge: 2 })
const ships = new Map([algoma, cason].map((s) => [s.mmsi, s]))
const log: ShipLog = new Map([
  [9, { mmsi: 9, name: 'EDWIN H. GOTT', passages: [{ time: new Date().toISOString(), direction: 'downbound' }], lastSeen: new Date().toISOString() }],
])

function Harness(props: {
  onSelectShip?: (ship: TrackedShip) => void
  isFavourite?: (mmsi: number) => boolean
  onToggleFavourite?: (mmsi: number, name: string) => void
}) {
  const [query, setQuery] = useState('')
  return (
    <ShipSearch
      query={query}
      onQueryChange={setQuery}
      ships={ships}
      log={log}
      isFavourite={props.isFavourite ?? (() => false)}
      onToggleFavourite={props.onToggleFavourite ?? vi.fn()}
      onSelectShip={props.onSelectShip}
    />
  )
}

describe('ShipSearch', () => {
  it('shows matching live ships and selects one', async () => {
    const onSelectShip = vi.fn()
    renderWithProviders(<Harness onSelectShip={onSelectShip} />)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search ships' }), 'algoma')
    expect(screen.getByText('ALGOMA EQUINOX')).toBeInTheDocument()
    expect(screen.queryByText('CASON J. CALLAWAY')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Select ALGOMA EQUINOX/ }))
    expect(onSelectShip).toHaveBeenCalledWith(algoma)
  })

  it('lists ship-log ships that are not heard now', async () => {
    renderWithProviders(<Harness />)
    await userEvent.type(screen.getByRole('searchbox'), 'gott')
    expect(screen.getByText('In the ship log, not heard now')).toBeInTheDocument()
    expect(screen.getByText('EDWIN H. GOTT')).toBeInTheDocument()
  })

  it('says when nothing matches', async () => {
    renderWithProviders(<Harness />)
    await userEvent.type(screen.getByRole('searchbox'), 'zzz')
    expect(screen.getByText(/No ships match/)).toBeInTheDocument()
  })

  it('stars a result without selecting it', async () => {
    const onSelectShip = vi.fn()
    const onToggleFavourite = vi.fn()
    renderWithProviders(<Harness onSelectShip={onSelectShip} onToggleFavourite={onToggleFavourite} />)
    await userEvent.type(screen.getByRole('searchbox'), 'cason')
    await userEvent.click(screen.getByRole('button', { name: 'Add CASON J. CALLAWAY to favourites' }))
    expect(onToggleFavourite).toHaveBeenCalledWith(366003, 'CASON J. CALLAWAY')
    expect(onSelectShip).not.toHaveBeenCalled()
  })

  it('clears with Escape and focuses with "/"', async () => {
    renderWithProviders(<Harness />)
    const input = screen.getByRole('searchbox')
    await userEvent.keyboard('/')
    expect(input).toHaveFocus()
    await userEvent.type(input, 'algoma')
    await userEvent.keyboard('{Escape}')
    expect(input).toHaveValue('')
    expect(screen.queryByText('ALGOMA EQUINOX')).not.toBeInTheDocument()
  })
})
