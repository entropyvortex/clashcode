import { type Settings, updateSetting } from '../config/index.js'
import type { SessionStore } from '../state/index.js'
import { c, box, dim, info, error, success } from './ui.js'
import { fetchModels, formatModelMenu, parseModelChoice, type ModelEntry } from './model-select.js'
import type { AgentSpec, SquadBlueprint } from '../core/clash-engine/index.js'
import type { ClashEngine } from '../core/clash-engine/index.js'
import type { ConsensusEvent } from '../consensus/types.js'
import { formatDebateReport } from '../consensus/index.js'
import { showCoordinationView, feedEvent, freezeCoordinationView } from './coordination-view.js'
import type { AgentStatus } from './coordination-view.js'
import type { DebateStore } from '../consensus/store.js'

import { listPersonas, BUILT_IN_PERSONAS } from '../consensus/personas.js'
import { keychain } from '../config/keychain.js'
import { runDoctor, formatDoctorReport } from './doctor.js'

export interface CommandContext {
  settings: Settings
  projectRoot: string
  sessionStore: SessionStore
  currentSessionId: string | null
  teamMode: boolean
  teamConfig: SquadBlueprint
  agentPresets: Record<string, AgentSpec>
  model: string
  engine: ClashEngine
  debateStore: DebateStore
}

export interface CommandResult {
  output: string
  shouldExit?: boolean
  updatedSettings?: Settings
  newSessionId?: string
  teamModeChanged?: boolean
  updatedTeamConfig?: SquadBlueprint
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '...' + key.slice(-4)
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString()
}

function handleHelp(): CommandResult {
  const commands = [
    ['/help', 'Show all available commands'],
    ['/config', 'Show current configuration'],
    ['/config set <key> <value>', 'Update a setting'],
    ['/model', 'Browse available models from provider'],
    ['/model <name|number>', 'Switch to a model by name or menu number'],
    ['/session', 'List all sessions'],
    ['/session new [title]', 'Create a new session'],
    ['/session delete <id>', 'Delete a session'],
    ['/team [on|off]', 'Show or toggle multi-agent team mode'],
    ['/agent', 'List agents in current team'],
    ['/agent remove <name>', 'Remove agent from team'],
    ['/agent add <name>', 'Add agent back to team'],
    ['/consensus <topic>', 'Run a multi-perspective debate on a topic'],
    ['/debate <topic>', 'Alias for /consensus'],
    ['/convergence', 'Show the last debate convergence-heuristic report'],
    ['/coherence', 'Alias for /convergence (historical)'],
    ['/debates', 'List past debates or view one by ID'],
    ['/perspectives', 'List available debate personas'],
    ['/diagnostics [on|off]', 'Show or toggle per-agent token/time diagnostics'],
    ['/sandbox', 'Show active sandbox backend (docker | shuru | local)'],
    ['/sandbox <backend>', 'Switch sandbox backend (auto|docker|shuru|local)'],
    ['/doctor', 'Run diagnostic self-check (versions, API keys, sandbox, keychain)'],
    ['/keychain', 'Show stored API keys (via keytar)'],
    ['/keychain set <provider> <key>', 'Store API key in OS keychain'],
    ['/keychain delete <provider>', 'Remove API key from keychain'],
    ['/clear', 'Clear the terminal'],
    ['/exit, /quit', 'Exit ClashCode'],
  ]

  const lines = commands
    .map(([cmd, desc]) => `  ${c.cyan}${cmd!.padEnd(30)}${c.reset} ${dim(desc!)}`)
    .join('\n')

  return { output: box('Commands', lines) }
}

