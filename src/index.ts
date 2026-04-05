/**
 * Public API for programmatic ClashCode usage.
 *
 * ```ts
 * import { createOrchestrator, ClashEngine, BUILT_IN_PERSONAS } from 'clashcode'
 * ```
 *
 * Most users interact with ClashCode through the CLI (`clashcode`). This
 * module exposes the underlying building blocks for integration into other
 * tools: orchestrator construction, sandbox backends, debate engine, and
 * session / debate persistence.
 *
 * @module clashcode
 */

// Orchestrator + providers
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
export { ClashEngine, BUILT_IN_PERSONAS, listPersonas, getPersona } from './consensus/index.js'
export type {
  Persona,
  RoundEntry,
  DebatePhase,
  DebateConfig,
  DebateResult,
  ConvergenceHeuristic,
  ConsensusEvent,
} from './consensus/index.js'

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
