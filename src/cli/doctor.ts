/**
 * `/doctor` — diagnostic self-check.
 *
 * Prints a pass/fail table for every subsystem ClashCode relies on:
 * version, environment, sandbox backend reachability, provider key
 * presence, keychain availability. Used for bug reports and first-run
 * sanity checks.
 *
 * @module cli/doctor
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { VERSION } from './ui.js'
import type { Settings } from '../config/index.js'
import { keychain } from '../config/keychain.js'
import { isShuruAvailable } from '../sandbox/backends/shuru.js'
import { resolveBackend } from '../sandbox/factory.js'

const execFileAsync = promisify(execFile)

type CheckStatus = 'pass' | 'warn' | 'fail' | 'info'

interface Check {
  name: string
  status: CheckStatus
  detail: string
}

async function hasDocker(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 3000 })
    return true
  } catch {
    return false
  }
}

function providerEnvVar(provider: string): string {
  const map: Record<string, string> = {
    grok: 'XAI_API_KEY',
    xai: 'XAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    copilot: 'COPILOT_API_KEY',
    gemini: 'GEMINI_API_KEY',
  }
  return map[provider] ?? `${provider.toUpperCase()}_API_KEY`
}

export async function runDoctor(settings: Settings): Promise<Check[]> {
  const checks: Check[] = []

  // ── Version + environment ────────────────────────────────────
  checks.push({ name: 'clashcode', status: 'info', detail: `v${VERSION}` })
  checks.push({
    name: 'node',
    status: 'info',
    detail: `${process.version} (${process.platform}/${process.arch})`,
  })

  const nodeMajor = Number.parseInt(process.version.slice(1).split('.')[0] ?? '0', 10)
  if (nodeMajor < 20) {
    checks.push({ name: 'node version', status: 'fail', detail: 'requires >= 20' })
  } else {
    checks.push({ name: 'node version', status: 'pass', detail: `>= 20 ✓` })
  }

  // ── Provider API key ─────────────────────────────────────────
  const providerKey = settings.provider === 'xai' ? 'grok' : settings.provider
  const envVar = providerEnvVar(providerKey)
  const fromEnv = Boolean(process.env[envVar])
  const fromKeychain = Boolean(await keychain.get(providerKey))
  const fromSettings = Boolean(settings.apiKeys[providerKey])

  if (fromKeychain) {
    checks.push({ name: `api key (${providerKey})`, status: 'pass', detail: 'found in keychain' })
  } else if (fromEnv) {
    checks.push({ name: `api key (${providerKey})`, status: 'pass', detail: `found in $${envVar}` })
  } else if (fromSettings) {
    checks.push({
      name: `api key (${providerKey})`,
      status: 'warn',
      detail: 'found in settings.json (plaintext — prefer keychain or env)',
    })
  } else {
    checks.push({
      name: `api key (${providerKey})`,
      status: 'fail',
      detail: `not found — set $${envVar} or run "/keychain set ${providerKey} <key>"`,
    })
  }

  // ── Keychain availability ────────────────────────────────────
  const keychainOk = await keychain.isAvailable()
  checks.push({
    name: 'keychain (keytar)',
    status: keychainOk ? 'pass' : 'info',
    detail: keychainOk ? 'available' : 'not installed (optional)',
  })

  // ── Sandbox backends ─────────────────────────────────────────
  const configured = settings.sandbox.backend
  const resolved = await resolveBackend(configured)
  checks.push({
    name: 'sandbox backend',
    status: 'info',
    detail: `configured=${configured}, resolved=${resolved}`,
  })

  const dockerOk = await hasDocker()
  checks.push({
    name: 'docker daemon',
    status: dockerOk ? 'pass' : resolved === 'docker' ? 'fail' : 'info',
    detail: dockerOk ? 'reachable' : 'not reachable',
  })

  const shuruOk = await isShuruAvailable()
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    checks.push({
      name: 'shuru CLI',
      status: shuruOk ? 'pass' : resolved === 'shuru' ? 'fail' : 'warn',
      detail: shuruOk
        ? 'installed'
        : 'not installed (brew tap superhq-ai/tap && brew install shuru)',
    })
  }

  // ── Settings integrity ───────────────────────────────────────
  checks.push({
    name: 'configVersion',
    status: 'info',
    detail: String(settings.configVersion ?? 1),
  })
  checks.push({
    name: 'team mode',
    status: 'info',
    detail: settings.teamMode ? 'on' : 'off',
  })
  if (settings.coordinatorModel) {
    checks.push({
      name: 'coordinator model',
      status: 'pass',
      detail: `override → ${settings.coordinatorModel}`,
    })
  }

  return checks
}

const STATUS_GLYPHS: Record<CheckStatus, string> = {
  pass: '✓',
  warn: '⚠',
  fail: '✗',
  info: '·',
}

const STATUS_COLOURS: Record<CheckStatus, string> = {
  pass: '\x1b[32m',
  warn: '\x1b[33m',
  fail: '\x1b[31m',
  info: '\x1b[90m',
}

/** Format check results as an aligned terminal table. */
export function formatDoctorReport(checks: Check[]): string {
  const reset = '\x1b[0m'
  const nameWidth = Math.max(...checks.map((c) => c.name.length), 16)
  const lines = checks.map((c) => {
    const glyph = `${STATUS_COLOURS[c.status]}${STATUS_GLYPHS[c.status]}${reset}`
    const name = c.name.padEnd(nameWidth)
    return `  ${glyph} ${name}  \x1b[90m${c.detail}${reset}`
  })
  const failed = checks.filter((c) => c.status === 'fail').length
  const warned = checks.filter((c) => c.status === 'warn').length
  const summary =
    failed > 0
      ? `\n  \x1b[31m${failed} check(s) failed${reset}${warned > 0 ? `, \x1b[33m${warned} warning(s)${reset}` : ''}`
      : warned > 0
        ? `\n  \x1b[33m${warned} warning(s)${reset}`
        : `\n  \x1b[32mall checks passed${reset}`
  return lines.join('\n') + summary
}
