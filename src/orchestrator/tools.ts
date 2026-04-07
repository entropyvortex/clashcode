/**
 * Sandbox tool definitions and lifecycle management.
 *
 * v1.3: SandboxHandle replaces the module-level singleton. Each handle
 * owns its own backend instance, so concurrent sessions in the same
 * process are safe.
 *
 * The old @jackchen_me/open-multi-agent dependency has been replaced by
 * ClashEngine's native ToolVault and defineTool.
 *
 * @module orchestrator/tools
 */

import { defineTool, type ToolVault } from '../core/clash-engine/index.js'
import { z } from 'zod'
import { createSandboxBackend, type SandboxFactoryConfig } from '../sandbox/factory.js'
import type { SandboxBackend } from '../sandbox/backend.js'
import { ensureBootstrapCheckpoint } from '../sandbox/backends/shuru-bootstrap.js'
import { logger } from '../logger.js'
import { increment, observe } from '../telemetry.js'

// --- Sandbox lifecycle ---

// Module-level cleanup: register process listeners once, clean up all live handles.
const liveHandles = new Set<SandboxHandle>()
let moduleCleanupInstalled = false

// Track registered handlers so _resetCleanupHooks can remove them.
const registeredHandlers: Array<{ event: string; handler: (...args: unknown[]) => void }> = []

function installModuleCleanupHooks(): void {
  if (moduleCleanupInstalled) return
  moduleCleanupInstalled = true

  let cleanupInProgress = false
  const cleanup = async (code: number): Promise<void> => {
    if (cleanupInProgress) return
    cleanupInProgress = true
    await Promise.all([...liveHandles].map((h) => h.destroy()))
    process.exit(code)
  }

  const onExit = () => {
    for (const h of liveHandles) {
      h.destroy().catch(() => {})
    }
  }
  const onSigint = () => {
    void cleanup(130)
  }
  const onSigterm = () => {
    void cleanup(143)
  }
  const onUncaught = (err: Error) => {
    logger.error(`Uncaught exception in sandbox runtime: ${err.message}`)
    void cleanup(1)
  }
  const onUnhandled = (reason: unknown) => {
    const msg = reason instanceof Error ? reason.message : String(reason)
    logger.error(`Unhandled rejection in sandbox runtime: ${msg}`)
    void Promise.all([...liveHandles].map((h) => h.destroy())).catch(() => {})
  }

  process.on('exit', onExit)
  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)
  process.on('uncaughtException', onUncaught)
  process.on('unhandledRejection', onUnhandled)

  registeredHandlers.push(
    { event: 'exit', handler: onExit },
    { event: 'SIGINT', handler: onSigint },
    { event: 'SIGTERM', handler: onSigterm },
    { event: 'uncaughtException', handler: onUncaught as (...args: unknown[]) => void },
    { event: 'unhandledRejection', handler: onUnhandled as (...args: unknown[]) => void },
  )
}

/** @internal Reset module-level cleanup state (test-only). */
export function _resetCleanupHooks(): void {
  for (const { event, handler } of registeredHandlers) {
    process.removeListener(event, handler)
  }
  registeredHandlers.length = 0
  moduleCleanupInstalled = false
  liveHandles.clear()
}

/**
 * An owned sandbox lifecycle handle. Encapsulates the lazy-created
 * backend instance and the cleanup hooks for one logical session.
 */
export class SandboxHandle {
  private instance: SandboxBackend | null = null
  private config: SandboxFactoryConfig

  constructor(config: SandboxFactoryConfig = {}) {
    this.config = { ...config }
  }

