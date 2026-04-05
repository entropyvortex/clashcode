/**
 * Pluggable sandbox backend interface.
 *
 * A sandbox isolates untrusted command execution (coder/reviewer agents,
 * LLM-generated shell commands) from the host. Different backends provide
 * different isolation levels and platform support:
 *
 * - **docker** — Linux container, shared host kernel (default on Linux).
 * - **shuru** — true microVM via Apple Virtualization.framework
 *   (default on macOS/Apple Silicon; strongest isolation).
 * - **local** — no isolation, runs in host shell (DEV-ONLY, off by default).
 *
 * All backends share this interface so the rest of the codebase can swap
 * them transparently.
 *
 * @module sandbox/backend
 */

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface ExecOptions {
  timeout?: number
  cwd?: string
  env?: Record<string, string>
}

/**
 * Configuration common to every backend. Backend-specific fields live
 * under their own namespaced config (e.g. `shuru`, `docker`).
 */
export interface CommonSandboxConfig {
  /** Filesystem path used as the sandbox's primary working directory. */
  workDir?: string
  /** Default per-command timeout (ms). */
  defaultTimeout?: number
  /** Whether the sandbox has outbound network access at all. */
  networkDisabled?: boolean
}

/**
 * Abstract sandbox backend. Implementations must be safe to call
 * multiple times (`start` is idempotent) and must clean up any
 * external resources in `destroy`.
 */
export interface SandboxBackend {
  /** Human-readable identifier for logs and diagnostics. */
  readonly name: 'docker' | 'shuru' | 'local'

  /** Boot the sandbox. Idempotent. */
  start(): Promise<void>

  /** Execute a shell command inside the sandbox. */
  exec(command: string, options?: ExecOptions): Promise<ExecResult>

  /** Write a file into the sandbox (absolute path inside guest). */
  writeFile(path: string, content: string): Promise<void>

  /** Read a file from inside the sandbox (absolute path inside guest). */
  readFile(path: string): Promise<string>

  /** Tear down the sandbox. Best-effort — safe to call before `start`. */
  destroy(): Promise<void>

  /** Current running state. */
  isRunning(): boolean
}

// ── Shared path validation ─────────────────────────────────────────

/** Characters allowed in sandbox file paths. */
const SAFE_PATH_RE = /^[a-zA-Z0-9_./ -]+$/

/**
 * Validate a path for use inside the sandbox.
 * Rejects shell metacharacters, traversal sequences, and empty paths.
 * Backends should call this before passing paths to any shell-ish API.
 */
import { SandboxError } from '../errors.js'

export function validateSandboxPath(p: string): void {
  if (!p || p.length === 0) throw new SandboxError('Empty path')
  if (!p.startsWith('/')) throw new SandboxError(`Path must be absolute: ${p}`)
  if (p.includes('..')) throw new SandboxError(`Path traversal rejected: ${p}`)
  if (!SAFE_PATH_RE.test(p)) throw new SandboxError(`Path contains unsafe characters: ${p}`)
}
