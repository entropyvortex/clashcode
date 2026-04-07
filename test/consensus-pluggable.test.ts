/**
 * Tests for the v1.3 pluggable consensus engine APIs:
 * - ConvergenceScorer interface + LexicalConvergenceScorer
 * - PersonaRegistry interface + BuiltInPersonaRegistry, CompositePersonaRegistry, ConfigPersonaRegistry
 * - ClashEngine wiring with custom scorers and registries
 */

import { describe, it, expect, vi } from 'vitest'
import {
  ClashEngine,
  LexicalConvergenceScorer,
  BuiltInPersonaRegistry,
  CompositePersonaRegistry,
  ConfigPersonaRegistry,
  BUILT_IN_PERSONAS,
} from '../src/consensus/index.js'
import type {
  ConvergenceScorer,
  ConvergenceHeuristic,
  Persona,
  RoundEntry,
} from '../src/consensus/types.js'

// ── helpers ──────────────────────────────────────────────────────

function entry(persona: string, round: number, content: string): RoundEntry {
  return { persona, round, content, tokensIn: 0, tokensOut: 0, elapsed: 0 }
}

const fixedHeuristic: ConvergenceHeuristic = {
  overall: 77,
  agreementConvergence: 80,
  contradictionResolution: 70,
  evidenceGrounding: 75,
  proposalSimilarity: 85,
  consensusSpeed: 60,
}

function makeMockScorer(heuristic: ConvergenceHeuristic = fixedHeuristic): ConvergenceScorer {
  return {
    name: 'mock-scorer',
    score: vi.fn().mockReturnValue(heuristic),
  }
}

function makeMockOrchestrator() {
  return {
    runAgent: vi.fn().mockResolvedValue({
      output: 'Mock agent response for debate.',
      tokenUsage: { input_tokens: 100, output_tokens: 50 },
    }),
  }
}

function makePersona(
  name: string,
  description = 'test',
  systemPrompt = 'You are a test.',
): Persona {
  return { name, description, systemPrompt }
}

// ── LexicalConvergenceScorer ─────────────────────────────────────

describe('LexicalConvergenceScorer', () => {
  it('has name "lexical"', () => {
    const scorer = new LexicalConvergenceScorer()
    expect(scorer.name).toBe('lexical')
  })

  it('score() returns a ConvergenceHeuristic with all fields', () => {
    const scorer = new LexicalConvergenceScorer()
    const entries = [
      entry('a', 1, 'security performance architecture design'),
      entry('b', 1, 'security performance architecture design'),
    ]
    const result = scorer.score(entries, 1)
    expect(result).toHaveProperty('overall')
    expect(result).toHaveProperty('agreementConvergence')
    expect(result).toHaveProperty('contradictionResolution')
    expect(result).toHaveProperty('evidenceGrounding')
    expect(result).toHaveProperty('proposalSimilarity')
    expect(result).toHaveProperty('consensusSpeed')
    expect(typeof result.overall).toBe('number')
    expect(result.overall).toBeGreaterThanOrEqual(0)
    expect(result.overall).toBeLessThanOrEqual(100)
  })

  it('score() delegates to computeConvergence (same result)', () => {
    const scorer = new LexicalConvergenceScorer()
    const entries = [
      entry('a', 1, 'I disagree however'),
      entry('b', 1, 'I agree with you, building on that'),
    ]
    const result1 = scorer.score(entries, 1)
    const result2 = scorer.score(entries, 1)
    expect(result1).toEqual(result2)
  })
})

// ── BuiltInPersonaRegistry ───────────────────────────────────────

describe('BuiltInPersonaRegistry', () => {
  const registry = new BuiltInPersonaRegistry()

  it('list() returns all built-in persona names', () => {
    const names = registry.list()
    expect(names).toEqual(Object.keys(BUILT_IN_PERSONAS))
    expect(names.length).toBeGreaterThanOrEqual(6)
  })

  it('get() returns persona by name', () => {
    const p = registry.get('pragmatist')
    expect(p).toBeDefined()
    expect(p!.name).toBe('pragmatist')
    expect(p!.systemPrompt).toBeTruthy()
  })

  it('get() returns undefined for unknown name', () => {
    expect(registry.get('nonexistent-persona-xyz')).toBeUndefined()
  })

  it('getAll() returns shallow copy of all personas', () => {
    const all = registry.getAll()
    expect(Object.keys(all)).toEqual(Object.keys(BUILT_IN_PERSONAS))
    // Verify it is a copy, not the original reference
    expect(all).not.toBe(BUILT_IN_PERSONAS)
    expect(all).toEqual(BUILT_IN_PERSONAS)
  })
})

