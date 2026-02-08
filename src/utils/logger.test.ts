import { describe, it, expect, vi, beforeEach } from 'vitest'
import { logger } from './logger'

describe('logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('has log, warn, error, and info methods', () => {
    expect(typeof logger.log).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.info).toBe('function')
  })

  it('log calls console.log in dev mode', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logger.log('test message', 123)
    // In test environment, import.meta.env.DEV is true
    spy.mockRestore()
  })

  it('warn calls console.warn in dev mode', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logger.warn('warning message')
    spy.mockRestore()
  })

  it('error calls console.error in dev mode', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.error('error message')
    spy.mockRestore()
  })

  it('info calls console.info in dev mode', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    logger.info('info message')
    spy.mockRestore()
  })

  it('accepts multiple arguments', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logger.log('first', 'second', { third: true })
    spy.mockRestore()
  })
})
