/**
 * Unit tests for src/cli/completer.ts — tab completion for slash commands.
 */
import { describe, it, expect } from 'vitest'
import { completer } from '../src/cli/completer.js'

describe('completer', () => {
  it('returns no completions for non-slash input', () => {
    const [hits] = completer('hello')
    expect(hits).toEqual([])
  })

  it('completes partial slash commands', () => {
    const [hits] = completer('/he')
    expect(hits).toContain('/help')
  })

  it('completes /con to /consensus and /config', () => {
    const [hits] = completer('/con')
    expect(hits).toContain('/consensus')
    expect(hits).toContain('/config')
  })

  it('completes /config subcommands', () => {
    const [hits] = completer('/config s')
    expect(hits).toContain('/config set')
  })

  it('completes /config set keys', () => {
    const [hits] = completer('/config set mod')
    expect(hits).toContain('/config set model')
  })

  it('completes /team on|off', () => {
    const [hits] = completer('/team o')
    expect(hits).toContain('/team on')
    expect(hits).toContain('/team off')
  })

  it('completes /agent subcommands', () => {
    const [hits] = completer('/agent a')
    expect(hits).toContain('/agent add')
  })

  it('completes /agent add agent names', () => {
    const [hits] = completer('/agent add co')
    expect(hits).toContain('/agent add coder')
    expect(hits).toContain('/agent add consensus')
  })

  it('completes /agent remove agent names', () => {
    const [hits] = completer('/agent remove r')
    expect(hits).toContain('/agent remove reviewer')
  })

  it('completes /session subcommands', () => {
    const [hits] = completer('/session n')
    expect(hits).toContain('/session new')
  })

  it('returns empty for /model (delegated to model discovery)', () => {
    const [hits] = completer('/model gro')
    expect(hits).toEqual([])
  })

  it('returns empty for unknown command prefix', () => {
    const [hits] = completer('/zzz')
    expect(hits).toEqual([])
  })

  it('completes single character /', () => {
    const [hits] = completer('/')
    expect(hits.length).toBeGreaterThan(5)
    // All should start with /
    for (const h of hits) {
      expect(h.startsWith('/')).toBe(true)
    }
  })
})
