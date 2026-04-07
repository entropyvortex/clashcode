/**
 * Public API for programmatic ClashCode usage.
 *
 * ```ts
 * import { ClashEngine, BUILT_IN_PERSONAS } from 'clashcode'
 * ```
 *
 * v1.3: The external @jackchen_me/open-multi-agent dependency has been
 * replaced by ClashEngine, a purpose-built orchestrator for better
 * security, control, and TUI experience.
 *
 * @module clashcode
 */

// ClashEngine core (new v1.3 orchestrator)
export { ClashEngine } from './core/clash-engine/index.js'
export type { ClashEngineDebateOptions } from './core/clash-engine/index.js'
export { SignalBus, Arena, ToolVault, defineTool } from './core/clash-engine/index.js'
export type {
  AgentSpec,
  AgentConfig,
  TeamConfig,
  SquadBlueprint,
  AgentOutcome,
  SquadOutcome,
  ArenaEvent,
  ArenaEventKind,
  OrchestratorEvent,
  EngineConfig,
  ToolDef,
  ToolResult,
  WorkflowMode,
  ClashSessionState,
} from './core/clash-engine/index.js'

// Orchestrator adapter (backward-compatible names)
export {
  createOrchestrator,
  CODER_AGENT,
  REVIEWER_AGENT,
  CONSENSUS_AGENT,
  AGENT_PRESETS,
  defaultTeamConfig,
} from './orchestrator/index.js'
export type { ClashcodeConfig, ClashProvider } from './orchestrator/index.js'

// Consensus / debate engine
export {
  LexicalConvergenceScorer,
  formatDebateReport,
  DebateEngine,
  BUILT_IN_PERSONAS,
  listPersonas,
  getPersona,
  BuiltInPersonaRegistry,
  CompositePersonaRegistry,
  ConfigPersonaRegistry,
} from './consensus/index.js'
export type {
  Persona,
  RoundEntry,
  DebatePhase,
  DebateConfig,
  DebateResult,
  ConvergenceHeuristic,
  ConvergenceScorer,
  PersonaRegistry,
  ConsensusEvent,
  ClashEngineOptions,
} from './consensus/index.js'

// Sandbox tools + lifecycle
export { SandboxHandle } from './orchestrator/tools.js'

// Sandbox backends
export { createSandboxBackend, resolveBackend } from './sandbox/factory.js'
export type { SandboxBackendName, SandboxFactoryConfig } from './sandbox/factory.js'
export { DockerBackend } from './sandbox/backends/docker.js'
export { IMAGE_NAME, DOCKERFILE } from './sandbox/dockerfile.js'
export { ShuruBackend, isShuruAvailable } from './sandbox/backends/shuru.js'
export { LocalBackend } from './sandbox/backends/local.js'
export { validateSandboxPath } from './sandbox/backend.js'
export type { SandboxBackend, ExecResult, ExecOptions } from './sandbox/backend.js'

// Persistence
export { SessionStore } from './state/index.js'
export type { Session, SessionMessage } from './state/index.js'
export { DebateStore } from './consensus/store.js'

// Config
export {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  CURRENT_CONFIG_VERSION,
} from './config/index.js'
export type { Settings } from './config/index.js'
export { KeychainStore, keychain, resolveApiKey } from './config/keychain.js'
export { runDoctor, formatDoctorReport } from './cli/doctor.js'
export { runInteractiveInit } from './cli/init-interactive.js'

// Errors + logger + retry
export {
  ClashCodeError,
  ConfigError,
  SandboxError,
  ProviderError,
  SessionError,
  DebateError,
  errorMessage,
} from './errors.js'
export { logger, setLogLevel, getLogLevel } from './logger.js'
export type { LogLevel } from './logger.js'
export { withRetry, computeDelay } from './retry.js'
export type { RetryOptions } from './retry.js'
export {
  increment,
  observe,
  getMetrics,
  resetMetrics,
  formatMetrics,
  enableOtelExport,
  enableSentry,
  telemetryActive,
} from './telemetry.js'
export type { MetricName, OtelOptions, SentryOptions } from './telemetry.js'
