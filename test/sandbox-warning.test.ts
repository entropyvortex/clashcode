/**
 * Verifies the sandbox security warning fires for 'local' and is silenced
 * by CLASHCODE_ACK_LOCAL_SANDBOX=1.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { warnIfUnsafeSandbox } from '../src/cli/sandbox-warning.js'

describe('warnIfUnsafeSandbox', () => {
  // The process.stderr.write overload set is messy; use a narrow typed spy.
  let stderrSpy: { mockRestore: () => void }
  let captured: string

  beforeEach(() => {
    captured = ''
    const orig = process.stderr.write.bind(process.stderr)
    const mocked = (chunk: string | Uint8Array) => {
      captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8')
      return true
    }
    process.stderr.write = mocked as typeof process.stderr.write
    stderrSpy = {
      mockRestore: () => {
        process.stderr.write = orig
      },
    }
    delete process.env['CLASHCODE_ACK_LOCAL_SANDBOX']
  })

  afterEach(() => {
    stderrSpy.mockRestore()
    delete process.env['CLASHCODE_ACK_LOCAL_SANDBOX']
  })

  it('warns when explicit local backend is chosen', async () => {
    await warnIfUnsafeSandbox('local')
    expect(captured).toContain('UNSAFE SANDBOX')
    expect(captured).toContain('explicitly selected')
  })

  it('silences warning when CLASHCODE_ACK_LOCAL_SANDBOX=1', async () => {
    process.env['CLASHCODE_ACK_LOCAL_SANDBOX'] = '1'
    await warnIfUnsafeSandbox('local')
    expect(captured).toBe('')
  })

  it('does not warn for docker backend', async () => {
    await warnIfUnsafeSandbox('docker')
    expect(captured).toBe('')
  })

  it('does not warn for shuru backend', async () => {
    await warnIfUnsafeSandbox('shuru')
    expect(captured).toBe('')
  })
})
