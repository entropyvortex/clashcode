/**
 * Live coordination view — animated ASCII mission control.
 *
 * Renders a vertical stack of agent cards with live status,
 * per-agent token counters, individual timers, and a global
 * summary bar. Adapts to terminal width automatically.
 *
 * All output goes to stderr so stdout piping stays clean.
 *
 * @module cli/coordination-view
 */

import { c } from './ui.js'

// ── Types ───────────────────────────────────────────────────

export interface AgentStatus {
  name: string
  role: string
  state: 'idle' | 'thinking' | 'tool_call' | 'done' | 'error'
  detail?: string
}

export interface ViewEvent {
  type:
    | 'agent_start'
    | 'agent_complete'
    | 'task_start'
    | 'task_complete'
    | 'task_retry'
    | 'message'
    | 'error'
    | 'consensus_update'
  agent?: string
  task?: string
  data?: unknown
}

/** Live consensus sub-panel state (populated when /consensus is running). */
export interface ConsensusState {
  personas: string[]
  currentRound: number
  totalRounds: number
  phase: string
  convergence: number // 0-100
}

/** Per-agent diagnostics tracked during the run. */
interface AgentDiag {
  tokensIn: number
  tokensOut: number
  startedAt: number | null
  elapsed: number // seconds, updated on complete or each tick
  toolCalls: number
}

interface ViewState {
  task: string
  agents: Map<string, AgentStatus>
  diag: Map<string, AgentDiag>
  messages: number
  handoffs: number
  totalToolCalls: number
  totalTokensIn: number
  totalTokensOut: number
  startTime: number
  ticks: number
  events: string[]
  consensus: ConsensusState | null
}

// ── Constants ───────────────────────────────────────────────

/**
 * Frame refresh interval in milliseconds.
 *
 * Override with `CLASHCODE_FRAME_MS` (clamped 50-2000ms). Lower values
 * give smoother timers at the cost of more stderr bytes; higher values
 * are friendlier to slow terminals and screen recorders.
 */
const FRAME_MS = (() => {
  const raw = process.env['CLASHCODE_FRAME_MS']
  if (!raw) return 250
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return 250
  return Math.min(Math.max(n, 50), 2000)
})()

const MAX_EVENTS = 4

const ROLE_STYLE: Record<string, [string, string]> = {
  coder: ['◆', c.green],
  reviewer: ['◇', c.yellow],
  coordinator: ['●', c.cyan],
  assistant: ['◆', c.blue],
  consensus: ['◎', c.cyan],
  pragmatist: ['P', c.green],
  'security-maximalist': ['S', c.red],
  'performance-extremist': ['X', c.yellow],
  'elegance-purist': ['E', c.magenta],
  'future-architect': ['F', c.blue],
  'devils-advocate': ['D', c.red],
}

const STATUS_VERBS: Record<string, string[]> = {
  thinking: ['reasoning', 'analyzing', 'evaluating', 'planning'],
  tool_call: ['executing', 'running', 'calling', 'invoking'],
  idle: ['standby'],
  done: ['done'],
  error: ['failed'],
}

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

// ── Module state ────────────────────────────────────────────

let state: ViewState | null = null
let timer: ReturnType<typeof setInterval> | null = null
let lineCount = 0

/**
 * Programmatic TUI disable flag. Set to `true` before the first
 * `showCoordinationView()` call to force line-log mode regardless
 * of terminal state. Useful when embedding clashcode as a library
 * or running in environments where ANSI cursor control is unsafe.
 *
 * Once set, cannot be un-set for the lifetime of the process
 * (defensive — avoids mid-render mode switches).
 */
let ttuiDisabled = false

/** Programmatically disable the animated TUI. Irreversible. */
export function disableTUI(): void {
  ttuiDisabled = true
}

/** Check whether the TUI is currently disabled. */
export function isTUIDisabled(): boolean {
  return ttuiDisabled || !INTERACTIVE
}

/**
 * True when stderr is an interactive TTY and NO_COLOR/CI overrides are
 * not set. Drives the animated ANSI view vs the line-log fallback.
 *
 * Rationale: piping to a file, redirecting to a log collector, or
 * running under a CI logger all produce mangled output when we emit
 * cursor-up escapes. Detect up-front and degrade gracefully.
 */
