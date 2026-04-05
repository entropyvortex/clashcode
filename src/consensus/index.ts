import type { OpenMultiAgent } from '@jackchen_me/open-multi-agent'
import { BUILT_IN_PERSONAS, getPersona } from './personas.js'
import type {
  ConvergenceHeuristic,
  DebateConfig,
  DebatePhase,
  DebateResult,
  Persona,
  RoundEntry,
} from './types.js'
import { c, box } from '../cli/ui.js'
import { randomUUID } from 'node:crypto'

// Re-export types and personas for convenient access
export { BUILT_IN_PERSONAS, listPersonas, getPersona } from './personas.js'
export type {
  ConvergenceHeuristic,
  DebateConfig,
  DebatePhase,
  DebateResult,
  Persona,
  RoundEntry,
  ConsensusEvent,
} from './types.js'

/** Phase instructions appended to persona system prompts per round. */
const PHASE_INSTRUCTIONS: Record<DebatePhase, string> = {
  'initial-analysis':
    'This is the INITIAL ANALYSIS round. Present your perspective on the topic. ' +
    'State your position clearly, identify the key concerns from your viewpoint, ' +
    'and outline your initial recommendations.',
  counterarguments:
    'This is the COUNTERARGUMENTS round. You have seen the other perspectives. ' +
    'Respond to their points. Where do you agree? Where do you disagree and why? ' +
    'Strengthen your position with specific reasoning.',
  'evidence-assessment':
    'This is the EVIDENCE ASSESSMENT round. Ground your arguments in specifics. ' +
    'Reference concrete examples, benchmarks, known patterns, or documented trade-offs. ' +
    'Identify which claims (yours and others) are well-supported and which are speculative.',
  synthesis:
    'This is the SYNTHESIS round. Work toward a balanced recommendation. ' +
    'Acknowledge the strongest points from each perspective. Propose a concrete plan ' +
    'that incorporates the key insights from the debate. Identify remaining risks.',
  refinement:
    'This is a REFINEMENT round. The debate has already produced a synthesis. ' +
    'Refine the consensus further. Address any remaining gaps, add nuance, ' +
    'and ensure the final recommendation is actionable.',
}

/** Map round number (1-indexed) to a debate phase. */
export function phaseForRound(round: number): DebatePhase {
  switch (round) {
    case 1:
      return 'initial-analysis'
    case 2:
      return 'counterarguments'
    case 3:
      return 'evidence-assessment'
    case 4:
      return 'synthesis'
    default:
      return 'refinement'
  }
}

/** Pick a good subset of personas for a debate (3-4). */
function selectDefaultPersonas(): string[] {
  const all = Object.keys(BUILT_IN_PERSONAS)
  // Shuffle and pick 4
  const shuffled = [...all].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, 4)
}

/** Build the context prompt containing all previous debate entries. */
export function buildContext(
  topic: string,
  entries: RoundEntry[],
  currentPhase: DebatePhase,
): string {
  let ctx = `DEBATE TOPIC: ${topic}\n\n`
  if (entries.length === 0) {
    ctx += 'No previous discussion. You are the first to speak.\n'
    return ctx
  }

  const byRound = new Map<number, RoundEntry[]>()
  for (const entry of entries) {
    const arr = byRound.get(entry.round) ?? []
    arr.push(entry)
    byRound.set(entry.round, arr)
  }

  for (const [round, roundEntries] of byRound) {
    const phase = phaseForRound(round)
    ctx += `--- Round ${round} (${phase}) ---\n`
    for (const e of roundEntries) {
      ctx += `[${e.persona}]: ${e.content}\n\n`
    }
  }

  ctx += `--- Current Phase: ${currentPhase} ---\n`
  ctx += 'Respond with your perspective for this phase.\n'
  return ctx
}

// ── Convergence heuristic — lexical / text-stats scorers ───────────
// See docs/coherence-scoring.md for methodology and known failure modes.

/** Extract meaningful words (lowercase, 4+ chars, no stop words). */
export function extractKeywords(text: string): Set<string> {
  const stops = new Set([
    'this',
    'that',
    'with',
    'from',
    'they',
    'them',
    'their',
    'have',
    'been',
    'will',
    'would',
    'could',
    'should',
    'about',
    'which',
    'there',
    'these',
    'those',
    'into',
    'also',
    'than',
    'then',
    'more',
    'some',
    'such',
    'when',
    'what',
    'each',
    'make',
    'like',
    'does',
    'just',
    'over',
    'very',
    'well',
  ])
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
  return new Set(words.filter((w) => w.length >= 4 && !stops.has(w)))
}

