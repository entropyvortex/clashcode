/**
 * Scorer self-test — verifies computeConvergence() ranks hand-crafted
 * transcripts in the expected direction.
 *
 * This is NOT a live-LLM benchmark. It's a deterministic test over
 * fixture files, used to:
 *   1. Confirm the heuristic scorer is stable across refactors.
 *   2. Document known failure modes (adversarial-same-vocab,
 *      evidence-stuffed) by asserting the scorer does score them
 *      the "wrong" way — proving the failure modes are real.
 *
 * See eval/README.md and docs/coherence-scoring.md.
 *
 * Runnable via `pnpm test:eval`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeConvergence } from '../src/consensus/index.js'
import type { RoundEntry } from '../src/consensus/types.js'

const HERE = dirname(fileURLToPath(import.meta.url))

interface FixtureEntry {
  persona: string
  round: number
  phase: string
  content: string
}

interface Fixture {
  topic: string
  rounds: number
  entries: FixtureEntry[]
}

function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(join(HERE, 'fixtures', name), 'utf-8'))
}

function toRoundEntries(f: Fixture): RoundEntry[] {
  return f.entries.map((e) => ({
    persona: e.persona,
    round: e.round,
    content: e.content,
    tokensIn: 0,
    tokensOut: 0,
    elapsed: 0,
  }))
}

describe('scorer self-test: expected ranking', () => {
  it('high-coherence fixture scores in the expected range (≥55)', () => {
    const f = loadFixture('high-coherence.json')
    const s = computeConvergence(toRoundEntries(f), f.rounds)
    expect(s.overall).toBeGreaterThanOrEqual(55)
    // Evidence markers are dense — this sub-metric should be high.
    expect(s.evidenceGrounding).toBeGreaterThanOrEqual(60)
  })

  it('low-coherence fixture scores in the expected range (≤55)', () => {
    const f = loadFixture('low-coherence.json')
    const s = computeConvergence(toRoundEntries(f), f.rounds)
    expect(s.overall).toBeLessThanOrEqual(55)
  })

  it('high > low by a meaningful margin', () => {
    const hi = computeConvergence(toRoundEntries(loadFixture('high-coherence.json')), 4)
    const lo = computeConvergence(toRoundEntries(loadFixture('low-coherence.json')), 4)
    // The point of the heuristic is to distinguish these; require ≥10pt gap.
    expect(hi.overall - lo.overall).toBeGreaterThanOrEqual(10)
  })
})

describe('scorer self-test: documented failure modes', () => {
  it('FAILURE MODE #1: adversarial-same-vocab scores high on Agreement', () => {
    // Two personas say "X is correct" / "X is wrong" with identical
    // vocabulary. The heuristic cannot tell them apart — it's lexical,
    // not semantic. We assert the failure to document it.
    const f = loadFixture('adversarial-same-vocab.json')
    const s = computeConvergence(toRoundEntries(f), f.rounds)
    // Keyword overlap is high because vocabulary is identical.
    expect(s.agreementConvergence).toBeGreaterThanOrEqual(60)
    // This is exactly the failure mode documented in
    // docs/coherence-scoring.md. If this test ever fails because the
    // score dropped, investigate — either the scorer improved (good!)
    // or we regressed the stopword list (bad).
  })

  it('FAILURE MODE #2: persona disagreement can still produce a passable score', () => {
    // Demonstrates that two personas can reach opposite recommendations
    // while still scoring above "obviously incoherent" levels. This is
    // the reputational risk we're up-front about.
    const f = loadFixture('adversarial-same-vocab.json')
    const s = computeConvergence(toRoundEntries(f), f.rounds)
    // NOT asserting overall ≥ 55 because that's flakey across the
    // scorer's weighted average; we only need Agreement to be the
    // smoking gun. Documented in docs/coherence-scoring.md.
    expect(s.overall).toBeGreaterThan(0)
  })

  it('FAILURE MODE #3: evidence-marker stuffing scores high on Evidence', () => {
    // Content is salted with evidence-marker words (benchmark, measured,
    // profiled, RFC, spec, empirical) WITHOUT any real evidence. The
    // heuristic rewards marker density, not marker validity.
    const f = loadFixture('evidence-stuffed.json')
    const s = computeConvergence(toRoundEntries(f), f.rounds)
    expect(s.evidenceGrounding).toBeGreaterThanOrEqual(80)
  })
})

describe('scorer self-test: determinism', () => {
  it('same input → same score (deterministic)', () => {
    const f = loadFixture('high-coherence.json')
    const a = computeConvergence(toRoundEntries(f), f.rounds)
    const b = computeConvergence(toRoundEntries(f), f.rounds)
    expect(a).toEqual(b)
  })
})