function isInteractive(): boolean {
  if (process.env['CLASHCODE_FORCE_TUI'] === '1') return true
  if (process.env['CLASHCODE_NO_TUI'] === '1') return false
  // NO_ANIMATION implies no TUI (spec-compliant: anything that would animate).
  if (process.env['CLASHCODE_NO_ANIMATION'] === '1') return false
  // NO_COLOR is a de-facto standard (https://no-color.org/) — respect it
  // as a strong signal the stream isn't a human-interactive terminal.
  if (process.env['NO_COLOR']) return false
  if (process.env['CI']) return false
  // Dumb terminals can't handle cursor movement.
  if (process.env['TERM'] === 'dumb') return false
  return Boolean(process.stderr.isTTY)
}

const INTERACTIVE = isInteractive()

// ── Public API ──────────────────────────────────────────────

export function showCoordinationView(task: string, agents?: AgentStatus[]): void {
  if (timer) clearCoordinationView()

  const agentMap = new Map<string, AgentStatus>()
  const diagMap = new Map<string, AgentDiag>()

  const roster =
    agents && agents.length > 0
      ? agents
      : [{ name: 'assistant', role: 'assistant', state: 'thinking' as const }]

  for (const a of roster) {
    agentMap.set(a.name, a)
    diagMap.set(a.name, { tokensIn: 0, tokensOut: 0, startedAt: null, elapsed: 0, toolCalls: 0 })
  }

  state = {
    task: task.length > 72 ? task.slice(0, 69) + '...' : task,
    agents: agentMap,
    diag: diagMap,
    messages: 0,
    handoffs: 0,
    totalToolCalls: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    startTime: Date.now(),
    ticks: 0,
    events: [],
    consensus: null,
  }

  if (INTERACTIVE && !ttuiDisabled) {
    process.stderr.write('\x1b[?25l') // hide cursor
    render()
    timer = setInterval(() => {
      if (!state) return
      state.ticks++
      render()
    }, FRAME_MS)
  } else {
    // Line-log fallback — one message per meaningful event, no animation.
    process.stderr.write(`[clashcode] task: ${state.task}\n`)
    const names = [...state.agents.keys()].join(', ')
    process.stderr.write(`[clashcode] agents: ${names}\n`)
  }
}

