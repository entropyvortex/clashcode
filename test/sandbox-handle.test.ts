import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the factory before importing the module under test
vi.mock('../src/sandbox/factory.js', () => ({
  createSandboxBackend: vi.fn(),
}))

vi.mock('../src/sandbox/backends/shuru-bootstrap.js', () => ({
  ensureBootstrapCheckpoint: vi.fn().mockResolvedValue(undefined),
}))

// Mock ToolUseContext for execute() calls
const mockCtx = { agent: { name: 'test', model: 'test' } } as any

vi.mock('../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('../src/telemetry.js', () => ({
  increment: vi.fn(),
  observe: vi.fn(),
}))

import {
  SandboxHandle,
  createSandboxTools,
  configureSandbox,
  _resetCleanupHooks,
} from '../src/orchestrator/tools.js'
import { createSandboxBackend } from '../src/sandbox/factory.js'
import { ensureBootstrapCheckpoint } from '../src/sandbox/backends/shuru-bootstrap.js'
import type { SandboxBackend } from '../src/sandbox/backend.js'

function makeFakeBackend(overrides: Partial<SandboxBackend> = {}): SandboxBackend {
  return {
    name: 'local' as const,
    start: vi.fn().mockResolvedValue(undefined),
    exec: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('file-content'),
    destroy: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(true),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SandboxHandle — lifecycle', () => {
  it('isRunning() returns false before get()', () => {
    const handle = new SandboxHandle()
    expect(handle.isRunning()).toBe(false)
  })

  it('get() creates backend, calls start, and returns it', async () => {
    const backend = makeFakeBackend()
    vi.mocked(createSandboxBackend).mockResolvedValue(backend)

    const handle = new SandboxHandle()
    const result = await handle.get()

    expect(createSandboxBackend).toHaveBeenCalledOnce()
    expect(backend.start).toHaveBeenCalledOnce()
    expect(result).toBe(backend)
  })

  it('get() returns cached instance on second call', async () => {
    const backend = makeFakeBackend()
    vi.mocked(createSandboxBackend).mockResolvedValue(backend)

    const handle = new SandboxHandle()
    const first = await handle.get()
    const second = await handle.get()

    expect(first).toBe(second)
    expect(createSandboxBackend).toHaveBeenCalledOnce()
    expect(backend.start).toHaveBeenCalledOnce()
  })

  it('isRunning() delegates to backend after get()', async () => {
    const backend = makeFakeBackend({ isRunning: vi.fn().mockReturnValue(true) })
    vi.mocked(createSandboxBackend).mockResolvedValue(backend)

    const handle = new SandboxHandle()
    await handle.get()
    expect(handle.isRunning()).toBe(true)

    vi.mocked(backend.isRunning).mockReturnValue(false)
    expect(handle.isRunning()).toBe(false)
  })

  it('destroy() calls backend.destroy and clears instance', async () => {
    const backend = makeFakeBackend()
    vi.mocked(createSandboxBackend).mockResolvedValue(backend)

    const handle = new SandboxHandle()
    await handle.get()
    await handle.destroy()

    expect(backend.destroy).toHaveBeenCalledOnce()
    expect(handle.isRunning()).toBe(false)
  })

  it('destroy() is safe to call multiple times (double-destroy)', async () => {
    const backend = makeFakeBackend()
    vi.mocked(createSandboxBackend).mockResolvedValue(backend)

    const handle = new SandboxHandle()
    await handle.get()
    await handle.destroy()
    await handle.destroy()

    // Only called once because instance is nulled after first destroy
    expect(backend.destroy).toHaveBeenCalledOnce()
  })

  it('destroy() is safe to call without ever calling get()', async () => {
    const handle = new SandboxHandle()
    await expect(handle.destroy()).resolves.toBeUndefined()
  })

  it('destroy() swallows errors from backend.destroy()', async () => {
    const backend = makeFakeBackend({
      destroy: vi.fn().mockRejectedValue(new Error('docker rm failed')),
    })
    vi.mocked(createSandboxBackend).mockResolvedValue(backend)

    const handle = new SandboxHandle()
    await handle.get()
    // Should not throw
    await expect(handle.destroy()).resolves.toBeUndefined()
  })

  it('after destroy(), get() creates a fresh backend', async () => {
    const backend1 = makeFakeBackend()
    const backend2 = makeFakeBackend()
    vi.mocked(createSandboxBackend).mockResolvedValueOnce(backend1).mockResolvedValueOnce(backend2)

    const handle = new SandboxHandle()
    const first = await handle.get()
    await handle.destroy()
    const second = await handle.get()

    expect(first).toBe(backend1)
    expect(second).toBe(backend2)
    expect(createSandboxBackend).toHaveBeenCalledTimes(2)
  })
})