function handleConfig(args: string[], ctx: CommandContext): CommandResult {
  if (args[0] === 'set') {
    const key = args[1]
    const rawValue = args.slice(2).join(' ')
    if (!key || !rawValue) {
      return { output: error('Usage: /config set <key> <value>') }
    }
    let value: unknown = rawValue
    if (rawValue === 'true') value = true
    else if (rawValue === 'false') value = false
    else if (rawValue === 'null' || rawValue === 'none') value = null
    else if (/^\d+$/.test(rawValue)) value = Number(rawValue)

    try {
      const updated = updateSetting(ctx.projectRoot, key, value)
      return {
        output: success(`Set ${c.bold}${key}${c.reset} = ${c.cyan}${String(value)}${c.reset}`),
        updatedSettings: updated,
      }
    } catch (e) {
      return { output: error(`Failed to set ${key}: ${(e as Error).message}`) }
    }
  }

  const s = ctx.settings
  const maskedKeys: Record<string, string> = {}
  for (const [provider, key] of Object.entries(s.apiKeys)) {
    maskedKeys[provider] = maskKey(key)
  }

  const lines = [
    `  ${dim('model:')}          ${c.cyan}${s.model}${c.reset}`,
    `  ${dim('provider:')}       ${c.cyan}${s.provider}${c.reset}`,
    `  ${dim('baseUrl:')}        ${c.cyan}${s.baseUrl ?? 'default'}${c.reset}`,
    `  ${dim('apiKeys:')}`,
    ...Object.entries(maskedKeys).map(([p, k]) => `    ${dim(p + ':')}  ${c.yellow}${k}${c.reset}`),
    ...(Object.keys(maskedKeys).length === 0 ? [`    ${dim('(none)')}`] : []),
    `  ${dim('sandbox:')}`,
    `    ${dim('enabled:')}      ${s.sandbox.enabled ? c.green + 'true' : c.red + 'false'}${c.reset}`,
    `    ${dim('backend:')}      ${c.cyan}${s.sandbox.backend}${c.reset}`,
    `    ${dim('persistent:')}   ${s.sandbox.persistent ? c.green + 'true' : c.red + 'false'}${c.reset}`,
    `    ${dim('image:')}        ${c.cyan}${s.sandbox.image}${c.reset} ${dim('(docker)')}`,
    `    ${dim('shuru:')}`,
    `      ${dim('checkpoint:')} ${c.cyan}${s.sandbox.shuru.checkpoint ?? '(none)'}${c.reset}`,
    `      ${dim('cpus:')}       ${c.cyan}${s.sandbox.shuru.cpus}${c.reset}`,
    `      ${dim('memory:')}     ${c.cyan}${s.sandbox.shuru.memory}${c.reset} MB`,
    `      ${dim('allowNet:')}   ${s.sandbox.shuru.allowNet ? c.yellow + 'true' : c.green + 'false'}${c.reset}`,
    `  ${dim('teamMode:')}       ${s.teamMode ? c.green + 'true' : c.yellow + 'false'}${c.reset}`,
    `  ${dim('maxConcurrency:')} ${c.cyan}${s.maxConcurrency}${c.reset}`,
    `  ${dim('diagnostics:')}    ${s.diagnostics ? c.green + 'on' : c.dim + 'off'}${c.reset}`,
    `  ${dim('coordinatorModel:')} ${c.cyan}${s.coordinatorModel ?? '(inherit from model)'}${c.reset}`,
    `  ${dim('cacheWorkerOutputs:')} ${s.cacheWorkerOutputs ? c.green + 'true' : c.yellow + 'false'}${c.reset}`,
  ]

  return { output: box('Configuration', lines.join('\n')) }
}

let cachedModels: ModelEntry[] = []

async function handleModel(args: string[], ctx: CommandContext): Promise<CommandResult> {
  if (args.length === 0) {
    try {
      cachedModels = await fetchModels(ctx.settings)
      const menu = formatModelMenu(cachedModels, ctx.settings.model)
      return { output: menu }
    } catch (e) {
      return {
        output:
          info(`Current model: ${c.bold}${c.cyan}${ctx.settings.model}${c.reset}`) +
          `\n${c.dim}(model discovery failed: ${(e as Error).message})${c.reset}`,
      }
    }
  }

  const input = args.join(' ')
  const choice = parseModelChoice(input, cachedModels)
  if (!choice) {
    return {
      output: error(`Invalid model selection: "${input}". Run /model to see available models.`),
    }
  }

  try {
    const updated = updateSetting(ctx.projectRoot, 'model', choice)
    return {
      output: success(`Model switched to ${c.bold}${c.cyan}${choice}${c.reset}`),
      updatedSettings: updated,
    }
  } catch (e) {
    return { output: error(`Failed to switch model: ${(e as Error).message}`) }
  }
}

