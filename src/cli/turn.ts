/**
 * Per-turn execution — takes a user message and drives it through either
 * the solo agent or the multi-agent squad, rendering the live coordination
 * view, handling cache hits, and printing the diagnostics panel.
 *
 * v1.3: Powered by ClashEngine. No more coordinator-model override hack.
 * Team names use crypto UUIDs for concurrent turn safety.
 *
 * @module cli/turn
 */

import { randomUUID } from 'node:crypto'
import {
  showCoordinationView,
  freezeCoordinationView,
  clearCoordinationView,
  type AgentStatus,
} from './coordination-view.js'
import { c, error, formatResponse } from './ui.js'
import { TeamCache } from '../state/team-cache.js'
import type { Runtime } from './runtime.js'

interface TurnTokens {
  tokIn: number
  tokOut: number
}

/**
 * Execute one user turn. Appends the user message to the session, runs
 * either the solo agent or the team, prints the response, and updates
 * session token counters.
 *
 * Accepts an optional `AbortSignal` for ESC-to-cancel support.
 */
export async function executeTurn(
  runtime: Runtime,
  userMessage: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    runtime.store.append(runtime.session.id, { role: 'user', content: userMessage })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(error(`Failed to save message: ${msg}`))
    return
  }

  const viewAgents: AgentStatus[] = runtime.teamMode
    ? runtime.teamConfig.agents.map((a) => ({
        name: a.name,
        role: a.name,
        state: 'idle' as const,
      }))
    : [{ name: 'assistant', role: 'assistant', state: 'thinking' as const }]

  showCoordinationView(userMessage, viewAgents)
  const runStart = Date.now()

  try {
    // Check for cancellation before starting
    if (signal?.aborted) throw new Error('Cancelled')

    const { output, summary, tokens } = runtime.teamMode
      ? await runTeamTurn(runtime, userMessage, runStart, signal)
      : await runSoloTurn(runtime, userMessage, runStart, signal)

    freezeCoordinationView()
    console.log(summary)
    runtime.store.append(runtime.session.id, { role: 'assistant', content: output })
    runtime.store.addTokens(runtime.session.id, tokens.tokIn, tokens.tokOut)
    console.log(formatResponse(output))
  } catch (err) {
    clearCoordinationView()
    // Abort errors from ESC-to-cancel are handled by the REPL
    if (signal?.aborted) return
    const msg = err instanceof Error ? err.message : String(err)
    console.error(error(msg))
  }
}

interface TurnResult {
  output: string
  summary: string
  tokens: TurnTokens
}

async function runSoloTurn(
  runtime: Runtime,
  userMessage: string,
  runStart: number,
  signal?: AbortSignal,
): Promise<TurnResult> {
  const result = await runtime.engine.executeAgent(runtime.soloAgent, userMessage, signal)
  const tu = result.tokenUsage
  const elapsed = ((Date.now() - runStart) / 1000).toFixed(1)
  const summary =
    `${c.dim}${elapsed}s · ${tu.input_tokens} in + ${tu.output_tokens} out · ` +
    `${result.toolCalls.length} tool calls${c.reset}`
  return {
    output: result.output,
    summary,
    tokens: { tokIn: tu.input_tokens, tokOut: tu.output_tokens },
  }
}

async function runTeamTurn(
  runtime: Runtime,
  userMessage: string,
  runStart: number,
  signal?: AbortSignal,
): Promise<TurnResult> {
  // ── Cache probe ──────────────────────────────────────────────
  const cacheKey = TeamCache.key(userMessage, runtime.teamConfig.agents, runtime.settings.model)
  const cached = runtime.settings.cacheWorkerOutputs ? runtime.teamCache.get(cacheKey) : null
  if (cached) {
    return {
      output: cached.output,
      summary:
        `${c.dim}[cache hit]${c.reset}${c.dim} orig: ${cached.elapsed.toFixed(1)}s · ` +
        `${cached.tokIn} in + ${cached.tokOut} out${c.reset}`,
      tokens: { tokIn: 0, tokOut: 0 },
    }
  }

  // ── Fresh run via ClashEngine ────────────────────────────────
  const teamName = `${runtime.teamConfig.name}-${randomUUID().slice(0, 8)}`
  const runConfig = { ...runtime.teamConfig, name: teamName }

  const result = await runtime.engine.executeSquad(
    runConfig,
    userMessage,
    runtime.settings.coordinatorModel ?? undefined,
    signal,
  )

  // Extract coordinator output as final answer
  const output =
    result.agentResults.get('coordinator')?.output ??
    [...result.agentResults.values()].find((r) => r.output)?.output ??
    '(no output)'

  const tu = result.totalTokenUsage
  const elapsed = (Date.now() - runStart) / 1000
  const agents = [...result.agentResults.entries()]
    .map(([name, r]) => `${name}: ${r.tokenUsage.input_tokens}+${r.tokenUsage.output_tokens}`)
    .join(', ')
  const summary =
    `${c.dim}${elapsed.toFixed(1)}s · ${tu.input_tokens} in + ${tu.output_tokens} out · ` +
    `${agents}${c.reset}`

  if (runtime.settings.diagnostics) {
    printDiagnosticsPanel(runtime, result, elapsed, tu)
  }

  if (runtime.settings.cacheWorkerOutputs) {
    runtime.teamCache.set(cacheKey, {
      output,
      tokIn: tu.input_tokens,
      tokOut: tu.output_tokens,
      agentBreakdown: agents,
      elapsed,
    })
  }

  return {
    output,
    summary,
    tokens: { tokIn: tu.input_tokens, tokOut: tu.output_tokens },
  }
}

interface SquadResultShape {
  agentResults: Map<
    string,
    {
      tokenUsage: { input_tokens: number; output_tokens: number }
      toolCalls?: unknown[]
    }
  >
}

function printDiagnosticsPanel(
  runtime: Runtime,
  result: SquadResultShape,
  elapsed: number,
  totalUsage: { input_tokens: number; output_tokens: number },
): void {
  const lines: string[] = []
  lines.push(
    `${c.bold}${c.magenta}▸ diagnostics${c.reset}  ${c.dim}total ${elapsed.toFixed(2)}s · ` +
      `${totalUsage.input_tokens.toLocaleString()} in + ` +
      `${totalUsage.output_tokens.toLocaleString()} out${c.reset}`,
  )
  const totalTokens = totalUsage.input_tokens + totalUsage.output_tokens || 1
  for (const [name, r] of result.agentResults.entries()) {
    const aIn = r.tokenUsage.input_tokens ?? 0
    const aOut = r.tokenUsage.output_tokens ?? 0
    const aTot = aIn + aOut
    const aPct = ((aTot / totalTokens) * 100).toFixed(1)
    const tools = r.toolCalls?.length ?? 0
    const modelUsed =
      name === 'coordinator' && runtime.settings.coordinatorModel
        ? runtime.settings.coordinatorModel
        : runtime.settings.model
    const nameCol = name === 'coordinator' ? c.yellow : c.cyan
    lines.push(
      `  ${nameCol}${name.padEnd(22)}${c.reset} ` +
        `${c.dim}in:${c.reset}${aIn.toString().padStart(6)} ` +
        `${c.dim}out:${c.reset}${aOut.toString().padStart(6)} ` +
        `${c.dim}tools:${c.reset}${tools.toString().padStart(2)}  ` +
        `${c.dim}${aPct}%${c.reset}  ` +
        `${c.dim}${modelUsed}${c.reset}`,
    )
  }
  console.log('\n' + lines.join('\n') + '\n')
}
