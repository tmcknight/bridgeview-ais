import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../test/utils/renderWithProviders'
import VesselInfoCard from './VesselInfoCard'
import { useVesselInfo } from '../hooks/useVesselInfo'

vi.mock('../hooks/useVesselInfo', () => ({
  useVesselInfo: vi.fn(),
}))

const mockedUseVesselInfo = vi.mocked(useVesselInfo)

describe('VesselInfoCard', () => {
  beforeEach(() => {
    mockedUseVesselInfo.mockReset()
  })

  it('shows a loading message while the lookup is in flight', () => {
    mockedUseVesselInfo.mockReturnValue({ info: null, loading: true })
    renderWithProviders(<VesselInfoCard mmsi={366938730} />)
    expect(screen.getByText('Looking up vessel details…')).toBeInTheDocument()
  })

  it('renders nothing when there is no match', () => {
    mockedUseVesselInfo.mockReturnValue({ info: null, loading: false })
    const { container } = renderWithProviders(<VesselInfoCard mmsi={366938730} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders photo, facts and links for a match', () => {
    mockedUseVesselInfo.mockReturnValue({
      loading: false,
      info: {
        wikidataId: 'Q6719625',
        wikidataUrl: 'https://www.wikidata.org/wiki/Q6719625',
        name: 'Indiana Harbor',
        description: 'self-discharging bulk carrier',
        imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/x.jpg?width=480',
        imagePageUrl: 'https://commons.wikimedia.org/wiki/File:x.jpg',
        yearBuilt: 1979,
        builder: 'Bay Shipbuilding Company',
        grossTonnage: 35923,
        wikipediaUrl: 'https://en.wikipedia.org/wiki/MV_Indiana_Harbor',
      },
    })
    renderWithProviders(<VesselInfoCard mmsi={366938730} imo={7514701} />)

    expect(mockedUseVesselInfo).toHaveBeenCalledWith(366938730, 7514701, true)
    expect(screen.getByAltText('Indiana Harbor')).toHaveAttribute(
      'src',
      'https://commons.wikimedia.org/wiki/Special:FilePath/x.jpg?width=480',
    )
    expect(screen.getByText('self-discharging bulk carrier')).toBeInTheDocument()
    expect(screen.getByText(/Built 1979 · Bay Shipbuilding Company · 35,923 GT/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Wikipedia' })).toHaveAttribute(
      'href',
      'https://en.wikipedia.org/wiki/MV_Indiana_Harbor',
    )
    expect(screen.getByRole('link', { name: 'Wikidata' })).toHaveAttribute(
      'href',
      'https://www.wikidata.org/wiki/Q6719625',
    )
  })

  it('uses details the server stored instead of looking the ship up', () => {
    mockedUseVesselInfo.mockReturnValue({ info: null, loading: true })
    renderWithProviders(
      <VesselInfoCard
        mmsi={366938730}
        storedInfo={{
          wikidataId: 'Q6719625',
          wikidataUrl: 'https://www.wikidata.org/wiki/Q6719625',
          name: 'Indiana Harbor',
          imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/x.jpg?width=480',
        }}
      />,
    )
    expect(mockedUseVesselInfo).toHaveBeenCalledWith(366938730, undefined, false)
    expect(screen.queryByText('Looking up vessel details…')).not.toBeInTheDocument()
    expect(screen.getByAltText('Indiana Harbor')).toBeInTheDocument()
  })

  it('renders nothing when the server found no match', () => {
    mockedUseVesselInfo.mockReturnValue({ info: null, loading: true })
    const { container } = renderWithProviders(<VesselInfoCard mmsi={366938730} storedInfo={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows register details for a ship Wikidata does not know', () => {
    renderWithProviders(
      <VesselInfoCard
        mmsi={316001234}
        storedInfo={{
          yearBuilt: 2012,
          grossTonnage: 24451,
          registry: { source: 'transport-canada', officialNumber: '837491', portOfRegistry: 'ST. CATHARINES', enginePowerKw: 6929 },
          uscg: { source: 'uscg', vesselId: 1225032, serviceType: 'Freight Ship', serviceSubType: 'General', deadweight: 36480 },
        }}
      />,
    )
    expect(
      screen.getByText('Built 2012 · Freight Ship, General · 24,451 GT · 36,480 DWT · 6,929 kW · Registered in St. Catharines'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Wikidata' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'USCG' })).toHaveAttribute('href', 'https://cgmix.uscg.mil/psix/')
    expect(screen.getByRole('link', { name: 'Transport Canada' })).toBeInTheDocument()
  })

  it('sums up USCG inspections, flagging open deficiencies', () => {
    renderWithProviders(
      <VesselInfoCard
        mmsi={366938730}
        storedInfo={{
          uscg: {
            source: 'uscg',
            vesselId: 50383,
            inspections: {
              count: 38,
              sinceYear: 2023,
              recent: [
                { date: '2026-08-03T21:29:09.000Z', zone: 'Detroit, Michigan', portStateControl: false, deficiencies: 2, unresolved: 1, controls: 0, systems: [] },
              ],
            },
          },
        }}
      />,
    )
    expect(screen.getByText(/38 USCG inspections since 2023 · last Aug 3, 2026 \(Detroit, Michigan\): 2 deficiencies/)).toBeInTheDocument()
    expect(screen.getByText('· 1 open deficiency')).toBeInTheDocument()
  })
})