function handleSession(args: string[], ctx: CommandContext): CommandResult {
  const sub = args[0]

  if (sub === 'new') {
    const title = args.slice(1).join(' ') || undefined
    try {
      const session = ctx.sessionStore.create(title)
      return {
        output: success(`Created session ${c.cyan}${session.id}${c.reset} — "${session.title}"`),
        newSessionId: session.id,
      }
    } catch (e) {
      return { output: error(`Failed to create session: ${(e as Error).message}`) }
    }
  }

  if (sub === 'delete') {
    const id = args[1]
    if (!id) return { output: error('Usage: /session delete <id>') }
    try {
      const deleted = ctx.sessionStore.delete(id)
      if (!deleted) return { output: error(`Session not found: ${id}`) }
      return { output: success(`Deleted session ${c.cyan}${id}${c.reset}`) }
    } catch (e) {
      return { output: error(`Failed to delete session: ${(e as Error).message}`) }
    }
  }

  try {
    const sessions = ctx.sessionStore.list()
    if (sessions.length === 0) {
      return { output: info('No sessions found. Use /session new to create one.') }
    }

    const formatTokens = (n: number): string => {
      if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
      return String(n)
    }

    const header = `  ${c.bold}${'ID'.padEnd(38)}${'Title'.padEnd(24)}${'Messages'.padEnd(10)}${'Tokens'.padEnd(12)}${'Updated'}${c.reset}`
    const rows = sessions.map((s) => {
      const shortId = s.id.slice(0, 8) + '...'
      const title = s.title.length > 22 ? s.title.slice(0, 20) + '..' : s.title
      const totalTokens = (s.tokensIn ?? 0) + (s.tokensOut ?? 0)
      const tokensStr = totalTokens > 0 ? formatTokens(totalTokens) : '-'
      return `  ${c.cyan}${shortId.padEnd(38)}${c.reset}${title.padEnd(24)}${String(s.messageCount).padEnd(10)}${tokensStr.padEnd(12)}${dim(formatDate(s.updatedAt))}`
    })

    const grandTotal = sessions.reduce((sum, s) => sum + (s.tokensIn ?? 0) + (s.tokensOut ?? 0), 0)
    if (grandTotal > 0) {
      rows.push(
        `  ${''.padEnd(38)}${''.padEnd(24)}${''.padEnd(10)}${c.bold}${formatTokens(grandTotal).padEnd(12)}${c.reset}${dim('total')}`,
      )
    }

    return { output: box('Sessions', [header, ...rows].join('\n')) }
  } catch (e) {
    return { output: error(`Failed to list sessions: ${(e as Error).message}`) }
  }
}

function handleTeam(args: string[], ctx: CommandContext): CommandResult {
  if (args.length === 0) {
    const mode = ctx.teamMode
    const label = mode
      ? `${c.cyan}team${c.reset} (coder + reviewer)`
      : `${c.yellow}solo${c.reset} (single agent)`
    return { output: info(`Current mode: ${label}. Use /team on or /team off to switch.`) }
  }

  const arg = args[0]!.toLowerCase()
  if (arg === 'on') {
    try {
      updateSetting(ctx.projectRoot, 'teamMode', true)
    } catch {
      /* non-fatal */
    }
    return {
      output: success(
        `Switched to ${c.cyan}team${c.reset} mode — coder and reviewer will collaborate.`,
      ),
      teamModeChanged: true,
    }
  }
  if (arg === 'off') {
    try {
      updateSetting(ctx.projectRoot, 'teamMode', false)
    } catch {
      /* non-fatal */
    }
    return {
      output: success(
        `Switched to ${c.yellow}solo${c.reset} mode — single agent, faster and cheaper.`,
      ),
      teamModeChanged: false,
    }
  }

  return { output: error('Usage: /team [on|off]') }
}