describe('SandboxHandle — Shuru checkpoint bootstrap', () => {
  it('calls ensureBootstrapCheckpoint for shuru backend with checkpoint config', async () => {
    const backend = makeFakeBackend({ name: 'shuru' as any })
    vi.mocked(createSandboxBackend).mockResolvedValue(backend)

    const handle = new SandboxHandle({
      shuru: { checkpoint: 'my-checkpoint', shuruBin: '/usr/bin/shuru' },
    })
    await handle.get()

    expect(ensureBootstrapCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'my-checkpoint',
        shuruBin: '/usr/bin/shuru',
      }),
    )
  })

  it('does not call ensureBootstrapCheckpoint for non-shuru backends', async () => {
    const backend = makeFakeBackend({ name: 'docker' as any })
    vi.mocked(createSandboxBackend).mockResolvedValue(backend)

    const handle = new SandboxHandle({ shuru: { checkpoint: 'cp' } })
    await handle.get()

    expect(ensureBootstrapCheckpoint).not.toHaveBeenCalled()
  })

  it('swallows checkpoint bootstrap errors and still starts', async () => {
    const backend = makeFakeBackend({ name: 'shuru' as any })
    vi.mocked(createSandboxBackend).mockResolvedValue(backend)
    vi.mocked(ensureBootstrapCheckpoint).mockRejectedValue(new Error('bootstrap boom'))

    const handle = new SandboxHandle({ shuru: { checkpoint: 'cp' } })
    const result = await handle.get()

    expect(result).toBe(backend)
    expect(backend.start).toHaveBeenCalled()
  })
})

describe('SandboxHandle — cleanup hooks', () => {
  beforeEach(() => {
    _resetCleanupHooks()
  })

  it('installs process signal handlers after get()', async () => {
    const onSpy = vi.spyOn(process, 'on')
    const backend = makeFakeBackend()
    vi.mocked(createSandboxBackend).mockResolvedValue(backend)

    const handle = new SandboxHandle()
    await handle.get()

    const registeredEvents = onSpy.mock.calls.map((c) => c[0])
    expect(registeredEvents).toContain('exit')
    expect(registeredEvents).toContain('SIGINT')
    expect(registeredEvents).toContain('SIGTERM')
    expect(registeredEvents).toContain('uncaughtException')
    expect(registeredEvents).toContain('unhandledRejection')

    onSpy.mockRestore()
  })

  it('does not install hooks more than once on repeated get() calls', async () => {
    const onSpy = vi.spyOn(process, 'on')
    const backend = makeFakeBackend()
    vi.mocked(createSandboxBackend).mockResolvedValue(backend)

    const handle = new SandboxHandle()
    await handle.get()

    const countAfterFirst = onSpy.mock.calls.filter((c) => c[0] === 'SIGINT').length

    // Re-get after destroy to trigger module hooks check again
    await handle.destroy()
    vi.mocked(createSandboxBackend).mockResolvedValue(makeFakeBackend())
    await handle.get()

    const countAfterSecond = onSpy.mock.calls.filter((c) => c[0] === 'SIGINT').length
    // Module-level hooks are installed only once
    expect(countAfterSecond).toBe(countAfterFirst)

    onSpy.mockRestore()
  })
})