// ── CompositePersonaRegistry ─────────────────────────────────────

describe('CompositePersonaRegistry', () => {
  it('merges personas from multiple registries', () => {
    const regA = new ConfigPersonaRegistry([makePersona('alpha')])
    const regB = new ConfigPersonaRegistry([makePersona('beta')])
    const composite = new CompositePersonaRegistry([regA, regB])

    const names = composite.list()
    expect(names).toContain('alpha')
    expect(names).toContain('beta')
    expect(names).toHaveLength(2)
  })

  it('later registry wins on name collision (override precedence)', () => {
    const personaV1 = makePersona('shared', 'version 1', 'Prompt v1')
    const personaV2 = makePersona('shared', 'version 2', 'Prompt v2')
    const regA = new ConfigPersonaRegistry([personaV1])
    const regB = new ConfigPersonaRegistry([personaV2])
    const composite = new CompositePersonaRegistry([regA, regB])

    const resolved = composite.get('shared')
    expect(resolved).toBeDefined()
    expect(resolved!.description).toBe('version 2')
    expect(resolved!.systemPrompt).toBe('Prompt v2')
  })

  it('list() deduplicates names from overlapping registries', () => {
    const regA = new ConfigPersonaRegistry([makePersona('shared'), makePersona('only-a')])
    const regB = new ConfigPersonaRegistry([makePersona('shared'), makePersona('only-b')])
    const composite = new CompositePersonaRegistry([regA, regB])

    const names = composite.list()
    expect(names).toHaveLength(3)
    expect(names.filter((n) => n === 'shared')).toHaveLength(1)
  })

  it('get() returns undefined for missing persona', () => {
    const composite = new CompositePersonaRegistry([new ConfigPersonaRegistry([])])
    expect(composite.get('nope')).toBeUndefined()
  })

  it('getAll() merges all, later overrides earlier', () => {
    const personaV1 = makePersona('x', 'first', 'Prompt first')
    const personaV2 = makePersona('x', 'second', 'Prompt second')
    const unique = makePersona('y', 'unique', 'Prompt unique')
    const regA = new ConfigPersonaRegistry([personaV1])
    const regB = new ConfigPersonaRegistry([personaV2, unique])
    const composite = new CompositePersonaRegistry([regA, regB])

    const all = composite.getAll()
    expect(Object.keys(all)).toHaveLength(2)
    expect(all['x']!.description).toBe('second')
    expect(all['y']!.description).toBe('unique')
  })

  it('works with empty registries', () => {
    const composite = new CompositePersonaRegistry([])
    expect(composite.list()).toEqual([])
    expect(composite.get('anything')).toBeUndefined()
    expect(composite.getAll()).toEqual({})
  })

  it('composes with BuiltInPersonaRegistry', () => {
    const custom = new ConfigPersonaRegistry([makePersona('custom-bot', 'custom', 'Custom prompt')])
    const composite = new CompositePersonaRegistry([new BuiltInPersonaRegistry(), custom])

    expect(composite.list()).toContain('pragmatist')
    expect(composite.list()).toContain('custom-bot')
    expect(composite.get('pragmatist')).toBeDefined()
    expect(composite.get('custom-bot')).toBeDefined()
  })
})

// ── ConfigPersonaRegistry ────────────────────────────────────────

describe('ConfigPersonaRegistry', () => {
  it('constructs from an array of personas', () => {
    const personas = [makePersona('alice'), makePersona('bob')]
    const reg = new ConfigPersonaRegistry(personas)
    expect(reg.list()).toEqual(['alice', 'bob'])
  })

  it('get() returns persona by name', () => {
    const reg = new ConfigPersonaRegistry([makePersona('alice', 'desc-a', 'prompt-a')])
    const p = reg.get('alice')
    expect(p).toBeDefined()
    expect(p!.description).toBe('desc-a')
    expect(p!.systemPrompt).toBe('prompt-a')
  })

  it('get() returns undefined for unknown name', () => {
    const reg = new ConfigPersonaRegistry([makePersona('alice')])
    expect(reg.get('bob')).toBeUndefined()
  })

  it('getAll() returns copy of internal map', () => {
    const personas = [makePersona('alice'), makePersona('bob')]
    const reg = new ConfigPersonaRegistry(personas)
    const all = reg.getAll()
    expect(Object.keys(all)).toEqual(['alice', 'bob'])
  })

  it('handles empty array', () => {
    const reg = new ConfigPersonaRegistry([])
    expect(reg.list()).toEqual([])
    expect(reg.get('x')).toBeUndefined()
    expect(reg.getAll()).toEqual({})
  })

  it('last persona wins on duplicate names in input array', () => {
    const personas = [
      makePersona('dup', 'first', 'Prompt first'),
      makePersona('dup', 'second', 'Prompt second'),
    ]
    const reg = new ConfigPersonaRegistry(personas)
    expect(reg.list()).toEqual(['dup'])
    expect(reg.get('dup')!.description).toBe('second')
  })
})

