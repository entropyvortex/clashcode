/**
 * Shuru microVM sandbox backend (macOS / Apple Silicon only).
 *
 * Runs untrusted commands inside an ephemeral Linux microVM booted via
 * Apple's Virtualization.framework. Each sandbox has:
 *  - its own Linux kernel (true VM isolation, not just container namespaces)
 *  - tmpfs overlay by default — host filesystem is read-only / unreachable
 *  - vsock-only I/O — no network device unless explicitly allowed
 *  - host-list allowlist + per-host secret proxy (secrets never enter the VM)
 *
 * Requires `shuru` CLI installed on the host (see https://shuru.sh).
 * On macOS: `brew tap superhq-ai/tap && brew install shuru`.
 *
 * The SDK package `@superhq/shuru` is loaded dynamically so non-mac
 * platforms don't need it at install time.
 *
 * @module sandbox/backends/shuru
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { SandboxBackend, ExecResult, ExecOptions, CommonSandboxConfig } from '../backend.js'
import { validateSandboxPath } from '../backend.js'
import { SandboxError } from '../../errors.js'

const execFileAsync = promisify(execFile)

/** Shuru-specific config fields. */
export interface ShuruSandboxConfig extends CommonSandboxConfig {
  /** Checkpoint name to boot from (fast-start with preinstalled tools). */
  checkpoint?: string | null
  /** Number of vCPUs. */
  cpus?: number
  /** Memory in MB. */
  memory?: number
  /** Disk size in MB. */
  diskSize?: number
  /** Allow any outbound network (overrides allowedHosts). */
  allowNet?: boolean
  /** Allowlist of hosts the guest may reach (empty = allow-all if allowNet). */
  allowedHosts?: string[]
  /** Directory mounts: { hostPath: guestPath }. Writes overlay by default. */
  mounts?: Record<string, string>
  /** Port forwards, e.g. ["8080:80"]. */
  ports?: string[]
  /** Path to the `shuru` binary (default: PATH lookup). */
  shuruBin?: string
}

const DEFAULT_CONFIG: Required<Omit<ShuruSandboxConfig, 'checkpoint' | 'shuruBin'>> & {
  checkpoint: string | null
  shuruBin: string
} = {
  checkpoint: 'clashcode-env',
  cpus: 2,
  memory: 2048,
  diskSize: 4096,
  allowNet: false,
  allowedHosts: [],
  mounts: {},
  ports: [],
  networkDisabled: true,
  workDir: '/workspace',
  defaultTimeout: 30000,
  shuruBin: 'shuru',
}

/** Check whether the `shuru` CLI is available on the host PATH. */
export async function isShuruAvailable(bin = 'shuru'): Promise<boolean> {
  try {
    await execFileAsync(bin, ['--version'], { timeout: 3000 })
    return true
  } catch {
    return false
  }
}

/**
 * Minimal structural type we depend on from @superhq/shuru. The real
 * package exposes many more methods — we only use the subset we need.
 */
interface ShuruSdkSandbox {
  exec(cmd: string): Promise<{ stdout: string; stderr: string; exitCode: number }>
  writeFile(path: string, content: string | Uint8Array): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  // checkpoint also stops the VM in the SDK
  checkpoint?(name: string): Promise<void>
  // Some SDK versions expose an explicit stop/close
  stop?(): Promise<void>
  close?(): Promise<void>
}

interface ShuruSdkModule {
  Sandbox: {
    start(opts?: Record<string, unknown>): Promise<ShuruSdkSandbox>
  }
}

export class ShuruBackend implements SandboxBackend {
  readonly name = 'shuru' as const

  private config: typeof DEFAULT_CONFIG
  private sandbox: ShuruSdkSandbox | null = null
  private _isRunning = false

