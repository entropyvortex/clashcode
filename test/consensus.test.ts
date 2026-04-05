import { describe, it, expect } from 'vitest'
import {
  phaseForRound,
  buildContext,
  extractKeywords,
  jaccardSimilarity,
  countPatterns,
  scoreAgreementConvergence,
  scoreContradictionResolution,
  scoreEvidenceGrounding,
  scoreProposalSimilarity,
  scoreConsensusSpeed,
  computeConvergence,
  buildSynthesis,
  ClashEngine,
  BUILT_IN_PERSONAS,
  listPersonas,
  getPersona,
} from '../src/consensus/index.js'
import type { RoundEntry } from '../src/consensus/types.js'

// ── helpers ──────────────────────────────────────────────────────

function entry(persona: string, round: number, content: string): RoundEntry {
  return { persona, round, content, tokensIn: 0, tokensOut: 0, elapsed: 0 }
}

// ── phaseForRound ────────────────────────────────────────────────

describe('phaseForRound', () => {
  it('maps 1→initial-analysis', () => {
    expect(phaseForRound(1)).toBe('initial-analysis')
  })
  it('maps 2→counterarguments', () => {
    expect(phaseForRound(2)).toBe('counterarguments')
  })
  it('maps 3→evidence-assessment', () => {
    expect(phaseForRound(3)).toBe('evidence-assessment')
  })
  it('maps 4→synthesis', () => {
    expect(phaseForRound(4)).toBe('synthesis')
  })
  it('maps 5+→refinement', () => {
    expect(phaseForRound(5)).toBe('refinement')
    expect(phaseForRound(6)).toBe('refinement')
    expect(phaseForRound(99)).toBe('refinement')
  })
  it('handles round 0 as refinement', () => {
    expect(phaseForRound(0)).toBe('refinement')
  })
})

// ── buildContext ─────────────────────────────────────────────────

describe('buildContext', () => {
  it('handles empty entries', () => {
    const ctx = buildContext('Should we use Rust?', [], 'initial-analysis')
    expect(ctx).toContain('DEBATE TOPIC: Should we use Rust?')
    expect(ctx).toContain('No previous discussion')
  })

  it('groups entries by round', () => {
    const entries = [
      entry('pragmatist', 1, 'Ship what works.'),
      entry('security-maximalist', 1, 'Audit first.'),
      entry('pragmatist', 2, 'I concede the audit point.'),
    ]
    const ctx = buildContext('topic', entries, 'counterarguments')
    expect(ctx).toContain('--- Round 1')
    expect(ctx).toContain('--- Round 2')
    expect(ctx).toContain('[pragmatist]')
    expect(ctx).toContain('[security-maximalist]')
    expect(ctx).toContain('Current Phase: counterarguments')
  })

  it('includes phase hint on each round header', () => {
    const entries = [entry('p', 1, 'x')]
    const ctx = buildContext('t', entries, 'synthesis')
    expect(ctx).toContain('initial-analysis')
  })
})

// ── extractKeywords / jaccardSimilarity ──────────────────────────

describe('extractKeywords', () => {
  it('extracts lowercase words ≥4 chars', () => {
    const kw = extractKeywords('The quick BROWN fox jumps!')
    expect(kw.has('quick')).toBe(true)
    expect(kw.has('brown')).toBe(true)
    expect(kw.has('jumps')).toBe(true)
    expect(kw.has('fox')).toBe(false) // too short
    expect(kw.has('the')).toBe(false) // too short
  })

  it('removes stop words', () => {
    const kw = extractKeywords('this that with from they')
    expect(kw.size).toBe(0)
  })

  it('strips punctuation', () => {
    const kw = extractKeywords('hello, world. hello!')
    expect(kw.has('hello')).toBe(true)
    expect(kw.has('world')).toBe(true)
  })
})

