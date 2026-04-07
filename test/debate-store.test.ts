/**
 * Tests for DebateStore — JSON file persistence for debate results.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DebateStore } from '../src/consensus/store.js'
import type { DebateResult, ConvergenceHeuristic } from '../src/consensus/types.js'

// ── helpers ──────────────────────────────────────────────────────

function makeConvergence(overall = 65): ConvergenceHeuristic {
  return {
    overall,
    agreementConvergence: 60,
    contradictionResolution: 70,
    evidenceGrounding: 75,
    proposalSimilarity: 55,
    consensusSpeed: 60,
  }
}

function makeResult(overrides: Partial<DebateResult> = {}): DebateResult {
  return {
    id: 'test-id-001',
    topic: 'Should we use TypeScript?',
    rounds: 4,
    personas: ['pragmatist', 'elegance-purist'],
    phases: ['initial-analysis', 'counterarguments', 'evidence-assessment', 'synthesis'],
    entries: [
      {
        persona: 'pragmatist',
        round: 1,
        content: 'Ship it with TS.',
        tokensIn: 100,
        tokensOut: 50,
        elapsed: 1.0,
      },
    ],
    convergence: makeConvergence(),
    synthesis: 'Use TypeScript.',
    totalTokensIn: 100,
    totalTokensOut: 50,
    totalElapsed: 2.0,
    timestamp: 1000,
    ...overrides,
  }
}

// ── test suite ───────────────────────────────────────────────────

describe('DebateStore', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'debate-store-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('creates the debates directory on construction', () => {
    new DebateStore(tempDir)
    expect(existsSync(join(tempDir, '.clashcode', 'debates'))).toBe(true)
  })

  it('save() persists a debate result as JSON', () => {
    const store = new DebateStore(tempDir)
    const result = makeResult()
    store.save(result)

    const filePath = join(tempDir, '.clashcode', 'debates', `${result.id}.json`)
    expect(existsSync(filePath)).toBe(true)
  })

  it('get() retrieves a saved debate', () => {
    const store = new DebateStore(tempDir)
    const result = makeResult()
    store.save(result)

    const retrieved = store.get(result.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.id).toBe(result.id)
    expect(retrieved!.topic).toBe(result.topic)
    expect(retrieved!.rounds).toBe(result.rounds)
    expect(retrieved!.convergence.overall).toBe(result.convergence.overall)
    expect(retrieved!.synthesis).toBe(result.synthesis)
  })

  it('get() returns null for non-existent ID', () => {
    const store = new DebateStore(tempDir)
    expect(store.get('does-not-exist-abc')).toBeNull()
  })

  it('get() recovers from corrupted JSON by returning null', () => {
    const store = new DebateStore(tempDir)
    const debatesDir = join(tempDir, '.clashcode', 'debates')
    // Write invalid JSON
    writeFileSync(join(debatesDir, 'corrupted-id.json'), '{not valid json!!!', 'utf-8')

    expect(store.get('corrupted-id')).toBeNull()
  })

  it('list() returns empty array when no debates saved', () => {
    const store = new DebateStore(tempDir)
    expect(store.list()).toEqual([])
  })

  it('list() returns saved debates with summary fields', () => {
    const store = new DebateStore(tempDir)
    const result = makeResult()
    store.save(result)

    const listed = store.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toEqual({
      id: result.id,
      topic: result.topic,
      convergence: result.convergence.overall,
      rounds: result.rounds,
      timestamp: result.timestamp,
    })
  })

  it('list() returns most recent first', () => {
    const store = new DebateStore(tempDir)

    const older = makeResult({ id: 'older', topic: 'Older debate', timestamp: 1000 })
    const newer = makeResult({ id: 'newer', topic: 'Newer debate', timestamp: 3000 })
    const middle = makeResult({ id: 'middle', topic: 'Middle debate', timestamp: 2000 })

    store.save(older)
    store.save(newer)
    store.save(middle)

    const listed = store.list()
    expect(listed).toHaveLength(3)
    expect(listed[0]!.id).toBe('newer')
    expect(listed[1]!.id).toBe('middle')
    expect(listed[2]!.id).toBe('older')
  })

  it('list() skips corrupted JSON files gracefully', () => {
    const store = new DebateStore(tempDir)
    const debatesDir = join(tempDir, '.clashcode', 'debates')

    // Save one valid result
    const valid = makeResult({ id: 'valid-one', timestamp: 5000 })
    store.save(valid)

    // Write a corrupted file
    writeFileSync(join(debatesDir, 'bad-file.json'), '{{{{garbage', 'utf-8')

    const listed = store.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]!.id).toBe('valid-one')
  })

  it('get() sanitizes ID to prevent path traversal', () => {
    const store = new DebateStore(tempDir)

    // Attempt path traversal — dots and slashes should be stripped
    const result = store.get('../../etc/passwd')
    expect(result).toBeNull()

    // The store should not have tried to read outside its directory
    // The sanitization strips non-alphanumeric/dash/underscore characters
    // so "../../etc/passwd" becomes "etcpasswd" which simply does not exist
  })

  it('get() sanitizes IDs with special characters', () => {
    const store = new DebateStore(tempDir)

    // Save a result with a clean ID
    const result = makeResult({ id: 'clean-id' })
    store.save(result)

    // The regex strips dots/slashes, so "../clean-id" becomes "clean-id"
    // which means traversal is neutralised (it resolves to the safe name).
    // Verify that the traversal characters are stripped, not that it returns null:
    // "../clean-id" -> sanitised to "clean-id" -> finds the file
    expect(store.get('../clean-id')).not.toBeNull()
    expect(store.get('../clean-id')!.id).toBe('clean-id')

    // An ID with only special chars sanitises to empty string -> not found
    expect(store.get('../../..')).toBeNull()

    // But the clean ID itself works
    expect(store.get('clean-id')).not.toBeNull()
  })

  it('save() and get() round-trip preserves all fields', () => {
    const store = new DebateStore(tempDir)
    const result = makeResult({
      id: 'round-trip-test',
      topic: 'Complex topic with "quotes" and special chars',
      rounds: 5,
      personas: ['a', 'b', 'c'],
      totalTokensIn: 999,
      totalTokensOut: 444,
      totalElapsed: 12.345,
      timestamp: Date.now(),
    })
    store.save(result)

    const retrieved = store.get('round-trip-test')
    expect(retrieved).toEqual(result)
  })

  it('save() overwrites existing debate with same ID', () => {
    const store = new DebateStore(tempDir)

    const v1 = makeResult({ id: 'overwrite-me', topic: 'Version 1' })
    store.save(v1)

    const v2 = makeResult({ id: 'overwrite-me', topic: 'Version 2' })
    store.save(v2)

    const retrieved = store.get('overwrite-me')
    expect(retrieved!.topic).toBe('Version 2')
  })
})
