import { describe, it, expect } from 'vitest'
import {
  ClashCodeError,
  ConfigError,
  SandboxError,
  ProviderError,
  SessionError,
  DebateError,
  errorMessage,
} from '../src/errors.js'

describe('errors', () => {
  it('ClashCodeError carries code + name + message', () => {
    const e = new ClashCodeError('boom', 'X_CODE')
    expect(e.message).toBe('boom')
    expect(e.code).toBe('X_CODE')
    expect(e.name).toBe('ClashCodeError')
    expect(e).toBeInstanceOf(Error)
  })

  it('subclasses set their own code', () => {
    expect(new ConfigError('x').code).toBe('CONFIG_ERROR')
    expect(new SandboxError('x').code).toBe('SANDBOX_ERROR')
    expect(new ProviderError('x').code).toBe('PROVIDER_ERROR')
    expect(new SessionError('x').code).toBe('SESSION_ERROR')
    expect(new DebateError('x').code).toBe('DEBATE_ERROR')
  })

  it('subclasses are instanceof ClashCodeError and Error', () => {
    const e = new SandboxError('x')
    expect(e).toBeInstanceOf(SandboxError)
    expect(e).toBeInstanceOf(ClashCodeError)
    expect(e).toBeInstanceOf(Error)
  })

  it('cause chaining via Error.cause', () => {
    const root = new Error('root cause')
    const e = new ConfigError('wrapper', { cause: root })
    expect(e.cause).toBe(root)
  })

  describe('ProviderError.isRetryable', () => {
    it('true for 429', () => {
      expect(new ProviderError('rate limit', { status: 429 }).isRetryable).toBe(true)
    })
    it('true for 500/502/503', () => {
      expect(new ProviderError('x', { status: 500 }).isRetryable).toBe(true)
      expect(new ProviderError('x', { status: 502 }).isRetryable).toBe(true)
      expect(new ProviderError('x', { status: 503 }).isRetryable).toBe(true)
    })
    it('false for 400/401/404', () => {
      expect(new ProviderError('x', { status: 400 }).isRetryable).toBe(false)
      expect(new ProviderError('x', { status: 401 }).isRetryable).toBe(false)
      expect(new ProviderError('x', { status: 404 }).isRetryable).toBe(false)
    })
    it('false when status is missing', () => {
      expect(new ProviderError('x').isRetryable).toBe(false)
    })
  })

  describe('errorMessage()', () => {
    it('returns "unknown error" for null', () => {
      expect(errorMessage(null)).toBe('unknown error')
    })
    it('stringifies non-Error throwables', () => {
      expect(errorMessage('string-throw')).toBe('string-throw')
      expect(errorMessage(42)).toBe('42')
    })
    it('walks cause chain', () => {
      const root = new Error('db unreachable')
      const mid = new SandboxError('sandbox failed', { cause: root })
      const top = new ProviderError('request failed', { cause: mid })
      const msg = errorMessage(top)
      expect(msg).toContain('request failed')
      expect(msg).toContain('sandbox failed')
      expect(msg).toContain('db unreachable')
    })
  })
})
