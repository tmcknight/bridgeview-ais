import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '../test/utils/renderWithProviders'
import TvMode from './TvMode'
import { SHIP_CAMS } from '../constants/shipCams'
import { mockShip } from '../test/mocks/ships'

// Keep Wikidata lookups offline
vi.mock('../hooks/useVesselInfo', () => ({
  useVesselInfo: () => ({ info: null, loading: false }),
}))

const cam = () => screen.getByTitle(`${SHIP_CAMS[0].name} live cam`)

describe('TvMode', () => {
  it('keeps the cam hidden behind the map while no ship is going by', () => {
    renderWithProviders(<TvMode passing={null} approaching={null} following={null} idle={false} onExit={() => {}} />)
    expect(cam()).toHaveClass('opacity-0')
    expect(screen.queryByLabelText('Ship going by')).not.toBeInTheDocument()
  })

  it('switches to the cam with the ship details as a ship goes by', () => {
    const ship = mockShip({
      name: 'ALGOMA EQUINOX',
      distanceToBridge: 0.3,
      cog: 5,
      length: 225,
      destination: 'THUNDER BAY',
      vesselInfo: null,
    })
    renderWithProviders(<TvMode passing={ship} approaching={null} following={null} idle={false} onExit={() => {}} />)

    expect(cam()).toHaveClass('opacity-100')
    expect(screen.getByRole('heading', { name: 'ALGOMA EQUINOX' })).toBeInTheDocument()
    expect(screen.getByText('Upbound to Lake Huron')).toBeInTheDocument()
    expect(screen.getByText(/225 m \(738 ft\)/)).toBeInTheDocument()
    expect(screen.getByText('Bound for THUNDER BAY')).toBeInTheDocument()
    expect(screen.getByText('Likely going to load grain')).toBeInTheDocument()
  })

  it('shows a ship on its way, with when it reaches the bridge, over the map', () => {
    const ship = mockShip({ name: 'JOHN G. MUNSON', cog: 185, vesselInfo: null })
    renderWithProviders(
      <TvMode
        passing={null}
        approaching={{ ship, etaMinutes: 12, distanceNM: 2, direction: 'downbound', cargo: null }}
        following={null}
        idle={false}
        onExit={() => {}}
      />,
    )
    expect(cam()).toHaveClass('opacity-0')
    expect(screen.getByLabelText('Ship coming up')).toHaveTextContent('JOHN G. MUNSON')
    expect(screen.getByRole('timer')).toHaveTextContent(/^1[12]:\d\d$/)
  })

  it('shows stored Wikidata details', () => {
    const ship = mockShip({
      distanceToBridge: 0.3,
      vesselInfo: { wikidataId: 'Q1', wikidataUrl: 'https://www.wikidata.org/wiki/Q1', yearBuilt: 1980, operator: 'Interlake' },
    })
    renderWithProviders(<TvMode passing={ship} approaching={null} following={null} idle={false} onExit={() => {}} />)
    expect(screen.getByText('Built 1980 · Operated by Interlake')).toBeInTheDocument()
  })

  it('falls back to the first cam when the URL names an unknown one', () => {
    renderWithProviders(<TvMode passing={null} approaching={null} following={null} idle={false} camId="nope" onExit={() => {}} />)
    expect(cam()).toBeInTheDocument()
  })

  it('hides the exit button while the mouse is still', () => {
    const onExit = vi.fn()
    const { rerender } = renderWithProviders(<TvMode passing={null} approaching={null} following={null} idle={false} onExit={onExit} />)
    fireEvent.click(screen.getByRole('button', { name: /Exit TV mode/ }))
    expect(onExit).toHaveBeenCalled()

    rerender(<TvMode passing={null} approaching={null} following={null} idle onExit={onExit} />)
    expect(screen.getByRole('button', { name: /Exit TV mode/ })).toHaveClass('opacity-0')
  })
})

describe('TvMode photo', () => {
  const info = {
    wikidataId: 'Q1',
    wikidataUrl: 'https://www.wikidata.org/wiki/Q1',
    imageUrl: 'https://upload.wikimedia.org/ship.jpg',
  }

  it('shows the ship photo on the map, but not over the cam', () => {
    const ship = mockShip({ distanceToBridge: 0.3, vesselInfo: info })
    const approaching = { ship, etaMinutes: 3, distanceNM: 0.5, direction: 'downbound', cargo: null } as const
    const { container, rerender } = renderWithProviders(
      <TvMode passing={null} approaching={approaching} following={null} idle={false} onExit={() => {}} />,
    )
    expect(container.querySelector('img')).toHaveAttribute('src', info.imageUrl)

    rerender(<TvMode passing={ship} approaching={null} following={null} idle={false} onExit={() => {}} />)
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('TvMode countdown', () => {
  it('counts down on the map, but not over the cam', () => {
    const ship = mockShip({ distanceToBridge: 0.5, vesselInfo: null })
    const approaching = { ship, etaMinutes: 3, distanceNM: 0.5, direction: 'downbound', cargo: null } as const
    const { rerender } = renderWithProviders(
      <TvMode passing={null} approaching={approaching} following={null} idle={false} onExit={() => {}} />,
    )
    expect(screen.getByRole('timer')).toBeInTheDocument()
    rerender(<TvMode passing={ship} approaching={null} following={null} idle={false} onExit={() => {}} />)
    expect(screen.queryByRole('timer')).toBeNull()
  })
})
