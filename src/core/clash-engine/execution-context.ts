/**
 * Arena — first-class execution context that owns the sandbox backend,
 * tool vault, and signal bus for a ClashEngine session.
 *
 * No globals. The Arena is the single source of truth for all runtime
 * resources during a run.
 *
 * @module core/clash-engine/execution-context
 */

import type { ClashProvider, EngineConfig } from './types.js'
import { SignalBus } from './event-bus.js'
import { ToolVault, registerBuiltInTools } from './tool-vault.js'
import { logger } from '../../logger.js'

/** Default model and provider. */
const DEFAULT_MODEL = 'grok-4'
const DEFAULT_PROVIDER: ClashProvider = 'grok'

/** Maps ClashProvider to the upstream provider label. */
type UpstreamProvider = 'anthropic' | 'openai' | 'copilot'

const UPSTREAM_MAP: Record<ClashProvider, UpstreamProvider> = {
  grok: 'openai',
  gemini: 'openai',
  anthropic: 'anthropic',
  openai: 'openai',
  copilot: 'copilot',
}

/** Default base URLs for OpenAI-compatible providers. */
const BASE_URLS: Partial<Record<ClashProvider, string>> = {
  grok: 'https://api.x.ai/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openai: 'https://api.openai.com/v1',
  copilot: 'https://api.githubcopilot.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
}

/** Environment variable names for provider API keys. */
const ENV_KEY_MAP: Record<ClashProvider, string> = {
  grok: 'XAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  copilot: 'COPILOT_API_KEY',
  gemini: 'GEMINI_API_KEY',
}

/** Normalize provider, handling 'xai' → 'grok'. */
function normalizeProvider(p: ClashProvider | 'xai' | undefined): ClashProvider {
  if (!p || p === 'xai') return DEFAULT_PROVIDER
  return p
}

/**
 * The Arena holds all resolved runtime configuration for a ClashEngine
 * session: model, provider, API key, tools, and signal bus.
 */
export class Arena {
  readonly model: string
  readonly provider: ClashProvider
  readonly upstreamProvider: UpstreamProvider
  readonly apiKey: string
  readonly baseURL: string
  readonly maxConcurrency: number
  readonly signals: SignalBus
  readonly vault: ToolVault

  constructor(config: EngineConfig = {}) {
    this.provider = normalizeProvider(config.defaultProvider)
    this.model = config.defaultModel ?? DEFAULT_MODEL
    this.upstreamProvider = UPSTREAM_MAP[this.provider]
    this.maxConcurrency = config.maxConcurrency ?? 5

    // Resolve API key
    let apiKey = config.defaultApiKey
    if (!apiKey) {
      const envVar = ENV_KEY_MAP[this.provider]
      apiKey = process.env[envVar] ?? ''
      if (!apiKey) {
        logger.warn(
          `No API key for provider "${this.provider}". ` +
            `Set ${envVar} or configure apiKeys in .clashcode/settings.json.`,
        )
      }
    }
    this.apiKey = apiKey

    // Resolve base URL
    this.baseURL = config.defaultBaseURL ?? BASE_URLS[this.provider] ?? 'https://api.openai.com/v1'

    // Signal bus for event streaming
    this.signals = new SignalBus()
    if (config.onProgress) {
      this.signals.setLegacyBridge(config.onProgress)
    }

    // Tool vault with built-in tools
    this.vault = new ToolVault()
    registerBuiltInTools(this.vault)
  }
}

// Re-export constants for use by orchestrator module
export { DEFAULT_MODEL, DEFAULT_PROVIDER, ENV_KEY_MAP, BASE_URLS, UPSTREAM_MAP }
export type { UpstreamProvider }
