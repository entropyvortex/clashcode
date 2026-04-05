/**
 * Validation hardening for updateSetting(): prototype-pollution guards,
 * value-domain validation, and path-segment sanity.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { updateSetting, loadSettings, saveSettings, DEFAULT_SETTINGS } from '../src/config/index.js'

describe('updateSetting validation', () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'clashcode-cfg-'))
    // seed settings
    saveSettings(projectRoot, { ...DEFAULT_SETTINGS })
  })
  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('rejects __proto__ key segments', () => {
    // __proto__ isn't a known key, so first guard fires.
    expect(() => updateSetting(projectRoot, '__proto__.polluted', true)).toThrow(/Unknown setting/)
  })

  it('rejects forbidden segments under apiKeys.* (which bypasses VALID_KEYS)', () => {
    expect(() => updateSetting(projectRoot, 'apiKeys.__proto__', 'x')).toThrow(/forbidden segment/)
    expect(() => updateSetting(projectRoot, 'apiKeys.constructor', 'x')).toThrow(
      /forbidden segment/,
    )
    expect(() => updateSetting(projectRoot, 'apiKeys.prototype', 'x')).toThrow(/forbidden segment/)
  })

  it('rejects empty path segments', () => {
    expect(() => updateSetting(projectRoot, 'apiKeys..openai', 'x')).toThrow(/empty path segment/)
  })

  it('rejects invalid provider values', () => {
    expect(() => updateSetting(projectRoot, 'provider', 'bogus')).toThrow(/Invalid provider/)
  })

  it('accepts all known provider values', () => {
    for (const p of ['grok', 'xai', 'anthropic', 'openai', 'copilot', 'gemini']) {
      expect(() => updateSetting(projectRoot, 'provider', p)).not.toThrow()
    }
  })

  it('rejects invalid sandbox backend', () => {
    expect(() => updateSetting(projectRoot, 'sandbox.backend', 'firecracker')).toThrow(
      /Invalid sandbox backend/,
    )
  })

  it('rejects out-of-range maxConcurrency', () => {
    expect(() => updateSetting(projectRoot, 'maxConcurrency', 0)).toThrow(/between 1 and 64/)
    expect(() => updateSetting(projectRoot, 'maxConcurrency', 1000)).toThrow(/between 1 and 64/)
    expect(() => updateSetting(projectRoot, 'maxConcurrency', 3.5)).toThrow(/between 1 and 64/)
  })

  it('accepts valid maxConcurrency', () => {
    expect(() => updateSetting(projectRoot, 'maxConcurrency', 8)).not.toThrow()
    const s = loadSettings(projectRoot)
    expect(s.maxConcurrency).toBe(8)
  })

  it('pollution attempt does not contaminate Object.prototype', () => {
    try {
      updateSetting(projectRoot, 'apiKeys.__proto__', { polluted: true })
    } catch {
      /* expected */
    }
    const probe: Record<string, unknown> = {}
    expect((probe as Record<string, unknown>)['polluted']).toBeUndefined()
  })
})
