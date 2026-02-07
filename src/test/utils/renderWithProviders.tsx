import { render, RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'

/**
 * Custom render function that wraps components with any necessary providers.
 * Currently just re-exports render, but can be extended with providers
 * (e.g., Router, Theme, etc.) as the application grows.
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: RenderOptions
) {
  return render(ui, { ...options })
}

// Re-export everything from testing library for convenience
export * from '@testing-library/react'
export { default as userEvent } from '@testing-library/user-event'
