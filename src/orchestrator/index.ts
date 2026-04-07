/**
 * Orchestrator module — thin adapter between ClashCode's CLI layer
 * and the ClashEngine core.
 *
 * v1.3: The external @jackchen_me/open-multi-agent dependency has been
 * replaced by ClashEngine, a purpose-built orchestrator owned by ClashCode.
 *
 * @module orchestrator
 */

import {
  ClashEngine,
  CODER_AGENT,
  REVIEWER_AGENT,
  CONSENSUS_AGENT,
  AGENT_PRESETS,
  defaultSquadBlueprint,
} from '../core/clash-engine/index.js'
import type {
  AgentSpec,
  ClashProvider,
  SquadBlueprint,
  OrchestratorEvent,
} from '../core/clash-engine/index.js'
import { registerSandboxTools } from './tools.js'

// Re-export types for backward compatibility
export type { ClashProvider }
export type { AgentSpec as AgentConfig }
export type { SquadBlueprint as TeamConfig }
export type { OrchestratorEvent }

export interface ClashcodeConfig {
  defaultModel?: string
  defaultProvider?: ClashProvider | 'xai'
  defaultBaseURL?: string
  defaultApiKey?: string
  maxConcurrency?: number
  onProgress?: (event: OrchestratorEvent) => void
}

/**
 * Create a ClashEngine instance configured for the given provider/model.
 *
 * This replaces the old `createOrchestrator()` that returned an
 * OpenMultiAgent instance. The new version returns a ClashEngine
 * that handles everything internally.
 */
export function createOrchestrator(config: ClashcodeConfig = {}) {
  const engine = new ClashEngine({
    defaultModel: config.defaultModel,
    defaultProvider: config.defaultProvider,
    defaultBaseURL: config.defaultBaseURL,
    defaultApiKey: config.defaultApiKey,
    maxConcurrency: config.maxConcurrency,
    onProgress: config.onProgress,
  })

  // Register sandbox tools into the engine's vault
  registerSandboxTools(engine.vault)

  return { engine }
}

// Re-export agent presets
export { CODER_AGENT, REVIEWER_AGENT, CONSENSUS_AGENT, AGENT_PRESETS }

/** Create a default team config (backward-compatible name). */
export function defaultTeamConfig(model?: string): SquadBlueprint {
  return defaultSquadBlueprint(model)
}
