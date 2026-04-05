/**
 * Interactive REPL loop — readline, paste detection, slash-command
 * dispatch, and graceful shutdown.
 *
 * Owns zero business logic. Orchestrator / team execution lives in
 * {@link ./turn.ts}; slash commands live in {@link ./commands.ts}.
 *
 * @module cli/repl
 */

import { createInterface } from 'node:readline'
import { banner, c, error } from './ui.js'
import { clearCoordinationView } from './coordination-view.js'
import { completer } from './completer.js'
import { handleCommand } from './commands.js'
import { executeTurn } from './turn.js'
import { info } from './ui.js'
import { AGENT_PRESETS, type Runtime } from './runtime.js'

/** Time window (ms) used to distinguish paste events from typed lines. */
const PASTE_DELAY_MS = 50

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

  // ── Paste-aware line buffering ───────────────────────────────
  // Lines arriving in quick succession are treated as a single paste and
  // joined. This avoids accidentally running the first line as a command
  // when the user pastes multi-line content.
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
      handleLine(runtime, input, goodbye)
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(error(`Unexpected error: ${msg}`))
        })
        .finally(() => {
          if (!exiting) showPrompt()
        })
    }, PASTE_DELAY_MS)
  })

  rl.on('close', goodbye)
  process.on('SIGINT', goodbye)
  process.on('SIGTERM', goodbye)

  showPrompt()

  // Resolve when the process is about to exit. We never actually resolve
  // under normal operation — `goodbye()` calls `process.exit(0)`.
  return new Promise<void>(() => {})
}

/**
 * Route one line of input: slash command → {@link handleCommand}, plain
 * text → {@link executeTurn}.
 */
async function handleLine(runtime: Runtime, line: string, goodbye: () => void): Promise<void> {
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
        consensus: runtime.consensus,
        debateStore: runtime.debateStore,
        orchestrator: runtime.orchestrator,
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

  await executeTurn(runtime, trimmed)
}
