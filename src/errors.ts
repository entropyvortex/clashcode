/**
 * Custom error classes for structured error handling.
 *
 * All errors extend {@link ClashCodeError} which carries a machine-readable
 * `code` and optional `cause` (via native `Error.cause`). The top-level CLI
 * handler can discriminate on `err instanceof ProviderError` vs
 * `SandboxError` etc. to decide retry strategy and user messaging.
 *
 * @module errors
 */

export interface ClashCodeErrorOptions {
  /** The upstream error that triggered this one (for chaining). */
  cause?: unknown
}

export class ClashCodeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    options?: ClashCodeErrorOptions,
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'ClashCodeError'
  }
}

export class ConfigError extends ClashCodeError {
  constructor(message: string, options?: ClashCodeErrorOptions) {
    super(message, 'CONFIG_ERROR', options)
    this.name = 'ConfigError'
  }
}

export class SandboxError extends ClashCodeError {
  constructor(message: string, options?: ClashCodeErrorOptions) {
    super(message, 'SANDBOX_ERROR', options)
    this.name = 'SandboxError'
  }
}

export class ProviderError extends ClashCodeError {
  /** HTTP status code when the error came from a provider API response. */
  public readonly status?: number

  constructor(message: string, options?: ClashCodeErrorOptions & { status?: number }) {
    super(message, 'PROVIDER_ERROR', options)
    this.name = 'ProviderError'
    if (options?.status !== undefined) this.status = options.status
  }

  /** True when the underlying status suggests a retry might succeed. */
  get isRetryable(): boolean {
    if (this.status === undefined) return false
    return this.status === 429 || (this.status >= 500 && this.status < 600)
  }
}

export class SessionError extends ClashCodeError {
  constructor(message: string, options?: ClashCodeErrorOptions) {
    super(message, 'SESSION_ERROR', options)
    this.name = 'SessionError'
  }
}

export class DebateError extends ClashCodeError {
  constructor(message: string, options?: ClashCodeErrorOptions) {
    super(message, 'DEBATE_ERROR', options)
    this.name = 'DebateError'
  }
}

/**
 * Extract a safe message from an unknown thrown value, unwrapping nested
 * `cause` chains up to {@link depth} levels deep. Non-Error throwables get
 * stringified.
 */
export function errorMessage(err: unknown, depth = 3): string {
  if (err == null) return 'unknown error'
  if (!(err instanceof Error)) return String(err)
  const parts = [err.message]
  let cur: unknown = err.cause
  for (let i = 0; i < depth && cur instanceof Error; i++) {
    parts.push(`caused by: ${cur.message}`)
    cur = cur.cause
  }
  return parts.join(' — ')
}
