/**
 * ClashRunner — handles the 6-persona structured debate with clear
 * numbered rounds, insight sharing, and convergence detection.
 *
 * Absorbs the debate logic previously in consensus/index.ts and
 * integrates it deeply with the ClashEngine event system.
 *
 * @module core/clash-engine/debate-runner
 */

import type { Arena } from './execution-context.js'
import { callModel } from './llm-client.js'
import type {
  DebateConfig,
  DebatePhase,
  DebateResult,
  Persona,
  PersonaRegistry,
  RoundEntry,
  ConvergenceScorer,
} from '../../consensus/types.js'
import { randomUUID } from 'node:crypto'

/** Phase instructions appended to persona system prompts per round. */
const PHASE_PROMPTS: Record<DebatePhase, string> = {
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

/** Build the context prompt containing all previous debate entries. */
function buildContext(topic: string, entries: RoundEntry[], currentPhase: DebatePhase): string {
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

/** Build a final synthesis from the last-round entries. */
function buildSynthesis(entries: RoundEntry[], finalRound: number, topic: string): string {
  const finalEntries = entries.filter((e) => e.round === finalRound)
  if (finalEntries.length === 0) return 'No entries in the final round.'
  const parts = finalEntries.map((e) => `[${e.persona}]: ${e.content}`)
  return `Synthesis of ${finalEntries.length} perspectives on: ${topic}\n\n` + parts.join('\n\n')
}

/**
 * Run a structured multi-perspective debate through the ClashEngine.
 *
 * Each persona runs as a single LLM call per round (no tool calling —
 * debate is pure reasoning). Rich events emitted at every step.
 */
export async function runClashDebate(
  config: DebateConfig,
  arena: Arena,
  scorer: ConvergenceScorer,
  personaRegistry: PersonaRegistry,
): Promise<DebateResult> {
  const totalRounds = config.rounds ?? 4
  const startTime = Date.now()

  // Resolve personas
  const resolvedPersonas = resolvePersonas(config, personaRegistry)
  const personaNames = resolvedPersonas.map((p) => p.name)

  const entries: RoundEntry[] = []
  const phases: DebatePhase[] = []

  for (let round = 1; round <= totalRounds; round++) {
    const phase = phaseForRound(round)
    phases.push(phase)

    arena.signals.emit('round_opened', {
      detail: `round ${round}: ${phase}`,
      data: { round, totalRounds, phase },
    })

    config.onProgress?.({
      type: 'phase_start',
      phase,
      round,
      totalRounds,
      personas: personaNames,
    })

    const context = buildContext(config.topic, entries, phase)

    for (const persona of resolvedPersonas) {
      arena.signals.emit('spark_ignited', {
        agent: persona.name,
        detail: `${phase} round ${round}`,
      })

      config.onProgress?.({ type: 'persona_start', persona: persona.name, round })

      const roundStart = Date.now()
      let content = ''
      let tokensIn = 0
      let tokensOut = 0

      try {
        const systemPrompt = persona.systemPrompt + '\n\n' + PHASE_PROMPTS[phase]
        const result = await callModel({
          model: persona.model ?? arena.model,
          apiKey: arena.apiKey,
          baseURL: arena.baseURL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: context },
          ],
        })

        content = result.message.content ?? ''
        tokensIn = result.usage.input_tokens
        tokensOut = result.usage.output_tokens
      } catch (err) {
        content = `[Error: ${err instanceof Error ? err.message : String(err)}]`
        arena.signals.emit('fault_recovered', {
          agent: persona.name,
          detail: content,
        })
      }

      const elapsed = (Date.now() - roundStart) / 1000

      entries.push({ persona: persona.name, round, content, tokensIn, tokensOut, elapsed })

      arena.signals.emit('spark_completed', {
        agent: persona.name,
        data: { tokenUsage: { input_tokens: tokensIn, output_tokens: tokensOut } },
      })

      config.onProgress?.({
        type: 'persona_complete',
        persona: persona.name,
        round,
        tokensIn,
        tokensOut,
        elapsed,
      })
    }

    // Emit convergence check after each round
    const interim = await Promise.resolve(scorer.score(entries, round))
    arena.signals.emit('convergence_probed', {
      detail: `round ${round} convergence: ${interim.overall}`,
      data: {
        currentRound: round,
        totalRounds,
        convergence: interim.overall,
        phase,
      },
    })

    config.onProgress?.({
      type: 'round_complete',
      round,
      totalRounds,
      convergence: interim.overall,
    })
  }

  config.onProgress?.({ type: 'debate_complete' })

  const convergence = await Promise.resolve(scorer.score(entries, totalRounds))
  const synthesis = buildSynthesis(entries, totalRounds, config.topic)

  const totalTokensIn = entries.reduce((s, e) => s + e.tokensIn, 0)
  const totalTokensOut = entries.reduce((s, e) => s + e.tokensOut, 0)
  const totalElapsed = (Date.now() - startTime) / 1000

  arena.signals.emit('session_sealed', {
    detail: 'debate complete',
    data: { convergence: convergence.overall },
  })

  return {
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
}

// ── Persona resolution ─────────────────────────────────────────

function selectDefaultPersonas(registry: PersonaRegistry): string[] {
  const all = registry.list()
  const shuffled = [...all].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, 4)
}

function resolvePersonas(config: DebateConfig, registry: PersonaRegistry): Persona[] {
  const personas: Persona[] = []

  if (config.customPersonas && config.customPersonas.length > 0) {
    personas.push(...config.customPersonas)
  }

  if (config.personas && config.personas.length > 0) {
    for (const name of config.personas) {
      const p = registry.get(name)
      if (p) personas.push(p)
    }
  }

  if (personas.length === 0) {
    const defaultNames = selectDefaultPersonas(registry)
    for (const name of defaultNames) {
      const p = registry.get(name)
      if (p) personas.push(p)
    }
  }

  return personas
}
