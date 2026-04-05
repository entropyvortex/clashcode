import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Current config schema version. Bump whenever the shape changes. */
export const CURRENT_CONFIG_VERSION = 2

/** Application settings interface. */
export interface Settings {
  /** Config schema version. Used by the migration runner on load. */
  configVersion: number
  /** LLM model identifier. */
  model: string
  /**
   * LLM provider. `'xai'` is a deprecated alias for `'grok'`, kept for
   * back-compat with existing `.clashcode/settings.json` files.
   */
  provider: 'grok' | 'anthropic' | 'openai' | 'copilot' | 'gemini' | 'xai'
  /** Custom API base URL, or null for provider default. */
  baseUrl: string | null
  /** API keys keyed by provider name. */
  apiKeys: Record<string, string>
  /** Sandbox execution settings. */
  sandbox: {
    enabled: boolean
    persistent: boolean
    image: string
    /** Which backend to use: 'auto' picks Shuru on mac-arm64, else Docker. */
    backend: 'auto' | 'docker' | 'shuru' | 'local'
    /** Shuru microVM backend options (macOS/Apple Silicon only). */
    shuru: {
      /** Checkpoint name to boot from. null = no checkpoint (slow cold boot). */
      checkpoint: string | null
      cpus: number
      memory: number
      diskSize: number
      allowNet: boolean
      /** Host allowlist; when set, network.allow is passed to Shuru. */
      allowedHosts: string[]
    }
  }
  /** Team mode: run multi-agent team (true) or single agent (false). */
  teamMode: boolean
  /** Maximum concurrent operations. */
  maxConcurrency: number
  /** Print per-agent token + time breakdown after each team run. */
  diagnostics: boolean
  /** Override the model used for the coordinator agent (cheap model recommended).
   *  null → fall back to the main model. */
  coordinatorModel: string | null
  /** Cache team-run outputs keyed on (goal + team hash + model).
   *  Identical prompts in the same session skip the full LLM roundtrip. */
  cacheWorkerOutputs: boolean
}

/** Default settings values. */
export const DEFAULT_SETTINGS: Settings = {
  configVersion: CURRENT_CONFIG_VERSION,
  model: 'grok-4',
  provider: 'grok',
  baseUrl: null,
  apiKeys: {},
  sandbox: {
    enabled: true,
    persistent: false,
    image: 'clashcode-sandbox',
    backend: 'auto',
    shuru: {
      checkpoint: 'clashcode-env',
      cpus: 2,
      memory: 2048,
      diskSize: 4096,
      allowNet: false,
      allowedHosts: [],
    },
  },
  teamMode: true,
  maxConcurrency: 5,
  diagnostics: false,
  coordinatorModel: null,
  cacheWorkerOutputs: true,
}

/**
 * Deep-merge source into target, returning a new object.
 * Target values are used as defaults; source values override.
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target }
  for (const key of Object.keys(source)) {
    const sv = source[key]
    const tv = result[key]
    if (
      sv !== null &&
      tv !== null &&
      typeof sv === 'object' &&
      typeof tv === 'object' &&
      !Array.isArray(sv) &&
      !Array.isArray(tv)
    ) {
      result[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>)
    } else {
      result[key] = sv
    }
  }
  return result
}

/** Resolve the settings file path. */
function settingsPath(projectRoot: string): string {
  return join(projectRoot, '.clashcode', 'settings.json')
}