  async get(): Promise<SandboxBackend> {
    if (this.instance) return this.instance

    const backend = await createSandboxBackend(this.config)

    // Shuru-specific: ensure the baseline checkpoint exists before booting.
    if (backend.name === 'shuru' && this.config.shuru?.checkpoint) {
      try {
        await ensureBootstrapCheckpoint({
          name: this.config.shuru.checkpoint,
          shuruBin: this.config.shuru.shuruBin,
          onProgress: (msg) => {
            logger.info(`sandbox: ${msg}`)
          },
        })
      } catch (err) {
        logger.warn(
          `sandbox checkpoint bootstrap failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    await backend.start()
    this.instance = backend

    liveHandles.add(this)
    installModuleCleanupHooks()
    return this.instance
  }

  /** Destroy the underlying backend. Safe to call multiple times. */
  async destroy(): Promise<void> {
    liveHandles.delete(this)
    const backend = this.instance
    this.instance = null
    if (!backend) return
    try {
      await Promise.race([backend.destroy(), new Promise((resolve) => setTimeout(resolve, 10_000))])
    } catch {
      // best effort
    }
  }

  isRunning(): boolean {
    return this.instance?.isRunning() ?? false
  }
}

// --- Legacy singleton API (backward compat) ---

let defaultHandle: SandboxHandle | null = null

/**
 * Configure the default sandbox backend before first use.
 *
 * @deprecated Prefer creating a `SandboxHandle` directly.
 */
export function configureSandbox(config: SandboxFactoryConfig): void {
  defaultHandle = new SandboxHandle(config)
}

// --- Tool factories ---

/**
 * Create sandbox tool definitions bound to a specific SandboxHandle.
 */
export function createSandboxTools(handle: SandboxHandle) {
  const getSandbox = () => handle.get()

  const sandboxExecTool = defineTool({
    name: 'sandbox_exec',
    description:
      'Execute a shell command inside the secure sandbox (Docker container or Shuru microVM). ' +
      'Use this for running untrusted code, build commands, or test suites in isolation.',
    inputSchema: z.object({
      command: z.string(),
      timeout: z.number().optional(),
    }),
    execute: async (input) => {
      const start = Date.now()
      try {
        const sandbox = await getSandbox()
        const result = await sandbox.exec(input.command, { timeout: input.timeout })
        increment('sandbox.exec', 1, { backend: sandbox.name })
        observe('sandbox.exec.ms', Date.now() - start, { backend: sandbox.name })
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
        return {
          data: output || '(no output)',
          metadata: { exitCode: result.exitCode, backend: sandbox.name },
        }
      } catch (err) {
        increment('sandbox.exec', 1, { status: 'error' })
        return {
          data: `Sandbox exec failed: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        }
      }
    },
  })

  const sandboxWriteTool = defineTool({
    name: 'sandbox_write',
    description: 'Write content to a file inside the sandbox.',
    inputSchema: z.object({
      path: z.string(),
      content: z.string(),
    }),
    execute: async (input) => {
      try {
        const sandbox = await getSandbox()
        await sandbox.writeFile(input.path, input.content)
        increment('sandbox.writeFile', 1, { backend: sandbox.name })
        return { data: `Written ${input.content.length} bytes to ${input.path}` }
      } catch (err) {
        return {
          data: `Sandbox write failed: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        }
      }
    },
  })

  const sandboxReadTool = defineTool({
    name: 'sandbox_read',
    description: 'Read a file from the sandbox.',
    inputSchema: z.object({
      path: z.string(),
    }),
    execute: async (input) => {
      try {
        const sandbox = await getSandbox()
        const content = await sandbox.readFile(input.path)
        increment('sandbox.readFile', 1, { backend: sandbox.name })
        return { data: content }
      } catch (err) {
        return {
          data: `Sandbox read failed: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        }
      }
    },
  })

  return { sandboxExecTool, sandboxWriteTool, sandboxReadTool }
}

// --- Registration ---

/** Register sandbox tools using a specific handle. */
export function registerSandboxToolsWithHandle(vault: ToolVault, handle: SandboxHandle): void {
  const tools = createSandboxTools(handle)
  vault.register(tools.sandboxExecTool)
  vault.register(tools.sandboxWriteTool)
  vault.register(tools.sandboxReadTool)
}

/**
 * Register sandbox tools using the default (singleton) handle.
 * @deprecated Prefer `registerSandboxToolsWithHandle` for concurrency safety.
 */
export function registerSandboxTools(vault: ToolVault): void {
  const tools = createSandboxTools(defaultHandle ?? new SandboxHandle())
  vault.register(tools.sandboxExecTool)
  vault.register(tools.sandboxWriteTool)
  vault.register(tools.sandboxReadTool)
}

export function registerAllTools(vault: ToolVault): void {
  registerSandboxTools(vault)
}
