/** A debate perspective/persona. */
export interface Persona {
  name: string
  description: string
  systemPrompt: string
  model?: string // override model for this persona (multi-model debates)
  provider?: string // override provider
}

/** A single round contribution from one persona. */
export interface RoundEntry {
  persona: string
  round: number
  content: string
  tokensIn: number
  tokensOut: number
  elapsed: number // seconds
}

/** Phase labels for structured debate. */
export type DebatePhase =
  | 'initial-analysis'
  | 'counterarguments'
  | 'evidence-assessment'
  | 'synthesis'
  | 'refinement'

/**
 * Convergence heuristic — a lexical / text-statistics signal, not a
 * semantic quality metric.
 *
 * Every sub-score is computed from bag-of-words statistics (Jaccard
 * keyword overlap, pattern counting, evidence-marker density). A high
 * `overall` score means the final-round entries look lexically similar
 * and evidence-rich; it does NOT mean the personas actually agreed.
 *
 * Known failure modes (adversarial same-vocabulary disagreement,
 * evidence-marker stuffing, template-phrasing convergence) are
 * documented in `docs/coherence-scoring.md` with measured examples
 * from `eval/fixtures/`. Run `pnpm test:eval` to reproduce.
 *
 * Use as a directional UX signal for comparing runs and spotting
 * low-quality debates — not as ground truth.
 */
export interface ConvergenceHeuristic {
  overall: number // 0-100
  agreementConvergence: number // 0-100: Jaccard overlap of final-round keywords
  contradictionResolution: number // 0-100: early-disagreement → late-acknowledgment ratio
  evidenceGrounding: number // 0-100: density of evidence-marker tokens
  proposalSimilarity: number // 0-100: overlap of recommendation sentences
  consensusSpeed: number // 0-100: how early agreement vocabulary appeared
}

/** Complete debate result. */
export interface DebateResult {
  id: string
  topic: string
  rounds: number
  personas: string[]
  phases: DebatePhase[]
  entries: RoundEntry[]
  convergence: ConvergenceHeuristic
  synthesis: string // final synthesized conclusion
  totalTokensIn: number
  totalTokensOut: number
  totalElapsed: number
  timestamp: number
}

/** Configuration for running a debate. */
export interface DebateConfig {
  topic: string
  rounds?: number // default 4
  personas?: string[] // persona names to use (default: all built-in)
  customPersonas?: Persona[] // ad-hoc personas
  onProgress?: (event: ConsensusEvent) => void
}

export interface ConsensusEvent {
  type: 'phase_start' | 'persona_start' | 'persona_complete' | 'round_complete' | 'debate_complete'
  phase?: DebatePhase
  round?: number
  totalRounds?: number
  persona?: string
  personas?: string[]
  tokensIn?: number
  tokensOut?: number
  elapsed?: number
  convergence?: number // 0-100 interim convergence heuristic after round_complete
}

// ── Pluggable scoring interface (v1.3) ──────────────────────────

/**
 * Pluggable convergence scorer. The built-in lexical scorer implements
 * this interface. Embeddings-based scorers can be plugged in by
 * providing an implementation that maps entries to vectors and computes
 * cosine similarity.
 *
 * @example
 * ```ts
 * const embeddingsScorer: ConvergenceScorer = {
 *   name: 'embeddings',
 *   async score(entries, totalRounds) {
 *     // call embeddings API, compute cosine similarity...
 *     return { overall: 82, agreementConvergence: 90, ... }
 *   },
 * }
 * const engine = new ClashEngine(model, provider, { scorer: embeddingsScorer })
 * ```
 */
export interface ConvergenceScorer {
  readonly name: string
  score(
    entries: RoundEntry[],
    totalRounds: number,
  ): ConvergenceHeuristic | Promise<ConvergenceHeuristic>
}

/**
 * Pluggable persona registry. Allows loading personas from external
 * config files, databases, or APIs.
 */
export interface PersonaRegistry {
  list(): string[]
  get(name: string): Persona | undefined
  getAll(): Record<string, Persona>
}
