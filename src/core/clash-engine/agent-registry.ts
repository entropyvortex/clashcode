/**
 * PersonaCatalog — clean registry of all agent presets and debate personas
 * with their system prompts and capabilities.
 *
 * @module core/clash-engine/agent-registry
 */

import type { AgentSpec } from './types.js'

/** Default model placeholder (resolved at runtime from Arena). */
const MODEL_PLACEHOLDER = 'grok-4'

// ── Agent Presets (3-role squad) ──────────────────────────────

export const CODER_AGENT: AgentSpec = {
  name: 'coder',
  model: MODEL_PLACEHOLDER,
  systemPrompt: `You are a senior software engineer. Write clean, correct, well-tested code.
Follow existing conventions in the codebase. Prefer simple solutions over clever ones.
Always explain your reasoning before writing code.`,
  tools: [
    'bash',
    'file_read',
    'file_write',
    'file_edit',
    'grep',
    'sandbox_exec',
    'sandbox_write',
    'sandbox_read',
  ],
}

export const REVIEWER_AGENT: AgentSpec = {
  name: 'reviewer',
  model: MODEL_PLACEHOLDER,
  systemPrompt: `You are a code reviewer. Examine code changes for correctness, security,
performance, and maintainability. Be specific about issues and suggest concrete fixes.
Flag any potential bugs, edge cases, or missing error handling.`,
  tools: ['bash', 'file_read', 'grep'],
}

export const CONSENSUS_AGENT: AgentSpec = {
  name: 'consensus',
  model: MODEL_PLACEHOLDER,
  systemPrompt:
    'You are a structured debate facilitator. You coordinate multi-perspective analysis by synthesizing viewpoints from different personas and driving toward coherent consensus.',
  tools: ['bash', 'file_read', 'grep'],
}

/** All available agent presets, keyed by name. */
export const AGENT_PRESETS: Record<string, AgentSpec> = {
  coder: CODER_AGENT,
  reviewer: REVIEWER_AGENT,
  consensus: CONSENSUS_AGENT,
}

/** Create a default squad blueprint for the 3-role team. */
export function defaultSquadBlueprint(model?: string): {
  name: string
  agents: AgentSpec[]
  sharedMemory: boolean
  maxConcurrency: number
} {
  const m = model ?? MODEL_PLACEHOLDER
  return {
    name: 'clash-team',
    agents: [
      { ...CODER_AGENT, model: m },
      { ...REVIEWER_AGENT, model: m },
      { ...CONSENSUS_AGENT, model: m },
    ],
    sharedMemory: true,
    maxConcurrency: 3,
  }
}
