import { describe, it, expect, beforeEach } from 'vitest'
import {
  increment,
  observe,
  getMetrics,
  resetMetrics,
  formatMetrics,
  telemetryActive,
} from '../src/telemetry.js'

describe('telemetry', () => {
  beforeEach(() => resetMetrics())

  it('counters accumulate', () => {
    increment('sandbox.exec')
    increment('sandbox.exec')
    increment('sandbox.exec', 3)
    const m = getMetrics()
    expect(m.counters['sandbox.exec']).toBe(5)
  })

  it('different counter names are separate', () => {
    increment('cache.hits', 2)
    increment('cache.misses', 1)
    const m = getMetrics()
    expect(m.counters['cache.hits']).toBe(2)
    expect(m.counters['cache.misses']).toBe(1)
  })

  it('histograms track count/sum/min/max', () => {
    observe('sandbox.exec.ms', 100)
    observe('sandbox.exec.ms', 200)
    observe('sandbox.exec.ms', 50)
    const m = getMetrics()
    const h = m.histograms['sandbox.exec.ms']
    expect(h?.count).toBe(3)
    expect(h?.sum).toBe(350)
    expect(h?.min).toBe(50)
    expect(h?.max).toBe(200)
  })

  it('resetMetrics clears everything', () => {
    increment('llm.requests', 5)
    observe('tokens.input', 100)
    resetMetrics()
    const m = getMetrics()
    expect(Object.keys(m.counters)).toHaveLength(0)
    expect(Object.keys(m.histograms)).toHaveLength(0)
  })

  it('formatMetrics returns readable output', () => {
    increment('sandbox.exec', 3)
    observe('sandbox.exec.ms', 120)
    const out = formatMetrics()
    expect(out).toContain('sandbox.exec')
    expect(out).toContain('3')
    expect(out).toContain('sandbox.exec.ms')
    expect(out).toContain('n=1')
    expect(out).toContain('avg=120')
  })

  it('empty formatMetrics says (none)', () => {
    const out = formatMetrics()
    expect(out).toContain('(none)')
  })

  it('telemetryActive returns defaults', () => {
    const active = telemetryActive()
    expect(typeof active.otel).toBe('boolean')
    expect(typeof active.sentry).toBe('boolean')
  })
})
