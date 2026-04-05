/**
 * ClashCode CLI entrypoint.
 *
 * Kept intentionally thin. Each step delegates to a focused module:
 *
 *   parseCliArgs → bootstrap
 *   buildRuntime → runtime
 *   runRepl      → repl → turn / commands
 *
 * See `ARCHITECTURE.md` for the full module map.
 *
 * @module cli
 */

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  HELP_TEXT,
  VERSION,
  applyLogLevel,
  installGlobalErrorHandlers,
  maybeEnableTelemetry,
  parseCliArgs,
} from './bootstrap.js'
import { buildRuntime } from './runtime.js'
import { runRepl } from './repl.js'
import { DEFAULT_SETTINGS, saveSettings } from '../config/index.js'
import { c, dim, info, success, error } from './ui.js'

installGlobalErrorHandlers()

/** Run the `clashcode init` flow (non-interactive default). */
function runInit(): void {
  const projectRoot = process.cwd()
  const clashcodeDir = join(projectRoot, '.clashcode')

  console.log(`\n${c.bold}${c.cyan}ClashCode${c.reset} — project initialisation\n`)

  if (existsSync(join(clashcodeDir, 'settings.json'))) {
    console.log(info('Already initialized — .clashcode/settings.json exists.'))
    return
  }

  mkdirSync(clashcodeDir, { recursive: true })
  mkdirSync(join(clashcodeDir, 'sessions'), { recursive: true })
  saveSettings(projectRoot, { ...DEFAULT_SETTINGS })

  console.log(success('Initialized .clashcode/ directory'))
  console.log(`
${dim('Next steps:')}
  1. Run ${c.cyan}clashcode init --interactive${c.reset} for guided provider/key setup,
     or edit ${c.cyan}.clashcode/settings.json${c.reset} manually
  2. Run ${c.cyan}clashcode${c.reset} to start a session
`)
}

/** Run the interactive `clashcode init --interactive` wizard. */
async function runInitInteractive(): Promise<void> {
  const projectRoot = process.cwd()
  const clashcodeDir = join(projectRoot, '.clashcode')
  mkdirSync(clashcodeDir, { recursive: true })
  mkdirSync(join(clashcodeDir, 'sessions'), { recursive: true })
  const { runInteractiveInit } = await import('./init-interactive.js')
  await runInteractiveInit(projectRoot)
}

export async function main(): Promise<void> {
  // ── `init` subcommand short-circuits before flag parsing ─────
  if (process.argv[2] === 'init') {
    const isInteractive = process.argv.includes('--interactive') || process.argv.includes('-i')
    if (isInteractive) {
      await runInitInteractive()
    } else {
      runInit()
    }
    return
  }

  const args = parseCliArgs()
  if (args === null) {
    // parseCliArgs already logged the error
    process.exit(1)
  }

  if (args.help) {
    console.log(HELP_TEXT)
    return
  }
  if (args.version) {
    console.log(VERSION)
    return
  }

  applyLogLevel(args.logLevel)
  maybeEnableTelemetry()

  const runtime = await buildRuntime({ projectRoot: process.cwd(), args })
  await runRepl(runtime)
}

main().catch((err) => {
  console.error(error(err instanceof Error ? err.message : String(err)))
  process.exit(1)
})
