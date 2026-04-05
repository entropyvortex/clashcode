import { describe, it, expect } from 'vitest'
import { withRetry, computeDelay } from '../src/retry.js'
import { ProviderError, SandboxError } from '../src/errors.js'

describe('retry', () => {
  describe('computeDelay', () => {
    it('grows exponentially', () => {
      const d0 = computeDelay(0, { baseDelayMs: 100, backoff: 2, maxDelayMs: 99999 })
      const d1 = computeDelay(1, { baseDelayMs: 100, backoff: 2, maxDelayMs: 99999 })
      const d2 = computeDelay(2, { baseDelayMs: 100, backoff: 2, maxDelayMs: 99999 })
      // ±20% jitter: d0 ≈ 80-120, d1 ≈ 160-240, d2 ≈ 320-480
      expect(d0).toBeGreaterThanOrEqual(80)
      expect(d0).toBeLessThanOrEqual(120)
      expect(d1).toBeGreaterThanOrEqual(160)
      expect(d1).toBeLessThanOrEqual(240)
      expect(d2).toBeGreaterThanOrEqual(320)
      expect(d2).toBeLessThanOrEqual(480)
    })

    it('caps at maxDelayMs', () => {
      const d = computeDelay(10, { baseDelayMs: 1000, backoff: 2, maxDelayMs: 5000 })
      expect(d).toBeLessThanOrEqual(5000)
    })
  })

  describe('withRetry', () => {
    it('returns result on first success', async () => {
      let calls = 0
      const result = await withRetry(async () => {
        calls++
        return 42
      })
      expect(result).toBe(42)
      expect(calls).toBe(1)
    })

    it('retries on retryable ProviderError', async () => {
      let calls = 0
      const result = await withRetry(
        async () => {
          calls++
          if (calls < 3) throw new ProviderError('rate limit', { status: 429 })
          return 'ok'
        },
        { baseDelayMs: 1, maxAttempts: 5 },
      )
      expect(result).toBe('ok')
      expect(calls).toBe(3)
    })

    it('does not retry non-retryable errors', async () => {
      let calls = 0
      await expect(
        withRetry(
          async () => {
            calls++
            throw new ProviderError('bad request', { status: 400 })
          },
          { baseDelayMs: 1 },
        ),
      ).rejects.toThrow('bad request')
      expect(calls).toBe(1)
    })

    it('does not retry unrelated errors by default', async () => {
      let calls = 0
      await expect(
        withRetry(
          async () => {
            calls++
            throw new SandboxError('disk full')
          },
          { baseDelayMs: 1 },
        ),
      ).rejects.toThrow('disk full')
      expect(calls).toBe(1)
    })

    it('retries timeout-like messages', async () => {
      let calls = 0
      const result = await withRetry(
        async () => {
          calls++
          if (calls < 2) throw new Error('ECONNRESET')
          return 'done'
        },
        { baseDelayMs: 1 },
      )
      expect(result).toBe('done')
      expect(calls).toBe(2)
    })

    it('exhausts maxAttempts', async () => {
      let calls = 0
      await expect(
        withRetry(
          async () => {
            calls++
            throw new ProviderError('500', { status: 500 })
          },
          { baseDelayMs: 1, maxAttempts: 3 },
        ),
      ).rejects.toThrow()
      expect(calls).toBe(3)
    })

    it('honors custom shouldRetry predicate', async () => {
      let calls = 0
      const result = await withRetry(
        async () => {
          calls++
          if (calls < 2) throw new Error('any error')
          return 'ok'
        },
        { baseDelayMs: 1, shouldRetry: () => true },
      )
      expect(result).toBe('ok')
      expect(calls).toBe(2)
    })
  })
})
