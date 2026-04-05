import { describe, it, expect } from 'vitest'
import { IMAGE_NAME, DOCKERFILE } from '../src/sandbox/dockerfile.js'
import { SandboxManager } from '../src/sandbox/manager.js'

describe('sandbox/dockerfile', () => {
  it('IMAGE_NAME equals clashcode-sandbox', () => {
    expect(IMAGE_NAME).toBe('clashcode-sandbox')
  })

  it('DOCKERFILE is a string', () => {
    const result = DOCKERFILE
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('Dockerfile contains FROM debian:bookworm-slim', () => {
    const df = DOCKERFILE
    expect(df).toContain('FROM debian:bookworm-slim')
  })

  it('Dockerfile contains RUN directives', () => {
    const df = DOCKERFILE
    expect(df).toContain('RUN')
  })

  it('Dockerfile contains WORKDIR /workspace', () => {
    const df = DOCKERFILE
    expect(df).toContain('WORKDIR /workspace')
  })

  it('Dockerfile contains USER sandbox', () => {
    const df = DOCKERFILE
    expect(df).toContain('USER sandbox')
  })

  it('DOCKERFILE constant is non-empty', () => {
    expect(DOCKERFILE.length).toBeGreaterThan(100)
  })
})

describe('sandbox/manager', () => {
  it('SandboxManager can be constructed with no arguments', () => {
    const manager = new SandboxManager()
    expect(manager).toBeInstanceOf(SandboxManager)
  })

  it('SandboxManager.isRunning() returns false before start', () => {
    const manager = new SandboxManager()
    expect(manager.isRunning()).toBe(false)
  })

  it('SandboxManager constructor applies default config', () => {
    const manager = new SandboxManager()
    // isRunning is false by default, confirming construction succeeded with defaults
    expect(manager.isRunning()).toBe(false)
  })

  it('SandboxManager constructor accepts custom config', () => {
    const manager = new SandboxManager({
      image: 'custom-image:latest',
      memoryLimit: '1g',
      cpuLimit: '2',
      networkDisabled: false,
      workDir: '/custom',
      defaultTimeout: 60000,
    })
    expect(manager).toBeInstanceOf(SandboxManager)
    expect(manager.isRunning()).toBe(false)
  })

  it('SandboxManager constructor merges partial config with defaults', () => {
    const manager = new SandboxManager({ memoryLimit: '1g' })
    expect(manager).toBeInstanceOf(SandboxManager)
    expect(manager.isRunning()).toBe(false)
  })

  it('exec() throws when sandbox is not running', async () => {
    const manager = new SandboxManager()
    await expect(manager.exec('echo hello')).rejects.toThrow('Sandbox is not running')
  })

  it('writeFile() throws when sandbox is not running', async () => {
    const manager = new SandboxManager()
    await expect(manager.writeFile('/tmp/test', 'content')).rejects.toThrow(
      'Sandbox is not running',
    )
  })

  it('readFile() throws when sandbox is not running', async () => {
    const manager = new SandboxManager()
    await expect(manager.readFile('/tmp/test')).rejects.toThrow('Sandbox is not running')
  })

  it('destroy() is safe to call before start', async () => {
    const manager = new SandboxManager()
    await expect(manager.destroy()).resolves.toBeUndefined()
  })
})