describe('createSandboxTools — tool definitions', () => {
  it('returns three named tools', () => {
    const handle = new SandboxHandle()
    const tools = createSandboxTools(handle)

    expect(tools.sandboxExecTool).toBeDefined()
    expect(tools.sandboxExecTool.name).toBe('sandbox_exec')
    expect(tools.sandboxWriteTool).toBeDefined()
    expect(tools.sandboxWriteTool.name).toBe('sandbox_write')
    expect(tools.sandboxReadTool).toBeDefined()
    expect(tools.sandboxReadTool.name).toBe('sandbox_read')
  })

  it('sandbox_exec tool executes command and returns output', async () => {
    const backend = makeFakeBackend({
      exec: vi.fn().mockResolvedValue({ stdout: 'hello world', stderr: '', exitCode: 0 }),
    })
    vi.mocked(createSandboxBackend).mockResolvedValue(backend)

    const handle = new SandboxHandle()
    const tools = createSandboxTools(handle)
    const result = await tools.sandboxExecTool.execute({ command: 'echo hello world' }, mockCtx)

    expect(result.data).toContain('hello world')
    expect(result.isError).toBeUndefined()
  })

  it('sandbox_exec tool returns combined stdout+stderr', async () => {
    const backend = makeFakeBackend({
      exec: vi.fn().mockResolvedValue({ stdout: 'out', stderr: 'err', exitCode: 0 }),
    })
    vi.mocked(createSandboxBackend).mockResolvedValue(backend)

    const handle = new SandboxHandle()
    const tools = createSandboxTools(handle)
    const result = await tools.sandboxExecTool.execute({ command: 'cmd' }, mockCtx)

    expect(result.data).toContain('out')
    expect(result.data).toContain('err')
  })

  it('sandbox_exec tool returns "(no output)" when both streams empty', async () => {
    const backend = makeFakeBackend({
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    })
    vi.mocked(createSandboxBackend).mockResolvedValue(backend)

    const handle = new SandboxHandle()
    const tools = createSandboxTools(handle)
    const result = await tools.sandboxExecTool.execute({ command: 'true' }, mockCtx)

    expect(result.data).toBe('(no output)')
  })

  it('sandbox_exec tool handles errors gracefully', async () => {
    const backend = makeFakeBackend({
      exec: vi.fn().mockRejectedValue(new Error('container died')),
    })
    vi.mocked(createSandboxBackend).mockResolvedValue(backend)

    const handle = new SandboxHandle()
    // Prime the handle
    await handle.get()

    const tools = createSandboxTools(handle)
    const result = await tools.sandboxExecTool.execute({ command: 'fail' }, mockCtx)

    expect(result.isError).toBe(true)
    expect(result.data).toContain('container died')
  })

  it('sandbox_write tool writes file and returns byte count', async () => {
    const backend = makeFakeBackend()
    vi.mocked(createSandboxBackend).mockResolvedValue(backend)

    const handle = new SandboxHandle()
    const tools = createSandboxTools(handle)
    const result = await tools.sandboxWriteTool.execute(
      {
        path: '/workspace/test.txt',
        content: 'hello',
      },
      mockCtx,
    )

    expect(result.data).toContain('5 bytes')
    expect(result.data).toContain('/workspace/test.txt')
  })

  it('sandbox_write tool handles errors gracefully', async () => {
    const backend = makeFakeBackend({
      writeFile: vi.fn().mockRejectedValue(new Error('write failed')),
    })
    vi.mocked(createSandboxBackend).mockResolvedValue(backend)

    const handle = new SandboxHandle()
    await handle.get()
    const tools = createSandboxTools(handle)
    const result = await tools.sandboxWriteTool.execute(
      {
        path: '/tmp/x',
        content: 'data',
      },
      mockCtx,
    )

    expect(result.isError).toBe(true)
    expect(result.data).toContain('write failed')
  })

  it('sandbox_read tool reads file and returns content', async () => {
    const backend = makeFakeBackend({
      readFile: vi.fn().mockResolvedValue('the file contents'),
    })
    vi.mocked(createSandboxBackend).mockResolvedValue(backend)

    const handle = new SandboxHandle()
    const tools = createSandboxTools(handle)
    const result = await tools.sandboxReadTool.execute({ path: '/workspace/file.txt' }, mockCtx)

    expect(result.data).toBe('the file contents')
  })

  it('sandbox_read tool handles errors gracefully', async () => {
    const backend = makeFakeBackend({
      readFile: vi.fn().mockRejectedValue(new Error('no such file')),
    })
    vi.mocked(createSandboxBackend).mockResolvedValue(backend)

    const handle = new SandboxHandle()
    await handle.get()
    const tools = createSandboxTools(handle)
    const result = await tools.sandboxReadTool.execute({ path: '/tmp/nope' }, mockCtx)

    expect(result.isError).toBe(true)
    expect(result.data).toContain('no such file')
  })
})

describe('configureSandbox — legacy API', () => {
  it('does not throw', () => {
    expect(() => configureSandbox({ backend: 'local' })).not.toThrow()
  })
})
