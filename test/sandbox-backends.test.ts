import { describe, it, expect } from 'vitest'
import { validateSandboxPath } from '../src/sandbox/backend.js'
import { DockerBackend } from '../src/sandbox/backends/docker.js'
import { ShuruBackend, isShuruAvailable } from '../src/sandbox/backends/shuru.js'
import { LocalBackend } from '../src/sandbox/backends/local.js'
import { resolveBackend, createSandboxBackend } from '../src/sandbox/factory.js'

describe('sandbox/backend — path validation', () => {
  it('accepts absolute paths with safe chars', () => {
    expect(() => validateSandboxPath('/workspace/file.ts')).not.toThrow()
    expect(() => validateSandboxPath('/tmp/a-b_c.txt')).not.toThrow()
  })

  it('rejects empty paths', () => {
    expect(() => validateSandboxPath('')).toThrow('Empty path')
  })

  it('rejects relative paths', () => {
    expect(() => validateSandboxPath('foo/bar')).toThrow('must be absolute')
  })

  it('rejects traversal sequences', () => {
    expect(() => validateSandboxPath('/workspace/../etc')).toThrow('Path traversal')
  })

  it('rejects shell metacharacters', () => {
    expect(() => validateSandboxPath('/tmp/a;rm -rf /')).toThrow('unsafe characters')
    expect(() => validateSandboxPath('/tmp/$(whoami)')).toThrow('unsafe characters')
    expect(() => validateSandboxPath('/tmp/a`b`')).toThrow('unsafe characters')
    expect(() => validateSandboxPath('/tmp/a|b')).toThrow('unsafe characters')
  })
})

describe('sandbox/backends/docker', () => {
  it('constructs with defaults', () => {
    const b = new DockerBackend()
    expect(b.name).toBe('docker')
    expect(b.isRunning()).toBe(false)
  })

  it('constructs with custom config', () => {
    const b = new DockerBackend({
      image: 'alpine:latest',
      memoryLimit: '256m',
      networkDisabled: false,
    })
    expect(b.isRunning()).toBe(false)
  })

  it('exec() throws before start', async () => {
    const b = new DockerBackend()
    await expect(b.exec('echo hi')).rejects.toThrow('Sandbox is not running')
  })

  it('writeFile() throws before start', async () => {
    const b = new DockerBackend()
    await expect(b.writeFile('/tmp/x', 'y')).rejects.toThrow('Sandbox is not running')
  })

  it('readFile() throws before start', async () => {
    const b = new DockerBackend()
    await expect(b.readFile('/tmp/x')).rejects.toThrow('Sandbox is not running')
  })

  it('destroy() is safe before start', async () => {
    const b = new DockerBackend()
    await expect(b.destroy()).resolves.toBeUndefined()
  })
})

describe('sandbox/backends/shuru', () => {
  it('constructs with defaults', () => {
    const b = new ShuruBackend()
    expect(b.name).toBe('shuru')
    expect(b.isRunning()).toBe(false)
  })

  it('constructs with custom config', () => {
    const b = new ShuruBackend({
      checkpoint: 'custom-env',
      cpus: 4,
      memory: 4096,
      allowedHosts: ['api.openai.com'],
    })
    expect(b.isRunning()).toBe(false)
  })

  it('exec() throws before start', async () => {
    const b = new ShuruBackend()
    await expect(b.exec('echo hi')).rejects.toThrow('Sandbox is not running')
  })

  it('isShuruAvailable() returns a boolean', async () => {
    const available = await isShuruAvailable('nonexistent-shuru-cmd-xxx')
    expect(available).toBe(false)
  })

  it('destroy() is safe before start', async () => {
    const b = new ShuruBackend()
    await expect(b.destroy()).resolves.toBeUndefined()
  })
})

describe('sandbox/backends/local', () => {
  it('constructs with defaults', () => {
    const b = new LocalBackend()
    expect(b.name).toBe('local')
    expect(b.isRunning()).toBe(false)
  })

  it('start() + isRunning() work', async () => {
    const b = new LocalBackend()
    await b.start()
    expect(b.isRunning()).toBe(true)
    await b.destroy()
    expect(b.isRunning()).toBe(false)
  })

  it('exec() runs real shell commands', async () => {
    const b = new LocalBackend()
    await b.start()
    const r = await b.exec('echo hello-local-sandbox')
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('hello-local-sandbox')
    await b.destroy()
  })

  it('exec() captures non-zero exit codes', async () => {
    const b = new LocalBackend()
    await b.start()
    const r = await b.exec('exit 7')
    expect(r.exitCode).toBe(7)
    await b.destroy()
  })
})

describe('sandbox/factory — resolveBackend', () => {
  it('passes through explicit names', async () => {
    expect(await resolveBackend('docker')).toBe('docker')
    expect(await resolveBackend('shuru')).toBe('shuru')
    expect(await resolveBackend('local')).toBe('local')
  })

  it('auto resolves to something valid', async () => {
    const r = await resolveBackend('auto')
    expect(['docker', 'shuru', 'local']).toContain(r)
  })
})

describe('sandbox/factory — createSandboxBackend', () => {
  it('creates a Local backend when requested', async () => {
    const b = await createSandboxBackend({ backend: 'local' })
    expect(b.name).toBe('local')
  })

  it('creates a Docker backend when requested', async () => {
    const b = await createSandboxBackend({ backend: 'docker' })
    expect(b.name).toBe('docker')
  })

  it('creates a Shuru backend when requested', async () => {
    const b = await createSandboxBackend({ backend: 'shuru' })
    expect(b.name).toBe('shuru')
  })
})