/** Ensure .clashcode/ directory exists. */
function ensureDir(projectRoot: string): void {
  const dir = join(projectRoot, '.clashcode')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/**
 * Load settings from `.clashcode/settings.json`, merging with defaults.
 * Creates the file with defaults if it does not exist.
 * @param projectRoot - Absolute path to the project root.
 * @returns Resolved settings.
 */
export function loadSettings(projectRoot: string): Settings {
  ensureDir(projectRoot)
  const p = settingsPath(projectRoot)
  if (!existsSync(p)) {
    writeFileSync(p, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8')
    return {
      ...DEFAULT_SETTINGS,
      sandbox: { ...DEFAULT_SETTINGS.sandbox },
      apiKeys: { ...DEFAULT_SETTINGS.apiKeys },
    }
  }
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>
  } catch {
    // Corrupted settings file — overwrite with defaults
    writeFileSync(p, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8')
    return {
      ...DEFAULT_SETTINGS,
      sandbox: { ...DEFAULT_SETTINGS.sandbox },
      apiKeys: { ...DEFAULT_SETTINGS.apiKeys },
    }
  }
  const defaults = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>
  const merged = deepMerge(defaults, raw) as unknown as Settings
  const migrated = runMigrations(merged)
  if (migrated.configVersion !== merged.configVersion) {
    writeFileSync(p, JSON.stringify(migrated, null, 2), 'utf-8')
  }
  return migrated
}

/**
 * Run migrations to bring an older config up to CURRENT_CONFIG_VERSION.
 * Each step is idempotent and narrowly scoped.
 */
function runMigrations(s: Settings): Settings {
  let v = typeof s.configVersion === 'number' ? s.configVersion : 1
  let out = s
  // v1 → v2: rename provider 'xai' → 'grok'
  if (v < 2) {
    if ((out.provider as string) === 'xai') {
      out = { ...out, provider: 'grok' }
    }
    v = 2
  }
  return { ...out, configVersion: v }
}

/**
 * Save settings to `.clashcode/settings.json`.
 * @param projectRoot - Absolute path to the project root.
 * @param settings - Full settings object to persist.
 */
export function saveSettings(projectRoot: string, settings: Settings): void {
  ensureDir(projectRoot)
  writeFileSync(settingsPath(projectRoot), JSON.stringify(settings, null, 2), 'utf-8')
}

/**
 * Update a single setting by dot-path key (e.g. `'sandbox.enabled'`), save, and return updated settings.
 * @param projectRoot - Absolute path to the project root.
 * @param key - Dot-separated path into the Settings object.
 * @param value - New value for the key.
 * @returns The full updated settings.
 */
/** Known valid setting keys (dot-paths). */
const VALID_KEYS = new Set([
  'model',
  'provider',
  'baseUrl',
  'teamMode',
  'maxConcurrency',
  'apiKeys',
  'sandbox.enabled',
  'sandbox.persistent',
  'sandbox.image',
  'sandbox.backend',
  'sandbox.shuru.checkpoint',
  'sandbox.shuru.cpus',
  'sandbox.shuru.memory',
  'sandbox.shuru.diskSize',
  'sandbox.shuru.allowNet',
  'diagnostics',
  'coordinatorModel',
  'cacheWorkerOutputs',
])

/**
 * Keys that are safe to traverse/assign on a plain object. Rejects
 * prototype-pollution vectors (`__proto__`, `constructor`, `prototype`)
 * and any empty segment.
 */
const FORBIDDEN_KEY_PARTS = new Set(['__proto__', 'constructor', 'prototype'])

function assertSafeKeyPart(part: string, fullKey: string): void {
  if (!part) {
    throw new Error(`Invalid setting key "${fullKey}": empty path segment`)
  }
  if (FORBIDDEN_KEY_PARTS.has(part)) {
    throw new Error(`Invalid setting key "${fullKey}": forbidden segment "${part}"`)
  }
}

/** Known provider names — enforced by `updateSetting` when key === 'provider'. */
const VALID_PROVIDER_VALUES = new Set(['grok', 'xai', 'anthropic', 'openai', 'copilot', 'gemini'])

export function updateSetting(projectRoot: string, key: string, value: unknown): Settings {
  if (!VALID_KEYS.has(key) && !key.startsWith('apiKeys.')) {
    throw new Error(`Unknown setting: "${key}". Valid keys: ${[...VALID_KEYS].join(', ')}`)
  }

  // Value-level validation for keys with constrained domains.
  if (key === 'provider' && typeof value === 'string' && !VALID_PROVIDER_VALUES.has(value)) {
    throw new Error(`Invalid provider "${value}". Valid: ${[...VALID_PROVIDER_VALUES].join(', ')}`)
  }
  if (key === 'sandbox.backend' && typeof value === 'string') {
    const validBackends = new Set(['auto', 'docker', 'shuru', 'local'])
    if (!validBackends.has(value)) {
      throw new Error(`Invalid sandbox backend "${value}". Valid: ${[...validBackends].join(', ')}`)
    }
  }
  if (key === 'maxConcurrency' && typeof value === 'number') {
    if (!Number.isInteger(value) || value < 1 || value > 64) {
      throw new Error(`maxConcurrency must be an integer between 1 and 64 (got ${value})`)
    }
  }

  const settings = loadSettings(projectRoot)
  const obj = settings as unknown as Record<string, unknown>
  const parts = key.split('.')
  // Path-traversal / prototype-pollution guard on every segment.
  for (const part of parts) assertSafeKeyPart(part, key)

  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!
    if (typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }
  current[parts[parts.length - 1]!] = value
  saveSettings(projectRoot, settings)
  return settings
}
