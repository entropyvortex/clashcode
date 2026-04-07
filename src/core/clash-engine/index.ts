/**
 * ClashEngine — barrel export.
 *
 * @module core/clash-engine
 */

// Main facade
export { ClashEngine } from './clash-engine.js'
export type { ClashEngineDebateOptions } from './clash-engine.js'

// Types
export type {
  AgentSpec,
  AgentConfig,
  TeamConfig,
  SquadBlueprint,
  AgentOutcome,
  SquadOutcome,
  TokenTally,
  ToolInvocation,
  ArenaEvent,
  ArenaEventKind,
  OrchestratorEvent,
  EngineConfig,
  ChatMessage,
  ModelToolCall,
  ToolDef,
  ToolResult,
  WorkflowMode,
  ClashSessionState,
  ClashProvider,
} from './types.js'

// Event bus
export { SignalBus } from './event-bus.js'

// Execution context
export { Arena } from './execution-context.js'
export {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  ENV_KEY_MAP,
  BASE_URLS,
  UPSTREAM_MAP,
} from './execution-context.js'
export type { UpstreamProvider } from './execution-context.js'

// Agent registry
export {
  CODER_AGENT,
  REVIEWER_AGENT,
  CONSENSUS_AGENT,
  AGENT_PRESETS,
  defaultSquadBlueprint,
} from './agent-registry.js'

// Tool vault
export { ToolVault, defineTool, registerBuiltInTools } from './tool-vault.js'

// Runners
export { runSpark, runSquad } from './team-runner.js'
export { runClashDebate, phaseForRound } from './debate-runner.js'

// LLM client
export { callModel } from './llm-client.js'
export type { LLMCallConfig, LLMCallResult } from './llm-client.js'
