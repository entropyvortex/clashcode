import { OpenMultiAgent, registerBuiltInTools, ToolRegistry } from '@jackchen_me/open-multi-agent'
import type { TeamConfig, AgentConfig, OrchestratorEvent } from '@jackchen_me/open-multi-agent'
import { registerSandboxTools } from './tools.js'
import { logger } from '../logger.js'

/** Supported provider identifiers (matches @jackchen_me/open-multi-agent v1.x). */
export type ClashProvider = 'grok' | 'anthropic' | 'openai' | 'copilot' | 'gemini'

export interface ClashcodeConfig {
  defaultModel?: string
  /**
   * Model provider. As of open-multi-agent 1.x, xAI/Grok is a first-class
   * provider (`'grok'`). For backward compat, `'xai'` is accepted and aliased.
   */
  defaultProvider?: ClashProvider | 'xai'
  defaultBaseURL?: string
  defaultApiKey?: string
  maxConcurrency?: number
  onProgress?: (event: OrchestratorEvent) => void
}

const DEFAULT_MODEL = 'grok-4'
const DEFAULT_PROVIDER: ClashProvider = 'grok'

/**
 * Upstream provider IDs supported by @jackchen_me/open-multi-agent.
 * Our ClashProvider is a superset; `grok` and `gemini` are routed through
 * the OpenAI-compatible adapter with a provider-specific baseURL.
 */
type UpstreamProvider = 'anthropic' | 'openai' | 'copilot'

const UPSTREAM_PROVIDER_MAP: Record<ClashProvider, UpstreamProvider> = {
  grok: 'openai',
  gemini: 'openai',
  anthropic: 'anthropic',
  openai: 'openai',
  copilot: 'copilot',
}

/** Default OpenAI-compatible base URL for providers routed through the openai adapter. */
const PROVIDER_BASE_URL: Partial<Record<ClashProvider, string>> = {
  grok: 'https://api.x.ai/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
}

/** Env-var name for each provider's API key. */
const ENV_KEY_MAP: Record<ClashProvider, string> = {
  grok: 'XAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  copilot: 'COPILOT_API_KEY',
  gemini: 'GEMINI_API_KEY',
}

/** Normalise legacy `'xai'` to `'grok'` (they're the same thing now). */
function normaliseProvider(p: ClashProvider | 'xai' | undefined): ClashProvider {
  if (!p || p === 'xai') return DEFAULT_PROVIDER
  return p
}

export function createOrchestrator(config: ClashcodeConfig = {}) {
  const provider = normaliseProvider(config.defaultProvider)

  // Resolve API key: explicit override → env var
  let apiKey = config.defaultApiKey
  if (!apiKey) {
    const envVar = ENV_KEY_MAP[provider]
    apiKey = process.env[envVar]
    if (!apiKey) {
      logger.warn(
        `No API key found for provider "${provider}". ` +
          `Set ${envVar} or configure apiKeys in .clashcode/settings.json.`,
      )
    }
  }

  const upstreamProvider = UPSTREAM_PROVIDER_MAP[provider]
  const baseURL = config.defaultBaseURL ?? PROVIDER_BASE_URL[provider]

  const orchestrator = new OpenMultiAgent({
    defaultModel: config.defaultModel ?? DEFAULT_MODEL,
    defaultProvider: upstreamProvider,
    defaultBaseURL: baseURL,
    defaultApiKey: apiKey,
    maxConcurrency: config.maxConcurrency ?? 5,
    onProgress: config.onProgress,
  })

  // Register built-in tools (bash, file_read, file_write, file_edit, grep)
  const registry = new ToolRegistry()
  registerBuiltInTools(registry)

  // Register sandbox tools
  registerSandboxTools(registry)

  return { orchestrator, registry }
}

// --- Default agent configurations ---

export const CODER_AGENT: AgentConfig = {
  name: 'coder',
  model: DEFAULT_MODEL,
  systemPrompt: `You are a senior software engineer. Write clean, correct, well-tested code.
Follow existing conventions in the codebase. Prefer simple solutions over clever ones.
Always explain your reasoning before writing code.`,
  tools: [
    'bash',
    'file_read',
    'file_write',
    'file_edit',
    'grep',
    'sandbox_exec',
    'sandbox_write',
    'sandbox_read',
  ],
}

export const REVIEWER_AGENT: AgentConfig = {
  name: 'reviewer',
  model: DEFAULT_MODEL,
  systemPrompt: `You are a code reviewer. Examine code changes for correctness, security,
performance, and maintainability. Be specific about issues and suggest concrete fixes.
Flag any potential bugs, edge cases, or missing error handling.`,
  tools: ['bash', 'file_read', 'grep'],
}

export const CONSENSUS_AGENT: AgentConfig = {
  name: 'consensus',
  model: DEFAULT_MODEL,
  systemPrompt:
    'You are a structured debate facilitator. You coordinate multi-perspective analysis by synthesizing viewpoints from different personas and driving toward coherent consensus.',
  tools: ['bash', 'file_read', 'grep'],
}

/** All available agent presets, keyed by name. */
export const AGENT_PRESETS: Record<string, AgentConfig> = {
  coder: CODER_AGENT,
  reviewer: REVIEWER_AGENT,
  consensus: CONSENSUS_AGENT,
}

export function defaultTeamConfig(model?: string): TeamConfig {
  const m = model ?? DEFAULT_MODEL
  return {
    name: 'clash-team',
    agents: [
      { ...CODER_AGENT, model: m },
      { ...REVIEWER_AGENT, model: m },
      { ...CONSENSUS_AGENT, model: m },
    ],
    sharedMemory: true,
    maxConcurrency: 3,
  }
}