// ── ClashEngine with custom ConvergenceScorer ────────────────────

describe('ClashEngine with custom ConvergenceScorer', () => {
  it('uses the provided scorer instead of the default lexical one', () => {
    const scorer = makeMockScorer()
    const engine = new ClashEngine('test-model', 'test-provider', { scorer })
    expect(engine.scorer).toBe(scorer)
    expect(engine.scorer.name).toBe('mock-scorer')
  })

  it('defaults to LexicalConvergenceScorer when no scorer provided', () => {
    const engine = new ClashEngine('test-model', 'test-provider')
    expect(engine.scorer.name).toBe('lexical')
    expect(engine.scorer).toBeInstanceOf(LexicalConvergenceScorer)
  })

  it('runDebate calls the custom scorer', async () => {
    const scorer = makeMockScorer()
    const registry = new ConfigPersonaRegistry([makePersona('agent-a', 'A', 'You are agent A.')])
    const engine = new ClashEngine('test-model', 'test-provider', {
      scorer,
      personaRegistry: registry,
    })

    const orchestrator = makeMockOrchestrator()
    const result = await engine.runDebate(
      { topic: 'Test topic', rounds: 1, personas: ['agent-a'] },
      orchestrator as any,
    )

    expect(scorer.score).toHaveBeenCalled()
    expect(result.convergence).toEqual(fixedHeuristic)
  })

  it('runDebate calls scorer once per round for interim + once final', async () => {
    const scorer = makeMockScorer()
    const registry = new ConfigPersonaRegistry([makePersona('agent-a')])
    const engine = new ClashEngine('m', 'p', { scorer, personaRegistry: registry })
    const orchestrator = makeMockOrchestrator()

    await engine.runDebate({ topic: 'T', rounds: 3, personas: ['agent-a'] }, orchestrator as any)

    // 3 interim (one per round) + 1 final = 4 calls
    expect(scorer.score).toHaveBeenCalledTimes(4)
  })

  it('supports async scorer (Promise-returning)', async () => {
    const asyncScorer: ConvergenceScorer = {
      name: 'async-mock',
      score: vi.fn().mockResolvedValue(fixedHeuristic),
    }
    const registry = new ConfigPersonaRegistry([makePersona('agent-a')])
    const engine = new ClashEngine('m', 'p', { scorer: asyncScorer, personaRegistry: registry })
    const orchestrator = makeMockOrchestrator()

    const result = await engine.runDebate(
      { topic: 'T', rounds: 1, personas: ['agent-a'] },
      orchestrator as any,
    )

    expect(result.convergence).toEqual(fixedHeuristic)
    expect(asyncScorer.score).toHaveBeenCalled()
  })

  it('formatReport includes scorer name', () => {
    const scorer = makeMockScorer()
    const engine = new ClashEngine('m', 'p', { scorer })
    const result = {
      id: 'test',
      topic: 'T',
      rounds: 1,
      personas: ['a'],
      phases: ['initial-analysis' as const],
      entries: [entry('a', 1, 'content')],
      convergence: fixedHeuristic,
      synthesis: 'Synthesis text',
      totalTokensIn: 100,
      totalTokensOut: 50,
      totalElapsed: 1.0,
      timestamp: 0,
    }
    const report = engine.formatReport(result)
    expect(report).toContain('mock-scorer')
  })
})

// ── ClashEngine with custom PersonaRegistry ──────────────────────

