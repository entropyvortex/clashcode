/**
 * Interactive REPL loop — readline, paste detection, slash-command
 * dispatch, ESC-to-cancel, and graceful shutdown.
 *
 * Owns zero business logic. Orchestrator / team execution lives in
 * {@link ./turn.ts}; slash commands live in {@link ./commands.ts}.
 *
 * @module cli/repl
 */

import { createInterface, emitKeypressEvents } from 'node:readline'
import { banner, c, error } from './ui.js'
import { clearCoordinationView } from './coordination-view.js'
import { completer } from './completer.js'
import { handleCommand } from './commands.js'
import { executeTurn } from './turn.js'
import { info } from './ui.js'
import { AGENT_PRESETS, type Runtime } from './runtime.js'

/** Time window (ms) used to distinguish paste events from typed lines. */
const PASTE_DELAY_MS = 50

/** Time window (ms) for double-ESC confirmation. */
const ESC_CONFIRM_MS = 2000

/**
 * Start the interactive REPL. Returns the promise that resolves when the
 * user exits (/exit, Ctrl+C, EOF, or SIGTERM).
 */
export async function runRepl(runtime: Runtime): Promise<void> {
  console.log(banner(runtime.settings.model, runtime.settings.provider))
  const modeLabel = runtime.teamMode
    ? `${c.cyan}team${c.reset} (coder + reviewer + consensus)`
    : `${c.yellow}solo${c.reset} (single agent)`
  console.log(info(`Mode: ${modeLabel} — /team to toggle`))

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    completer,
  })

  const showPrompt = () => process.stdout.write(`${c.green}>${c.reset} `)

  let exiting = false
  const goodbye = () => {
    if (exiting) return
    exiting = true
    clearCoordinationView()
    console.log(`\n${c.dim}Goodbye!${c.reset}`)
    rl.close()
    process.exit(0)
  }

  // ── ESC-to-cancel support ──────────────────────────────────
  //
  // We use readline.emitKeypressEvents + raw mode to intercept ESC while
  // an agent turn is running. Raw mode is enabled when a turn starts and
  // restored when it ends, so readline's normal line-editing still works
  // at the prompt.
  let activeAbort: AbortController | null = null
  let escPending = false
  let escTimer: ReturnType<typeof setTimeout> | null = null
  let running = false

  // Enable keypress events on stdin so we can listen for individual keys.
  emitKeypressEvents(process.stdin)

  process.stdin.on('keypress', (_ch, key: { name?: string; sequence?: string } | undefined) => {
    if (!running || !activeAbort) return
    if (key?.name === 'escape') {
      handleEsc()
    }
  })

  function handleEsc(): void {
    if (!activeAbort) return

    if (escPending) {
      // Second ESC — abort (view already cleared on first ESC)
      escPending = false
      if (escTimer) {
        clearTimeout(escTimer)
        escTimer = null
      }
      process.stderr.write(`${c.red}${c.bold}Cancelled.${c.reset}\n`)
      activeAbort.abort()
      return
    }

    // First ESC — stop the TUI animation before writing anything, then prompt
    clearCoordinationView()
    escPending = true
    process.stderr.write(`${c.yellow}Cancel? Press ESC again to confirm${c.reset}\n`)
    escTimer = setTimeout(() => {
      escPending = false
      escTimer = null
    }, ESC_CONFIRM_MS)
  }

  /** Enable raw mode so individual keystrokes (ESC) are delivered immediately. */
  function enterRawMode(): void {
    if (process.stdin.isTTY) process.stdin.setRawMode(true)
  }

  /** Restore cooked mode when the turn is over. */
  function exitRawMode(): void {
    if (process.stdin.isTTY) process.stdin.setRawMode(false)
  }

  // ── Paste-aware line buffering ───────────────────────────────
  const lineBuffer: string[] = []
  let pasteTimer: ReturnType<typeof setTimeout> | null = null

  rl.on('line', (line: string) => {
    lineBuffer.push(line)
    if (pasteTimer) clearTimeout(pasteTimer)
    pasteTimer = setTimeout(() => {
      const lines = lineBuffer.splice(0)
      pasteTimer = null
      if (lines.length === 0) {
        showPrompt()
        return
      }
      const input =
        lines.length === 1
          ? lines[0]!.trim()
          : (console.log(`${c.dim}[pasted ${lines.length} lines]${c.reset}`),
            lines.join('\n').trim())
      if (!input) {
        showPrompt()
        return
      }

      // Create an AbortController for this operation
      const abort = new AbortController()
      activeAbort = abort
      running = true
      enterRawMode()

      handleLine(runtime, input, goodbye, abort.signal)
        .catch((err) => {
          if (abort.signal.aborted) {
            clearCoordinationView()
            return
          }
          const msg = err instanceof Error ? err.message : String(err)
          console.error(error(`Unexpected error: ${msg}`))
        })
        .finally(() => {
          exitRawMode()
          activeAbort = null
          running = false
          escPending = false
          if (escTimer) {
            clearTimeout(escTimer)
            escTimer = null
          }
          if (!exiting) showPrompt()
        })
    }, PASTE_DELAY_MS)
  })

  rl.on('close', goodbye)
  process.on('SIGINT', goodbye)
  process.on('SIGTERM', goodbye)

  showPrompt()

  return new Promise<void>(() => {})
}

/**
 * Route one line of input: slash command → {@link handleCommand}, plain
 * text → {@link executeTurn}.
 */
async function handleLine(
  runtime: Runtime,
  line: string,
  goodbye: () => void,
  signal?: AbortSignal,
): Promise<void> {
  const trimmed = line.trim()
  if (!trimmed) return

  if (trimmed.startsWith('/')) {
    try {
      const result = await handleCommand(trimmed, {
        settings: runtime.settings,
        projectRoot: runtime.projectRoot,
        sessionStore: runtime.store,
        currentSessionId: runtime.session.id,
        teamMode: runtime.teamMode,
        teamConfig: runtime.teamConfig,
        agentPresets: AGENT_PRESETS,
        model: runtime.settings.model,
        engine: runtime.engine,
        debateStore: runtime.debateStore,
      })
      console.log(result.output)
      if (result.updatedSettings) Object.assign(runtime.settings, result.updatedSettings)
      if (result.newSessionId) {
        const newSession = runtime.store.get(result.newSessionId)
        if (newSession) runtime.session = newSession
      }
      if (result.teamModeChanged !== undefined) runtime.teamMode = result.teamModeChanged
      if (result.updatedTeamConfig) runtime.teamConfig = result.updatedTeamConfig
      if (result.shouldExit) goodbye()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(error(msg))
    }
    return
  }

  await executeTurn(runtime, trimmed, signal)
}
