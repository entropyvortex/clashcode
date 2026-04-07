/**
 * SignalBus — lightweight typed pub/sub for inter-agent communication.
 *
 * Powers all event streaming from the engine to the TUI. Every agent
 * action, tool call, phase transition, and insight flows through here.
 *
 * @module core/clash-engine/event-bus
 */

import type { ArenaEvent, ArenaEventKind, OrchestratorEvent } from './types.js'

type EventCallback = (event: ArenaEvent) => void

/**
 * Typed event bus that streams arena events to subscribers.
 * The TUI subscribes to this to render real-time progress.
 */
export class SignalBus {
  private listeners: EventCallback[] = []
  private legacyBridge: ((event: OrchestratorEvent) => void) | null = null

  /** Subscribe to all arena events. */
  subscribe(callback: EventCallback): () => void {
    this.listeners.push(callback)
    return () => {
      const idx = this.listeners.indexOf(callback)
      if (idx >= 0) this.listeners.splice(idx, 1)
    }
  }

  /**
   * Bridge to legacy OrchestratorEvent format for backward compatibility
   * with the existing coordination view.
   */
  setLegacyBridge(callback: (event: OrchestratorEvent) => void): void {
    this.legacyBridge = callback
  }

  /** Emit an event to all subscribers. */
  emit(kind: ArenaEventKind, payload?: Partial<Omit<ArenaEvent, 'kind' | 'ts'>>): void {
    const event: ArenaEvent = {
      kind,
      ts: Date.now(),
      ...payload,
    }

    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Listeners must not crash the engine
      }
    }

    // Bridge to legacy format
    if (this.legacyBridge) {
      const legacy = this.toLegacyEvent(event)
      if (legacy) {
        try {
          this.legacyBridge(legacy)
        } catch {
          // Best effort
        }
      }
    }
  }

  /** Map ArenaEvent to the legacy OrchestratorEvent format. */
  private toLegacyEvent(event: ArenaEvent): OrchestratorEvent | null {
    switch (event.kind) {
      case 'spark_ignited':
        return { type: 'agent_start', agent: event.agent, data: event.data }
      case 'spark_completed':
        return { type: 'agent_complete', agent: event.agent, data: event.data }
      case 'tool_invoked':
        return { type: 'message', agent: event.agent, data: `tool: ${event.detail}` }
      case 'tool_resolved':
        return { type: 'message', agent: event.agent, data: `tool done: ${event.detail}` }
      case 'phase_shifted':
        return { type: 'task_start', task: event.detail }
      case 'session_sealed':
        return { type: 'task_complete', task: event.detail }
      case 'fault_recovered':
        return { type: 'error', agent: event.agent, data: event.detail }
      case 'pulse':
        return { type: 'message', agent: event.agent, data: event.detail }
      case 'insight_surfaced':
        return { type: 'message', agent: event.agent, data: event.detail }
      case 'convergence_probed':
        return { type: 'consensus_update', data: event.data }
      default:
        return null
    }
  }

  /** Remove all subscribers. */
  clear(): void {
    this.listeners.length = 0
    this.legacyBridge = null
  }
}
