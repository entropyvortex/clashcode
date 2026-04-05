/**
 * Integration tests for the Local sandbox backend.
 *
 * Runs real shell commands on the host. Safe to always execute because
 * LocalBackend is intentionally zero-isolation and uses only POSIX
 * commands (echo, cat, true/false, exit codes).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalBackend } from '../../src/sandbox/backends/local.js'

describe('LocalBackend — integration', () => {
  let workDir: string
  let backend: LocalBackend

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'clashcode-local-int-'))
    backend = new LocalBackend({ workDir, defaultTimeout: 5000 })
    await backend.start()
  })

  afterAll(async () => {
    await backend.destroy()
    rmSync(workDir, { recursive: true, force: true })
  })

  it('exec echo returns stdout + exit 0', async () => {
    const r = await backend.exec('echo hello-from-sandbox')
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('hello-from-sandbox')
  })

  it('exec captures stderr separately', async () => {
    const r = await backend.exec('echo err >&2; echo out')
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('out')
    expect(r.stderr).toContain('err')
  })

  it('exec propagates non-zero exit codes', async () => {
    const r = await backend.exec('exit 42')
    expect(r.exitCode).toBe(42)
  })

  it('exec respects cwd option', async () => {
    const r = await backend.exec('pwd', { cwd: workDir })
    expect(r.exitCode).toBe(0)
    expect(r.stdout.trim()).toContain(workDir.split('/').pop() ?? '')
  })

  it('exec respects env option', async () => {
    const r = await backend.exec('echo "env=$TEST_SANDBOX_VAR"', {
      env: { TEST_SANDBOX_VAR: 'from-test' },
    })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('env=from-test')
  })

  it('exec enforces timeout', async () => {
    const r = await backend.exec('sleep 10', { timeout: 100 })
    expect(r.exitCode).not.toBe(0)
  }, 3000)

  it('writeFile + readFile roundtrip', async () => {
    const path = join(workDir, 'integration-test.txt')
    await backend.writeFile(path, 'round-trip-content')
    const content = await backend.readFile(path)
    expect(content).toBe('round-trip-content')
  })

  it('writeFile creates parent directories', async () => {
    const path = join(workDir, 'nested', 'deep', 'file.txt')
    await backend.writeFile(path, 'deep content')
    const content = await backend.readFile(path)
    expect(content).toBe('deep content')
  })

  it('writeFile then exec cat sees the file', async () => {
    const path = join(workDir, 'readme.txt')
    await backend.writeFile(path, 'from writeFile')
    const r = await backend.exec(`cat "${path}"`)
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('from writeFile')
  })

  it('readFile rejects unsafe paths', async () => {
    await expect(backend.readFile('/etc/passwd$(whoami)')).rejects.toThrow()
    await expect(backend.readFile('relative/path')).rejects.toThrow()
    await expect(backend.readFile('/path/with/../traversal')).rejects.toThrow()
  })

  it('isRunning reflects start/destroy lifecycle', async () => {
    const b = new LocalBackend()
    expect(b.isRunning()).toBe(false)
    await b.start()
    expect(b.isRunning()).toBe(true)
    await b.destroy()
    expect(b.isRunning()).toBe(false)
  })
})
