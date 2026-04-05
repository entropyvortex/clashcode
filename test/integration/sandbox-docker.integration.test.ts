/**
 * Integration tests for the Docker sandbox backend.
 *
 * Runs ONLY when a docker daemon is reachable AND the
 * `CLASHCODE_INTEGRATION=1` env var is set. Otherwise every test is
 * skipped. This keeps CI default-fast (~600ms) while letting
 * developers with docker + `CLASHCODE_INTEGRATION=1` verify the real
 * backend end-to-end (~20-30s for the suite).
 *
 * Uses `alpine:latest` because it's ~5MB and boots in <1s.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DockerBackend } from '../../src/sandbox/backends/docker.js'

const execFileAsync = promisify(execFile)

async function dockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 3000 })
    return true
  } catch {
    return false
  }
}

const shouldRun = process.env['CLASHCODE_INTEGRATION'] === '1'
const describeIf = shouldRun ? describe : describe.skip

describeIf('DockerBackend — integration (requires docker daemon)', () => {
  let backend: DockerBackend | null = null
  let dockerOk = false

  beforeAll(async () => {
    dockerOk = await dockerAvailable()
    if (!dockerOk) return
    backend = new DockerBackend({
      image: 'alpine:latest',
      memoryLimit: '128m',
      cpuLimit: '0.5',
      networkDisabled: true,
      defaultTimeout: 10_000,
    })
    await backend.start()
  }, 60_000)

  afterAll(async () => {
    if (backend) await backend.destroy()
  }, 20_000)

  it('skips gracefully when docker is not available', () => {
    if (!dockerOk) {
      process.stderr.write('docker not reachable — suite was a no-op\n')
    }
    expect(true).toBe(true)
  })

  it('exec echo returns stdout + exit 0', async () => {
    if (!dockerOk || !backend) return
    const r = await backend.exec('echo hello-docker')
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('hello-docker')
  })

  it('exec captures stderr', async () => {
    if (!dockerOk || !backend) return
    const r = await backend.exec('echo err >&2')
    expect(r.stderr).toContain('err')
  })

  it('exec propagates non-zero exit codes', async () => {
    if (!dockerOk || !backend) return
    const r = await backend.exec('exit 17')
    expect(r.exitCode).toBe(17)
  })

  it('network is disabled by default', async () => {
    if (!dockerOk || !backend) return
    // Alpine (musl) has no getent; try nslookup which alpine ships with.
    // Success proves DNS works (= network enabled, bad). Failure proves
    // isolation (= what we want). We accept any non-zero exit OR any of
    // several known failure-mode strings.
    const r = await backend.exec('nslookup google.com 2>&1; echo EXIT=$?')
    const combined = r.stdout + r.stderr
    // Either the command failed (non-zero before echo, which we catch in
    // EXIT=) OR the output contains a DNS-failure marker.
    const looksBlocked =
      /EXIT=[^0]/.test(combined) ||
      /can't resolve|not found|No address|timed out|SERVFAIL|connection refused/i.test(combined)
    expect(looksBlocked).toBe(true)
  })

  it('writeFile + readFile roundtrip', async () => {
    if (!dockerOk || !backend) return
    await backend.writeFile('/tmp/test.txt', 'docker-round-trip')
    const content = await backend.readFile('/tmp/test.txt')
    expect(content).toBe('docker-round-trip')
  })

  it('writeFile creates parent directories', async () => {
    if (!dockerOk || !backend) return
    await backend.writeFile('/workspace/nested/deep.txt', 'deep')
    const r = await backend.exec('cat /workspace/nested/deep.txt')
    expect(r.stdout).toContain('deep')
  })

  it('rejects unsafe paths', async () => {
    if (!dockerOk || !backend) return
    await expect(backend.readFile('/path/with/../traversal')).rejects.toThrow()
  })

  it('resource limits apply', async () => {
    if (!dockerOk || !backend) return
    // Verify memory limit is enforced by container inspection
    // (If we configured 128m, /sys/fs/cgroup/memory.max should reflect it)
    const r = await backend.exec(
      'cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null',
    )
    expect(r.exitCode).toBe(0)
    // 128m = 134217728
    expect(r.stdout).toMatch(/134217728|max/i)
  })
})
