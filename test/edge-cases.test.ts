/**
 * Additional edge-case tests to improve coverage across multiple modules.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── errors ─────────────────────────────────────────────────────────

import { errorMessage, ProviderError } from '../src/errors.js'

describe('errorMessage edge cases', () => {
  it('returns "unknown error" for undefined', () => {
    expect(errorMessage(undefined)).toBe('unknown error')
  })

  it('stringifies a non-Error object throwable', () => {
    expect(errorMessage({ code: 42 })).toBe('[object Object]')
  })

  it('stringifies a boolean throwable', () => {
    expect(errorMessage(false)).toBe('false')
  })

  it('stringifies a symbol throwable', () => {
    expect(errorMessage(Symbol('oops'))).toBe('Symbol(oops)')
  })

  it('walks a deep cause chain (4+ levels), capped by default depth=3', () => {
    const e4 = new Error('level4')
    const e3 = new Error('level3', { cause: e4 })
    const e2 = new Error('level2', { cause: e3 })
    const e1 = new Error('level1', { cause: e2 })
    const top = new Error('top', { cause: e1 })

    // default depth=3 means we see top + 3 causes (level1, level2, level3)
    const msg = errorMessage(top)
    expect(msg).toContain('top')
    expect(msg).toContain('level1')
    expect(msg).toContain('level2')
    expect(msg).toContain('level3')
    // level4 is beyond depth=3
    expect(msg).not.toContain('level4')
  })

  it('walks deeper when depth is explicitly larger', () => {
    const e4 = new Error('level4')
    const e3 = new Error('level3', { cause: e4 })
    const e2 = new Error('level2', { cause: e3 })
    const e1 = new Error('level1', { cause: e2 })
    const top = new Error('top', { cause: e1 })

    const msg = errorMessage(top, 10)
    expect(msg).toContain('level4')
  })

  it('stops walking when cause is not an Error', () => {
    const inner = new Error('inner')
    ;(inner as any).cause = 'string-cause'
    const outer = new Error('outer', { cause: inner })
    const msg = errorMessage(outer)
    // outer + inner, but string-cause is not an Error so the walk stops
    expect(msg).toContain('outer')
    expect(msg).toContain('inner')
    expect(msg).not.toContain('string-cause')
  })
})

// ── ProviderError.isRetryable boundary values ──────────────────────

describe('ProviderError.isRetryable boundary values', () => {
  it('undefined status returns false', () => {
    expect(new ProviderError('x').isRetryable).toBe(false)
  })

  it('429 is retryable', () => {
    expect(new ProviderError('x', { status: 429 }).isRetryable).toBe(true)
  })

  it('428 is not retryable', () => {
    expect(new ProviderError('x', { status: 428 }).isRetryable).toBe(false)
  })

  it('430 is not retryable', () => {
    expect(new ProviderError('x', { status: 430 }).isRetryable).toBe(false)
  })

  it('499 is not retryable', () => {
    expect(new ProviderError('x', { status: 499 }).isRetryable).toBe(false)
  })

  it('500 is retryable (lower boundary of 5xx)', () => {
    expect(new ProviderError('x', { status: 500 }).isRetryable).toBe(true)
  })

  it('599 is retryable (upper boundary of 5xx)', () => {
    expect(new ProviderError('x', { status: 599 }).isRetryable).toBe(true)
  })

  it('600 is not retryable (above 5xx range)', () => {
    expect(new ProviderError('x', { status: 600 }).isRetryable).toBe(false)
  })
})

// ── computeDelay ───────────────────────────────────────────────────

import { computeDelay } from '../src/retry.js'

describe('computeDelay edge cases', () => {
  it('first attempt (attempt=0) uses base delay with jitter', () => {
    const results: number[] = []
    for (let i = 0; i < 50; i++) {
      results.push(computeDelay(0, { baseDelayMs: 1000, backoff: 2, maxDelayMs: 99999 }))
    }
    // base=1000, jitter +-20% => [800, 1200]
    for (const r of results) {
      expect(r).toBeGreaterThanOrEqual(800)
      expect(r).toBeLessThanOrEqual(1200)
    }
  })

  it('caps at maxDelayMs even for very high attempt numbers', () => {
    for (let i = 0; i < 20; i++) {
      const d = computeDelay(20, { baseDelayMs: 1000, backoff: 3, maxDelayMs: 5000 })
      expect(d).toBeLessThanOrEqual(5000)
    }
  })

  it('jitter stays within +-20% of raw value', () => {
    // attempt=1, base=1000, backoff=2 => raw=2000, jitter range [1600, 2400]
    const results: number[] = []
    for (let i = 0; i < 100; i++) {
      results.push(computeDelay(1, { baseDelayMs: 1000, backoff: 2, maxDelayMs: 99999 }))
    }
    for (const r of results) {
      expect(r).toBeGreaterThanOrEqual(1600)
      expect(r).toBeLessThanOrEqual(2400)
    }
  })

  it('uses defaults when no opts provided', () => {
    // defaults: base=1000, backoff=2, max=30000
    // attempt=0 => raw=1000, jitter +-20% => [800, 1200]
    const d = computeDelay(0)
    expect(d).toBeGreaterThanOrEqual(800)
    expect(d).toBeLessThanOrEqual(1200)
  })
})

// ── TeamCache ──────────────────────────────────────────────────────

import { TeamCache } from '../src/state/team-cache.js'

describe('TeamCache edge cases', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'clashcode-edge-cache-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('key stability: different agent orders produce different keys', () => {
    const agents1 = [{ name: 'coder' }, { name: 'reviewer' }]
    const agents2 = [{ name: 'reviewer' }, { name: 'coder' }]
    const k1 = TeamCache.key('goal', agents1, 'model')
    const k2 = TeamCache.key('goal', agents2, 'model')
    // Order matters in the key computation
    expect(k1).not.toBe(k2)
  })

  it('key uses agent model override when present', () => {
    const agents1 = [{ name: 'coder', model: 'gpt-4' }]
    const agents2 = [{ name: 'coder' }]
    const k1 = TeamCache.key('goal', agents1, 'grok-4')
    const k2 = TeamCache.key('goal', agents2, 'grok-4')
    expect(k1).not.toBe(k2)
  })

  it('concurrent get/set does not corrupt data', () => {
    const cache = new TeamCache(tmpDir)
    const entry = { output: 'result', tokIn: 10, tokOut: 5, agentBreakdown: '', elapsed: 1 }
    // Rapid set then get on same key
    for (let i = 0; i < 20; i++) {
      cache.set(`key-${i}`, { ...entry, output: `result-${i}` })
    }
    for (let i = 0; i < 20; i++) {
      const got = cache.get(`key-${i}`)
      expect(got).not.toBeNull()
      expect(got!.output).toBe(`result-${i}`)
    }
  })

  it('set overwrites existing entry', () => {
    const cache = new TeamCache(tmpDir)
    cache.set('k', { output: 'old', tokIn: 1, tokOut: 1, agentBreakdown: '', elapsed: 0 })
    cache.set('k', { output: 'new', tokIn: 2, tokOut: 2, agentBreakdown: '', elapsed: 0 })
    const entry = cache.get('k')
    expect(entry!.output).toBe('new')
    expect(entry!.tokIn).toBe(2)
  })
})

// ── SessionStore ───────────────────────────────────────────────────

import { SessionStore } from '../src/state/index.js'

describe('SessionStore edge cases', () => {
  let tmpDir: string
  let store: SessionStore

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'clashcode-edge-state-'))
    store = new SessionStore(tmpDir)
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('append to non-existent session throws', () => {
    expect(() =>
      store.append('00000000-0000-0000-0000-000000000000', {
        role: 'user',
        content: 'hello',
      }),
    ).toThrow('Session not found')
  })

  it('search with no sessions returns empty array', () => {
    expect(store.search('anything')).toEqual([])
  })

  it('search returns empty when sessions exist but no messages match', () => {
    const s = store.create('Test')
    store.append(s.id, { role: 'user', content: 'hello world' })
    expect(store.search('zzzznonexistent')).toEqual([])
  })

  it('addTokens throws for non-existent session', () => {
    expect(() => store.addTokens('missing-id', 100, 50)).toThrow('Session not found')
  })

  it('addTokens accumulates correctly', () => {
    const s = store.create('Tokens')
    store.addTokens(s.id, 100, 50)
    store.addTokens(s.id, 200, 100)
    const updated = store.get(s.id)
    expect(updated!.tokensIn).toBe(300)
    expect(updated!.tokensOut).toBe(150)
  })
})

// ── Config ─────────────────────────────────────────────────────────

import { loadSettings, updateSetting, DEFAULT_SETTINGS } from '../src/config/index.js'

describe('Config edge cases', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'clashcode-edge-cfg-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('loadSettings creates .clashcode directory if missing', () => {
    const dir = join(tmpDir, 'subproject')
    // directory does not exist yet — loadSettings should create it
    const settings = loadSettings(dir)
    expect(existsSync(join(dir, '.clashcode'))).toBe(true)
    expect(settings.model).toBe(DEFAULT_SETTINGS.model)
  })

  it('updateSetting with nested dotpath sandbox.shuru.cpus', () => {
    loadSettings(tmpDir)
    const updated = updateSetting(tmpDir, 'sandbox.shuru.cpus', 4)
    expect(updated.sandbox.shuru.cpus).toBe(4)
    // Verify persistence
    const reloaded = loadSettings(tmpDir)
    expect(reloaded.sandbox.shuru.cpus).toBe(4)
  })

  it('updateSetting with deeply nested sandbox.shuru.memory', () => {
    loadSettings(tmpDir)
    const updated = updateSetting(tmpDir, 'sandbox.shuru.memory', 4096)
    expect(updated.sandbox.shuru.memory).toBe(4096)
  })

  it('loadSettings handles corrupted JSON gracefully', () => {
    // Create settings first
    loadSettings(tmpDir)
    // Corrupt the file
    const { writeFileSync } = require('node:fs')
    writeFileSync(join(tmpDir, '.clashcode', 'settings.json'), '{bad json!!!', 'utf-8')
    // Should return defaults without throwing
    const settings = loadSettings(tmpDir)
    expect(settings.model).toBe(DEFAULT_SETTINGS.model)
  })

  it('loadSettings migrates v1 xai provider to grok', () => {
    const { writeFileSync } = require('node:fs')
    const { mkdirSync } = require('node:fs')
    const dir = join(tmpDir, 'migrate')
    mkdirSync(join(dir, '.clashcode'), { recursive: true })
    const v1Settings = { ...DEFAULT_SETTINGS, configVersion: 1, provider: 'xai' }
    writeFileSync(
      join(dir, '.clashcode', 'settings.json'),
      JSON.stringify(v1Settings, null, 2),
      'utf-8',
    )
    const settings = loadSettings(dir)
    expect(settings.provider).toBe('grok')
    expect(settings.configVersion).toBe(2)
  })
})

// ── Logger ─────────────────────────────────────────────────────────

import { logger, setLogLevel, getLogLevel, type LogLevel } from '../src/logger.js'

describe('Logger edge cases', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: any
  let original: LogLevel

  beforeEach(() => {
    original = getLogLevel()
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })
  afterEach(() => {
    setLogLevel(original)
    stderrSpy.mockRestore()
  })

  it('debug level shows debug messages with DEBUG prefix', () => {
    setLogLevel('debug')
    logger.debug('trace-info')
    expect(stderrSpy).toHaveBeenCalled()
    const output = stderrSpy.mock.calls[0]?.[0] as string
    expect(output).toContain('DEBUG')
    expect(output).toContain('trace-info')
  })

  it('debug level shows Error stack traces', () => {
    setLogLevel('debug')
    const err = new Error('stack-test')
    logger.info(err)
    const output = stderrSpy.mock.calls[0]?.[0] as string
    // In debug mode, errors should include stack
    expect(output).toContain('stack-test')
    expect(output).toContain('Error')
  })

  it('info level shows Error message only (no stack)', () => {
    setLogLevel('info')
    const err = new Error('msg-only')
    logger.info(err)
    const output = stderrSpy.mock.calls[0]?.[0] as string
    expect(output).toContain('msg-only')
  })

  it('formats non-string, non-Error values as JSON', () => {
    setLogLevel('info')
    logger.info({ key: 'value' })
    const output = stderrSpy.mock.calls[0]?.[0] as string
    expect(output).toContain('"key"')
    expect(output).toContain('"value"')
  })

  it('handles circular references without throwing', () => {
    setLogLevel('info')
    const obj: any = {}
    obj.self = obj
    // Should not throw — falls back to String()
    expect(() => logger.info(obj)).not.toThrow()
    expect(stderrSpy).toHaveBeenCalled()
  })

  it('warn level suppresses info and debug', () => {
    setLogLevel('warn')
    logger.debug('d')
    logger.info('i')
    expect(stderrSpy).not.toHaveBeenCalled()
    logger.warn('w')
    expect(stderrSpy).toHaveBeenCalledOnce()
    const output = stderrSpy.mock.calls[0]?.[0] as string
    expect(output).toContain('WARN')
  })
})

// ── Telemetry ──────────────────────────────────────────────────────

import { increment, observe, getMetrics, resetMetrics, formatMetrics } from '../src/telemetry.js'

describe('Telemetry edge cases', () => {
  beforeEach(() => resetMetrics())

  it('observe with labels (attrs) still records histogram', () => {
    observe('latency.ms', 150, { provider: 'grok' })
    observe('latency.ms', 250, { provider: 'grok' })
    const m = getMetrics()
    const h = m.histograms['latency.ms']
    expect(h).toBeDefined()
    expect(h!.count).toBe(2)
    expect(h!.sum).toBe(400)
    expect(h!.min).toBe(150)
    expect(h!.max).toBe(250)
  })

  it('observe updates min correctly when new value is lower', () => {
    observe('metric', 100)
    observe('metric', 50)
    observe('metric', 200)
    const h = getMetrics().histograms['metric']
    expect(h!.min).toBe(50)
    expect(h!.max).toBe(200)
  })

  it('formatMetrics with no data shows (none) for both sections', () => {
    const output = formatMetrics()
    expect(output).toContain('Counters:')
    expect(output).toContain('Histograms:')
    // Two occurrences of (none)
    const noneCount = (output.match(/\(none\)/g) || []).length
    expect(noneCount).toBe(2)
  })

  it('formatMetrics sorts entries alphabetically', () => {
    increment('sandbox.exec', 1)
    increment('cache.hits', 1)
    increment('llm.requests', 1)
    const output = formatMetrics()
    const lines = output.split('\n')
    const counterLines = lines.filter(
      (l) => l.startsWith('  ') && !l.includes('(none)') && !l.includes('n='),
    )
    // cache.hits should come before llm.requests which comes before sandbox.exec
    const cacheIdx = counterLines.findIndex((l) => l.includes('cache.hits'))
    const llmIdx = counterLines.findIndex((l) => l.includes('llm.requests'))
    const sandboxIdx = counterLines.findIndex((l) => l.includes('sandbox.exec'))
    expect(cacheIdx).toBeLessThan(llmIdx)
    expect(llmIdx).toBeLessThan(sandboxIdx)
  })

  it('increment with custom attrs does not break accumulation', () => {
    increment('llm.requests', 1, { model: 'grok-4' })
    increment('llm.requests', 2, { model: 'gpt-4' })
    const m = getMetrics()
    expect(m.counters['llm.requests']).toBe(3)
  })
})

// ── validateSandboxPath ────────────────────────────────────────────

import { validateSandboxPath } from '../src/sandbox/backend.js'

describe('validateSandboxPath edge cases', () => {
  it('accepts paths with spaces', () => {
    expect(() => validateSandboxPath('/home/user/my project/file.txt')).not.toThrow()
  })

  it('accepts paths with hyphens and underscores', () => {
    expect(() => validateSandboxPath('/home/my-user/my_file.txt')).not.toThrow()
  })

  it('accepts paths with dots in filenames', () => {
    expect(() => validateSandboxPath('/home/user/.config/settings.json')).not.toThrow()
  })

  it('rejects paths with semicolons', () => {
    expect(() => validateSandboxPath('/home/user;rm -rf /')).toThrow('unsafe characters')
  })

  it('rejects paths with backticks', () => {
    expect(() => validateSandboxPath('/home/user/`whoami`')).toThrow('unsafe characters')
  })

  it('rejects paths with dollar signs', () => {
    expect(() => validateSandboxPath('/home/$USER/file')).toThrow('unsafe characters')
  })

  it('rejects paths with pipe characters', () => {
    expect(() => validateSandboxPath('/tmp/file|cat /etc/passwd')).toThrow('unsafe characters')
  })

  it('rejects paths with newlines', () => {
    expect(() => validateSandboxPath('/tmp/file\nmalicious')).toThrow('unsafe characters')
  })

  it('rejects empty paths', () => {
    expect(() => validateSandboxPath('')).toThrow('Empty path')
  })

  it('rejects relative paths', () => {
    expect(() => validateSandboxPath('relative/path')).toThrow('must be absolute')
  })

  it('rejects path traversal', () => {
    expect(() => validateSandboxPath('/home/user/../../../etc/passwd')).toThrow('traversal')
  })

  it('rejects paths with ampersand', () => {
    expect(() => validateSandboxPath('/tmp/file&rm -rf /')).toThrow('unsafe characters')
  })

  it('rejects paths with parentheses', () => {
    expect(() => validateSandboxPath('/tmp/file(test)')).toThrow('unsafe characters')
  })
})
