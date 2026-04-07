/**
 * CLI runtime construction — wires together every long-lived service a
 * session needs (settings, stores, sandbox, orchestrator, team cache) into
 * a single {@link Runtime} value.
 *
 * v1.3: The external orchestration framework has been replaced by
 * ClashEngine, a purpose-built orchestrator owned by ClashCode.
 * Runtime is now fully injectable.
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
import { SandboxHandle, configureSandbox } from '../orchestrator/tools.js'
import { DebateStore } from '../consensus/store.js'
import { logger } from '../logger.js'
import { feedEvent, type ViewEvent } from './coordination-view.js'
import { info, c } from './ui.js'
import { warnIfUnsafeSandbox } from './sandbox-warning.js'
import type { ClashEngine } from '../core/clash-engine/index.js'
import type { AgentSpec, SquadBlueprint } from '../core/clash-engine/index.js'
import type { ParsedArgs } from './bootstrap.js'

/**
 * The long-lived services for an interactive clashcode session.
 *
 * v1.3: `orchestrator` is now a ClashEngine instance (replaces OpenMultiAgent).
 * `sandboxHandle` is an injectable owned lifecycle object.
 */
export interface Runtime {
  readonly projectRoot: string
  settings: Settings
  session: Session
  readonly store: SessionStore
  readonly teamCache: TeamCache
  readonly engine: ClashEngine
  readonly debateStore: DebateStore
  readonly soloAgent: AgentSpec
  readonly sandboxHandle: SandboxHandle
  teamConfig: SquadBlueprint
  teamMode: boolean
}

/** Options for {@link buildRuntime}. */
export interface BuildRuntimeOptions {
  projectRoot: string
  args: ParsedArgs
  /** Inject a pre-built SandboxHandle (for testing / embedding). */
  sandboxHandle?: SandboxHandle
}

/**
 * Construct every service needed for an interactive session.
 */
export async function buildRuntime({
  projectRoot,
  args,
  sandboxHandle: injectedHandle,
}: BuildRuntimeOptions): Promise<Runtime> {
  // ── Settings + CLI overrides ─────────────────────────────────
  const settings = loadSettings(projectRoot)
  if (args.model) settings.model = args.model
  if (args.provider) settings.provider = args.provider

  // ── Sandbox handle ─────────────────────────────────────────
  const sandboxConfig = {
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
  }

  await warnIfUnsafeSandbox(settings.sandbox.backend)

  const sandboxHandle = injectedHandle ?? new SandboxHandle(sandboxConfig)
  configureSandbox(sandboxConfig)

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

  // ── ClashEngine ──────────────────────────────────────────────
  const providerKey = settings.provider === 'xai' ? 'grok' : settings.provider
  const envVarName = providerKey === 'grok' ? 'XAI_API_KEY' : `${providerKey.toUpperCase()}_API_KEY`
  const apiKey = await resolveApiKey(providerKey, envVarName, settings.apiKeys)
  const { engine } = createOrchestrator({
    defaultModel: settings.model,
    defaultProvider: settings.provider,
    defaultBaseURL: settings.baseUrl ?? undefined,
    defaultApiKey: apiKey ?? undefined,
    maxConcurrency: settings.maxConcurrency,
    onProgress: (event) => feedEvent(event as ViewEvent),
  })

  // ── Debate store ────────────────────────────────────────────
  const debateStore = new DebateStore(projectRoot)

  // ── Agent presets ────────────────────────────────────────────
  const soloAgent: AgentSpec = {
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
    engine,
    debateStore,
    soloAgent,
    sandboxHandle,
    teamConfig,
    teamMode: settings.teamMode,
  }
}

/** Re-export for convenience — commands.ts / turn.ts need these. */
export { AGENT_PRESETS }