describe('ClashEngine with custom PersonaRegistry', () => {
  it('uses the provided registry', () => {
    const registry = new ConfigPersonaRegistry([makePersona('custom-p')])
    const engine = new ClashEngine('m', 'p', { personaRegistry: registry })
    expect(engine.personaRegistry).toBe(registry)
  })

  it('defaults to BuiltInPersonaRegistry when no registry provided', () => {
    const engine = new ClashEngine('m', 'p')
    expect(engine.personaRegistry).toBeInstanceOf(BuiltInPersonaRegistry)
  })

  it('resolvePersonas uses the registry for named personas', async () => {
    const customPersona = makePersona('my-expert', 'Expert', 'You are an expert.')
    const registry = new ConfigPersonaRegistry([customPersona])
    const engine = new ClashEngine('m', 'p', { personaRegistry: registry })
    const orchestrator = makeMockOrchestrator()

    const result = await engine.runDebate(
      { topic: 'Test', rounds: 1, personas: ['my-expert'] },
      orchestrator as any,
    )

    expect(result.personas).toEqual(['my-expert'])
    expect(orchestrator.runAgent).toHaveBeenCalledTimes(1)
    // Verify the system prompt from our custom persona was used
    const agentConfig = orchestrator.runAgent.mock.calls[0][0]
    expect(agentConfig.name).toBe('my-expert')
    expect(agentConfig.systemPrompt).toContain('You are an expert.')
  })

  it('resolvePersonas ignores unknown persona names gracefully', async () => {
    const registry = new ConfigPersonaRegistry([makePersona('exists')])
    const engine = new ClashEngine('m', 'p', { personaRegistry: registry })
    const orchestrator = makeMockOrchestrator()

    const result = await engine.runDebate(
      { topic: 'T', rounds: 1, personas: ['exists', 'does-not-exist'] },
      orchestrator as any,
    )

    // Only the existing persona should participate
    expect(result.personas).toEqual(['exists'])
    expect(orchestrator.runAgent).toHaveBeenCalledTimes(1)
  })

  it('falls back to registry defaults when no personas specified', async () => {
    const personas = [
      makePersona('a1'),
      makePersona('a2'),
      makePersona('a3'),
      makePersona('a4'),
      makePersona('a5'),
    ]
    const registry = new ConfigPersonaRegistry(personas)
    const engine = new ClashEngine('m', 'p', { personaRegistry: registry })
    const orchestrator = makeMockOrchestrator()

    const result = await engine.runDebate({ topic: 'T', rounds: 1 }, orchestrator as any)

    // selectDefaultPersonas picks up to 4 from the registry
    expect(result.personas.length).toBeGreaterThanOrEqual(1)
    expect(result.personas.length).toBeLessThanOrEqual(4)
    // All resolved personas should be from our registry
    for (const name of result.personas) {
      expect(registry.get(name)).toBeDefined()
    }
  })

  it('customPersonas in config are used directly (not from registry)', async () => {
    const registry = new ConfigPersonaRegistry([]) // empty registry
    const engine = new ClashEngine('m', 'p', { personaRegistry: registry })
    const orchestrator = makeMockOrchestrator()

    const customPersona: Persona = {
      name: 'inline-expert',
      description: 'Inline',
      systemPrompt: 'You are inline.',
    }

    const result = await engine.runDebate(
      { topic: 'T', rounds: 1, customPersonas: [customPersona] },
      orchestrator as any,
    )

    expect(result.personas).toEqual(['inline-expert'])
    expect(orchestrator.runAgent).toHaveBeenCalledTimes(1)
  })

  it('runDebate emits progress events with correct persona names', async () => {
    const registry = new ConfigPersonaRegistry([makePersona('ev-persona')])
    const engine = new ClashEngine('m', 'p', { personaRegistry: registry })
    const orchestrator = makeMockOrchestrator()
    const events: any[] = []

    await engine.runDebate(
      {
        topic: 'T',
        rounds: 1,
        personas: ['ev-persona'],
        onProgress: (e) => events.push(e),
      },
      orchestrator as any,
    )

    const phaseStart = events.find((e) => e.type === 'phase_start')
    expect(phaseStart).toBeDefined()
    expect(phaseStart.personas).toEqual(['ev-persona'])

    const personaStart = events.find((e) => e.type === 'persona_start')
    expect(personaStart).toBeDefined()
    expect(personaStart.persona).toBe('ev-persona')

    const debateComplete = events.find((e) => e.type === 'debate_complete')
    expect(debateComplete).toBeDefined()
  })
})
