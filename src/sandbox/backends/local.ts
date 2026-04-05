/**
 * Local (no-isolation) sandbox backend — DEVELOPMENT ONLY.
 *
 * Runs commands directly on the host shell. No isolation, no resource
 * limits, no network restrictions. This exists purely as a fallback
 * when the user disables the sandbox entirely and wants quick iteration.
 *
 * **Do not use this with untrusted prompts in production.** The agent
 * can read any file the user can read, delete files, access the network,
 * and exfiltrate secrets.
 *
 * @module sandbox/backends/local
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile as fsWriteFile, readFile as fsReadFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { tmpdir } from 'node:os'

import type { SandboxBackend, ExecResult, ExecOptions, CommonSandboxConfig } from '../backend.js'
import { validateSandboxPath } from '../backend.js'

const execFileAsync = promisify(execFile)

export type LocalSandboxConfig = CommonSandboxConfig

const DEFAULT_CONFIG: Required<LocalSandboxConfig> = {
  // Use OS temp dir — `/tmp` doesn't exist on Windows.
  workDir: tmpdir(),
  defaultTimeout: 30000,
  networkDisabled: false, // inherently we can't disable the host network
}

export class LocalBackend implements SandboxBackend {
  readonly name = 'local' as const

  private config: Required<LocalSandboxConfig>
  private _isRunning = false

  constructor(config?: LocalSandboxConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async start(): Promise<void> {
    this._isRunning = true
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const timeout = options?.timeout ?? this.config.defaultTimeout
    // Use platform-native shell: cmd.exe on Windows, sh elsewhere. This keeps
    // the local-dev fallback working on every CI target; real isolation
    // should use the Docker or Shuru backend.
    const isWindows = process.platform === 'win32'
    const shell = isWindows ? (process.env['ComSpec'] ?? 'cmd.exe') : 'sh'
    const shellArgs = isWindows ? ['/d', '/s', '/c', command] : ['-c', command]
    try {
      const { stdout, stderr } = await execFileAsync(shell, shellArgs, {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        cwd: options?.cwd ?? this.config.workDir,
        env: options?.env ? { ...process.env, ...options.env } : process.env,
        windowsHide: true,
      })
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

  async writeFile(path: string, content: string): Promise<void> {
    validateSandboxPath(path)
    await mkdir(dirname(path), { recursive: true })
    await fsWriteFile(path, content, 'utf-8')
  }

  async readFile(path: string): Promise<string> {
    validateSandboxPath(path)
    return await fsReadFile(path, 'utf-8')
  }

  async destroy(): Promise<void> {
    this._isRunning = false
  }

  isRunning(): boolean {
    return this._isRunning
  }
}
