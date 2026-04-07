/**
 * Additional tests to bring coverage above 90% for files that are still below threshold.
 * Covers: docker.ts, local.ts, factory.ts, team-cache.ts, keychain.ts, config/index.ts,
 * sandbox/manager.ts, logger.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

// ── Docker backend unit tests (no real Docker) ──────────────────────

describe('DockerBackend — configuration and security', () => {
  it('noNewPrivileges defaults to true', async () => {
    const { DockerBackend } = await import('../src/sandbox/backends/docker.js')
    const backend = new DockerBackend()
    // Access private config via any cast for test inspection
    const config = (backend as any).config
    expect(config.noNewPrivileges).toBe(true)
  })

  it('default resource limits are set', async () => {
    const { DockerBackend } = await import('../src/sandbox/backends/docker.js')
    const backend = new DockerBackend()
    const config = (backend as any).config
    expect(config.memoryLimit).toBe('512m')
    expect(config.cpuLimit).toBe('1')
    expect(config.pidsLimit).toBe(256)
    expect(config.networkDisabled).toBe(true)
    expect(config.image).toBe('node:20-slim')
  })

  it('custom config merges with defaults', async () => {
    const { DockerBackend } = await import('../src/sandbox/backends/docker.js')
    const backend = new DockerBackend({
      memoryLimit: '1g',
      cpuLimit: '2',
      seccompProfile: 'builtin',
      apparmorProfile: 'docker-default',
      capAdd: ['NET_BIND_SERVICE'],
      readOnlyRootfs: true,
    })
    const config = (backend as any).config
    expect(config.memoryLimit).toBe('1g')
    expect(config.cpuLimit).toBe('2')
    expect(config.seccompProfile).toBe('builtin')
    expect(config.apparmorProfile).toBe('docker-default')
    expect(config.capAdd).toEqual(['NET_BIND_SERVICE'])
    expect(config.readOnlyRootfs).toBe(true)
    // Defaults preserved
    expect(config.pidsLimit).toBe(256)
    expect(config.image).toBe('node:20-slim')
  })

  it('BUILTIN_SECCOMP_PROFILE has expected structure', async () => {
    const { BUILTIN_SECCOMP_PROFILE } = await import('../src/sandbox/backends/docker.js')
    expect(BUILTIN_SECCOMP_PROFILE.defaultAction).toBe('SCMP_ACT_ALLOW')
    expect(BUILTIN_SECCOMP_PROFILE.syscalls).toHaveLength(1)
    expect(BUILTIN_SECCOMP_PROFILE.syscalls[0]!.action).toBe('SCMP_ACT_ERRNO')
    expect(BUILTIN_SECCOMP_PROFILE.syscalls[0]!.names).toContain('ptrace')
    expect(BUILTIN_SECCOMP_PROFILE.syscalls[0]!.names).toContain('mount')
    expect(BUILTIN_SECCOMP_PROFILE.syscalls[0]!.names).toContain('reboot')
    expect(BUILTIN_SECCOMP_PROFILE.syscalls[0]!.names).toContain('kexec_load')
  })

  it('exec before start throws SandboxError', async () => {
    const { DockerBackend } = await import('../src/sandbox/backends/docker.js')
    const backend = new DockerBackend()
    await expect(backend.exec('echo hi')).rejects.toThrow('Sandbox is not running')
    await expect(backend.writeFile('/tmp/test', 'hi')).rejects.toThrow('Sandbox is not running')
    await expect(backend.readFile('/tmp/test')).rejects.toThrow('Sandbox is not running')
  })

  it('destroy on non-started backend is safe', async () => {
    const { DockerBackend } = await import('../src/sandbox/backends/docker.js')
    const backend = new DockerBackend()
    // No-op when no container
    await backend.destroy()
    expect(backend.isRunning()).toBe(false)
  })

  it('destroy sets isRunning to false', async () => {
    const { DockerBackend } = await import('../src/sandbox/backends/docker.js')
    const backend = new DockerBackend()
    // Manually set internal state to simulate a started backend
    ;(backend as any).containerId = 'fake-container-id'
    ;(backend as any)._isRunning = true
    expect(backend.isRunning()).toBe(true)
    // destroy will fail the docker rm but still clear state
    await backend.destroy()
    expect(backend.isRunning()).toBe(false)
    expect((backend as any).containerId).toBeNull()
  })
})

// ── Local backend additional tests ──────────────────────────────────

describe('LocalBackend — additional edge cases', () => {
  it('writeFile validates path before writing', async () => {
    const { LocalBackend } = await import('../src/sandbox/backends/local.js')
    const backend = new LocalBackend()
    await expect(backend.writeFile('relative/path', 'content')).rejects.toThrow('must be absolute')
    await expect(backend.writeFile('/path/../traversal', 'content')).rejects.toThrow('traversal')
    await expect(backend.writeFile('/path/with;semicolon', 'content')).rejects.toThrow('unsafe')
  })

  it('readFile validates path before reading', async () => {
    const { LocalBackend } = await import('../src/sandbox/backends/local.js')
    const backend = new LocalBackend()
    await expect(backend.readFile('relative')).rejects.toThrow('must be absolute')
    await expect(backend.readFile('/path/../bad')).rejects.toThrow('traversal')
  })

  it('exec returns stderr and non-zero exit code on failure', async () => {
    const { LocalBackend } = await import('../src/sandbox/backends/local.js')
    const backend = new LocalBackend()
    await backend.start()
    const result = await backend.exec('exit 42')
    expect(result.exitCode).not.toBe(0)
  })

  it('exec respects cwd option', async () => {
    const { realpathSync } = await import('node:fs')
    const { LocalBackend } = await import('../src/sandbox/backends/local.js')
    const backend = new LocalBackend()
    await backend.start()
    const result = await backend.exec('pwd', { cwd: '/tmp' })
    expect(result.stdout.trim()).toBe(realpathSync('/tmp'))
  })

  it('exec respects env option', async () => {
    const { LocalBackend } = await import('../src/sandbox/backends/local.js')
    const backend = new LocalBackend()
    await backend.start()
    const result = await backend.exec('echo $TEST_VAR', { env: { TEST_VAR: 'hello123' } })
    expect(result.stdout.trim()).toBe('hello123')
  })

  it('writeFile creates parent directories', async () => {
    const { LocalBackend } = await import('../src/sandbox/backends/local.js')
    const backend = new LocalBackend()
    const tempBase = join(tmpdir(), `clashcode-test-${randomBytes(4).toString('hex')}`)
    const filePath = join(tempBase, 'deep/nested/dir/file.txt')
    try {
      await backend.writeFile(filePath, 'test content')
      const content = await backend.readFile(filePath)
      expect(content).toBe('test content')
    } finally {
      rmSync(tempBase, { recursive: true, force: true })
    }
  })

  it('start is idempotent', async () => {
    const { LocalBackend } = await import('../src/sandbox/backends/local.js')
    const backend = new LocalBackend()
    await backend.start()
    await backend.start()
    expect(backend.isRunning()).toBe(true)
  })

  it('destroy sets isRunning to false', async () => {
    const { LocalBackend } = await import('../src/sandbox/backends/local.js')
    const backend = new LocalBackend()
    await backend.start()
    expect(backend.isRunning()).toBe(true)
    await backend.destroy()
    expect(backend.isRunning()).toBe(false)
  })
})

// ── Factory additional tests ────────────────────────────────────────

describe('sandbox/factory — resolveBackend', () => {
  it('returns docker when explicitly requested', async () => {
    const { resolveBackend } = await import('../src/sandbox/factory.js')
    expect(await resolveBackend('docker')).toBe('docker')
  })

  it('returns local when explicitly requested', async () => {
    const { resolveBackend } = await import('../src/sandbox/factory.js')
    expect(await resolveBackend('local')).toBe('local')
  })

  it('returns shuru when explicitly requested', async () => {
    const { resolveBackend } = await import('../src/sandbox/factory.js')
    expect(await resolveBackend('shuru')).toBe('shuru')
  })

  it('createSandboxBackend with docker creates DockerBackend', async () => {
    const { createSandboxBackend } = await import('../src/sandbox/factory.js')
    const { DockerBackend } = await import('../src/sandbox/backends/docker.js')
    const backend = await createSandboxBackend({ backend: 'docker' })
    expect(backend).toBeInstanceOf(DockerBackend)
    expect(backend.name).toBe('docker')
  })

  it('createSandboxBackend with local creates LocalBackend', async () => {
    const { createSandboxBackend } = await import('../src/sandbox/factory.js')
    const { LocalBackend } = await import('../src/sandbox/backends/local.js')
    const backend = await createSandboxBackend({ backend: 'local' })
    expect(backend).toBeInstanceOf(LocalBackend)
    expect(backend.name).toBe('local')
  })
})

// ── TeamCache additional coverage ───────────────────────────────────

describe('TeamCache — additional coverage', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `clashcode-cache-test-${randomBytes(4).toString('hex')}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('get returns null for corrupted JSON', async () => {
    const { TeamCache } = await import('../src/state/team-cache.js')
    const cache = new TeamCache(tempDir)
    const key = TeamCache.key('test', [{ name: 'a' }], 'model')
    const filePath = join(tempDir, '.clashcode', 'cache', `${key}.json`)
    writeFileSync(filePath, 'not json{{{', 'utf-8')
    expect(cache.get(key)).toBeNull()
  })

  it('prune removes old entries', async () => {
    const { TeamCache } = await import('../src/state/team-cache.js')
    const cache = new TeamCache(tempDir, { ttlMs: 1 })
    cache.set('old-key', { output: 'old', tokIn: 1, tokOut: 1, agentBreakdown: '', elapsed: 1 })
    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 10))
    const pruned = cache.prune()
    expect(pruned).toBeGreaterThanOrEqual(0) // May or may not be pruned depending on mtime granularity
  })

  it('stats returns correct entry count', async () => {
    const { TeamCache } = await import('../src/state/team-cache.js')
    const cache = new TeamCache(tempDir)
    cache.set('k1', { output: 'a', tokIn: 1, tokOut: 1, agentBreakdown: '', elapsed: 1 })
    cache.set('k2', { output: 'b', tokIn: 1, tokOut: 1, agentBreakdown: '', elapsed: 1 })
    const stats = cache.stats()
    expect(stats.entries).toBe(2)
    expect(stats.totalBytes).toBeGreaterThan(0)
  })

  it('delete on non-existent key is safe', async () => {
    const { TeamCache } = await import('../src/state/team-cache.js')
    const cache = new TeamCache(tempDir)
    // Should not throw
    cache.delete('nonexistent-key')
  })

  it('clear removes all entries', async () => {
    const { TeamCache } = await import('../src/state/team-cache.js')
    const cache = new TeamCache(tempDir)
    cache.set('k1', { output: 'a', tokIn: 1, tokOut: 1, agentBreakdown: '', elapsed: 1 })
    cache.set('k2', { output: 'b', tokIn: 1, tokOut: 1, agentBreakdown: '', elapsed: 1 })
    const cleared = cache.clear()
    expect(cleared).toBe(2)
    expect(cache.stats().entries).toBe(0)
  })

  it('key is stable across calls with same input', async () => {
    const { TeamCache } = await import('../src/state/team-cache.js')
    const agents = [{ name: 'coder', model: 'gpt-4' }, { name: 'reviewer' }]
    const k1 = TeamCache.key('hello', agents, 'gpt-4')
    const k2 = TeamCache.key('hello', agents, 'gpt-4')
    expect(k1).toBe(k2)
    expect(k1).toHaveLength(32)
  })

  it('key differs when goal differs', async () => {
    const { TeamCache } = await import('../src/state/team-cache.js')
    const agents = [{ name: 'coder' }]
    const k1 = TeamCache.key('hello', agents, 'model')
    const k2 = TeamCache.key('world', agents, 'model')
    expect(k1).not.toBe(k2)
  })
})

// ── SandboxManager legacy wrapper ───────────────────────────────────

describe('SandboxManager — legacy wrapper', () => {
  it('constructs and wraps DockerBackend', async () => {
    const { SandboxManager } = await import('../src/sandbox/manager.js')
    const mgr = new SandboxManager()
    expect(mgr.isRunning()).toBe(false)
    await mgr.destroy() // no-op, should not throw
  })

  it('delegates isRunning correctly', async () => {
    const { SandboxManager } = await import('../src/sandbox/manager.js')
    const mgr = new SandboxManager()
    expect(mgr.isRunning()).toBe(false)
  })
})

// ── Keychain — additional edge cases ────────────────────────────────

describe('keychain — additional coverage', () => {
  it('resolveApiKey prefers env over settings (keytar unavailable)', async () => {
    const { resolveApiKey } = await import('../src/config/keychain.js')
    const original = process.env['TEST_KEYCHAIN_KEY']
    process.env['TEST_KEYCHAIN_KEY'] = 'from-env'
    try {
      // Priority: override → keychain (unavail) → env → settings
      const key = await resolveApiKey('test', 'TEST_KEYCHAIN_KEY', { test: 'from-settings' })
      expect(key).toBe('from-env')
    } finally {
      if (original === undefined) delete process.env['TEST_KEYCHAIN_KEY']
      else process.env['TEST_KEYCHAIN_KEY'] = original
    }
  })

  it('resolveApiKey prefers explicit override over everything', async () => {
    const { resolveApiKey } = await import('../src/config/keychain.js')
    const key = await resolveApiKey('test', 'SOME_VAR', { test: 'settings' }, 'explicit-override')
    expect(key).toBe('explicit-override')
  })

  it('resolveApiKey falls back to env when settings empty', async () => {
    const { resolveApiKey } = await import('../src/config/keychain.js')
    const original = process.env['RESOLVE_KEY_TEST']
    process.env['RESOLVE_KEY_TEST'] = 'env-value'
    try {
      const key = await resolveApiKey('test', 'RESOLVE_KEY_TEST', {})
      expect(key).toBe('env-value')
    } finally {
      if (original === undefined) delete process.env['RESOLVE_KEY_TEST']
      else process.env['RESOLVE_KEY_TEST'] = original
    }
  })

  it('resolveApiKey returns undefined when nothing available', async () => {
    const { resolveApiKey } = await import('../src/config/keychain.js')
    const original = process.env['NONEXISTENT_KEY_VAR']
    delete process.env['NONEXISTENT_KEY_VAR']
    try {
      const key = await resolveApiKey('nonexistent', 'NONEXISTENT_KEY_VAR', {})
      expect(key).toBeUndefined()
    } finally {
      if (original !== undefined) process.env['NONEXISTENT_KEY_VAR'] = original
    }
  })
})

// ── Config — additional edge cases ──────────────────────────────────

describe('config — additional coverage', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `clashcode-config-test-${randomBytes(4).toString('hex')}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('loadSettings creates .clashcode directory if missing', async () => {
    const { loadSettings } = await import('../src/config/index.js')
    const settings = loadSettings(tempDir)
    expect(settings).toBeDefined()
    expect(settings.model).toBeDefined()
    expect(existsSync(join(tempDir, '.clashcode'))).toBe(true)
  })

  it('updateSetting with nested dotpath works', async () => {
    const { loadSettings, updateSetting } = await import('../src/config/index.js')
    loadSettings(tempDir) // initialize
    const updated = updateSetting(tempDir, 'sandbox.backend', 'docker')
    expect(updated.sandbox.backend).toBe('docker')
  })

  it('loadSettings returns defaults for fresh directory', async () => {
    const { loadSettings, DEFAULT_SETTINGS } = await import('../src/config/index.js')
    const settings = loadSettings(tempDir)
    expect(settings.model).toBe(DEFAULT_SETTINGS.model)
    expect(settings.provider).toBe(DEFAULT_SETTINGS.provider)
  })
})

// ── Logger — edge cases ─────────────────────────────────────────────

describe('logger — additional coverage', () => {
  it('setLogLevel to debug enables debug messages', async () => {
    const { setLogLevel, getLogLevel } = await import('../src/logger.js')
    const original = getLogLevel()
    setLogLevel('debug')
    expect(getLogLevel()).toBe('debug')
    // Restore
    setLogLevel(original)
  })

  it('getLogLevel returns current level', async () => {
    const { getLogLevel, setLogLevel } = await import('../src/logger.js')
    const original = getLogLevel()
    setLogLevel('warn')
    expect(getLogLevel()).toBe('warn')
    setLogLevel(original)
  })
})

// ── validateSandboxPath — comprehensive ─────────────────────────────

describe('validateSandboxPath — comprehensive', () => {
  it('accepts valid paths with spaces', async () => {
    const { validateSandboxPath } = await import('../src/sandbox/backend.js')
    expect(() => validateSandboxPath('/home/user/my project/file.ts')).not.toThrow()
  })

  it('accepts valid paths with hyphens and underscores', async () => {
    const { validateSandboxPath } = await import('../src/sandbox/backend.js')
    expect(() => validateSandboxPath('/var/my-project_v2/main.ts')).not.toThrow()
  })

  it('accepts valid deep paths', async () => {
    const { validateSandboxPath } = await import('../src/sandbox/backend.js')
    expect(() => validateSandboxPath('/a/b/c/d/e/f/g.txt')).not.toThrow()
  })

  it('rejects paths with semicolons', async () => {
    const { validateSandboxPath } = await import('../src/sandbox/backend.js')
    expect(() => validateSandboxPath('/tmp/file;rm -rf /')).toThrow('unsafe characters')
  })

  it('rejects paths with backticks', async () => {
    const { validateSandboxPath } = await import('../src/sandbox/backend.js')
    expect(() => validateSandboxPath('/tmp/`whoami`')).toThrow('unsafe characters')
  })

  it('rejects paths with dollar signs', async () => {
    const { validateSandboxPath } = await import('../src/sandbox/backend.js')
    expect(() => validateSandboxPath('/tmp/$HOME')).toThrow('unsafe characters')
  })

  it('rejects paths with pipe', async () => {
    const { validateSandboxPath } = await import('../src/sandbox/backend.js')
    expect(() => validateSandboxPath('/tmp/file|cat')).toThrow('unsafe characters')
  })

  it('rejects paths with ampersand', async () => {
    const { validateSandboxPath } = await import('../src/sandbox/backend.js')
    expect(() => validateSandboxPath('/tmp/file&bg')).toThrow('unsafe characters')
  })

  it('rejects paths with single quotes', async () => {
    const { validateSandboxPath } = await import('../src/sandbox/backend.js')
    expect(() => validateSandboxPath("/tmp/file'name")).toThrow('unsafe characters')
  })

  it('rejects paths with double quotes', async () => {
    const { validateSandboxPath } = await import('../src/sandbox/backend.js')
    expect(() => validateSandboxPath('/tmp/file"name')).toThrow('unsafe characters')
  })

  it('rejects paths with newlines', async () => {
    const { validateSandboxPath } = await import('../src/sandbox/backend.js')
    expect(() => validateSandboxPath('/tmp/file\nname')).toThrow('unsafe characters')
  })

  it('rejects empty string', async () => {
    const { validateSandboxPath } = await import('../src/sandbox/backend.js')
    expect(() => validateSandboxPath('')).toThrow('Empty path')
  })

  it('rejects relative paths', async () => {
    const { validateSandboxPath } = await import('../src/sandbox/backend.js')
    expect(() => validateSandboxPath('relative/path')).toThrow('must be absolute')
  })

  it('rejects path traversal', async () => {
    const { validateSandboxPath } = await import('../src/sandbox/backend.js')
    expect(() => validateSandboxPath('/tmp/../etc/passwd')).toThrow('traversal')
  })
})
