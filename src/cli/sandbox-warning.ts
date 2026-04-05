/**
 * Security warning for unsafe sandbox backends.
 *
 * The `local` backend runs agent-generated commands directly on the host
 * shell with no isolation. That's fine for tight inner-loop development
 * but catastrophic with an untrusted prompt. We surface a loud warning
 * whenever a session would resolve to `local`.
 *
 * @module cli/sandbox-warning
 */

import { c } from './ui.js'
import { logger } from '../logger.js'

/** Env var that acknowledges the risk and silences the warning. */
const ACK_ENV = 'CLASHCODE_ACK_LOCAL_SANDBOX'

/**
 * Print a startup warning if the configured / resolved backend is `local`.
 *
 * Resolution: if `configured === 'auto'`, this delegates to
 * {@link resolveBackend} to see what `auto` picks on this host. If the
 * result is `local` (because neither Shuru nor Docker was available), we
 * still warn — the user almost certainly didn't choose it intentionally.
 *
 * Silenced by `CLASHCODE_ACK_LOCAL_SANDBOX=1` (CI / scripted tests /
 * users who've read the docs).
 */
export async function warnIfUnsafeSandbox(configured: string): Promise<void> {
  if (process.env[ACK_ENV] === '1') return

  // Quick path: user explicitly chose 'local'.
  if (configured === 'local') {
    printWarning('explicit')
    return
  }

  // 'auto' may fall back to 'local' when Shuru and Docker are both absent.
  if (configured === 'auto') {
    try {
      const { resolveBackend } = await import('../sandbox/factory.js')
      const resolved = await resolveBackend('auto')
      if (resolved === 'local') printWarning('fallback')
    } catch (err) {
      // Resolution itself failing is odd but non-fatal here.
      logger.debug(
        `sandbox resolution check failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

function printWarning(kind: 'explicit' | 'fallback'): void {
  const header = `${c.bold}${c.red}╭─ ⚠  UNSAFE SANDBOX — local shell mode ─────────────────────╮${c.reset}`
  const footer = `${c.bold}${c.red}╰────────────────────────────────────────────────────────────╯${c.reset}`
  const reason =
    kind === 'explicit'
      ? 'You explicitly selected the "local" sandbox backend.'
      : 'Neither Shuru nor Docker is available; auto-resolution fell back to "local".'
  const body = [
    reason,
    '',
    'Agents will run shell commands, read files, and reach the network',
    "with your user's full privileges. There is no isolation.",
    '',
    `  ${c.yellow}•${c.reset} Do NOT feed untrusted prompts or paste URLs from strangers.`,
    `  ${c.yellow}•${c.reset} Install Docker or Shuru (macOS) for real isolation.`,
    `  ${c.yellow}•${c.reset} Silence this warning with ${c.cyan}${ACK_ENV}=1${c.reset}.`,
  ]
  const inner = body.map((l) => `${c.red}│${c.reset} ${l}`).join('\n')
  process.stderr.write(`\n${header}\n${inner}\n${footer}\n\n`)
}
