/**
 * SandboxManager — thin back-compat wrapper around the pluggable
 * {@link SandboxBackend} interface.
 *
 * Historically this class was Docker-specific. Now it delegates to
 * whichever backend was chosen via the factory (docker | shuru | local).
 * Existing code importing `SandboxManager` keeps working unchanged.
 *
 * For new code, prefer importing a backend directly or using
 * {@link createSandboxBackend}.
 *
 * @module sandbox/manager
 */

import type { SandboxBackend, ExecResult } from './backend.js'
import { DockerBackend, type DockerSandboxConfig } from './backends/docker.js'

/** @deprecated Use {@link DockerSandboxConfig} or {@link SandboxBackend} directly. */
export type SandboxConfig = DockerSandboxConfig

export type { ExecResult } from './backend.js'

/**
 * Legacy Docker-backed sandbox manager. New code should use
 * {@link createSandboxBackend} from `./factory` to pick the right
 * backend automatically (Shuru on macOS, Docker on Linux).
 */
export class SandboxManager {
  private backend: SandboxBackend

  constructor(config?: SandboxConfig) {
    this.backend = new DockerBackend(config)
  }

  start(): Promise<void> {
    return this.backend.start()
  }

  exec(command: string, options?: { timeout?: number }): Promise<ExecResult> {
    return this.backend.exec(command, options)
  }

  writeFile(path: string, content: string): Promise<void> {
    return this.backend.writeFile(path, content)
  }

  readFile(path: string): Promise<string> {
    return this.backend.readFile(path)
  }

  destroy(): Promise<void> {
    return this.backend.destroy()
  }

  isRunning(): boolean {
    return this.backend.isRunning()
  }
}