  constructor(config?: ShuruSandboxConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async start(): Promise<void> {
    if (this._isRunning && this.sandbox) return

    // Dynamically import @superhq/shuru. This keeps the dep optional
    // for Linux users who can't run Shuru anyway.
    let sdk: ShuruSdkModule
    try {
      // Name built at runtime so tsc doesn't try to resolve the optional dep.
      const pkg = '@superhq/shuru'
      sdk = (await import(/* @vite-ignore */ pkg)) as unknown as ShuruSdkModule
    } catch (err) {
      throw new SandboxError(
        '@superhq/shuru SDK not installed. Run `bun add @superhq/shuru` ' +
          '(or `npm i @superhq/shuru`) to enable the Shuru backend. ' +
          `Original error: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }

    // Require shuru CLI binary too (SDK spawns it under the hood)
    if (!(await isShuruAvailable(this.config.shuruBin))) {
      throw new SandboxError(
        `shuru CLI not found on PATH (looked for: ${this.config.shuruBin}). ` +
          'Install: `brew tap superhq-ai/tap && brew install shuru`',
      )
    }

    const startOpts: Record<string, unknown> = {
      cpus: this.config.cpus,
      memory: this.config.memory,
      diskSize: this.config.diskSize,
      allowNet: this.config.allowNet || this.config.allowedHosts.length > 0,
      shuruBin: this.config.shuruBin,
    }

    if (this.config.checkpoint) startOpts.from = this.config.checkpoint
    if (this.config.allowedHosts.length > 0) {
      startOpts.network = { allow: this.config.allowedHosts }
    }
    if (Object.keys(this.config.mounts).length > 0) {
      startOpts.mounts = this.config.mounts
    }
    if (this.config.ports.length > 0) {
      startOpts.ports = this.config.ports
    }

    try {
      this.sandbox = await sdk.Sandbox.start(startOpts)
      this._isRunning = true
    } catch (err) {
      throw new SandboxError(
        `Failed to start Shuru sandbox: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    if (!this.sandbox || !this._isRunning) {
      throw new SandboxError('Sandbox is not running. Call start() first.')
    }

    // Shuru's exec doesn't take a timeout directly; we race against a timer.
    const timeout = options?.timeout ?? this.config.defaultTimeout

    // Wrap the command with cd/env if requested (no host shell involved —
    // this string is interpreted by the guest's /bin/sh).
    let wrapped = command
    if (options?.cwd) {
      const safeCwd = options.cwd.replace(/'/g, `'\\''`)
      wrapped = `cd '${safeCwd}' && ${wrapped}`
    }
    if (options?.env) {
      const envPrefix = Object.entries(options.env)
        .map(([k, v]) => `${k}='${String(v).replace(/'/g, `'\\''`)}'`)
        .join(' ')
      wrapped = `${envPrefix} ${wrapped}`
    }

    let timer: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<ExecResult>((resolve) => {
      timer = setTimeout(() => {
        resolve({
          stdout: '',
          stderr: `Command timed out after ${timeout}ms`,
          exitCode: 124,
        })
      }, timeout)
    })

    try {
      const execPromise = this.sandbox.exec(wrapped).then((r) => ({
        stdout: r.stdout ?? '',
        stderr: r.stderr ?? '',
        exitCode: r.exitCode ?? 0,
      }))
      const result = await Promise.race([execPromise, timeoutPromise])
      return result
    } catch (err) {
      return {
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: 1,
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!this.sandbox || !this._isRunning) {
      throw new SandboxError('Sandbox is not running. Call start() first.')
    }
    validateSandboxPath(path)
    await this.sandbox.writeFile(path, content)
  }

  async readFile(path: string): Promise<string> {
    if (!this.sandbox || !this._isRunning) {
      throw new SandboxError('Sandbox is not running. Call start() first.')
    }
    validateSandboxPath(path)
    const bytes = await this.sandbox.readFile(path)
    return new TextDecoder().decode(bytes)
  }

  async destroy(): Promise<void> {
    if (!this.sandbox) return
    try {
      if (typeof this.sandbox.stop === 'function') {
        await this.sandbox.stop()
      } else if (typeof this.sandbox.close === 'function') {
        await this.sandbox.close()
      }
      // Otherwise: Shuru VMs are ephemeral and tear down on process exit.
    } catch {
      // best effort
    }
    this.sandbox = null
    this._isRunning = false
  }

  isRunning(): boolean {
    return this._isRunning
  }
}
