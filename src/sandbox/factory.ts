/**
 * Sandbox backend factory + auto-detection.
 *
 * @module sandbox/factory
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { logger } from '../logger.js'
import type { SandboxBackend } from './backend.js'
import { DockerBackend, type DockerSandboxConfig } from './backends/docker.js'
import { ShuruBackend, type ShuruSandboxConfig, isShuruAvailable } from './backends/shuru.js'
import { LocalBackend, type LocalSandboxConfig } from './backends/local.js'

const execFileAsync = promisify(execFile)

export type SandboxBackendName = 'docker' | 'shuru' | 'local' | 'auto'

export interface SandboxFactoryConfig {
  backend?: SandboxBackendName
  docker?: DockerSandboxConfig
  shuru?: ShuruSandboxConfig
  local?: LocalSandboxConfig
}

/**
 * Decide which backend to use for the current host.
 *
 * Priority when `backend === 'auto'`:
 *   1. macOS + Apple Silicon + `shuru` CLI present  → shuru
 *   2. `docker` CLI present                          → docker
 *   3. fallback                                      → local (with a warning)
 */
export async function resolveBackend(
  name: SandboxBackendName,
): Promise<Exclude<SandboxBackendName, 'auto'>> {
  if (name !== 'auto') return name

  // Prefer Shuru on Apple Silicon macOS when available
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    if (await isShuruAvailable()) return 'shuru'
  }

  // Otherwise prefer Docker if reachable
  try {
    await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 3000 })
    return 'docker'
  } catch (err: unknown) {
    const code = (err as { code?: string }).code
    if (code !== 'ENOENT') {
      // Docker CLI exists but daemon is unreachable — warn so the user
      // knows we fell back to the insecure local backend.
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn(
        `Docker CLI found but daemon unavailable (${msg}); falling back to local sandbox (no isolation)`,
      )
    }
  }

  return 'local'
}

/** Build a backend instance from resolved config. */
export async function createSandboxBackend(
  config: SandboxFactoryConfig = {},
): Promise<SandboxBackend> {
  const requested = config.backend ?? 'auto'
  const resolved = await resolveBackend(requested)

  switch (resolved) {
    case 'shuru':
      return new ShuruBackend(config.shuru)
    case 'docker':
      return new DockerBackend(config.docker)
    case 'local':
      return new LocalBackend(config.local)
  }
}
