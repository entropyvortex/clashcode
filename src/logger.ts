/**
 * Centralized logger for diagnostic output.
 *
 * Writes directly to `process.stderr` so stdout stays clean for piping CLI
 * results. This is separate from user-facing UI (banners, prompts, response
 * panels) — those go through `src/cli/ui.ts` and `console.log` to stdout.
 *
 * The initial level is read from `CLASHCODE_LOG_LEVEL` at module load, or
 * `info` by default. `setLogLevel()` lets callers override at runtime (e.g.
 * from a `--log-level` CLI flag).
 *
 * @module logger
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
}

function resolveInitialLevel(): LogLevel {
  const raw = process.env['CLASHCODE_LOG_LEVEL']?.toLowerCase()
  if (raw && raw in LEVELS) return raw as LogLevel
  return 'info'
}

let currentLevel: LogLevel = resolveInitialLevel()

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

export function getLogLevel(): LogLevel {
  return currentLevel
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel]
}

const PREFIX = '\x1b[90m[clashcode]\x1b[0m'

/** Format arguments into a single string for stderr. Stringifies Errors with stack. */
function fmt(level: string, colour: string, args: unknown[]): string {
  const parts = args.map((a) => {
    if (a instanceof Error) {
      return currentLevel === 'debug' ? (a.stack ?? a.message) : a.message
    }
    if (typeof a === 'string') return a
    try {
      return JSON.stringify(a)
    } catch {
      return String(a)
    }
  })
  return `${PREFIX} ${colour}${level}\x1b[0m ${parts.join(' ')}\n`
}

export const logger = {
  debug: (...args: unknown[]) => {
    if (shouldLog('debug')) process.stderr.write(fmt('DEBUG', '\x1b[36m', args))
  },
  info: (...args: unknown[]) => {
    if (shouldLog('info')) process.stderr.write(fmt('INFO ', '\x1b[34m', args))
  },
  warn: (...args: unknown[]) => {
    if (shouldLog('warn')) process.stderr.write(fmt('WARN ', '\x1b[33m', args))
  },
  error: (...args: unknown[]) => {
    if (shouldLog('error')) process.stderr.write(fmt('ERROR', '\x1b[31m', args))
  },
}
