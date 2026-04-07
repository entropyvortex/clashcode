/**
 * ClashEngine — the public facade for ClashCode's orchestration core.
 *
 * This is the ONLY class external consumers interact with. It provides:
 * - `runSpark()` — run a single agent with tool calling
 * - `runSquad()` — run the 3-role team collaboration
 * - `runClashDebate()` — run the 6-persona structured debate
 * - `onEvent()` — subscribe to rich arena events for TUI visualization
 *
 * The engine owns its Arena (execution context), SignalBus (events),
 * and ToolVault (tools). No globals, no singletons, fully injectable.
 *
 * @module core/clash-engine/clash-engine
 */

import type {
  AgentSpec,
  AgentOutcome,
  SquadBlueprint,
  SquadOutcome,
  ArenaEvent,
  EngineConfig,
  ToolDef,
} from './types.js'
import { Arena } from './execution-context.js'
import { runSpark, runSquad } from './team-runner.js'
import { runClashDebate } from './debate-runner.js'
import { BuiltInPersonaRegistry } from '../../consensus/personas.js'
import type {
  ConvergenceScorer,
  DebateConfig,
  DebateResult,
  PersonaRegistry,
} from '../../consensus/types.js'
import { LexicalConvergenceScorer } from '../../consensus/index.js'

/** Options for the debate engine within ClashEngine. */
export interface ClashEngineDebateOptions {
  scorer?: ConvergenceScorer
  personaRegistry?: PersonaRegistry
}

/**
 * The main ClashEngine — owns orchestration for both team and debate workflows.
 *
 * Create one per session. Pass an `EngineConfig` to configure model, provider,
 * and API key. Subscribe to events with `onEvent()` for live TUI updates.
 */
export class ClashEngine {
  readonly arena: Arena
  private lastDebateResult: DebateResult | null = null
  readonly scorer: ConvergenceScorer
  readonly personaRegistry: PersonaRegistry

  constructor(config: EngineConfig = {}, debateOptions?: ClashEngineDebateOptions) {
    this.arena = new Arena(config)
    this.scorer = debateOptions?.scorer ?? new LexicalConvergenceScorer()
    this.personaRegistry = debateOptions?.personaRegistry ?? new BuiltInPersonaRegistry()
  }

  // ── Event subscription ──────────────────────────────────────

  /** Subscribe to all arena events for live TUI visualization. */
  onEvent(callback: (event: ArenaEvent) => void): () => void {
    return this.arena.signals.subscribe(callback)
  }

  // ── Single agent ────────────────────────────────────────────

  /** Run a single agent with tool calling. */
  async executeAgent(spec: AgentSpec, input: string, signal?: AbortSignal): Promise<AgentOutcome> {
    return runSpark(spec, input, this.arena, signal)
  }

  // ── Team (squad) ────────────────────────────────────────────

  /** Run the multi-agent squad collaboration. */
  async executeSquad(
    blueprint: SquadBlueprint,
    task: string,
    coordinatorModel?: string,
    signal?: AbortSignal,
  ): Promise<SquadOutcome> {
    return runSquad(blueprint, task, this.arena, coordinatorModel, signal)
  }

  // ── Debate ──────────────────────────────────────────────────

  /** Run a structured multi-perspective debate. */
  async executeClashDebate(config: DebateConfig): Promise<DebateResult> {
    const result = await runClashDebate(config, this.arena, this.scorer, this.personaRegistry)
    this.lastDebateResult = result
    return result
  }

  /** Get the last debate result (for /convergence command). */
  getLastDebateResult(): DebateResult | null {
    return this.lastDebateResult
  }

  // ── Tool registration ───────────────────────────────────────

  /** Register additional tools (e.g., sandbox tools). */
  registerTool(tool: ToolDef): void {
    this.arena.vault.register(tool)
  }

  /** Get the tool vault for direct registration. */
  get vault() {
    return this.arena.vault
  }

  // ── Accessors ───────────────────────────────────────────────

  /** The model this engine is configured with. */
  get model(): string {
    return this.arena.model
  }

  /** The provider this engine is configured with. */
  get provider(): string {
    return this.arena.provider
  }
}
