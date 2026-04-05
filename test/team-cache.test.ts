import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TeamCache } from '../src/state/team-cache.js'

describe('TeamCache', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'clashcode-cache-test-'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('key() is stable for same inputs', () => {
    const agents = [{ name: 'coder' }, { name: 'reviewer' }]
    const k1 = TeamCache.key('build a thing', agents, 'grok-4')
    const k2 = TeamCache.key('build a thing', agents, 'grok-4')
    expect(k1).toBe(k2)
    expect(k1).toHaveLength(32)
  })

  it('key() differs for different inputs', () => {
    const a = [{ name: 'coder' }]
    expect(TeamCache.key('x', a, 'grok-4')).not.toBe(TeamCache.key('y', a, 'grok-4'))
    expect(TeamCache.key('x', a, 'grok-4')).not.toBe(TeamCache.key('x', a, 'grok-3'))
  })

  it('get() returns null on miss', () => {
    const c = new TeamCache(tmpDir)
    expect(c.get('nonexistent')).toBeNull()
  })

  it('set() then get() roundtrips the entry', () => {
    const c = new TeamCache(tmpDir)
    c.set('k1', {
      output: 'hello',
      tokIn: 100,
      tokOut: 50,
      agentBreakdown: 'coder: 50+25',
      elapsed: 1.5,
    })
    const entry = c.get('k1')
    expect(entry).not.toBeNull()
    expect(entry?.output).toBe('hello')
    expect(entry?.tokIn).toBe(100)
    expect(entry?.storedAt).toBeGreaterThan(0)
  })

  it('respects TTL', () => {
    const c = new TeamCache(tmpDir, { ttlMs: 1 })
    c.set('k', { output: 'x', tokIn: 1, tokOut: 1, agentBreakdown: '', elapsed: 0 })
    // Sleep via sync loop
    const until = Date.now() + 10
    while (Date.now() < until) {
      /* wait */
    }
    expect(c.get('k')).toBeNull()
  })

  it('delete() removes an entry', () => {
    const c = new TeamCache(tmpDir)
    c.set('k', { output: 'x', tokIn: 1, tokOut: 1, agentBreakdown: '', elapsed: 0 })
    expect(c.get('k')).not.toBeNull()
    c.delete('k')
    expect(c.get('k')).toBeNull()
  })

  it('clear() removes all entries', () => {
    const c = new TeamCache(tmpDir)
    c.set('a', { output: '1', tokIn: 0, tokOut: 0, agentBreakdown: '', elapsed: 0 })
    c.set('b', { output: '2', tokIn: 0, tokOut: 0, agentBreakdown: '', elapsed: 0 })
    expect(c.clear()).toBe(2)
    expect(c.get('a')).toBeNull()
    expect(c.get('b')).toBeNull()
  })

  it('stats() reports entry count', () => {
    const c = new TeamCache(tmpDir)
    expect(c.stats().entries).toBe(0)
    c.set('a', { output: 'x', tokIn: 0, tokOut: 0, agentBreakdown: '', elapsed: 0 })
    c.set('b', { output: 'y', tokIn: 0, tokOut: 0, agentBreakdown: '', elapsed: 0 })
    const s = c.stats()
    expect(s.entries).toBe(2)
    expect(s.totalBytes).toBeGreaterThan(0)
  })
})
