import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadSettings, saveSettings, updateSetting, DEFAULT_SETTINGS } from '../src/config/index.js'
import type { Settings } from '../src/config/index.js'

describe('config', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'clashcode-config-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('loadSettings', () => {
    it('creates default file when missing', () => {
      const settings = loadSettings(tmpDir)
      const filePath = join(tmpDir, '.clashcode', 'settings.json')
      expect(existsSync(filePath)).toBe(true)
      expect(settings.model).toBe(DEFAULT_SETTINGS.model)
      expect(settings.provider).toBe(DEFAULT_SETTINGS.provider)
      expect(settings.maxConcurrency).toBe(DEFAULT_SETTINGS.maxConcurrency)
    })

    it('reads existing file', () => {
      // First call creates the file
      loadSettings(tmpDir)
      // Modify the file
      const filePath = join(tmpDir, '.clashcode', 'settings.json')
      const custom: Settings = {
        ...DEFAULT_SETTINGS,
        model: 'gpt-4o',
        provider: 'openai',
        apiKeys: { openai: 'sk-test' },
        sandbox: { ...DEFAULT_SETTINGS.sandbox, shuru: { ...DEFAULT_SETTINGS.sandbox.shuru } },
      }
      writeFileSync(filePath, JSON.stringify(custom, null, 2), 'utf-8')

      const settings = loadSettings(tmpDir)
      expect(settings.model).toBe('gpt-4o')
      expect(settings.provider).toBe('openai')
      expect(settings.apiKeys.openai).toBe('sk-test')
    })
  })

  describe('saveSettings', () => {
    it('writes valid JSON', () => {
      const settings: Settings = {
        ...DEFAULT_SETTINGS,
        model: 'test-model',
        apiKeys: {},
        sandbox: { ...DEFAULT_SETTINGS.sandbox, shuru: { ...DEFAULT_SETTINGS.sandbox.shuru } },
      }
      saveSettings(tmpDir, settings)
      const filePath = join(tmpDir, '.clashcode', 'settings.json')
      expect(existsSync(filePath)).toBe(true)
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
      expect(parsed.model).toBe('test-model')
    })
  })

  describe('updateSetting', () => {
    it('updates with dotpath keys', () => {
      loadSettings(tmpDir) // create defaults
      const updated = updateSetting(tmpDir, 'sandbox.enabled', false)
      expect(updated.sandbox.enabled).toBe(false)

      // Verify it persisted
      const reloaded = loadSettings(tmpDir)
      expect(reloaded.sandbox.enabled).toBe(false)
    })

    it('updates top-level keys', () => {
      loadSettings(tmpDir)
      const updated = updateSetting(tmpDir, 'maxConcurrency', 10)
      expect(updated.maxConcurrency).toBe(10)
    })

    it('rejects unknown setting keys', () => {
      loadSettings(tmpDir)
      expect(() => updateSetting(tmpDir, 'nonexistent.deeply.nested.path', 'value')).toThrow(
        'Unknown setting',
      )
    })
  })
})
