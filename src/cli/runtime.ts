/**
 * CLI runtime construction — wires together every long-lived service a
 * session needs (settings, stores, sandbox, orchestrator, team cache) into
 * a single {@link Runtime} value.
 *
 * All side-effects (loading settings, creating SQLite files, configuring the
 * sandbox singleton) happen in {@link buildRuntime}. The REPL and turn
 * handlers receive this object read-only, so tests can construct a fake
 * Runtime by hand.
 *
 * @module cli/runtime
 */

import { loadSettings, type Settings } from '../config/index.js'
import { resolveApiKey } from '../config/keychain.js'
import { SessionStore, type Session } from '../state/index.js'
import { TeamCache } from '../state/team-cache.js'
import {
  createOrchestrator,
  defaultTeamConfig,
  CODER_AGENT,
  AGENT_PRESETS,
} from '../orchestrator/index.js'
import { configureSandbox } from '../orchestrator/tools.js'
import { ClashEngine } from '../consensus/index.js'
import { DebateStore } from '../consensus/store.js'
import { logger } from '../logger.js'
import { feedEvent, type ViewEvent } from './coordination-view.js'
import { info, c } from './ui.js'
import { warnIfUnsafeSandbox } from './sandbox-warning.js'
import type { AgentConfig, OpenMultiAgent, TeamConfig } from '@jackchen_me/open-multi-agent'
import type { ParsedArgs } from './bootstrap.js'

/**
 * The long-lived services for an interactive clashcode session.
 *
 * Once constructed, this value is passed around by reference — the REPL and
 * turn handler mutate a small number of fields (`session`, `teamConfig`,
 * `teamMode`, `teamCallCount`) but never replace wholesale.
 */
export interface Runtime {
  readonly projectRoot: string
  settings: Settings
  session: Session
  readonly store: SessionStore
  readonly teamCache: TeamCache
  readonly orchestrator: OpenMultiAgent
  readonly consensus: ClashEngine
  readonly debateStore: DebateStore
  readonly soloAgent: AgentConfig
  teamConfig: TeamConfig
  teamMode: boolean
  /** Monotonic counter — the framework rejects duplicate team names. */
  teamCallCount: number
}

/** Options for {@link buildRuntime}. */
export interface BuildRuntimeOptions {
  projectRoot: string
  args: ParsedArgs
}

/**
 * Construct every service needed for an interactive session.
 *
 * Side-effects:
 * - Loads `.clashcode/settings.json` (creates if missing).
 * - Opens a SQLite file via {@link SessionStore} and {@link TeamCache}.
 * - Configures the sandbox factory singleton via {@link configureSandbox}.
 * - Prunes expired team-cache entries.
 */
export async function buildRuntime({ projectRoot, args }: BuildRuntimeOptions): Promise<Runtime> {
  // ── Settings + CLI overrides ─────────────────────────────────
  const settings = loadSettings(projectRoot)
  if (args.model) settings.model = args.model
  if (args.provider) settings.provider = args.provider

  // ── Sandbox singleton ────────────────────────────────────────
  // Warn loudly when running with no isolation. Warning is suppressible via
  // CLASHCODE_ACK_LOCAL_SANDBOX=1 so CI/tests don't log noise.
  await warnIfUnsafeSandbox(settings.sandbox.backend)
  configureSandbox({
    backend: settings.sandbox.backend,
    docker: { image: settings.sandbox.image },
    shuru: {
      checkpoint: settings.sandbox.shuru.checkpoint,
      cpus: settings.sandbox.shuru.cpus,
      memory: settings.sandbox.shuru.memory,
      diskSize: settings.sandbox.shuru.diskSize,
      allowNet: settings.sandbox.shuru.allowNet,
      allowedHosts: settings.sandbox.shuru.allowedHosts,
    },
  })

  // ── Session store (resume latest unless --reset) ─────────────
  const store = new SessionStore(projectRoot)
  let session: Session
  if (args.reset) {
    session = store.create()
    console.log(info('Started new session'))
  } else {
    const sessions = store.list()
    const latest = sessions[0]
    const resumed = latest ? store.get(latest.id) : null
    if (resumed) {
      session = resumed
      console.log(info(`Resumed session ${c.dim}${session.id.slice(0, 8)}${c.reset}`))
    } else {
      session = store.create()
    }
  }

  // ── Team cache ───────────────────────────────────────────────
  const teamCache = new TeamCache(projectRoot)
  const pruned = teamCache.prune()
  if (pruned > 0) logger.debug(`pruned ${pruned} expired cache entries`)

  // ── Orchestrator ─────────────────────────────────────────────
  // Key resolution: keychain → env → settings.apiKeys. See
  // src/config/keychain.ts for the full lookup precedence.
  const providerKey = settings.provider === 'xai' ? 'grok' : settings.provider
  const envVarName = providerKey === 'grok' ? 'XAI_API_KEY' : `${providerKey.toUpperCase()}_API_KEY`
  const apiKey = await resolveApiKey(providerKey, envVarName, settings.apiKeys)
  const { orchestrator } = createOrchestrator({
    defaultModel: settings.model,
    defaultProvider: settings.provider,
    defaultBaseURL: settings.baseUrl ?? undefined,
    defaultApiKey: apiKey ?? undefined,
    maxConcurrency: settings.maxConcurrency,
    onProgress: (event) => feedEvent(event as ViewEvent),
  })

  // ── Consensus / debate ───────────────────────────────────────
  const consensus = new ClashEngine(settings.model, settings.provider)
  const debateStore = new DebateStore(projectRoot)

  // ── Agent presets ────────────────────────────────────────────
  const soloAgent: AgentConfig = {
    ...CODER_AGENT,
    name: 'assistant',
    model: settings.model,
  }
  const teamConfig = defaultTeamConfig(settings.model)

  return {
    projectRoot,
    settings,
    session,
    store,
    teamCache,
    orchestrator,
    consensus,
    debateStore,
    soloAgent,
    teamConfig,
    teamMode: settings.teamMode,
    teamCallCount: 0,
  }
}

/** Re-export for convenience — commands.ts / turn.ts need these. */
export { AGENT_PRESETS }
