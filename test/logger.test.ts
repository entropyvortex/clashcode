import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { logger, setLogLevel, getLogLevel, type LogLevel } from '../src/logger.js'

describe('logger', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: any
  let original: LogLevel

  beforeEach(() => {
    original = getLogLevel()
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    setLogLevel(original)
    stderrSpy.mockRestore()
  })

  it('writes info when level is info', () => {
    setLogLevel('info')
    logger.info('hello')
    expect(stderrSpy).toHaveBeenCalled()
    const call = stderrSpy.mock.calls[0]?.[0] as string
    expect(call).toContain('INFO')
    expect(call).toContain('hello')
  })

  it('suppresses debug when level is info', () => {
    setLogLevel('info')
    logger.debug('noisy')
    expect(stderrSpy).not.toHaveBeenCalled()
  })

  it('writes debug when level is debug', () => {
    setLogLevel('debug')
    logger.debug('trace')
    expect(stderrSpy).toHaveBeenCalled()
    expect(stderrSpy.mock.calls[0]?.[0]).toContain('DEBUG')
  })

  it('silent suppresses everything', () => {
    setLogLevel('silent')
    logger.debug('x')
    logger.info('x')
    logger.warn('x')
    logger.error('x')
    expect(stderrSpy).not.toHaveBeenCalled()
  })

  it('error level only emits errors', () => {
    setLogLevel('error')
    logger.info('x')
    logger.warn('x')
    expect(stderrSpy).not.toHaveBeenCalled()
    logger.error('boom')
    expect(stderrSpy).toHaveBeenCalledOnce()
  })

  it('stringifies Error objects to message', () => {
    setLogLevel('info')
    logger.info(new Error('failed'))
    const call = stderrSpy.mock.calls[0]?.[0] as string
    expect(call).toContain('failed')
  })

  it('setLogLevel / getLogLevel roundtrip', () => {
    setLogLevel('warn')
    expect(getLogLevel()).toBe('warn')
    setLogLevel('debug')
    expect(getLogLevel()).toBe('debug')
  })
})
