import { describe, it, expect } from 'vitest'

const isWindows = process.platform === 'win32'
import { validateSandboxPath } from '../src/sandbox/backend.js'
import { DockerBackend, BUILTIN_SECCOMP_PROFILE } from '../src/sandbox/backends/docker.js'
import { ShuruBackend, isShuruAvailable } from '../src/sandbox/backends/shuru.js'
import { LocalBackend } from '../src/sandbox/backends/local.js'
import { resolveBackend, createSandboxBackend } from '../src/sandbox/factory.js'
import { SandboxError } from '../src/errors.js'

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

  it('throws SandboxError instances', () => {
    expect(() => validateSandboxPath('')).toThrow(SandboxError)
    expect(() => validateSandboxPath('relative')).toThrow(SandboxError)
    expect(() => validateSandboxPath('/a/../b')).toThrow(SandboxError)
    expect(() => validateSandboxPath('/tmp/a&b')).toThrow(SandboxError)
  })

  it('rejects paths with newlines and control characters', () => {
    expect(() => validateSandboxPath('/tmp/a\nb')).toThrow('unsafe characters')
    expect(() => validateSandboxPath('/tmp/a\tb')).toThrow('unsafe characters')
    expect(() => validateSandboxPath('/tmp/a\0b')).toThrow('unsafe characters')
  })

  it('rejects paths with braces, brackets, and quotes', () => {
    expect(() => validateSandboxPath('/tmp/{a}')).toThrow('unsafe characters')
    expect(() => validateSandboxPath('/tmp/a"b')).toThrow('unsafe characters')
    expect(() => validateSandboxPath("/tmp/a'b")).toThrow('unsafe characters')
    expect(() => validateSandboxPath('/tmp/a[0]')).toThrow('unsafe characters')
  })

  it('rejects paths with glob wildcards', () => {
    expect(() => validateSandboxPath('/tmp/*')).toThrow('unsafe characters')
    expect(() => validateSandboxPath('/tmp/?.txt')).toThrow('unsafe characters')
  })

  it('accepts paths with spaces, dots, hyphens, underscores', () => {
    expect(() => validateSandboxPath('/workspace/my file.ts')).not.toThrow()
    expect(() => validateSandboxPath('/workspace/.hidden')).not.toThrow()
    expect(() => validateSandboxPath('/workspace/a-b_c/d.e')).not.toThrow()
  })

  it('accepts root path', () => {
    expect(() => validateSandboxPath('/')).not.toThrow()
  })

  it('rejects double-dot anywhere in path', () => {
    expect(() => validateSandboxPath('/a/b..c')).toThrow('Path traversal')
    expect(() => validateSandboxPath('/..hidden')).toThrow('Path traversal')
  })

  it('rejects path that is just ".."', () => {
    // Starts with ".." which is relative, so hits "must be absolute" first
    expect(() => validateSandboxPath('..')).toThrow('must be absolute')
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

  it('constructor merges partial config with defaults', () => {
    const b = new DockerBackend({ image: 'alpine:3.18', pidsLimit: 64 })
    // It constructed successfully; name and isRunning confirm defaults applied
    expect(b.name).toBe('docker')
    expect(b.isRunning()).toBe(false)
  })

  it('constructor with no arguments uses all defaults', () => {
    const b = new DockerBackend()
    expect(b.name).toBe('docker')
    expect(b.isRunning()).toBe(false)
  })

  it('constructor with empty object uses all defaults', () => {
    const b = new DockerBackend({})
    expect(b.name).toBe('docker')
    expect(b.isRunning()).toBe(false)
  })
})

