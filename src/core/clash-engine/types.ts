/**
 * Core type definitions for ClashEngine — the purpose-built orchestrator
 * powering ClashCode's multi-agent workflows and live TUI visualization.
 *
 * Every type here is designed for rich, real-time event streaming.
 * The TUI consumes ArenaEvents to render beautiful progress displays.
 *
 * @module core/clash-engine/types
 */

// ── Provider & Model ──────────────────────────────────────────

/** Supported LLM provider identifiers. */
export type ClashProvider = 'grok' | 'anthropic' | 'openai' | 'copilot' | 'gemini'

// ── Agent & Squad Specifications ──────────────────────────────

/** Specification for an individual agent in the arena. */
export interface AgentSpec {
  name: string
  model?: string
  systemPrompt: string
  tools?: string[]
}

/**
 * Blueprint for a multi-agent squad.
 * Backward-compatible alias: `TeamConfig`.
 */
export interface SquadBlueprint {
  name: string
  agents: AgentSpec[]
  sharedMemory?: boolean
  maxConcurrency?: number
}

// Backward-compatible aliases
export type AgentConfig = AgentSpec
export type TeamConfig = SquadBlueprint

// ── Outcomes ──────────────────────────────────────────────────

/** Token usage from an LLM call. */
export interface TokenTally {
  input_tokens: number
  output_tokens: number
}

/** Record of a single tool invocation. */
export interface ToolInvocation {
  name: string
  input: unknown
  output: string
  elapsed: number
}

/** Result from a single agent run. */
export interface AgentOutcome {
  output: string
  tokenUsage: TokenTally
  toolCalls: ToolInvocation[]
}

/** Result from a squad (team) run. */
export interface SquadOutcome {
  agentResults: Map<string, AgentOutcome>
  totalTokenUsage: TokenTally
}

// ── Arena Events (TUI-optimized) ──────────────────────────────

/**
 * Discriminated event kinds emitted by ClashEngine.
 *
 * Every meaningful action emits an event immediately so the TUI
 * can show real-time "work in progress" visualization.
 */
export type ArenaEventKind =
  | 'spark_ignited' // agent started processing
  | 'spark_completed' // agent finished
  | 'tool_invoked' // tool call initiated
  | 'tool_resolved' // tool call completed
  | 'code_proposed' // code delta from coder agent
  | 'critique_issued' // review feedback from reviewer
  | 'insight_surfaced' // shared discovery between agents
  | 'round_opened' // debate round started
  | 'convergence_probed' // convergence check performed
  | 'phase_shifted' // workflow phase transition
  | 'pulse' // status heartbeat
  | 'fault_recovered' // error recovered gracefully
  | 'session_sealed' // session/run complete

/** A rich, structured event from the arena. */
export interface ArenaEvent {
  kind: ArenaEventKind
  agent?: string
  detail?: string
  data?: unknown
  ts: number
}

/**
 * Legacy-compatible event shape for the coordination view.
 * Maps ArenaEvents to the existing ViewEvent format.
 */
export interface OrchestratorEvent {
  type: string
  agent?: string
  task?: string
  data?: unknown
}

// ── Engine Configuration ──────────────────────────────────────

/** Configuration for creating a ClashEngine instance. */
export interface EngineConfig {
  defaultModel?: string
  defaultProvider?: ClashProvider | 'xai'
  defaultBaseURL?: string
  defaultApiKey?: string
  maxConcurrency?: number
  onProgress?: (event: OrchestratorEvent) => void
}

// ── Chat Protocol ─────────────────────────────────────────────

/** A tool call request from the model. */
export interface ModelToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** A message in the chat conversation. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  name?: string
  tool_call_id?: string
  tool_calls?: ModelToolCall[]
}

// ── Tool Definitions ──────────────────────────────────────────

/** A tool that agents can invoke. */
export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (input: Record<string, unknown>) => Promise<ToolResult>
}

/** Result from executing a tool. */
export interface ToolResult {
  data: string
  isError?: boolean
  metadata?: Record<string, unknown>
}

// ── Workflow ──────────────────────────────────────────────────

/** The two workflow modes supported by ClashEngine. */
export type WorkflowMode = 'squad' | 'clash-debate'

/** Persistent session state for campaign resumption. */
export interface ClashSessionState {
  id: string
  mode: WorkflowMode
  startedAt: number
  lastActivityAt: number
}
