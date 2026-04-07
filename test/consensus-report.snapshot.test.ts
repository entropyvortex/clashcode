/**
 * Snapshot tests for the debate report formatter.
 *
 * Strips ANSI colour codes before comparison so terminal theming doesn't
 * destabilise the snapshot. We pin the shape/content/alignment of the
 * generated report — any formatting change requires an intentional
 * snapshot update.
 */

import { describe, it, expect } from 'vitest'
import { ClashEngine } from '../src/consensus/index.js'
import type { DebateResult } from '../src/consensus/types.js'

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g
const stripAnsi = (s: string): string => s.replace(ANSI_RE, '')

function makeResult(overrides: Partial<DebateResult> = {}): DebateResult {
  return {
    id: 'test-debate-id',
    topic: 'Should we adopt microservices?',
    rounds: 2,
    personas: ['pragmatist', 'elegance-purist'],
    phases: ['initial-analysis', 'counterarguments'],
    entries: [
      {
        persona: 'pragmatist',
        round: 2,
        content:
          'Ship the monolith first.\nOptimise only after you have users.\nRefactor incrementally.',
        tokensIn: 100,
        tokensOut: 50,
        elapsed: 1.5,
      },
      {
        persona: 'elegance-purist',
        round: 2,
        content: 'Clean separation of concerns matters from day one.',
        tokensIn: 80,
        tokensOut: 40,
        elapsed: 1.2,
      },
    ],
    convergence: {
      overall: 65,
      agreementConvergence: 60,
      contradictionResolution: 70,
      evidenceGrounding: 75,
      proposalSimilarity: 55,
      consensusSpeed: 65,
    },
    synthesis:
      'Synthesis of 2 perspectives on: Should we adopt microservices?\n\n[pragmatist]: Ship the monolith first.',
    totalTokensIn: 180,
    totalTokensOut: 90,
    totalElapsed: 2.7,
    timestamp: 0, // stable for snapshot
    ...overrides,
  }
}

describe('ClashEngine.formatReport — snapshot', () => {
  const engine = new ClashEngine('grok-4', 'grok')

  it('formats a mid-coherence debate', () => {
    const result = makeResult()
    const report = stripAnsi(engine.formatReport(result))
    expect(report).toMatchInlineSnapshot(`
      "╭─ ClashCode Debate ────────────────────────────╮
      │ Topic: Should we adopt microservices?
      │ Convergence: 65/100 (lexical scorer — see docs/coherence-scoring.md)
      │ 2 personas × 2 rounds
      ╰────────────────────────────────────────────────╯

      pragmatist (round 2)
        │ Ship the monolith first.
        │ Optimise only after you have users.
        │ Refactor incrementally.

      elegance-purist (round 2)
        │ Clean separation of concerns matters from day one.

      Convergence Heuristic Breakdown
        Agreement (lex)  ████████████░░░░░░░░ 60
        Contradictions   ██████████████░░░░░░ 70
        Evidence density ███████████████░░░░░ 75
        Proposal overlap ███████████░░░░░░░░░ 55
        Consensus speed  █████████████░░░░░░░ 65

      ╭─ Synthesis ───────────────────────────────────╮
      │ Synthesis of 2 perspectives on: Should we adopt microservices?
      │ 
      │ [pragmatist]: Ship the monolith first.
      ╰────────────────────────────────────────────────╯

      Tokens: 180 in / 90 out  Time: 2.7s"
    `)
  })

  it('colour classes vary with coherence score', () => {
    // Green ≥70, yellow ≥45, red <45 — all three ranges
    const high = makeResult({ convergence: { ...makeResult().convergence, overall: 85 } })
    const mid = makeResult({ convergence: { ...makeResult().convergence, overall: 55 } })
    const low = makeResult({ convergence: { ...makeResult().convergence, overall: 20 } })
    const hRep = engine.formatReport(high)
    const mRep = engine.formatReport(mid)
    const lRep = engine.formatReport(low)
    // High gets green ANSI (32), mid yellow (33), low red (31)
    // eslint-disable-next-line no-control-regex
    expect(hRep).toMatch(/\x1b\[32m.*85\/100/)
    // eslint-disable-next-line no-control-regex
    expect(mRep).toMatch(/\x1b\[33m.*55\/100/)
    // eslint-disable-next-line no-control-regex
    expect(lRep).toMatch(/\x1b\[31m.*20\/100/)
  })

  it('formatBar output is exactly 20 chars wide', () => {
    const result = makeResult()
    const report = stripAnsi(engine.formatReport(result))
    const barLine = report.split('\n').find((l) => l.includes('Agreement'))!
    // Strip label + score — just the bar
    const match = barLine.match(/[█░]{20}/)
    expect(match).not.toBeNull()
    expect(match![0]).toHaveLength(20)
  })
})
