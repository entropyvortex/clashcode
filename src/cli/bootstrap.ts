/**
 * CLI bootstrap — arg parsing, logging, telemetry, and global handlers.
 *
 * This module is deliberately side-effect-heavy at its boundaries (installs
 * `process.on(...)` handlers, mutates `LogLevel` state, starts exporters) but
 * pure functions inside. Keeping it isolated means the entrypoint in
 * {@link ./index.ts} stays ~declarative.
 *
 * @module cli/bootstrap
 */

import { parseArgs } from 'node:util'
import { logger, setLogLevel, type LogLevel } from '../logger.js'
import { enableOtelExport, enableSentry } from '../telemetry.js'
import { c, VERSION } from './ui.js'

/** Known providers, re-used by `--provider` validation. */
export const VALID_PROVIDERS = ['grok', 'xai', 'anthropic', 'openai', 'copilot', 'gemini'] as const
export type ValidProvider = (typeof VALID_PROVIDERS)[number]

const VALID_LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent']

export const HELP_TEXT = `
${c.bold}clashcode${c.reset} — multi-agent coding assistant

${c.bold}Usage:${c.reset}
  clashcode [options]
  clashcode init [--interactive]

${c.bold}Commands:${c.reset}
  init             Initialize a new .clashcode/ project directory
  init -i          Guided setup (provider, API key, sandbox, team mode)

${c.bold}Options:${c.reset}
  --help, -h       Show this help message
  --version, -v    Print version
  --model <name>   Override LLM model for this run
  --provider <p>   Override LLM provider (${VALID_PROVIDERS.join('|')})
  --log-level <l>  ${VALID_LOG_LEVELS.join('|')} (env: CLASHCODE_LOG_LEVEL)
  --reset          Start a fresh session, ignoring any resumable one

${c.bold}Environment:${c.reset}
  CLASHCODE_LOG_LEVEL          Default log level
  CLASHCODE_NO_TUI=1           Disable live coordination view (line-log mode)
  CLASHCODE_FORCE_TUI=1        Force live view even on non-TTY streams
  CLASHCODE_NO_ANIMATION=1     Disable spinner animations (implies NO_TUI)
  CLASHCODE_FRAME_MS           Coordination view refresh interval, 50-2000 (default 250)
  CLASHCODE_ACK_LOCAL_SANDBOX=1  Silence the unsafe-sandbox warning
  CLASHCODE_OTEL_ENDPOINT      OTLP endpoint for metric export (optional)
  CLASHCODE_SENTRY_DSN         Sentry DSN for error reporting (optional)
  NO_COLOR                     Standard; disables the live view (https://no-color.org/)
`

/** Parsed CLI flags. */
export interface ParsedArgs {
  help: boolean
  version: boolean
  model?: string
  provider?: ValidProvider
  logLevel?: LogLevel
  reset: boolean
}

/**
 * Parse command-line flags. Returns `null` if a flag is invalid (caller
 * should exit); invalid flags are reported via {@link logger}.
 */
export function parseCliArgs(argv: string[] = process.argv): ParsedArgs | null {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      model: { type: 'string' },
      provider: { type: 'string' },
      'log-level': { type: 'string' },
      reset: { type: 'boolean', default: false },
    },
    strict: false,
  })

  const parsed: ParsedArgs = {
    help: Boolean(values.help),
    version: Boolean(values.version),
    reset: Boolean(values.reset),
  }

  if (typeof values.model === 'string' && values.model.trim()) {
    parsed.model = values.model.trim()
  }

  if (typeof values.provider === 'string') {
    const p = values.provider.trim()
    if (!isValidProvider(p)) {
      logger.error(`Invalid --provider "${p}". Valid: ${VALID_PROVIDERS.join(', ')}`)
      return null
    }
    parsed.provider = p
  }

  if (typeof values['log-level'] === 'string') {
    const lvl = values['log-level'].trim()
    if (!isValidLogLevel(lvl)) {
      logger.warn(`Invalid --log-level "${lvl}". Valid: ${VALID_LOG_LEVELS.join(', ')}`)
    } else {
      parsed.logLevel = lvl
    }
  }

  return parsed
}

/** Type-guard for {@link ValidProvider}. Exported for reuse in commands. */
export function isValidProvider(value: string): value is ValidProvider {
  return (VALID_PROVIDERS as readonly string[]).includes(value)
}

/** Type-guard for {@link LogLevel}. */
export function isValidLogLevel(value: string): value is LogLevel {
  return (VALID_LOG_LEVELS as readonly string[]).includes(value)
}

/**
 * Install the process-global unhandled-rejection and uncaught-exception
 * handlers. Idempotent: calling twice is safe (Node de-dupes listeners by
 * identity so we guard manually).
 */
let globalHandlersInstalled = false
export function installGlobalErrorHandlers(): void {
  if (globalHandlersInstalled) return
  globalHandlersInstalled = true

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason)
    logger.error(`Unhandled rejection: ${msg}`)
  })

  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.message}`)
    process.exit(1)
  })
}

/**
 * Start telemetry exporters if the corresponding env vars are set. Both
 * exporters fail open: if the peer dependency isn't installed, we log and
 * continue.
 */
export function maybeEnableTelemetry(): void {
  const otelEndpoint = process.env['CLASHCODE_OTEL_ENDPOINT']
  if (otelEndpoint) {
    void enableOtelExport({
      endpoint: otelEndpoint,
      serviceName: process.env['CLASHCODE_OTEL_SERVICE'] ?? 'clashcode',
    })
  }
  const sentryDsn = process.env['CLASHCODE_SENTRY_DSN']
  if (sentryDsn) {
    void enableSentry({
      dsn: sentryDsn,
      environment: process.env['CLASHCODE_ENV'] ?? 'production',
    })
  }
}

/** Apply a parsed log-level flag. No-op when undefined. */
export function applyLogLevel(level: LogLevel | undefined): void {
  if (level) setLogLevel(level)
}

/** Re-export VERSION for entrypoint `--version`. */
export { VERSION }