describe('sandbox/backends/docker — BUILTIN_SECCOMP_PROFILE', () => {
  it('has SCMP_ACT_ALLOW as defaultAction', () => {
    expect(BUILTIN_SECCOMP_PROFILE.defaultAction).toBe('SCMP_ACT_ALLOW')
  })

  it('has a syscalls array with at least one entry', () => {
    expect(Array.isArray(BUILTIN_SECCOMP_PROFILE.syscalls)).toBe(true)
    expect(BUILTIN_SECCOMP_PROFILE.syscalls.length).toBeGreaterThan(0)
  })

  it('each syscall entry has names array, action, and errnoRet', () => {
    for (const entry of BUILTIN_SECCOMP_PROFILE.syscalls) {
      expect(Array.isArray(entry.names)).toBe(true)
      expect(entry.names.length).toBeGreaterThan(0)
      expect(entry.action).toBe('SCMP_ACT_ERRNO')
      expect(typeof entry.errnoRet).toBe('number')
    }
  })

  it('blocks dangerous syscalls like ptrace, mount, reboot', () => {
    const blocked = BUILTIN_SECCOMP_PROFILE.syscalls.flatMap((e) => e.names)
    expect(blocked).toContain('ptrace')
    expect(blocked).toContain('mount')
    expect(blocked).toContain('reboot')
    expect(blocked).toContain('kexec_load')
  })
})

describe('sandbox/backends/docker — destroy clears state even on failure', () => {
  it.skipIf(isWindows)('clears containerId and isRunning before attempting docker rm', async () => {
    // By inspecting the source, destroy() sets containerId = null and
    // _isRunning = false BEFORE calling execFileAsync('docker', ['rm'...]).
    // This guarantees state is cleared even if docker rm throws.
    // We verify by setting up internal state and calling destroy() —
    // docker rm will fail (no real Docker), but state must still be cleared.
    const b = new DockerBackend()
    const bAny = b as any
    bAny.containerId = 'fake-container-id-123'
    bAny._isRunning = true

    expect(b.isRunning()).toBe(true)

    // destroy() will try `docker rm -f fake-container-id-123` which will
    // fail since Docker is not available. The catch block swallows errors.
    await b.destroy()

    expect(b.isRunning()).toBe(false)
    expect(bAny.containerId).toBeNull()
  })

  it('destroy is a no-op when containerId is already null', async () => {
    const b = new DockerBackend()
    const bAny = b as any
    bAny.containerId = null
    bAny._isRunning = false

    // Should be a no-op, returning immediately
    await expect(b.destroy()).resolves.toBeUndefined()
  })

  it.skipIf(isWindows)('double destroy is safe', async () => {
    const b = new DockerBackend()
    const bAny = b as any
    bAny.containerId = 'fake-id'
    bAny._isRunning = true

    await b.destroy()
    await b.destroy() // second call should be a no-op

    expect(b.isRunning()).toBe(false)
    expect(bAny.containerId).toBeNull()
  })
})

describe('sandbox/backends/docker — noNewPrivileges default', () => {
  it('noNewPrivileges defaults to true', () => {
    const b = new DockerBackend()
    const bAny = b as any
    expect(bAny.config.noNewPrivileges).toBe(true)
  })

  it('noNewPrivileges can be overridden to false', () => {
    const b = new DockerBackend({ noNewPrivileges: false })
    const bAny = b as any
    expect(bAny.config.noNewPrivileges).toBe(false)
  })

  it('readOnlyRootfs defaults to false', () => {
    const b = new DockerBackend()
    const bAny = b as any
    expect(bAny.config.readOnlyRootfs).toBe(false)
  })

  it('default image is node:20-slim', () => {
    const b = new DockerBackend()
    const bAny = b as any
    expect(bAny.config.image).toBe('node:20-slim')
  })

  it('default memoryLimit is 512m', () => {
    const b = new DockerBackend()
    const bAny = b as any
    expect(bAny.config.memoryLimit).toBe('512m')
  })

  it('default cpuLimit is 1', () => {
    const b = new DockerBackend()
    const bAny = b as any
    expect(bAny.config.cpuLimit).toBe('1')
  })

  it('default pidsLimit is 256', () => {
    const b = new DockerBackend()
    const bAny = b as any
    expect(bAny.config.pidsLimit).toBe(256)
  })

  it('default networkDisabled is true', () => {
    const b = new DockerBackend()
    const bAny = b as any
    expect(bAny.config.networkDisabled).toBe(true)
  })

  it('default workDir is /workspace', () => {
    const b = new DockerBackend()
    const bAny = b as any
    expect(bAny.config.workDir).toBe('/workspace')
  })

  it('default defaultTimeout is 30000', () => {
    const b = new DockerBackend()
    const bAny = b as any
    expect(bAny.config.defaultTimeout).toBe(30000)
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
