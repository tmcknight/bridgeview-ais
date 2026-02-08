import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders } from '../test/utils/renderWithProviders'
import ComponentErrorBoundary from './ComponentErrorBoundary'

function ThrowingComponent({ error }: { error?: Error }) {
  if (error) throw error
  return <div>Working component</div>
}

describe('ComponentErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('renders children when there is no error', () => {
    const { getByText } = renderWithProviders(
      <ComponentErrorBoundary componentName="TestComponent">
        <div>Child content</div>
      </ComponentErrorBoundary>
    )
    expect(getByText('Child content')).toBeInTheDocument()
  })

  it('renders inline error UI when error occurs', () => {
    const { getByText } = renderWithProviders(
      <ComponentErrorBoundary componentName="Map">
        <ThrowingComponent error={new Error('Component error')} />
      </ComponentErrorBoundary>
    )
    expect(getByText('Map Error')).toBeInTheDocument()
    expect(getByText(/This component encountered an error/)).toBeInTheDocument()
  })

  it('shows the component name in the error title', () => {
    const { getByText } = renderWithProviders(
      <ComponentErrorBoundary componentName="Vessel List">
        <ThrowingComponent error={new Error('Test error')} />
      </ComponentErrorBoundary>
    )
    expect(getByText('Vessel List Error')).toBeInTheDocument()
  })

  it('shows error details in expandable section', () => {
    const { getByText } = renderWithProviders(
      <ComponentErrorBoundary componentName="Test">
        <ThrowingComponent error={new Error('Specific error text')} />
      </ComponentErrorBoundary>
    )
    expect(getByText('Details')).toBeInTheDocument()
    expect(getByText(/Specific error text/)).toBeInTheDocument()
  })

  it('shows Try Again button', () => {
    const { getByText } = renderWithProviders(
      <ComponentErrorBoundary componentName="Test">
        <ThrowingComponent error={new Error('Test error')} />
      </ComponentErrorBoundary>
    )
    expect(getByText('Try Again')).toBeInTheDocument()
  })

  it('renders Try Again button that can be clicked', () => {
    const { getByText } = renderWithProviders(
      <ComponentErrorBoundary componentName="Test">
        <ThrowingComponent error={new Error('Reset test')} />
      </ComponentErrorBoundary>
    )
    expect(getByText('Test Error')).toBeInTheDocument()

    const tryAgainButton = getByText('Try Again')
    expect(tryAgainButton).toBeInTheDocument()
    tryAgainButton.click()
  })

  it('logs error with component name to console', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderWithProviders(
      <ComponentErrorBoundary componentName="ShipMap">
        <ThrowingComponent error={new Error('Map error')} />
      </ComponentErrorBoundary>
    )
    expect(consoleSpy).toHaveBeenCalledWith(
      'Error in ShipMap:',
      expect.any(Error),
      expect.anything()
    )
  })
})
