/**
 * ForgeRunner — handles the standard 3-role squad collaboration.
 *
 * Coordinator orchestrates, Coder writes, Reviewer critiques.
 * Round-based turns with rich event emission at every step.
 *
 * @module core/clash-engine/team-runner
 */

import type {
  AgentSpec,
  AgentOutcome,
  ChatMessage,
  SquadBlueprint,
  SquadOutcome,
  TokenTally,
  ToolInvocation,
} from './types.js'
import type { Arena } from './execution-context.js'
import { callModel } from './llm-client.js'

/** Maximum tool-calling loop iterations per agent to prevent infinite loops. */
const MAX_TOOL_ROUNDS = 25

/**
 * Run a single agent with tool-calling loop.
 *
 * Emits spark_ignited, tool_invoked, tool_resolved, and spark_completed
 * events through the arena's signal bus.
 */
export async function runSpark(
  spec: AgentSpec,
  input: string,
  arena: Arena,
  signal?: AbortSignal,
): Promise<AgentOutcome> {
  arena.signals.emit('spark_ignited', { agent: spec.name, detail: 'processing' })

  const messages: ChatMessage[] = [
    { role: 'system', content: spec.systemPrompt },
    { role: 'user', content: input },
  ]

  const toolDefs = spec.tools ? arena.vault.toOpenAIFormat(spec.tools) : []

  let totalIn = 0
  let totalOut = 0
  const invocations: ToolInvocation[] = []

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await callModel({
      model: spec.model ?? arena.model,
      apiKey: arena.apiKey,
      baseURL: arena.baseURL,
      messages,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      signal,
    })

    totalIn += result.usage.input_tokens
    totalOut += result.usage.output_tokens

    messages.push(result.message)

    // No tool calls — agent is done
    if (!result.message.tool_calls || result.message.tool_calls.length === 0) {
      break
    }

    // Execute tool calls
    for (const tc of result.message.tool_calls) {
      const toolName = tc.function.name
      arena.signals.emit('tool_invoked', {
        agent: spec.name,
        detail: toolName,
      })

      const start = Date.now()
      let parsedInput: Record<string, unknown> = {}
      try {
        parsedInput = JSON.parse(tc.function.arguments) as Record<string, unknown>
      } catch {
        parsedInput = { raw: tc.function.arguments }
      }

      const toolResult = await arena.vault.execute(toolName, parsedInput)
      const elapsed = Date.now() - start

      invocations.push({
        name: toolName,
        input: parsedInput,
        output: toolResult.data,
        elapsed,
      })

      arena.signals.emit('tool_resolved', {
        agent: spec.name,
        detail: toolName,
        data: { elapsed, isError: toolResult.isError },
      })

      messages.push({
        role: 'tool',
        content: toolResult.data,
        tool_call_id: tc.id,
      })
    }
  }

  // Extract final output from the last assistant message
  const output =
    messages
      .slice()
      .reverse()
      .find((m) => m.role === 'assistant' && m.content)?.content ?? ''

  const outcome: AgentOutcome = {
    output,
    tokenUsage: { input_tokens: totalIn, output_tokens: totalOut },
    toolCalls: invocations,
  }

  arena.signals.emit('spark_completed', {
    agent: spec.name,
    data: { tokenUsage: outcome.tokenUsage },
  })

  return outcome
}

/**
 * Execute a squad run: all agents work on the task, then a coordinator
 * synthesizes the final answer.
 *
 * The coordinator is implicit — it receives all agent outputs and produces
 * the final response. This avoids the old framework's coordinator-model
 * override hack entirely.
 */
export async function runSquad(
  blueprint: SquadBlueprint,
  task: string,
  arena: Arena,
  coordinatorModel?: string,
  signal?: AbortSignal,
): Promise<SquadOutcome> {
  arena.signals.emit('phase_shifted', { detail: `squad: ${blueprint.name}` })

  const agentResults = new Map<string, AgentOutcome>()
  const totalUsage: TokenTally = { input_tokens: 0, output_tokens: 0 }

  // Run each agent on the task
  for (const agent of blueprint.agents) {
    const outcome = await runSpark(agent, task, arena, signal)
    agentResults.set(agent.name, outcome)
    totalUsage.input_tokens += outcome.tokenUsage.input_tokens
    totalUsage.output_tokens += outcome.tokenUsage.output_tokens
  }

  // Coordinator synthesis: gather all outputs and produce final answer
  const coordinatorPrompt =
    'You are the coordinator. Synthesize the following agent outputs into a ' +
    'clear, actionable final response. Combine the best insights from each agent.\n\n' +
    [...agentResults.entries()]
      .map(([name, result]) => `=== ${name} ===\n${result.output}`)
      .join('\n\n')

  const coordinatorSpec: AgentSpec = {
    name: 'coordinator',
    model: coordinatorModel ?? arena.model,
    systemPrompt:
      'You are a coordinator who synthesizes multiple agent perspectives into one coherent response.',
    tools: [],
  }

  const coordOutcome = await runSpark(coordinatorSpec, coordinatorPrompt, arena, signal)
  agentResults.set('coordinator', coordOutcome)
  totalUsage.input_tokens += coordOutcome.tokenUsage.input_tokens
  totalUsage.output_tokens += coordOutcome.tokenUsage.output_tokens

  arena.signals.emit('session_sealed', { detail: `squad complete: ${blueprint.name}` })

  return {
    agentResults,
    totalTokenUsage: totalUsage,
  }
}