function handleAgent(args: string[], ctx: CommandContext): CommandResult {
  const sub = args[0]?.toLowerCase()

  if (sub === 'remove' || sub === 'rm') {
    const name = args[1]
    if (!name) return { output: error('Usage: /agent remove <name>') }
    const current = ctx.teamConfig.agents
    const idx = current.findIndex((a) => a.name === name)
    if (idx === -1) {
      return {
        output: error(
          `Agent "${name}" is not in the team. Current: ${current.map((a) => a.name).join(', ')}`,
        ),
      }
    }
    if (current.length <= 1) {
      return { output: error('Cannot remove the last agent. Team must have at least one agent.') }
    }
    const updated: SquadBlueprint = {
      ...ctx.teamConfig,
      agents: [...current.slice(0, idx), ...current.slice(idx + 1)],
    }
    return {
      output: success(
        `Removed ${c.bold}${name}${c.reset} from team. Roster: ${updated.agents.map((a) => a.name).join(', ')}`,
      ),
      updatedTeamConfig: updated,
    }
  }

  if (sub === 'add') {
    const name = args[1]
    if (!name) {
      const available = Object.keys(ctx.agentPresets).join(', ')
      return { output: error(`Usage: /agent add <name>. Available: ${available}`) }
    }
    const preset = ctx.agentPresets[name]
    if (!preset) {
      const available = Object.keys(ctx.agentPresets).join(', ')
      return { output: error(`Unknown agent "${name}". Available: ${available}`) }
    }
    const current = ctx.teamConfig.agents
    if (current.some((a) => a.name === name)) {
      return { output: info(`Agent "${name}" is already in the team.`) }
    }
    const updated: SquadBlueprint = {
      ...ctx.teamConfig,
      agents: [...current, { ...preset, model: ctx.model }],
    }
    return {
      output: success(
        `Added ${c.bold}${name}${c.reset} to team. Roster: ${updated.agents.map((a) => a.name).join(', ')}`,
      ),
      updatedTeamConfig: updated,
    }
  }

  const current = ctx.teamConfig.agents
  if (current.length === 0) {
    return { output: info('No agents in the team.') }
  }
  const lines = current.map((a) => {
    const tools = (a.tools ?? []).join(', ')
    return `  ${c.cyan}${a.name.padEnd(16)}${c.reset}${c.dim}tools: ${tools}${c.reset}`
  })
  const available = Object.keys(ctx.agentPresets).filter((n) => !current.some((a) => a.name === n))
  if (available.length > 0) {
    lines.push('')
    lines.push(`  ${c.dim}available to add: ${available.join(', ')}${c.reset}`)
  }
  return { output: box('Team Roster', lines.join('\n')) }
}

