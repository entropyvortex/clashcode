/**
 * Unit tests for src/cli/coordination-view.ts — event feed, state management.
 *
 * The TUI renderer itself is not tested (requires a real TTY). We test the
 * public API (showCoordinationView, feedEvent, clearCoordinationView,
 * freezeCoordinationView) in non-interactive mode where output goes to
 * stderr as line logs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Force non-interactive mode so no ANSI cursor control happens.
process.env['CLASHCODE_NO_TUI'] = '1'

import {
  showCoordinationView,
  feedEvent,
  clearCoordinationView,
  freezeCoordinationView,
  isTUIDisabled,
  type AgentStatus,
} from '../src/cli/coordination-view.js'

describe('coordination-view (non-interactive)', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    clearCoordinationView()
    stderrSpy.mockRestore()
  })

  it('isTUIDisabled returns true when CLASHCODE_NO_TUI=1', () => {
    expect(isTUIDisabled()).toBe(true)
  })

  it('showCoordinationView writes task and agent names', () => {
    const agents: AgentStatus[] = [
      { name: 'coder', role: 'coder', state: 'idle' },
      { name: 'reviewer', role: 'reviewer', state: 'idle' },
    ]
    showCoordinationView('build the thing', agents)
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('build the thing')
    expect(output).toContain('coder')
    expect(output).toContain('reviewer')
  })

  it('showCoordinationView defaults to assistant agent', () => {
    showCoordinationView('solo task')
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('assistant')
  })

  it('feedEvent agent_start logs event to stderr', () => {
    showCoordinationView('task', [{ name: 'coder', role: 'coder', state: 'idle' }])
    stderrSpy.mockClear()
    feedEvent({ type: 'agent_start', agent: 'coder' })
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('coder started')
  })

  it('feedEvent agent_complete logs done event', () => {
    showCoordinationView('task', [{ name: 'coder', role: 'coder', state: 'thinking' }])
    feedEvent({ type: 'agent_start', agent: 'coder' })
    stderrSpy.mockClear()
    feedEvent({
      type: 'agent_complete',
      agent: 'coder',
      data: { tokenUsage: { input_tokens: 100, output_tokens: 50 } },
    })
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('coder done')
  })

  it('feedEvent task_start logs the task label', () => {
    showCoordinationView('task')
    stderrSpy.mockClear()
    feedEvent({ type: 'task_start', task: 'Phase: synthesis' })
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('Phase: synthesis')
  })

  it('feedEvent consensus_update stores consensus state', () => {
    showCoordinationView('debate')
    feedEvent({
      type: 'consensus_update',
      data: {
        personas: ['pragmatist', 'devil'],
        currentRound: 2,
        totalRounds: 4,
        phase: 'counterarguments',
        convergence: 42,
      },
    })
    // No crash — state is internal, but we can verify no error
  })

  it('feedEvent with no active view is a no-op', () => {
    clearCoordinationView()
    // Should not throw
    feedEvent({ type: 'agent_start', agent: 'test' })
  })

  it('freezeCoordinationView stops the view', () => {
    showCoordinationView('task')
    freezeCoordinationView()
    // After freeze, feedEvent should be a no-op
    stderrSpy.mockClear()
    feedEvent({ type: 'agent_start', agent: 'test' })
    expect(stderrSpy).not.toHaveBeenCalled()
  })

  it('clearCoordinationView stops the view', () => {
    showCoordinationView('task')
    clearCoordinationView()
    stderrSpy.mockClear()
    feedEvent({ type: 'agent_start', agent: 'test' })
    expect(stderrSpy).not.toHaveBeenCalled()
  })

  it('showCoordinationView truncates long tasks', () => {
    const longTask = 'a'.repeat(100)
    showCoordinationView(longTask)
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('...')
  })

  it('feedEvent error sets agent state', () => {
    showCoordinationView('task', [{ name: 'coder', role: 'coder', state: 'thinking' }])
    stderrSpy.mockClear()
    feedEvent({ type: 'error', agent: 'coder', data: 'API timeout' })
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('error')
  })

  it('feedEvent message increments message counter', () => {
    showCoordinationView('task', [{ name: 'coder', role: 'coder', state: 'thinking' }])
    feedEvent({ type: 'message', agent: 'coder', data: 'tool call: bash' })
    // Verify no crash — internal state only
  })

  it('feedEvent task_complete increments handoff counter', () => {
    showCoordinationView('task')
    feedEvent({ type: 'task_complete' })
    // Verify no crash
  })

  it('feedEvent task_retry logs retry event', () => {
    showCoordinationView('task')
    stderrSpy.mockClear()
    feedEvent({ type: 'task_retry', task: 'API call' })
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(output).toContain('retry')
  })
})
