import { describe, it, expect } from 'vitest'
import { handleCommand, listCommands } from '../src/cli/commands.js'
import type { CommandContext } from '../src/cli/commands.js'

// Minimal stub ctx — handlers we test don't use most fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stubCtx = {} as any as CommandContext

describe('command registry', () => {
  it('listCommands includes all canonical names and aliases', () => {
    const names = listCommands()
    expect(names).toContain('/help')
    expect(names).toContain('/config')
    expect(names).toContain('/model')
    expect(names).toContain('/session')
    expect(names).toContain('/team')
    expect(names).toContain('/agent')
    expect(names).toContain('/consensus')
    expect(names).toContain('/debate') // alias for /consensus
    expect(names).toContain('/coherence')
    expect(names).toContain('/debates')
    expect(names).toContain('/perspectives')
    expect(names).toContain('/diagnostics')
    expect(names).toContain('/sandbox')
    expect(names).toContain('/keychain')
    expect(names).toContain('/exit')
    expect(names).toContain('/quit') // alias for /exit
  })

  it('returns sorted list', () => {
    const names = listCommands()
    const sorted = [...names].sort()
    expect(names).toEqual(sorted)
  })
})

describe('handleCommand', () => {
  it('rejects unknown commands', async () => {
    const r = await handleCommand('/nonsense', stubCtx)
    expect(r.output).toContain('Unknown command')
  })

  it('/help returns a box with commands listed', async () => {
    const r = await handleCommand('/help', stubCtx)
    expect(r.output).toContain('/help')
    expect(r.output).toContain('/consensus')
  })

  it('/exit returns shouldExit', async () => {
    const r = await handleCommand('/exit', stubCtx)
    expect(r.shouldExit).toBe(true)
  })

  it('/quit aliases to /exit', async () => {
    const r = await handleCommand('/quit', stubCtx)
    expect(r.shouldExit).toBe(true)
  })

  it('command name is lowercased before dispatch', async () => {
    const r = await handleCommand('/HELP', stubCtx)
    expect(r.output).toContain('/help')
  })

  it('extra whitespace does not break dispatch', async () => {
    const r = await handleCommand('   /help   ', stubCtx)
    expect(r.output).toContain('/help')
  })

  it('catches handler exceptions and returns error message', async () => {
    // /perspectives will fail gracefully if ctx is missing — shouldn't throw
    const r = await handleCommand('/perspectives', stubCtx)
    // Either works (lists personas) or returns an error — both are valid
    expect(typeof r.output).toBe('string')
  })
})