describe('jaccardSimilarity', () => {
  it('returns 1 for identical sets', () => {
    const a = new Set(['apple', 'banana', 'cherry'])
    expect(jaccardSimilarity(a, a)).toBe(1)
  })
  it('returns 0 for disjoint sets', () => {
    const a = new Set(['apple'])
    const b = new Set(['banana'])
    expect(jaccardSimilarity(a, b)).toBe(0)
  })
  it('returns 0 for two empty sets', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0)
  })
  it('returns correct fraction for partial overlap', () => {
    const a = new Set(['apple', 'banana', 'cherry'])
    const b = new Set(['banana', 'cherry', 'date'])
    // intersection=2, union=4 → 0.5
    expect(jaccardSimilarity(a, b)).toBe(0.5)
  })
})

// ── countPatterns ────────────────────────────────────────────────

describe('countPatterns', () => {
  it('counts all occurrences, case-insensitive', () => {
    expect(countPatterns('However, but HOWEVER we disagree', ['however', 'but '])).toBe(3)
  })
  it('counts multiple non-overlapping instances of same pattern', () => {
    expect(countPatterns('agree agree agree', ['agree'])).toBe(3)
  })
  it('returns 0 on miss', () => {
    expect(countPatterns('nothing to see', ['foo', 'bar'])).toBe(0)
  })
})

// ── score* functions ─────────────────────────────────────────────

describe('scoreAgreementConvergence', () => {
  it('returns 50 when final round has <2 entries', () => {
    const entries = [entry('p', 1, 'x')]
    expect(scoreAgreementConvergence(entries, 1)).toBe(50)
  })
  it('higher score when final entries share keywords', () => {
    const entries = [
      entry('a', 1, 'nothing relevant'),
      entry('b', 1, 'nothing relevant'),
      entry('a', 2, 'security performance reliability architecture scalability'),
      entry('b', 2, 'security performance reliability architecture scalability'),
    ]
    const score = scoreAgreementConvergence(entries, 2)
    expect(score).toBeGreaterThan(70)
  })
  it('lower score when final entries diverge', () => {
    const entries = [entry('a', 2, 'apple banana cherry'), entry('b', 2, 'xylophone yacht zebra')]
    const score = scoreAgreementConvergence(entries, 2)
    expect(score).toBeLessThan(50)
  })
})

describe('scoreContradictionResolution', () => {
  it('returns 70 when early has no contradictions', () => {
    const entries = [
      entry('a', 1, 'simple statement of fact'),
      entry('b', 1, 'another simple statement'),
    ]
    expect(scoreContradictionResolution(entries, 2)).toBe(70)
  })
  it('scores higher when resolution language shows up late', () => {
    const entries = [
      entry('a', 1, 'I disagree, this is wrong however'),
      entry('b', 1, 'I disagree, you are incorrect'),
      entry('a', 4, 'I agree with you, fair point, acknowledge the concern'),
      entry('b', 4, 'valid point, building on that good point'),
    ]
    const score = scoreContradictionResolution(entries, 4)
    expect(score).toBeGreaterThan(40)
  })
})

describe('scoreEvidenceGrounding', () => {
  it('returns 50 when neither evidence nor vague markers present', () => {
    const entries = [entry('a', 1, 'just plain text')]
    expect(scoreEvidenceGrounding(entries)).toBe(50)
  })
  it('high score for evidence-heavy text', () => {
    const entries = [
      entry(
        'a',
        1,
        'because the benchmark shows specifically the latency of 50ms, documentation confirms, measured data shows',
      ),
    ]
    expect(scoreEvidenceGrounding(entries)).toBeGreaterThan(80)
  })
  it('low score for vague text', () => {
    const entries = [
      entry('a', 1, 'probably might be i think arguably in theory maybe seems like should be fine'),
    ]
    expect(scoreEvidenceGrounding(entries)).toBeLessThan(30)
  })
})

describe('scoreProposalSimilarity', () => {
  it('returns 50 when final round has <2 entries', () => {
    const entries = [entry('a', 1, 'I recommend X')]
    expect(scoreProposalSimilarity(entries, 1)).toBe(50)
  })
  it('higher score when recommendations align', () => {
    const entries = [
      entry(
        'a',
        2,
        'I recommend adopting microservices with kubernetes orchestration approach solution',
      ),
      entry(
        'b',
        2,
        'I suggest microservices with kubernetes orchestration is the approach solution',
      ),
    ]
    const score = scoreProposalSimilarity(entries, 2)
    expect(score).toBeGreaterThan(50)
  })
})

