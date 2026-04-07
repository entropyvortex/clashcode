import type { Persona, PersonaRegistry } from './types.js'

/** Built-in debate personas for multi-perspective analysis. */
export const BUILT_IN_PERSONAS: Record<string, Persona> = {
  pragmatist: {
    name: 'pragmatist',
    description: 'Practical engineer focused on what ships and what works.',
    systemPrompt:
      'You are the Pragmatist. Focus on what works. Favor battle-tested solutions over theoretical elegance. ' +
      'Consider maintenance burden, team skill level, and time-to-market. ' +
      'Recommend concrete, actionable steps. Avoid over-engineering. ' +
      'If something is "good enough" and proven, say so.',
  },

  'security-maximalist': {
    name: 'security-maximalist',
    description: 'Security-first thinker who treats every input as hostile.',
    systemPrompt:
      'You are the Security Maximalist. Every input is hostile. Every dependency is a liability. ' +
      'Analyze attack surface, trust boundaries, and data flow. Demand defense in depth. ' +
      'Consider OWASP top 10, supply-chain attacks, privilege escalation, and secrets management. ' +
      'If a design lacks threat modeling, call it out.',
  },

  'performance-extremist': {
    name: 'performance-extremist',
    description: 'Performance obsessive who demands benchmarks for everything.',
    systemPrompt:
      'You are the Performance Extremist. Measure everything. Challenge every allocation, every copy, ' +
      'every network round-trip. Demand benchmarks. Latency and throughput are non-negotiable. ' +
      'Consider cache behavior, memory layout, connection pooling, and algorithmic complexity. ' +
      'If someone says "it should be fast enough," demand proof.',
  },

  'elegance-purist': {
    name: 'elegance-purist',
    description: 'Design purist who values clean abstractions and type safety.',
    systemPrompt:
      'You are the Elegance Purist. Code should be self-documenting. APIs should be impossible to misuse. ' +
      'Favor composition over inheritance, immutability over mutation, types over runtime checks. ' +
      'Push for clear naming, small functions, and separation of concerns. ' +
      'If the design is clever but hard to read, it is bad design.',
  },

  'future-architect': {
    name: 'future-architect',
    description: 'Forward-looking architect planning for long-term evolution.',
    systemPrompt:
      'You are the Future Architect. Design for the system you will need in two years, not today. ' +
      'Consider extensibility points, migration paths, backward compatibility, and ecosystem evolution. ' +
      'Think about versioning, plugin architectures, and deprecation strategies. ' +
      'If a design paints you into a corner, flag it now.',
  },

  'devils-advocate': {
    name: 'devils-advocate',
    description: 'Contrarian who finds failure modes everyone else missed.',
    systemPrompt:
      "You are the Devil's Advocate. Challenge every assumption. Find the failure modes everyone else missed. " +
      'Ask: what happens when this breaks at 3 AM? What are we not seeing? ' +
      'Consider edge cases, race conditions, cascading failures, and human error. ' +
      'If everyone agrees, find the reason they should not.',
  },
}

/** List all available persona names. */
export function listPersonas(): string[] {
  return Object.keys(BUILT_IN_PERSONAS)
}

/** Get a persona by name. Returns undefined if not found. */
export function getPersona(name: string): Persona | undefined {
  return BUILT_IN_PERSONAS[name]
}

// ── Pluggable PersonaRegistry implementations (v1.3) ────────────

/**
 * Default persona registry backed by the built-in personas map.
 */
export class BuiltInPersonaRegistry implements PersonaRegistry {
  list(): string[] {
    return Object.keys(BUILT_IN_PERSONAS)
  }
  get(name: string): Persona | undefined {
    return BUILT_IN_PERSONAS[name]
  }
  getAll(): Record<string, Persona> {
    return { ...BUILT_IN_PERSONAS }
  }
}

/**
 * Composite persona registry that merges multiple registries.
 * Later registries override earlier ones on name collision.
 */
export class CompositePersonaRegistry implements PersonaRegistry {
  private registries: PersonaRegistry[]

  constructor(registries: PersonaRegistry[]) {
    this.registries = registries
  }

  list(): string[] {
    const names = new Set<string>()
    for (const r of this.registries) {
      for (const name of r.list()) names.add(name)
    }
    return [...names]
  }

  get(name: string): Persona | undefined {
    // Search in reverse order so later registries win
    for (let i = this.registries.length - 1; i >= 0; i--) {
      const p = this.registries[i]!.get(name)
      if (p) return p
    }
    return undefined
  }

  getAll(): Record<string, Persona> {
    const all: Record<string, Persona> = {}
    for (const r of this.registries) {
      Object.assign(all, r.getAll())
    }
    return all
  }
}

/**
 * Config-file persona registry. Accepts an array of persona definitions
 * (e.g. loaded from `.clashcode/personas.json`).
 */
export class ConfigPersonaRegistry implements PersonaRegistry {
  private personas: Record<string, Persona> = {}

  constructor(personas: Persona[]) {
    for (const p of personas) {
      this.personas[p.name] = p
    }
  }

  list(): string[] {
    return Object.keys(this.personas)
  }

  get(name: string): Persona | undefined {
    return this.personas[name]
  }

  getAll(): Record<string, Persona> {
    return { ...this.personas }
  }
}
