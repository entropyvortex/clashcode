/**
 * Docker sandbox backend.
 *
 * Runs untrusted commands inside a Linux container with:
 *  - memory/cpu/pids limits
 *  - optional network isolation (`--network none`)
 *  - path validation on all file I/O
 *  - `docker cp` for file transfer (no shell interpolation)
 *  - optional seccomp and AppArmor profiles (v1.3)
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
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs'

import type { SandboxBackend, ExecResult, ExecOptions, CommonSandboxConfig } from '../backend.js'
import { validateSandboxPath } from '../backend.js'
import { SandboxError } from '../../errors.js'

const execFileAsync = promisify(execFile)

/** Docker-specific config fields (image, resource limits, security profiles). */
export interface DockerSandboxConfig extends CommonSandboxConfig {
  image?: string
  memoryLimit?: string
  cpuLimit?: string
  pidsLimit?: number
  /** Path to a seccomp profile JSON file. Set to 'builtin' for the default hardened profile. */
  seccompProfile?: string
  /** AppArmor profile name to apply. Set to 'unconfined' to disable. */
  apparmorProfile?: string
  /** Drop all Linux capabilities and only add back the ones listed here. */
  capAdd?: string[]
  /** Whether to mount the filesystem as read-only (container root). */
  readOnlyRootfs?: boolean
  /** Disable setuid/setgid bit elevation inside the container. */
  noNewPrivileges?: boolean
}

const DEFAULT_CONFIG: Required<
  Pick<
    DockerSandboxConfig,
    | 'image'
    | 'memoryLimit'
    | 'cpuLimit'
    | 'pidsLimit'
    | 'networkDisabled'
    | 'workDir'
    | 'defaultTimeout'
    | 'noNewPrivileges'
    | 'readOnlyRootfs'
  >
> = {
  image: 'node:20-slim',
  memoryLimit: '512m',
  cpuLimit: '1',
  pidsLimit: 256,
  networkDisabled: true,
  workDir: '/workspace',
  defaultTimeout: 30000,
  noNewPrivileges: true,
  readOnlyRootfs: false,
}

/**
 * Built-in seccomp profile that blocks dangerous syscalls.
 * Used when `seccompProfile === 'builtin'`.
 */
export const BUILTIN_SECCOMP_PROFILE = {
  defaultAction: 'SCMP_ACT_ALLOW',
  syscalls: [
    {
      names: [
        'kexec_load',
        'kexec_file_load',
        'reboot',
        'mount',
        'umount2',
        'pivot_root',
        'swapon',
        'swapoff',
        'init_module',
        'finit_module',
        'delete_module',
        'acct',
        'settimeofday',
        'clock_settime',
        'stime',
        'nfsservctl',
        'personality',
        'keyctl',
        'request_key',
        'add_key',
        'ptrace',
      ],
      action: 'SCMP_ACT_ERRNO',
      errnoRet: 1,
    },
  ],
}

export class DockerBackend implements SandboxBackend {
  readonly name = 'docker' as const

  private config: DockerSandboxConfig & typeof DEFAULT_CONFIG
  private containerId: string | null = null
  private _isRunning = false
  private _seccompTmpPath: string | null = null

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

    // Security hardening flags (v1.3)
    if (this.config.noNewPrivileges) {
      args.push('--security-opt', 'no-new-privileges:true')
    }

    if (this.config.readOnlyRootfs) {
      args.push('--read-only')
      // Need a writable tmpfs for /tmp and /workspace
      args.push('--tmpfs', '/tmp:rw,noexec,nosuid,size=64m')
      args.push('--tmpfs', `${this.config.workDir}:rw,exec,nosuid,size=256m`)
    }

    // Seccomp profile
    if (this.config.seccompProfile) {
      if (this.config.seccompProfile === 'builtin') {
        // Write the built-in profile to a temp file; cleaned up after docker run below.
        this._seccompTmpPath = join(
          tmpdir(),
          `clashcode-seccomp-${randomBytes(4).toString('hex')}.json`,
        )
        writeFileSync(this._seccompTmpPath, JSON.stringify(BUILTIN_SECCOMP_PROFILE), 'utf-8')
        args.push('--security-opt', `seccomp=${this._seccompTmpPath}`)
      } else if (existsSync(this.config.seccompProfile)) {
        args.push('--security-opt', `seccomp=${this.config.seccompProfile}`)
      }
    }

    // AppArmor profile
    if (this.config.apparmorProfile) {
      args.push('--security-opt', `apparmor=${this.config.apparmorProfile}`)
    }

    // Capability control
    if (this.config.capAdd && this.config.capAdd.length > 0) {
      args.push('--cap-drop', 'ALL')
      for (const cap of this.config.capAdd) {
        args.push('--cap-add', cap)
      }
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
    } finally {
      // Clean up the seccomp temp file now that docker has read it.
      if (this._seccompTmpPath) {
        try {
          unlinkSync(this._seccompTmpPath)
        } catch {
          /* best effort */
        }
        this._seccompTmpPath = null
      }
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
    const id = this.containerId
    this.containerId = null
    this._isRunning = false
    try {
      await execFileAsync('docker', ['rm', '-f', id], { timeout: 15000 })
    } catch {
      // best effort
    }
  }

  isRunning(): boolean {
    return this._isRunning
  }
}
