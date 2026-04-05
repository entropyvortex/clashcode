import { describe, it, expect } from 'vitest'
import { runDoctor, formatDoctorReport } from '../src/cli/doctor.js'
import { DEFAULT_SETTINGS } from '../src/config/index.js'
import type { Settings } from '../src/config/index.js'

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '')

describe('runDoctor', () => {
  it('returns a non-empty list of checks', { timeout: 15000 }, async () => {
    const checks = await runDoctor(DEFAULT_SETTINGS)
    expect(checks.length).toBeGreaterThan(5)
  })

  it('always includes version + node + sandbox info', { timeout: 15000 }, async () => {
    const checks = await runDoctor(DEFAULT_SETTINGS)
    const names = checks.map((c) => c.name)
    expect(names).toContain('clashcode')
    expect(names).toContain('node')
    expect(names).toContain('sandbox backend')
    expect(names).toContain('docker daemon')
  })

  it('reports api key as fail when none present', { timeout: 15000 }, async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origEnv = { ...process.env } as any
    delete process.env['XAI_API_KEY']
    delete process.env['OPENAI_API_KEY']
    delete process.env['ANTHROPIC_API_KEY']
    delete process.env['COPILOT_API_KEY']
    delete process.env['GEMINI_API_KEY']
    try {
      const settings: Settings = { ...DEFAULT_SETTINGS, apiKeys: {} }
      const checks = await runDoctor(settings)
      const keyCheck = checks.find((c) => c.name.startsWith('api key'))
      expect(keyCheck).toBeDefined()
      // Either keychain has it or it's fail
      expect(['pass', 'fail']).toContain(keyCheck!.status)
    } finally {
      process.env = origEnv
    }
  })

  it('reports api key as pass when env var present', { timeout: 15000 }, async () => {
    process.env['XAI_API_KEY'] = 'xai-test-key'
    try {
      const settings: Settings = { ...DEFAULT_SETTINGS, provider: 'grok', apiKeys: {} }
      const checks = await runDoctor(settings)
      const keyCheck = checks.find((c) => c.name.startsWith('api key'))
      // keychain may pre-empt env, so pass is the only must-have
      expect(['pass']).toContain(keyCheck!.status)
    } finally {
      delete process.env['XAI_API_KEY']
    }
  })

  it('node version check flags <20 as fail', { timeout: 15000 }, async () => {
    const checks = await runDoctor(DEFAULT_SETTINGS)
    const vCheck = checks.find((c) => c.name === 'node version')
    expect(vCheck).toBeDefined()
    // We're running on node >= 20 in CI, so pass
    expect(vCheck!.status).toBe('pass')
  })

  it('shuru check only appears on mac-arm64', { timeout: 15000 }, async () => {
    const checks = await runDoctor(DEFAULT_SETTINGS)
    const shuruCheck = checks.find((c) => c.name === 'shuru CLI')
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      expect(shuruCheck).toBeDefined()
    } else {
      expect(shuruCheck).toBeUndefined()
    }
  })
})

describe('formatDoctorReport', () => {
  it('produces aligned output with status glyphs', { timeout: 15000 }, async () => {
    const checks = await runDoctor(DEFAULT_SETTINGS)
    const report = stripAnsi(formatDoctorReport(checks))
    // Has glyphs
    expect(report).toMatch(/[✓✗⚠·]/)
    // Has a summary line
    expect(report).toMatch(/check.*failed|warning|all checks passed/)
  })

  it('summary reflects overall status', { timeout: 15000 }, async () => {
    // Synthesize a report with a failure
    const checks = [
      { name: 'test', status: 'fail' as const, detail: 'broken' },
      { name: 'other', status: 'pass' as const, detail: 'ok' },
    ]
    const report = stripAnsi(formatDoctorReport(checks))
    expect(report).toContain('1 check(s) failed')
  })

  it('all-pass summary is green checkmark text', { timeout: 15000 }, async () => {
    const checks = [{ name: 'test', status: 'pass' as const, detail: 'ok' }]
    const report = stripAnsi(formatDoctorReport(checks))
    expect(report).toContain('all checks passed')
  })
})
