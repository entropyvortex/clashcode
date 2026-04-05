/**
 * Exponential-backoff retry helper for provider calls.
 *
 * Wraps an async function. Retries on `ProviderError.isRetryable` or when
 * the caller's `shouldRetry` predicate returns true. Emits progress
 * callbacks via the logger so users see what's happening.
 *
 * @module retry
 */

import { ProviderError } from './errors.js'
import { logger } from './logger.js'

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 3. */
  maxAttempts?: number
  /** Base delay in ms before the first retry. Default: 1000. */
  baseDelayMs?: number
  /** Exponential backoff multiplier. Default: 2. */
  backoff?: number
  /** Max delay cap in ms. Default: 30_000. */
  maxDelayMs?: number
  /** Override: return true to retry, false to abort. */
  shouldRetry?: (err: unknown, attempt: number) => boolean
  /** Label for logs (e.g. "provider.runAgent"). */
  label?: string
}

const DEFAULTS: Required<Omit<RetryOptions, 'shouldRetry' | 'label'>> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  backoff: 2,
  maxDelayMs: 30_000,
}

function defaultShouldRetry(err: unknown): boolean {
  if (err instanceof ProviderError) return err.isRetryable
  // Treat abort/timeout as retryable by default
  if (err instanceof Error && /timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(err.message)) {
    return true
  }
  return false
}

export function computeDelay(attempt: number, opts: RetryOptions = {}): number {
  const base = opts.baseDelayMs ?? DEFAULTS.baseDelayMs
  const backoff = opts.backoff ?? DEFAULTS.backoff
  const cap = opts.maxDelayMs ?? DEFAULTS.maxDelayMs
  const raw = base * Math.pow(backoff, attempt)
  // Add ±20% jitter
  const jitter = raw * 0.2 * (Math.random() * 2 - 1)
  return Math.min(cap, Math.max(0, Math.floor(raw + jitter)))
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const max = opts.maxAttempts ?? DEFAULTS.maxAttempts
  const check = opts.shouldRetry ?? defaultShouldRetry
  const label = opts.label ?? 'operation'

  let lastErr: unknown
  for (let attempt = 0; attempt < max; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const isLast = attempt === max - 1
      if (isLast || !check(err, attempt)) throw err
      const delay = computeDelay(attempt, opts)
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn(`${label}: attempt ${attempt + 1}/${max} failed (${msg}); retrying in ${delay}ms`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  // Unreachable — the loop either returns or throws
  throw lastErr
}