async function handleConsensus(args: string[], ctx: CommandContext): Promise<CommandResult> {
  if (args.length === 0) {
    return { output: error('Usage: /consensus [rounds] <topic>') }
  }

  let rounds: number | undefined
  let topicArgs = args
  const firstArg = args[0]!
  if (/^\d+$/.test(firstArg) && args.length > 1) {
    rounds = parseInt(firstArg, 10)
    topicArgs = args.slice(1)
  }

  const topic = topicArgs.join(' ')
  if (!topic) {
    return { output: error('Usage: /consensus [rounds] <topic>') }
  }

  try {
    const personaNames = Object.keys(BUILT_IN_PERSONAS)
    const agents: AgentStatus[] = personaNames.map((name) => ({
      name,
      role: name,
      state: 'idle' as const,
    }))
    showCoordinationView(topic, agents)

    const initialRounds = rounds ?? 4
    feedEvent({
      type: 'consensus_update',
      data: {
        personas: personaNames,
        currentRound: 0,
        totalRounds: initialRounds,
        phase: 'starting',
        convergence: 0,
      },
    })

    const onProgress = (event: ConsensusEvent): void => {
      switch (event.type) {
        case 'phase_start':
          feedEvent({ type: 'task_start', task: `Phase: ${event.phase}` })
          feedEvent({
            type: 'consensus_update',
            data: {
              personas: event.personas,
              currentRound: event.round,
              totalRounds: event.totalRounds,
              phase: event.phase,
            },
          })
          break
        case 'persona_start':
          feedEvent({ type: 'agent_start', agent: event.persona })
          break
        case 'persona_complete':
          feedEvent({
            type: 'agent_complete',
            agent: event.persona,
            data: {
              tokenUsage: {
                input_tokens: event.tokensIn ?? 0,
                output_tokens: event.tokensOut ?? 0,
              },
            },
          })
          break
        case 'round_complete':
          feedEvent({
            type: 'consensus_update',
            data: {
              currentRound: event.round,
              totalRounds: event.totalRounds,
              convergence: event.convergence,
            },
          })
          break
        case 'debate_complete':
          break
      }
    }

    const result = await ctx.engine.executeClashDebate({ topic, rounds, onProgress })
    feedEvent({
      type: 'consensus_update',
      data: {
        currentRound: result.rounds,
        totalRounds: result.rounds,
        phase: 'complete',
        convergence: result.convergence.overall,
      },
    })
    freezeCoordinationView()
    ctx.debateStore.save(result)
    const report = formatDebateReport(result, ctx.engine.scorer.name)
    return { output: report }
  } catch (e) {
    freezeCoordinationView()
    return { output: error(`Debate failed: ${(e as Error).message}`) }
  }
}

function handleConvergence(ctx: CommandContext): CommandResult {
  const result = ctx.engine.getLastDebateResult()
  if (!result) {
    return { output: info('No debate results. Run /consensus <topic> first.') }
  }
  return { output: formatDebateReport(result, ctx.engine.scorer.name) }
}

async function handleDoctor(ctx: CommandContext): Promise<CommandResult> {
  const checks = await runDoctor(ctx.settings)
  const report = formatDoctorReport(checks)
  return { output: box('ClashCode Doctor', report) }
}

async function handleKeychain(args: string[]): Promise<CommandResult> {
  const available = await keychain.isAvailable()
  if (!available) {
    return {
      output: error(
        'Keychain unavailable. Install with `pnpm add keytar` (macOS/Windows work out of the box; Linux needs `libsecret-1-dev`).',
      ),
    }
  }

  const sub = args[0]
  if (!sub) {
    const providers = await keychain.list()
    if (providers.length === 0) {
      return { output: info('No API keys in keychain. Use `/keychain set <provider> <key>`.') }
    }
    const lines = providers.map((p) => `  ${c.cyan}${p}${c.reset} ${dim('****')}`)
    return { output: box('Keychain — stored API keys', lines.join('\n')) }
  }

  if (sub === 'set') {
    const provider = args[1]
    const key = args[2]
    if (!provider || !key) return { output: error('Usage: /keychain set <provider> <api-key>') }
    const ok = await keychain.set(provider, key)
    return {
      output: ok
        ? success(`Stored ${c.cyan}${provider}${c.reset} API key in keychain.`)
        : error('Failed to write to keychain.'),
    }
  }

  if (sub === 'delete') {
    const provider = args[1]
    if (!provider) return { output: error('Usage: /keychain delete <provider>') }
    const ok = await keychain.delete(provider)
    return {
      output: ok
        ? success(`Removed ${c.cyan}${provider}${c.reset} from keychain.`)
        : error(`No key found for "${provider}".`),
    }
  }

  return { output: error(`Unknown subcommand "${sub}". Use: set | delete | (none).`) }
}

