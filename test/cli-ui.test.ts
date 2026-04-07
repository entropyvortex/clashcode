/**
 * Unit tests for src/cli/ui.ts — ANSI helpers, Spinner, box, formatResponse.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  c,
  VERSION,
  banner,
  Spinner,
  formatResponse,
  box,
  dim,
  error,
  success,
  info,
} from '../src/cli/ui.js'

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '')

describe('ANSI color constants', () => {
  it('c.reset is a valid ANSI escape', () => {
    expect(c.reset).toBe('\x1b[0m')
  })

  it('c.bold is a valid ANSI escape', () => {
    expect(c.bold).toBe('\x1b[1m')
  })
})

describe('VERSION', () => {
  it('is a non-empty semver-like string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })
})

describe('banner', () => {
  it('includes model and provider', () => {
    const result = stripAnsi(banner('grok-4', 'grok'))
    expect(result).toContain('grok-4')
    expect(result).toContain('grok')
    expect(result).toContain('ClashCode')
  })
})

describe('Spinner', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    stderrSpy.mockRestore()
  })

  it('start() writes to stderr on each interval', () => {
    const spinner = new Spinner()
    spinner.start('Loading')
    vi.advanceTimersByTime(500)
    expect(stderrSpy).toHaveBeenCalled()
    const output = stderrSpy.mock.calls.map((c) => c[0]).join('')
    expect(output).toContain('Loading')
    spinner.stop()
  })

  it('stop() clears the line', () => {
    const spinner = new Spinner()
    spinner.start()
    vi.advanceTimersByTime(250)
    spinner.stop()
    const lastCall = stderrSpy.mock.calls[stderrSpy.mock.calls.length - 1]?.[0] as string
    expect(lastCall).toContain('\x1b[K')
  })

  it('stop() is safe to call without start()', () => {
    const spinner = new Spinner()
    expect(() => spinner.stop()).not.toThrow()
  })
})

describe('formatResponse', () => {
  it('wraps lines with a left border', () => {
    const result = stripAnsi(formatResponse('line1\nline2'))
    expect(result).toContain('│ line1')
    expect(result).toContain('│ line2')
  })
})

describe('box', () => {
  it('includes title and content', () => {
    const result = stripAnsi(box('Title', 'body text'))
    expect(result).toContain('Title')
    expect(result).toContain('body text')
    expect(result).toContain('╭')
    expect(result).toContain('╰')
  })
})

describe('dim', () => {
  it('wraps text in dim ANSI codes', () => {
    const result = dim('faded')
    expect(result).toContain('\x1b[2m')
    expect(result).toContain('faded')
    expect(result).toContain('\x1b[0m')
  })
})

describe('error', () => {
  it('includes a red cross and the message', () => {
    const result = stripAnsi(error('something broke'))
    expect(result).toContain('✗')
    expect(result).toContain('something broke')
  })
})

describe('success', () => {
  it('includes a green checkmark and the message', () => {
    const result = stripAnsi(success('it worked'))
    expect(result).toContain('✓')
    expect(result).toContain('it worked')
  })
})

describe('info', () => {
  it('includes an info symbol and the message', () => {
    const result = stripAnsi(info('heads up'))
    expect(result).toContain('ℹ')
    expect(result).toContain('heads up')
  })
})
