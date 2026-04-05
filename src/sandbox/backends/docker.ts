/**
 * Docker sandbox backend.
 *
 * Runs untrusted commands inside a Linux container with:
 *  - memory/cpu/pids limits
 *  - optional network isolation (`--network none`)
 *  - path validation on all file I/O
 *  - `docker cp` for file transfer (no shell interpolation)
 *
 * This is the default backend on Linux. On macOS/Apple Silicon we
 * prefer the Shuru microVM backend (stronger isolation + no Docker
 * Desktop dependency).
 *
 * @module sandbox/backends/docker
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs'

import type { SandboxBackend, ExecResult, ExecOptions, CommonSandboxConfig } from '../backend.js'
import { validateSandboxPath } from '../backend.js'
import { SandboxError } from '../../errors.js'

const execFileAsync = promisify(execFile)

/** Docker-specific config fields (image, resource limits). */
export interface DockerSandboxConfig extends CommonSandboxConfig {
  image?: string
  memoryLimit?: string
  cpuLimit?: string
  pidsLimit?: number
}

const DEFAULT_CONFIG: Required<DockerSandboxConfig> = {
  image: 'node:20-slim',
  memoryLimit: '512m',
  cpuLimit: '1',
  pidsLimit: 256,
  networkDisabled: true,
  workDir: '/workspace',
  defaultTimeout: 30000,
}

export class DockerBackend implements SandboxBackend {
  readonly name = 'docker' as const

  private config: Required<DockerSandboxConfig>
  private containerId: string | null = null
  private _isRunning = false

  constructor(config?: DockerSandboxConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async start(): Promise<void> {
    if (this._isRunning && this.containerId) return

    const name = `clashcode-sandbox-${randomBytes(4).toString('hex')}`
    const args = [
      'run',
      '-d',
      '--name',
      name,
      '--memory',
      this.config.memoryLimit,
      '--cpus',
      this.config.cpuLimit,
      '--pids-limit',
      String(this.config.pidsLimit),
      '-w',
      this.config.workDir,
    ]

    if (this.config.networkDisabled) {
      args.push('--network', 'none')
    }

    args.push(this.config.image, 'sleep', 'infinity')

    try {
      const { stdout } = await execFileAsync('docker', args, { timeout: 30000 })
      this.containerId = stdout.trim()
      this._isRunning = true
    } catch (err) {
      throw new SandboxError(
        `Failed to start docker sandbox: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    if (!this.containerId || !this._isRunning) {
      throw new SandboxError('Sandbox is not running. Call start() first.')
    }

    const timeout = options?.timeout ?? this.config.defaultTimeout
    const cwdArgs = options?.cwd ? ['-w', options.cwd] : []
    const envArgs: string[] = []
    if (options?.env) {
      for (const [k, v] of Object.entries(options.env)) {
        envArgs.push('-e', `${k}=${v}`)
      }
    }

    try {
      const { stdout, stderr } = await execFileAsync(
        'docker',
        ['exec', ...cwdArgs, ...envArgs, this.containerId, 'sh', '-c', command],
        { timeout, maxBuffer: 10 * 1024 * 1024 },
      )
      return { stdout, stderr, exitCode: 0 }
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number | string }
      return {
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? (err instanceof Error ? err.message : String(err)),
        exitCode: typeof e.code === 'number' ? e.code : 1,
      }
    }
  }

  /**
   * Write a file to the container using docker cp.
   * Content is written to a host tempfile then copied in — no shell interpolation.
   */
  async writeFile(path: string, content: string): Promise<void> {
    if (!this.containerId || !this._isRunning) {
      throw new SandboxError('Sandbox is not running. Call start() first.')
    }
    validateSandboxPath(path)

    const tmp = join(tmpdir(), `clashcode-${randomBytes(6).toString('hex')}`)
    try {
      writeFileSync(tmp, content, 'utf-8')
      const parentDir = path.substring(0, path.lastIndexOf('/')) || '/'
      await execFileAsync('docker', ['exec', this.containerId, 'mkdir', '-p', parentDir], {
        timeout: 10000,
      })
      await execFileAsync('docker', ['cp', tmp, `${this.containerId}:${path}`], { timeout: 10000 })
    } finally {
      try {
        unlinkSync(tmp)
      } catch {
        /* best effort */
      }
    }
  }

  async readFile(path: string): Promise<string> {
    if (!this.containerId || !this._isRunning) {
      throw new SandboxError('Sandbox is not running. Call start() first.')
    }
    validateSandboxPath(path)

    const tmp = join(tmpdir(), `clashcode-${randomBytes(6).toString('hex')}`)
    try {
      await execFileAsync('docker', ['cp', `${this.containerId}:${path}`, tmp], { timeout: 10000 })
      return readFileSync(tmp, 'utf-8')
    } catch (err) {
      throw new SandboxError(
        `Failed to read ${path}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    } finally {
      try {
        unlinkSync(tmp)
      } catch {
        /* best effort */
      }
    }
  }

  async destroy(): Promise<void> {
    if (!this.containerId) return
    try {
      await execFileAsync('docker', ['rm', '-f', this.containerId], { timeout: 15000 })
    } catch {
      // best effort
    }
    this.containerId = null
    this._isRunning = false
  }

  isRunning(): boolean {
    return this._isRunning
  }
}