export function feedEvent(event: ViewEvent): void {
  if (!state) return
  const { type, agent, task, data } = event
  const now = Date.now()

  switch (type) {
    case 'agent_start': {
      const name = agent ?? 'unknown'
      const existing = state.agents.get(name)
      if (existing) {
        existing.state = 'thinking'
        existing.detail = undefined
      } else {
        state.agents.set(name, { name, role: name, state: 'thinking' })
      }
      const d = state.diag.get(name) ?? {
        tokensIn: 0,
        tokensOut: 0,
        startedAt: null,
        elapsed: 0,
        toolCalls: 0,
      }
      d.startedAt = now
      state.diag.set(name, d)
      pushEvent(state, `${name} started`)
      break
    }

    case 'agent_complete': {
      const name = agent ?? 'unknown'
      const a = state.agents.get(name)
      if (a) a.state = 'done'
      const d = state.diag.get(name)
      if (d && d.startedAt) {
        d.elapsed += (now - d.startedAt) / 1000
        d.startedAt = null
      }
      // Try to extract token usage from data (with runtime type checks)
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const obj = data as Record<string, unknown>
        const tu = obj['tokenUsage']
        if (tu && typeof tu === 'object' && !Array.isArray(tu)) {
          const tok = tu as Record<string, unknown>
          const din = typeof tok['input_tokens'] === 'number' ? tok['input_tokens'] : 0
          const dout = typeof tok['output_tokens'] === 'number' ? tok['output_tokens'] : 0
          if (d) {
            d.tokensIn += din
            d.tokensOut += dout
          }
          state.totalTokensIn += din
          state.totalTokensOut += dout
        }
      }
      pushEvent(state, `${name} done`)
      break
    }

    case 'task_start': {
      const label = task ?? (typeof data === 'string' ? data : 'task')
      pushEvent(state, `task: ${label.length > 40 ? label.slice(0, 37) + '...' : label}`)
      break
    }

    case 'task_complete': {
      state.handoffs++
      pushEvent(state, 'task complete')
      break
    }

    case 'task_retry': {
      pushEvent(state, `retry: ${task ?? 'task'}`)
      break
    }

    case 'message': {
      state.messages++
      if (typeof data === 'string' && data.includes('tool')) {
        state.totalToolCalls++
        const a = agent ? state.agents.get(agent) : undefined
        if (a) {
          a.state = 'tool_call'
          a.detail = data.slice(0, 30)
        }
        const d = agent ? state.diag.get(agent) : undefined
        if (d) d.toolCalls++
      }
      break
    }

    case 'consensus_update': {
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const obj = data as Record<string, unknown>
        const personas = Array.isArray(obj['personas'])
          ? (obj['personas'] as unknown[]).filter((x): x is string => typeof x === 'string')
          : (state.consensus?.personas ?? [])
        const currentRound =
          typeof obj['currentRound'] === 'number'
            ? obj['currentRound']
            : (state.consensus?.currentRound ?? 0)
        const totalRounds =
          typeof obj['totalRounds'] === 'number'
            ? obj['totalRounds']
            : (state.consensus?.totalRounds ?? 0)
        const phase =
          typeof obj['phase'] === 'string' ? obj['phase'] : (state.consensus?.phase ?? '')
        const convergence =
          typeof obj['convergence'] === 'number'
            ? obj['convergence']
            : (state.consensus?.convergence ?? 0)
        state.consensus = { personas, currentRound, totalRounds, phase, convergence }
      }
      break
    }

    case 'error': {
      const name = agent ?? 'system'
      const a = state.agents.get(name)
      if (a) a.state = 'error'
      pushEvent(state, `error: ${typeof data === 'string' ? data.slice(0, 40) : 'unknown'}`)
      break
    }
  }
}

export function clearCoordinationView(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (INTERACTIVE && !ttuiDisabled) {
    if (lineCount > 0) {
      process.stderr.write(`\x1b[${lineCount}A`)
      for (let i = 0; i < lineCount; i++) process.stderr.write('\x1b[2K\n')
      process.stderr.write(`\x1b[${lineCount}A`)
    }
    process.stderr.write('\x1b[?25h')
  }
  state = null
  lineCount = 0
}

/**
 * Freeze the view in place showing final metrics. Stops the animation
 * timer and does one last render, but leaves all output on screen and
 * cursor below the panel so the final result is visible. Call this
 * instead of clearCoordinationView() when a run completes successfully.
 */
export function freezeCoordinationView(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (state) {
    // Close out any still-running agents (shouldn't happen, but be safe)
    const now = Date.now()
    for (const [, d] of state.diag) {
      if (d.startedAt) {
        d.elapsed += (now - d.startedAt) / 1000
        d.startedAt = null
      }
    }
    render()
  }
  if (INTERACTIVE && !ttuiDisabled) process.stderr.write('\x1b[?25h')
  state = null
  lineCount = 0
}

// ── Rendering ───────────────────────────────────────────────