async function handleSandbox(args: string[], ctx: CommandContext): Promise<CommandResult> {
  const { resolveBackend } = await import('../sandbox/factory.js')
  const configured = ctx.settings.sandbox.backend
  const resolved = await resolveBackend(configured)

  if (args.length === 0) {
    const lines = [
      `  ${dim('configured:')}  ${c.cyan}${configured}${c.reset}`,
      `  ${dim('resolved:')}    ${c.bold}${c.cyan}${resolved}${c.reset}`,
      `  ${dim('platform:')}    ${c.dim}${process.platform}/${process.arch}${c.reset}`,
      '',
      `  ${dim('Switch with:')} ${c.cyan}/sandbox <auto|docker|shuru|local>${c.reset}`,
    ]
    const note =
      resolved === 'shuru'
        ? `\n  ${c.green}✓ microVM isolation active${c.reset} ${dim('(host filesystem unreachable, no network by default)')}`
        : resolved === 'docker'
          ? `\n  ${c.yellow}⚠ container isolation${c.reset} ${dim('(shared host kernel)')}`
          : `\n  ${c.red}⚠ NO isolation — local shell mode${c.reset} ${dim('(DEV ONLY)')}`
    return { output: box('Sandbox backend', lines.join('\n') + note) }
  }

  const choice = args[0]!.toLowerCase()
  const valid = ['auto', 'docker', 'shuru', 'local']
  if (!valid.includes(choice)) {
    return { output: error(`Invalid backend: "${choice}". Valid: ${valid.join(', ')}`) }
  }
  try {
    const updated = updateSetting(ctx.projectRoot, 'sandbox.backend', choice)
    const newResolved = await resolveBackend(choice as 'auto' | 'docker' | 'shuru' | 'local')
    const warnLine =
      newResolved === 'local'
        ? `\n  ${c.red}⚠ NO isolation — agent commands run directly on your host shell.${c.reset}` +
          `\n  ${c.dim}Set CLASHCODE_ACK_LOCAL_SANDBOX=1 to silence the startup warning.${c.reset}`
        : ''
    return {
      output:
        success(
          `Sandbox backend set to ${c.cyan}${choice}${c.reset} → resolves to ${c.bold}${c.cyan}${newResolved}${c.reset}. Takes effect on next sandbox call (restart recommended).`,
        ) + warnLine,
      updatedSettings: updated,
    }
  } catch (e) {
    return { output: error(`Failed to set sandbox backend: ${(e as Error).message}`) }
  }
}

function handleDiagnostics(args: string[], ctx: CommandContext): CommandResult {
  if (args.length === 0) {
    const state = ctx.settings.diagnostics ? `${c.green}on${c.reset}` : `${c.dim}off${c.reset}`
    return {
      output: info(`Diagnostics: ${state}. Use /diagnostics on or /diagnostics off to toggle.`),
    }
  }
  const arg = args[0]!.toLowerCase()
  if (arg !== 'on' && arg !== 'off') {
    return { output: error('Usage: /diagnostics [on|off]') }
  }
  const value = arg === 'on'
  try {
    const updated = updateSetting(ctx.projectRoot, 'diagnostics', value)
    return {
      output: success(
        `Diagnostics ${value ? c.green + 'enabled' : c.yellow + 'disabled'}${c.reset}. Per-agent token/time breakdown will ${value ? 'now' : 'no longer'} print after each team run.`,
      ),
      updatedSettings: updated,
    }
  } catch (e) {
    return { output: error(`Failed to toggle diagnostics: ${(e as Error).message}`) }
  }
}

function handlePerspectives(): CommandResult {
  const names = listPersonas()
  const lines = names.map((name) => {
    const persona = BUILT_IN_PERSONAS[name]
    if (!persona) return `  ${c.cyan}${name}${c.reset}`
    return `  ${c.cyan}${c.bold}${persona.name}${c.reset}  ${dim(persona.description)}`
  })
  return { output: box('Debate Personas', lines.join('\n')) }
}

