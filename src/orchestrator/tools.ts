import type { ToolRegistry } from '@jackchen_me/open-multi-agent'
import { defineTool } from '@jackchen_me/open-multi-agent'
import { z } from 'zod'
import { createSandboxBackend, type SandboxFactoryConfig } from '../sandbox/factory.js'
import type { SandboxBackend } from '../sandbox/backend.js'
import { ensureBootstrapCheckpoint } from '../sandbox/backends/shuru-bootstrap.js'
import { logger } from '../logger.js'
import { increment, observe } from '../telemetry.js'

// --- Sandbox tools ---
//
// The sandbox backend is resolved lazily on first use so the cost of
// booting Docker / Shuru only hits users who actually run sandboxed
// commands. The factory auto-picks Shuru on macOS/Apple Silicon and
// Docker elsewhere — override via settings.sandbox.backend.

let sandboxInstance: SandboxBackend | null = null
let configuredFactory: SandboxFactoryConfig = {}

/**
 * Configure the sandbox backend before first use.
 * Call this once at startup with resolved settings.
 */
export function configureSandbox(config: SandboxFactoryConfig): void {
  configuredFactory = config
}

async function getSandbox(): Promise<SandboxBackend> {
  if (sandboxInstance) return sandboxInstance

  const backend = await createSandboxBackend(configuredFactory)

  // Shuru-specific: ensure the baseline checkpoint exists before booting.
  // This is a one-time first-run cost (~30-60s on fresh Apple Silicon Macs).
  if (backend.name === 'shuru' && configuredFactory.shuru?.checkpoint) {
    try {
      await ensureBootstrapCheckpoint({
        name: configuredFactory.shuru.checkpoint,
        shuruBin: configuredFactory.shuru.shuruBin,
        onProgress: (msg) => {
          logger.info(`sandbox: ${msg}`)
        },
      })
    } catch (err) {
      // Non-fatal — user might have a pre-existing different checkpoint.
      logger.warn(
        `sandbox checkpoint bootstrap failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  await backend.start()
  sandboxInstance = backend

  installSandboxCleanupHooks()
  return sandboxInstance
}

let cleanupHooksInstalled = false
let cleanupInProgress = false

/**
 * Install signal handlers that destroy the active sandbox on exit.
 *
 * destroy() is async (docker rm -f or VM stop), so we await it before
 * `process.exit` to avoid orphan containers/VMs. Uses a 10s grace timeout
 * so the process can't hang forever on a wedged docker daemon.
 *
 * Idempotent — safe to call multiple times.
 */
function installSandboxCleanupHooks(): void {
  if (cleanupHooksInstalled) return
  cleanupHooksInstalled = true

  const cleanup = async (code: number): Promise<void> => {
    if (cleanupInProgress) return
    cleanupInProgress = true
    const instance = sandboxInstance
    sandboxInstance = null
    if (!instance) {
      process.exit(code)
      return
    }
    try {
      // Race destroy against a grace timeout
      await Promise.race([
        instance.destroy(),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ])
    } catch {
      // best effort
    }
    process.exit(code)
  }

  // 'exit' is sync-only; fire-and-forget best effort
  process.on('exit', () => {
    sandboxInstance?.destroy().catch(() => {})
  })
  process.on('SIGINT', () => {
    void cleanup(130)
  })
  process.on('SIGTERM', () => {
    void cleanup(143)
  })
  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception in sandbox runtime: ${err.message}`)
    void cleanup(1)
  })
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason)
    logger.error(`Unhandled rejection in sandbox runtime: ${msg}`)
    // Don't exit on unhandled rejection — let the top-level handler decide
  })
}

const sandboxExecTool = defineTool({
  name: 'sandbox_exec',
  description:
    'Execute a shell command inside the secure sandbox (Docker container or Shuru microVM). ' +
    'Use this for running untrusted code, build commands, or test suites in isolation.',
  inputSchema: z.object({
    command: z.string().describe('Shell command to execute'),
    timeout: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
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
    path: z.string().describe('Absolute path inside the sandbox'),
    content: z.string().describe('File content to write'),
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
    path: z.string().describe('Absolute path inside the sandbox'),
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

// --- Registration ---

export function registerSandboxTools(registry: ToolRegistry): void {
  registry.register(sandboxExecTool)
  registry.register(sandboxWriteTool)
  registry.register(sandboxReadTool)
}

export function registerAllTools(registry: ToolRegistry): void {
  registerSandboxTools(registry)
}
