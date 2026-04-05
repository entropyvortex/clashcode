/**
 * Model discovery and interactive selection.
 *
 * Fetches available models from the configured provider's API
 * and presents an interactive numbered menu for selection.
 *
 * @module cli/model-select
 */

import { c, box } from './ui.js'
import type { Settings } from '../config/index.js'

/** A discovered model entry. */
export interface ModelEntry {
  id: string
  owned_by?: string
}

/** Provider API base URLs for model listing. */
const PROVIDER_URLS: Record<string, string> = {
  grok: 'https://api.x.ai/v1',
  xai: 'https://api.x.ai/v1', // legacy alias
  openai: 'https://api.openai.com/v1',
}

/**
 * Fetch available models from the provider's /v1/models endpoint.
 * Works with any OpenAI-compatible API (xAI, OpenAI, local).
 */
export async function fetchModels(settings: Settings): Promise<ModelEntry[]> {
  const provider = settings.provider
  const baseUrl = settings.baseUrl ?? PROVIDER_URLS[provider]
  if (!baseUrl) {
    throw new Error(`No API URL known for provider "${provider}". Set baseUrl in settings.`)
  }

  const apiKey = settings.apiKeys[provider] ?? resolveEnvKey(provider)
  if (!apiKey) {
    throw new Error(
      `No API key for "${provider}". Set ${envVarName(provider)} or configure apiKeys.`,
    )
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!res.ok) {
    throw new Error(`Models API returned ${res.status}: ${await res.text().catch(() => 'unknown')}`)
  }

  const body = (await res.json()) as { data?: Array<{ id: string; owned_by?: string }> }
  if (!body.data || !Array.isArray(body.data)) {
    throw new Error('Unexpected models API response format')
  }

  return body.data
    .map((m) => ({ id: m.id, owned_by: m.owned_by }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Format the model list as a numbered menu for display.
 */
export function formatModelMenu(models: ModelEntry[], currentModel: string): string {
  if (models.length === 0) {
    return `${c.dim}No models found.${c.reset}`
  }

  const lines: string[] = []
  for (let i = 0; i < models.length; i++) {
    const m = models[i]!
    const num = String(i + 1).padStart(3)
    const isCurrent = m.id === currentModel
    const marker = isCurrent ? `${c.green} *${c.reset}` : '  '
    const name = isCurrent ? `${c.bold}${c.cyan}${m.id}${c.reset}` : `${c.cyan}${m.id}${c.reset}`
    const owner = m.owned_by ? ` ${c.dim}(${m.owned_by})${c.reset}` : ''
    lines.push(`  ${c.dim}${num}${c.reset}${marker} ${name}${owner}`)
  }

  lines.push('')
  lines.push(`  ${c.dim}Enter a number to select, or type a model ID directly.${c.reset}`)

  return box('Available Models', lines.join('\n'))
}

/**
 * Parse user input after model menu: either a number (1-based index)
 * or a model ID string.
 *
 * @returns The selected model ID, or null if invalid.
 */
export function parseModelChoice(input: string, models: ModelEntry[]): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // Try as number
  const num = parseInt(trimmed, 10)
  if (!isNaN(num) && num >= 1 && num <= models.length) {
    return models[num - 1]!.id
  }

  // Try as direct model ID (exact or prefix match)
  const exact = models.find((m) => m.id === trimmed)
  if (exact) return exact.id

  const prefix = models.filter((m) => m.id.startsWith(trimmed))
  if (prefix.length === 1) return prefix[0]!.id

  // Accept any string as a model ID (user may know models not in the list)
  if (trimmed.length > 2) return trimmed

  return null
}

// ── Helpers ─────────────────────────────────────────────────

function resolveEnvKey(provider: string): string | undefined {
  return process.env[envVarName(provider)]
}

function envVarName(provider: string): string {
  const map: Record<string, string> = {
    grok: 'XAI_API_KEY',
    xai: 'XAI_API_KEY', // legacy alias
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    copilot: 'COPILOT_API_KEY',
    gemini: 'GEMINI_API_KEY',
  }
  return map[provider] ?? `${provider.toUpperCase()}_API_KEY`
}