function handleDebates(args: string[], ctx: CommandContext): CommandResult {
  if (args.length > 0) {
    const id = args[0]!
    const all = ctx.debateStore.list()
    const match = all.find((d) => d.id === id || d.id.startsWith(id))
    if (!match) {
      return { output: error(`Debate not found: ${id}`) }
    }
    const result = ctx.debateStore.get(match.id)
    if (!result) {
      return { output: error(`Could not load debate: ${match.id}`) }
    }
    return { output: formatDebateReport(result) }
  }

  const debates = ctx.debateStore.list()
  if (debates.length === 0) {
    return { output: info('No debates yet. Run /consensus <topic> to start one.') }
  }

  const header = `  ${c.bold}${'ID'.padEnd(12)}${'Topic'.padEnd(36)}${'Score'.padEnd(8)}${'Rounds'.padEnd(8)}${'Date'}${c.reset}`
  const rows = debates.map((d) => {
    const shortId = d.id.slice(0, 8)
    const topic = d.topic.length > 34 ? d.topic.slice(0, 32) + '..' : d.topic
    const score = `${d.convergence}/100`
    const date = new Date(d.timestamp).toLocaleDateString()
    return `  ${c.cyan}${shortId.padEnd(12)}${c.reset}${topic.padEnd(36)}${score.padEnd(8)}${String(d.rounds).padEnd(8)}${dim(date)}`
  })

  return { output: box('Debate History', [header, ...rows].join('\n')) }
}

function handleClear(): CommandResult {
  return { output: '\x1b[2J\x1b[H' }
}

function handleExit(): CommandResult {
  return { output: dim('Goodbye!'), shouldExit: true }
}

// ── Command registry ────────────────────────────────────────────

type CommandHandler = (
  args: string[],
  ctx: CommandContext,
) => CommandResult | Promise<CommandResult>

interface CommandSpec {
  name: string
  aliases?: readonly string[]
  handler: CommandHandler
}

const COMMAND_REGISTRY: readonly CommandSpec[] = [
  { name: '/help', handler: () => handleHelp() },
  { name: '/config', handler: (args, ctx) => handleConfig(args, ctx) },
  { name: '/model', handler: (args, ctx) => handleModel(args, ctx) },
  { name: '/session', handler: (args, ctx) => handleSession(args, ctx) },
  { name: '/team', handler: (args, ctx) => handleTeam(args, ctx) },
  { name: '/agent', handler: (args, ctx) => handleAgent(args, ctx) },
  { name: '/clear', handler: () => handleClear() },
  { name: '/consensus', aliases: ['/debate'], handler: (args, ctx) => handleConsensus(args, ctx) },
  {
    name: '/convergence',
    aliases: ['/coherence'],
    handler: (_args, ctx) => handleConvergence(ctx),
  },
  { name: '/debates', handler: (args, ctx) => handleDebates(args, ctx) },
  { name: '/perspectives', handler: () => handlePerspectives() },
  { name: '/diagnostics', handler: (args, ctx) => handleDiagnostics(args, ctx) },
  { name: '/sandbox', handler: (args, ctx) => handleSandbox(args, ctx) },
  { name: '/keychain', handler: (args) => handleKeychain(args) },
  { name: '/doctor', handler: (_args, ctx) => handleDoctor(ctx) },
  { name: '/exit', aliases: ['/quit'], handler: () => handleExit() },
]

const COMMAND_MAP = new Map<string, CommandSpec>()
for (const cmd of COMMAND_REGISTRY) {
  COMMAND_MAP.set(cmd.name, cmd)
  for (const alias of cmd.aliases ?? []) COMMAND_MAP.set(alias, cmd)
}

/** All registered slash-command names (including aliases). Used by autocomplete. */
export function listCommands(): readonly string[] {
  return Array.from(COMMAND_MAP.keys()).sort()
}

export async function handleCommand(input: string, ctx: CommandContext): Promise<CommandResult> {
  try {
    const trimmed = input.trim()
    const parts = trimmed.split(/\s+/)
    const command = parts[0]!.toLowerCase()
    const args = parts.slice(1)

    const spec = COMMAND_MAP.get(command)
    if (!spec) {
      return { output: error(`Unknown command: ${command}. Type /help for available commands.`) }
    }
    return await spec.handler(args, ctx)
  } catch (e) {
    return { output: error(`Command failed: ${(e as Error).message}`) }
  }
}