describe('scoreConsensusSpeed', () => {
  it('high score when agreement appears in round 1', () => {
    const entries = [entry('a', 1, 'we agree on this, this is consensus')]
    expect(scoreConsensusSpeed(entries, 4)).toBeGreaterThanOrEqual(90)
  })
  it('low score when no agreement language appears', () => {
    const entries = [entry('a', 1, 'nothing convergent here')]
    expect(scoreConsensusSpeed(entries, 4)).toBe(30)
  })
  it('decreasing score as agreement moves to later rounds', () => {
    const r1 = scoreConsensusSpeed([entry('a', 1, 'we agree')], 4)
    const r3 = scoreConsensusSpeed([entry('a', 3, 'we agree')], 4)
    expect(r1).toBeGreaterThan(r3)
  })
})

// ── computeConvergence ─────────────────────────────────────────────

describe('computeConvergence', () => {
  it('returns overall score in 0..100', () => {
    const entries = [
      entry('a', 1, 'initial position one'),
      entry('b', 1, 'initial position two'),
      entry('a', 2, 'we agree building on that, measured benchmark shows'),
      entry('b', 2, 'we agree, acknowledge the fair point, documentation confirms'),
    ]
    const score = computeConvergence(entries, 2)
    expect(score.overall).toBeGreaterThanOrEqual(0)
    expect(score.overall).toBeLessThanOrEqual(100)
    expect(score.agreementConvergence).toBeGreaterThanOrEqual(0)
    expect(score.contradictionResolution).toBeGreaterThanOrEqual(0)
    expect(score.evidenceGrounding).toBeGreaterThanOrEqual(0)
    expect(score.proposalSimilarity).toBeGreaterThanOrEqual(0)
    expect(score.consensusSpeed).toBeGreaterThanOrEqual(0)
  })

  it('weighted overall is reasonable combination', () => {
    const entries = [entry('a', 1, 'x'), entry('b', 1, 'x')]
    const s = computeConvergence(entries, 1)
    // With only 1 entry per persona in round 1 of 1, should be low-ish
    expect(s.overall).toBeGreaterThanOrEqual(0)
    expect(s.overall).toBeLessThanOrEqual(100)
  })
})

// ── buildSynthesis ───────────────────────────────────────────────

describe('buildSynthesis', () => {
  it('handles zero final entries', () => {
    expect(buildSynthesis([], 1, 'topic')).toContain('No entries')
  })
  it('includes topic and persona labels', () => {
    const entries = [entry('pragmatist', 2, 'ship it'), entry('purist', 2, 'refactor first')]
    const s = buildSynthesis(entries, 2, 'ship or refactor')
    expect(s).toContain('ship or refactor')
    expect(s).toContain('[pragmatist]')
    expect(s).toContain('[purist]')
    expect(s).toContain('ship it')
    expect(s).toContain('refactor first')
  })
})

// ── ClashEngine class ────────────────────────────────────────────

describe('ClashEngine', () => {
  it('constructs with model and provider', () => {
    const e = new ClashEngine('grok-4', 'grok')
    expect(e.provider).toBe('grok')
  })

  it('getLastResult returns null before any runDebate', () => {
    const e = new ClashEngine('grok-4', 'grok')
    expect(e.getLastResult()).toBeNull()
  })
})

// ── persona re-exports ───────────────────────────────────────────

describe('persona exports', () => {
  it('BUILT_IN_PERSONAS has 6 entries', () => {
    expect(Object.keys(BUILT_IN_PERSONAS).length).toBeGreaterThanOrEqual(6)
  })
  it('listPersonas returns all names', () => {
    expect(listPersonas()).toEqual(Object.keys(BUILT_IN_PERSONAS))
  })
  it('getPersona returns the persona or undefined', () => {
    const names = listPersonas()
    expect(getPersona(names[0]!)).toBeDefined()
    expect(getPersona('nonexistent-xyz')).toBeUndefined()
  })
})
