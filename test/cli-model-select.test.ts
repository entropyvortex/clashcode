/**
 * Unit tests for src/cli/model-select.ts — formatModelMenu, parseModelChoice.
 */
import { describe, it, expect } from 'vitest'
import { formatModelMenu, parseModelChoice, type ModelEntry } from '../src/cli/model-select.js'

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '')

const MODELS: ModelEntry[] = [
  { id: 'grok-3', owned_by: 'xai' },
  { id: 'grok-4', owned_by: 'xai' },
  { id: 'grok-4-mini', owned_by: 'xai' },
]

describe('formatModelMenu', () => {
  it('returns "No models found" for empty list', () => {
    const result = stripAnsi(formatModelMenu([], 'grok-4'))
    expect(result).toContain('No models found')
  })

  it('includes numbered entries', () => {
    const result = stripAnsi(formatModelMenu(MODELS, 'grok-4'))
    expect(result).toContain('1')
    expect(result).toContain('grok-3')
    expect(result).toContain('2')
    expect(result).toContain('grok-4')
    expect(result).toContain('3')
  })

  it('marks current model with *', () => {
    const result = stripAnsi(formatModelMenu(MODELS, 'grok-4'))
    // The line for grok-4 should have the * marker
    const lines = result.split('\n')
    const grok4Line = lines.find((l) => l.includes('grok-4') && !l.includes('grok-4-mini'))
    expect(grok4Line).toContain('*')
  })

  it('includes owned_by info', () => {
    const result = stripAnsi(formatModelMenu(MODELS, 'none'))
    expect(result).toContain('(xai)')
  })
})

describe('parseModelChoice', () => {
  it('returns null for empty input', () => {
    expect(parseModelChoice('', MODELS)).toBeNull()
  })

  it('parses a number selection (1-based)', () => {
    expect(parseModelChoice('1', MODELS)).toBe('grok-3')
    expect(parseModelChoice('2', MODELS)).toBe('grok-4')
    expect(parseModelChoice('3', MODELS)).toBe('grok-4-mini')
  })

  it('returns null for out-of-range number', () => {
    expect(parseModelChoice('0', MODELS)).toBeNull()
    expect(parseModelChoice('99', MODELS)).toBeNull()
  })

  it('matches exact model ID', () => {
    expect(parseModelChoice('grok-3', MODELS)).toBe('grok-3')
  })

  it('matches unique prefix', () => {
    expect(parseModelChoice('grok-3', MODELS)).toBe('grok-3')
  })

  it('accepts any string longer than 2 chars as direct ID', () => {
    expect(parseModelChoice('custom-model', MODELS)).toBe('custom-model')
  })

  it('returns null for very short unknown input', () => {
    expect(parseModelChoice('zz', MODELS)).toBeNull()
  })
})