/** Jaccard similarity between two keyword sets. */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0
  for (const w of a) {
    if (b.has(w)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/** Count occurrences of patterns in text. */
export function countPatterns(text: string, patterns: string[]): number {
  const lower = text.toLowerCase()
  let count = 0
  for (const p of patterns) {
    let idx = 0
    while ((idx = lower.indexOf(p, idx)) !== -1) {
      count++
      idx += p.length
    }
  }
  return count
}

export function scoreAgreementConvergence(entries: RoundEntry[], finalRound: number): number {
  const finalEntries = entries.filter((e) => e.round === finalRound)
  if (finalEntries.length < 2) return 50

  const keywordSets = finalEntries.map((e) => extractKeywords(e.content))
  let totalSim = 0
  let pairs = 0
  for (let i = 0; i < keywordSets.length; i++) {
    for (let j = i + 1; j < keywordSets.length; j++) {
      totalSim += jaccardSimilarity(keywordSets[i]!, keywordSets[j]!)
      pairs++
    }
  }
  const avgSim = pairs > 0 ? totalSim / pairs : 0
  // Scale: 0.05 sim ≈ 30, 0.15 sim ≈ 60, 0.25+ ≈ 85+
  return Math.min(100, Math.round(avgSim * 350 + 20))
}

export function scoreContradictionResolution(entries: RoundEntry[], finalRound: number): number {
  const contradictionMarkers = [
    'however',
    'but ',
    'disagree',
    'on the other hand',
    'counterpoint',
    'incorrect',
    'wrong',
  ]
  const resolutionMarkers = [
    'agree with',
    'valid point',
    'good point',
    'fair point',
    'concede',
    'acknowledge',
    'building on',
  ]

  const earlyEntries = entries
    .filter((e) => e.round <= 2)
    .map((e) => e.content)
    .join(' ')
  const lateEntries = entries
    .filter((e) => e.round >= finalRound - 1)
    .map((e) => e.content)
    .join(' ')

  const earlyContradictions = countPatterns(earlyEntries, contradictionMarkers)
  const lateResolutions = countPatterns(lateEntries, resolutionMarkers)
  const lateContradictions = countPatterns(lateEntries, contradictionMarkers)

  if (earlyContradictions === 0) return 70 // No contradictions to resolve
  const resolutionRatio = lateResolutions / (lateContradictions + 1)
  return Math.min(100, Math.round(40 + resolutionRatio * 30))
}

export function scoreEvidenceGrounding(entries: RoundEntry[]): number {
  const evidenceMarkers = [
    'because',
    'data shows',
    'measured',
    'benchmark',
    'according to',
    'example',
    'specifically',
    'in practice',
    'we found',
    'evidence',
    'documentation',
    'RFC',
    'spec ',
    'CVE-',
    'performance test',
    'latency of',
    'throughput of',
    'percentage',
    'ratio',
  ]
  const vagueMarkers = [
    'probably',
    'might be',
    'i think',
    'arguably',
    'in theory',
    'should be fine',
    'good enough',
    'seems like',
    'maybe',
  ]

  const allText = entries.map((e) => e.content).join(' ')
  const evidenceCount = countPatterns(allText, evidenceMarkers)
  const vagueCount = countPatterns(allText, vagueMarkers)

  const total = evidenceCount + vagueCount
  if (total === 0) return 50
  const ratio = evidenceCount / total
  return Math.min(100, Math.round(ratio * 90 + 10))
}

export function scoreProposalSimilarity(entries: RoundEntry[], finalRound: number): number {
  const finalEntries = entries.filter((e) => e.round === finalRound)
  if (finalEntries.length < 2) return 50

  // Extract recommendation-like sentences (containing "recommend", "suggest", "should", "propose")
  const recMarkers = ['recommend', 'suggest', 'should', 'propose', 'approach', 'solution']
  const recommendations = finalEntries.map((e) => {
    const sentences = e.content.split(/[.!?]+/)
    const recSentences = sentences.filter((s) => {
      const lower = s.toLowerCase()
      return recMarkers.some((m) => lower.includes(m))
    })
    return extractKeywords(recSentences.join(' '))
  })

  let totalSim = 0
  let pairs = 0
  for (let i = 0; i < recommendations.length; i++) {
    for (let j = i + 1; j < recommendations.length; j++) {
      totalSim += jaccardSimilarity(recommendations[i]!, recommendations[j]!)
      pairs++
    }
  }
  const avgSim = pairs > 0 ? totalSim / pairs : 0
  return Math.min(100, Math.round(avgSim * 400 + 15))
}

export function scoreConsensusSpeed(entries: RoundEntry[], totalRounds: number): number {
  // Check when agreement language starts appearing
  const agreementMarkers = [
    'agree',
    'consensus',
    'align',
    'convergence',
    'building on',
    'support this',
  ]

  let earliestAgreementRound = totalRounds + 1
  for (const entry of entries) {
    const lower = entry.content.toLowerCase()
    if (agreementMarkers.some((m) => lower.includes(m))) {
      earliestAgreementRound = Math.min(earliestAgreementRound, entry.round)
    }
  }

  if (earliestAgreementRound > totalRounds) return 30
  // Earlier agreement = higher score. Round 1 = 95, round 2 = 80, round 3 = 65, round 4 = 50
  return Math.max(30, Math.min(100, 110 - earliestAgreementRound * 15))
}

export function computeConvergence(
  entries: RoundEntry[],
  totalRounds: number,
): ConvergenceHeuristic {
  const agreementConvergence = scoreAgreementConvergence(entries, totalRounds)
  const contradictionResolution = scoreContradictionResolution(entries, totalRounds)
  const evidenceGrounding = scoreEvidenceGrounding(entries)
  const proposalSimilarity = scoreProposalSimilarity(entries, totalRounds)
  const consensusSpeed = scoreConsensusSpeed(entries, totalRounds)

  // Weighted average: convergence and proposals matter most
  const overall = Math.round(
    agreementConvergence * 0.25 +
      contradictionResolution * 0.15 +
      evidenceGrounding * 0.2 +
      proposalSimilarity * 0.25 +
      consensusSpeed * 0.15,
  )

  return {
    overall,
    agreementConvergence,
    contradictionResolution,
    evidenceGrounding,
    proposalSimilarity,
    consensusSpeed,
  }
}

/** Build a final synthesis from the last-round entries. */
export function buildSynthesis(entries: RoundEntry[], finalRound: number, topic: string): string {
  const finalEntries = entries.filter((e) => e.round === finalRound)
  if (finalEntries.length === 0) return 'No entries in the final round.'

  const parts = finalEntries.map((e) => `[${e.persona}]: ${e.content}`)
  return `Synthesis of ${finalEntries.length} perspectives on: ${topic}\n\n` + parts.join('\n\n')
}

// ── Main Engine ─────────────────────────────────────────────────────

export class ClashEngine {
  private lastResult: DebateResult | null = null

  /** The provider used when no persona-level override is set. */
  readonly provider: string

  constructor(
    private defaultModel: string,
    defaultProvider: string,
  ) {
    this.provider = defaultProvider
  }

  /** Run a structured multi-perspective debate. */
  async runDebate(config: DebateConfig, orchestrator: OpenMultiAgent): Promise<DebateResult> {
    const totalRounds = config.rounds ?? 4
    const startTime = Date.now()

    // Resolve personas
    const resolvedPersonas = this.resolvePersonas(config)
    const personaNames = resolvedPersonas.map((p) => p.name)

    const entries: RoundEntry[] = []
    const phases: DebatePhase[] = []

    for (let round = 1; round <= totalRounds; round++) {
      const phase = phaseForRound(round)
      phases.push(phase)
      config.onProgress?.({
        type: 'phase_start',
        phase,
        round,
        totalRounds,
        personas: personaNames,
      })
      const context = buildContext(config.topic, entries, phase)

      for (const persona of resolvedPersonas) {
        const systemPrompt = persona.systemPrompt + '\n\n' + PHASE_INSTRUCTIONS[phase]

        const agentConfig = {
          name: persona.name,
          model: persona.model ?? this.defaultModel,
          systemPrompt,
        }

        config.onProgress?.({ type: 'persona_start', persona: persona.name, round })
        const roundStart = Date.now()
        const result = await orchestrator.runAgent(agentConfig, context)
        const elapsed = (Date.now() - roundStart) / 1000

        entries.push({
          persona: persona.name,
          round,
          content: result.output,
          tokensIn: result.tokenUsage?.input_tokens ?? 0,
          tokensOut: result.tokenUsage?.output_tokens ?? 0,
          elapsed,
        })
        config.onProgress?.({
          type: 'persona_complete',
          persona: persona.name,
          round,
          tokensIn: result.tokenUsage?.input_tokens ?? 0,
          tokensOut: result.tokenUsage?.output_tokens ?? 0,
          elapsed,
        })
      }

      // Emit interim convergence score after each round (scaled: partial debates need
      // convergence relative to their own last round, so we compute against
      // current round as the "final" round so far).
      const interim = computeConvergence(entries, round)
      config.onProgress?.({
        type: 'round_complete',
        round,
        totalRounds,
        convergence: interim.overall,
      })
    }

    config.onProgress?.({ type: 'debate_complete' })

    const convergence = computeConvergence(entries, totalRounds)
    const synthesis = buildSynthesis(entries, totalRounds, config.topic)

    const totalTokensIn = entries.reduce((s, e) => s + e.tokensIn, 0)
    const totalTokensOut = entries.reduce((s, e) => s + e.tokensOut, 0)
    const totalElapsed = (Date.now() - startTime) / 1000

    const debateResult: DebateResult = {
      id: randomUUID(),
      topic: config.topic,
      rounds: totalRounds,
      personas: personaNames,
      phases: [...new Set(phases)],
      entries,
      convergence,
      synthesis,
      totalTokensIn,
      totalTokensOut,
      totalElapsed,
      timestamp: Date.now(),
    }

    this.lastResult = debateResult
    return debateResult
  }

  /** Format a debate result as a readable terminal report. */
  formatReport(result: DebateResult): string {
    const lines: string[] = []

    // Title box
    const scoreColor =
      result.convergence.overall >= 70
        ? c.green
        : result.convergence.overall >= 45
          ? c.yellow
          : c.red
    const scoreText = `${scoreColor}${c.bold}${result.convergence.overall}/100${c.reset}`

    lines.push(
      box(
        'ClashCode Debate',
        `${c.bold}Topic:${c.reset} ${result.topic}\n` +
          `${c.bold}Convergence:${c.reset} ${scoreText} ` +
          `${c.dim}(heuristic — see docs/coherence-scoring.md)${c.reset}\n` +
          `${c.dim}${result.personas.length} personas × ${result.rounds} rounds${c.reset}`,
      ),
    )
    lines.push('')

    // Per-persona key points from final round
    const finalEntries = result.entries.filter((e) => e.round === result.rounds)
    for (const entry of finalEntries) {
      const personaLabel = `${c.cyan}${c.bold}${entry.persona}${c.reset}`
      const firstLines = entry.content.split('\n').slice(0, 6).join('\n')
      lines.push(`${personaLabel} ${c.dim}(round ${entry.round})${c.reset}`)
      lines.push(
        firstLines
          .split('\n')
          .map((l) => `  ${c.dim}│${c.reset} ${l}`)
          .join('\n'),
      )
      lines.push('')
    }

    // Convergence-heuristic breakdown — all text-stats; see docs/coherence-scoring.md
    lines.push(`${c.bold}${c.magenta}Convergence Heuristic Breakdown${c.reset}`)
    lines.push(this.formatBar('Agreement (lex)', result.convergence.agreementConvergence))
    lines.push(this.formatBar('Contradictions', result.convergence.contradictionResolution))
    lines.push(this.formatBar('Evidence density', result.convergence.evidenceGrounding))
    lines.push(this.formatBar('Proposal overlap', result.convergence.proposalSimilarity))
    lines.push(this.formatBar('Consensus speed', result.convergence.consensusSpeed))
    lines.push('')

    // Synthesis
    lines.push(box('Synthesis', result.synthesis.slice(0, 800)))
    lines.push('')

    // Stats
    const stats = [
      `${c.dim}Tokens: ${result.totalTokensIn.toLocaleString()} in / ${result.totalTokensOut.toLocaleString()} out${c.reset}`,
      `${c.dim}Time: ${result.totalElapsed.toFixed(1)}s${c.reset}`,
    ]
    lines.push(stats.join('  '))

    return lines.join('\n')
  }

  /** Get the last debate result (for /convergence command). */
  getLastResult(): DebateResult | null {
    return this.lastResult
  }

  // ── Private ─────────────────────────────────────────────────────

  private resolvePersonas(config: DebateConfig): Persona[] {
    const personas: Persona[] = []

    if (config.customPersonas && config.customPersonas.length > 0) {
      personas.push(...config.customPersonas)
    }

    if (config.personas && config.personas.length > 0) {
      for (const name of config.personas) {
        const p = getPersona(name)
        if (p) personas.push(p)
      }
    }

    // If nothing resolved, pick defaults
    if (personas.length === 0) {
      const defaultNames = selectDefaultPersonas()
      for (const name of defaultNames) {
        const p = BUILT_IN_PERSONAS[name]
        if (p) personas.push(p)
      }
    }

    return personas
  }

  private formatBar(label: string, score: number): string {
    const barWidth = 20
    const filled = Math.round((score / 100) * barWidth)
    const empty = barWidth - filled
    const color = score >= 70 ? c.green : score >= 45 ? c.yellow : c.red
    const bar = `${color}${'█'.repeat(filled)}${c.dim}${'░'.repeat(empty)}${c.reset}`
    const paddedLabel = label.padEnd(16)
    return `  ${c.dim}${paddedLabel}${c.reset} ${bar} ${color}${score}${c.reset}`
  }
}
