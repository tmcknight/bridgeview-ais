import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, act } from './test/utils/renderWithProviders'
import { MockAISStreamServer } from './test/mocks/websocket'
import App from './App'

// Mock ShipMap since it depends on MapLibre GL which isn't available in jsdom
vi.mock('./components/ShipMap', () => ({
  default: ({ ships, theme }: { ships: Map<number, unknown>; theme: string }) => (
    <div data-testid="ship-map" data-theme={theme}>
      Map with {ships.size} ships
    </div>
  ),
}))

describe('App', () => {
  let mockServer: MockAISStreamServer

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockServer = new MockAISStreamServer('ws://localhost:3001')
  })

  afterEach(() => {
    mockServer.close()
    vi.useRealTimers()
  })

  it('renders the app title', async () => {
    const { getByText } = renderWithProviders(<App />)
    expect(getByText('BridgeView AIS')).toBeInTheDocument()
  })

  it('renders the subtitle', () => {
    const { getByText } = renderWithProviders(<App />)
    expect(getByText('Blue Water Bridge Ship Tracker')).toBeInTheDocument()
  })

  it('renders the status bar', () => {
    const { container } = renderWithProviders(<App />)
    // StatusBar renders an aria-live region
    const liveRegion = container.querySelector('[aria-live="polite"]')
    expect(liveRegion).toBeInTheDocument()
  })

  it('renders the theme toggle button', () => {
    const { getByLabelText } = renderWithProviders(<App />)
    // Theme starts as light, so button should say "Switch to dark mode"
    expect(getByLabelText(/Switch to dark mode/i)).toBeInTheDocument()
  })

  it('toggles theme when theme button is clicked', async () => {
    const { getByLabelText } = renderWithProviders(<App />)
    const toggleButton = getByLabelText(/Switch to dark mode/i)
    await act(async () => {
      toggleButton.click()
    })
    expect(getByLabelText(/Switch to light mode/i)).toBeInTheDocument()
  })

  it('renders the map component', () => {
    const { getByTestId } = renderWithProviders(<App />)
    expect(getByTestId('ship-map')).toBeInTheDocument()
  })

  it('shows Enable Notifications button when permission is default', () => {
    const { getByText } = renderWithProviders(<App />)
    expect(getByText('Enable Notifications')).toBeInTheDocument()
  })

  it('shows loading spinner when connecting with no ships', () => {
    const { getByText } = renderWithProviders(<App />)
    expect(getByText('Connecting to AIS stream...')).toBeInTheDocument()
  })
})