function render(): void {
  if (!state || !INTERACTIVE || ttuiDisabled) return

  const W = Math.min(process.stderr.columns || 80, 80)
  const IW = W - 4 // inner width between the two │ chars
  const t = state.ticks
  const elapsed = (Date.now() - state.startTime) / 1000
  const lines: string[] = []

  /** Pad (or truncate) content to exactly IW visible chars, wrapped in │...│ */
  function padLine(content: string): string {
    const vis = stripAnsi(content).length
    const padded = vis >= IW ? content : content + ' '.repeat(IW - vis)
    return `  ${c.dim}│${c.reset}${padded}${c.dim}│${c.reset}`
  }

  /** Horizontal rule: ├───┤ or ╭───╮ etc */
  function rule(left: string, right: string): string {
    return `  ${c.dim}${left}${'─'.repeat(IW)}${right}${c.reset}`
  }

  // ── Header ──
  lines.push('')
  const headerLabel = `─ ${c.reset}${c.bold}${c.cyan}Orchestrator${c.reset}${c.dim} `
  const headerLabelVis = 2 + 'Orchestrator'.length + 1 // "─ Orchestrator "
  lines.push(`  ${c.dim}╭${headerLabel}${'─'.repeat(Math.max(0, IW - headerLabelVis))}╮${c.reset}`)
  lines.push(padLine(` ${c.dim}task:${c.reset} ${state.task}`))
  lines.push(rule('├', '┤'))

  // ── Consensus sub-panel (if active) ──
  if (state.consensus) {
    const cs = state.consensus
    // Round counter + phase
    const roundLabel = `${c.dim}round${c.reset} ${c.bold}${c.cyan}${cs.currentRound}${c.reset}${c.dim}/${cs.totalRounds}${c.reset}`
    const phaseLabel = cs.phase ? ` ${c.dim}·${c.reset} ${c.magenta}${cs.phase}${c.reset}` : ''
    lines.push(padLine(` ${c.dim}consensus${c.reset}  ${roundLabel}${phaseLabel}`))

    // Persona list (truncated to fit)
    if (cs.personas.length > 0) {
      const personaStr = cs.personas.join(`${c.dim}, ${c.reset}${c.cyan}`)
      const fullLine = ` ${c.dim}personas${c.reset}  ${c.cyan}${personaStr}${c.reset}`
      const visLen = stripAnsi(fullLine).length
      if (visLen <= IW) {
        lines.push(padLine(fullLine))
      } else {
        // Truncate
        const plain = ` personas  ${cs.personas.join(', ')}`
        const truncated = plain.slice(0, IW - 3) + '...'
        lines.push(
          padLine(` ${c.dim}personas${c.reset}  ${c.cyan}${truncated.slice(11)}${c.reset}`),
        )
      }
    }

    // Consensus % bar
    const barLabel = ' convergence'
    const pctStr = `${cs.convergence}%`
    // Reserve: 1 space + label(10) + 2 spaces + bar + 1 space + pct + 1 space
    const barWidth = Math.max(8, IW - 1 - barLabel.length - 2 - 1 - pctStr.length - 1)
    const filled = Math.round((cs.convergence / 100) * barWidth)
    const empty = barWidth - filled
    const barColor = cs.convergence >= 70 ? c.green : cs.convergence >= 45 ? c.yellow : c.red
    const bar = `${barColor}${'█'.repeat(filled)}${c.dim}${'░'.repeat(empty)}${c.reset}`
    lines.push(
      padLine(` ${c.dim}${barLabel.trim()}${c.reset} ${bar} ${barColor}${pctStr}${c.reset} `),
    )

    lines.push(rule('├', '┤'))
  }

  // ── Agent cards (vertical stack — scales to any width) ──
  const agentList = [...state.agents.values()]

  for (let i = 0; i < agentList.length; i++) {
    const agent = agentList[i]!
    const diag = state.diag.get(agent.name)
    const [icon, color] = ROLE_STYLE[agent.role] ?? ROLE_STYLE[agent.name] ?? ['○', c.white]

    const isActive = agent.state === 'thinking' || agent.state === 'tool_call'
    const spin = isActive
      ? SPIN[t % SPIN.length]!
      : agent.state === 'done'
        ? '✓'
        : agent.state === 'error'
          ? '✗'
          : '·'
    const spinCol = agent.state === 'done' ? c.green : agent.state === 'error' ? c.red : color

    const verbs = STATUS_VERBS[agent.state] ?? ['working']
    const verb = verbs[t % verbs.length]!

    // Line 1: icon, name, status verb, per-agent timer
    let displayElapsed = diag ? diag.elapsed : 0
    if (diag && diag.startedAt) displayElapsed += (Date.now() - diag.startedAt) / 1000
    const agentTime = fmtTime(displayElapsed)
    const namePart = `${spinCol}${spin}${c.reset} ${color}${icon}${c.reset} ${c.bold}${agent.name}${c.reset}`
    const statusPart = `${c.dim}${verb}${c.reset}`
    const timePart = `${c.dim}${agentTime}${c.reset}`
    const nameVis = 2 + 2 + agent.name.length // spin + space + icon + space + name
    const statusVis = verb.length
    const timeVis = agentTime.length
    const gap1 = Math.max(1, IW - 2 - nameVis - statusVis - timeVis - 2)
    lines.push(padLine(` ${namePart}${' '.repeat(gap1)}${statusPart}  ${timePart} `))

    // Line 2: token stats + tool calls
    if (diag) {
      const tIn = fmtTokens(diag.tokensIn)
      const tOut = fmtTokens(diag.tokensOut)
      const tools = diag.toolCalls
      const statsStr = `${c.dim}in:${c.reset}${c.cyan}${tIn}${c.reset} ${c.dim}out:${c.reset}${c.cyan}${tOut}${c.reset} ${c.dim}tools:${c.reset}${c.cyan}${tools}${c.reset}`
      lines.push(padLine(`   ${statsStr}`))
    }

    // Separator between agents
    if (i < agentList.length - 1) {
      lines.push(padLine(`   ${c.dim}${'·'.repeat(Math.max(0, IW - 3))}${c.reset}`))
    }
  }

  // ── Totals bar ──
  lines.push(rule('├', '┤'))

  const active = agentList.filter((a) => a.state === 'thinking' || a.state === 'tool_call').length
  const tTotalIn = fmtTokens(state.totalTokensIn)
  const tTotalOut = fmtTokens(state.totalTokensOut)
  const elapsedStr = fmtTime(elapsed)

  const totalsStr = [
    `${c.cyan}${active}${c.reset}${c.dim} active${c.reset}`,
    `${c.dim}in:${c.reset}${c.cyan}${tTotalIn}${c.reset}`,
    `${c.dim}out:${c.reset}${c.cyan}${tTotalOut}${c.reset}`,
    `${c.cyan}${state.messages}${c.reset}${c.dim} msgs${c.reset}`,
    `${c.cyan}${state.totalToolCalls}${c.reset}${c.dim} tools${c.reset}`,
    `${c.bold}${elapsedStr}${c.reset}`,
  ].join(`${c.dim} · ${c.reset}`)
  lines.push(padLine(` ${totalsStr}`))

  // ── Event log ──
  if (state.events.length > 0) {
    lines.push(rule('├', '┤'))
    for (const ev of state.events) {
      const evTrunc = ev.length > IW - 4 ? ev.slice(0, IW - 7) + '...' : ev
      lines.push(padLine(` ${c.dim}▸ ${evTrunc}${c.reset}`))
    }
  }

  // ── Footer ──
  lines.push(`  ${c.dim}╰${'─'.repeat(IW)}╯${c.reset}`)
  lines.push('')

  // ── Write ──
  if (lineCount > 0) {
    process.stderr.write(`\x1b[${lineCount}A`)
  }
  for (const ln of lines) {
    process.stderr.write(`\x1b[2K${ln}\n`)
  }
  lineCount = lines.length
}

// ── Helpers ─────────────────────────────────────────────────

function pushEvent(s: ViewState, msg: string): void {
  s.events.push(msg)
  if (s.events.length > MAX_EVENTS) s.events.shift()
  // In non-interactive mode, stream events to stderr line-by-line so
  // piped logs / CI output see progress.
  if (!INTERACTIVE || ttuiDisabled) {
    process.stderr.write(`[clashcode] ${msg}\n`)
  }
}

function fmtTokens(n: number): string {
  if (n === 0) return '0'
  if (n < 1000) return String(n)
  if (n < 100_000) return (n / 1000).toFixed(1) + 'k'
  return (n / 1000).toFixed(0) + 'k'
}

function fmtTime(seconds: number): string {
  if (seconds < 60) return seconds.toFixed(1) + 's'
  const m = Math.floor(seconds / 60)
  const s = (seconds % 60).toFixed(0)
  return `${m}m${s.padStart(2, '0')}s`
}

/** Strip ANSI escape codes for visual width calculation. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}
