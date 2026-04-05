/**
 * OS keychain integration for API key storage.
 *
 * Keeps API keys out of the plaintext `.clashcode/settings.json`.
 * Uses `keytar` as an **optional peer dependency** — if it's not
 * installed (or if native modules fail to load), `KeychainStore` falls
 * back to a no-op that signals "keychain unavailable" so callers can
 * transparently drop back to settings.json.
 *
 * Installation (optional, adds a native dep):
 *   pnpm add keytar
 *
 * On Linux this additionally requires `libsecret-1-dev`. On macOS and
 * Windows the backing store is native (Keychain / Credential Manager)
 * and works out of the box.
 *
 * @module config/keychain
 */

import { logger } from '../logger.js'

const SERVICE = 'clashcode'

/** Minimal structural type for the subset of keytar we use. */
interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>
  setPassword(service: string, account: string, password: string): Promise<void>
  deletePassword(service: string, account: string): Promise<boolean>
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>
}

let cached: KeytarLike | null | undefined
let loadAttempted = false

async function loadKeytar(): Promise<KeytarLike | null> {
  if (cached !== undefined) return cached
  loadAttempted = true
  try {
    const pkg = 'keytar'
    cached = (await import(/* @vite-ignore */ pkg)) as unknown as KeytarLike
    return cached
  } catch (err) {
    cached = null
    logger.debug(
      `keychain unavailable (keytar not installed or native module failed to load): ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return null
  }
}

export class KeychainStore {
  private readonly service: string
  constructor(service = SERVICE) {
    this.service = service
  }

  /** True if keytar loaded successfully. Safe to call any time. */
  async isAvailable(): Promise<boolean> {
    return (await loadKeytar()) !== null
  }

  /** Read an API key for a provider. Returns null on miss or when unavailable. */
  async get(provider: string): Promise<string | null> {
    const k = await loadKeytar()
    if (!k) return null
    try {
      return await k.getPassword(this.service, provider)
    } catch (err) {
      logger.warn(
        `keychain read failed for "${provider}": ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }
  }

  /** Store an API key for a provider. Returns false when unavailable. */
  async set(provider: string, apiKey: string): Promise<boolean> {
    const k = await loadKeytar()
    if (!k) return false
    try {
      await k.setPassword(this.service, provider, apiKey)
      return true
    } catch (err) {
      logger.warn(
        `keychain write failed for "${provider}": ${err instanceof Error ? err.message : String(err)}`,
      )
      return false
    }
  }

  /** Delete an API key. Returns true if removed, false otherwise. */
  async delete(provider: string): Promise<boolean> {
    const k = await loadKeytar()
    if (!k) return false
    try {
      return await k.deletePassword(this.service, provider)
    } catch {
      return false
    }
  }

  /** List all providers with keys stored. */
  async list(): Promise<string[]> {
    const k = await loadKeytar()
    if (!k) return []
    try {
      const creds = await k.findCredentials(this.service)
      return creds.map((c) => c.account)
    } catch {
      return []
    }
  }
}

/** Default singleton. */
export const keychain = new KeychainStore()

/**
 * Resolve an API key for a provider using the priority order:
 *   1. explicit `override` (e.g. `--api-key` flag)
 *   2. keychain
 *   3. environment variable
 *   4. settings.json apiKeys[provider]
 *
 * Used by the CLI at startup to pick the right key without the user
 * having to care where it came from.
 */
export async function resolveApiKey(
  provider: string,
  envVar: string,
  settingsApiKeys: Record<string, string>,
  override?: string,
): Promise<string | undefined> {
  if (override) return override
  const fromChain = await keychain.get(provider)
  if (fromChain) return fromChain
  const fromEnv = process.env[envVar]
  if (fromEnv) return fromEnv
  if (settingsApiKeys[provider]) return settingsApiKeys[provider]
  return undefined
}

/** True if we ever tried to load keytar (for diagnostics). */
export function keychainLoadAttempted(): boolean {
  return loadAttempted
}
