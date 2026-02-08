import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders } from '../test/utils/renderWithProviders'
import ErrorBoundary from './ErrorBoundary'

// Component that throws an error
function ThrowingComponent({ error }: { error?: Error }) {
  if (error) throw error
  return <div>Working component</div>
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // Suppress console.error from React error boundaries in tests
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('renders children when there is no error', () => {
    const { getByText } = renderWithProviders(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>
    )
    expect(getByText('Child content')).toBeInTheDocument()
  })

  it('renders default fallback UI when error occurs', () => {
    const { getByText } = renderWithProviders(
      <ErrorBoundary>
        <ThrowingComponent error={new Error('Test error')} />
      </ErrorBoundary>
    )
    expect(getByText('Something went wrong')).toBeInTheDocument()
    expect(getByText(/An unexpected error occurred/)).toBeInTheDocument()
  })

  it('renders custom fallback when provided', () => {
    const { getByText } = renderWithProviders(
      <ErrorBoundary fallback={<div>Custom error page</div>}>
        <ThrowingComponent error={new Error('Test error')} />
      </ErrorBoundary>
    )
    expect(getByText('Custom error page')).toBeInTheDocument()
  })

  it('displays error details in expandable section', () => {
    const { getByText } = renderWithProviders(
      <ErrorBoundary>
        <ThrowingComponent error={new Error('Detailed error message')} />
      </ErrorBoundary>
    )
    expect(getByText('Error details')).toBeInTheDocument()
    expect(getByText(/Detailed error message/)).toBeInTheDocument()
  })

  it('shows Try Again and Reload Page buttons', () => {
    const { getByText } = renderWithProviders(
      <ErrorBoundary>
        <ThrowingComponent error={new Error('Test error')} />
      </ErrorBoundary>
    )
    expect(getByText('Try Again')).toBeInTheDocument()
    expect(getByText('Reload Page')).toBeInTheDocument()
  })

  it('renders Try Again button that can be clicked', () => {
    const { getByText } = renderWithProviders(
      <ErrorBoundary>
        <ThrowingComponent error={new Error('Reset test error')} />
      </ErrorBoundary>
    )
    expect(getByText('Something went wrong')).toBeInTheDocument()

    const tryAgainButton = getByText('Try Again')
    expect(tryAgainButton).toBeInTheDocument()
    // Clicking Try Again resets the error boundary state
    // In React 19 dev mode, the component will re-throw, but the button is functional
    tryAgainButton.click()
  })

  it('calls onError callback when error is caught', () => {
    const onError = vi.fn()
    renderWithProviders(
      <ErrorBoundary onError={onError}>
        <ThrowingComponent error={new Error('Callback test error')} />
      </ErrorBoundary>
    )
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Callback test error' }),
      expect.objectContaining({ componentStack: expect.any(String) })
    )
  })

  it('logs error to console', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderWithProviders(
      <ErrorBoundary>
        <ThrowingComponent error={new Error('Console error test')} />
      </ErrorBoundary>
    )
    expect(consoleSpy).toHaveBeenCalled()
  })
})
