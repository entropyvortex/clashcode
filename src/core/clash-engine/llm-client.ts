/**
 * Minimal LLM client for OpenAI-compatible chat completions.
 *
 * Handles grok (xAI), openai, gemini, copilot, and anthropic providers
 * through the standard /v1/chat/completions endpoint. No external SDK
 * dependencies — just fetch.
 *
 * @module core/clash-engine/llm-client
 */

import type { ChatMessage, ModelToolCall, TokenTally } from './types.js'

/** Configuration for an LLM API call. */
export interface LLMCallConfig {
  model: string
  apiKey: string
  baseURL: string
  messages: ChatMessage[]
  tools?: Array<{
    type: 'function'
    function: { name: string; description: string; parameters: Record<string, unknown> }
  }>
  maxTokens?: number
  /** AbortSignal for cancellation support (ESC-to-cancel). */
  signal?: AbortSignal
}

/** Response from an LLM API call. */
export interface LLMCallResult {
  message: ChatMessage
  usage: TokenTally
}

/**
 * Call an OpenAI-compatible chat completions endpoint.
 *
 * Works with xAI/Grok, OpenAI, Gemini, Copilot, and Anthropic's
 * OpenAI-compatible endpoint.
 */
export async function callModel(config: LLMCallConfig): Promise<LLMCallResult> {
  const url = `${config.baseURL.replace(/\/$/, '')}/chat/completions`

  const body: Record<string, unknown> = {
    model: config.model,
    messages: config.messages.map(serializeMessage),
  }

  if (config.tools && config.tools.length > 0) {
    body.tools = config.tools
    body.tool_choice = 'auto'
  }

  if (config.maxTokens) {
    body.max_tokens = config.maxTokens
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: config.signal,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error')
    throw new Error(`LLM API error ${response.status}: ${errorText.slice(0, 500)}`)
  }

  const data = (await response.json()) as OpenAIResponse

  const choice = data.choices?.[0]
  if (!choice) {
    throw new Error('LLM returned no choices')
  }

  const assistantMessage: ChatMessage = {
    role: 'assistant',
    content: choice.message.content,
  }

  if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
    assistantMessage.tool_calls = choice.message.tool_calls.map(
      (tc): ModelToolCall => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }),
    )
  }

  return {
    message: assistantMessage,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    },
  }
}

// ── Serialization helpers ─────────────────────────────────────

function serializeMessage(msg: ChatMessage): Record<string, unknown> {
  const out: Record<string, unknown> = { role: msg.role }

  if (msg.content !== null && msg.content !== undefined) {
    out.content = msg.content
  }
  if (msg.name) {
    out.name = msg.name
  }
  if (msg.tool_call_id) {
    out.tool_call_id = msg.tool_call_id
  }
  if (msg.tool_calls && msg.tool_calls.length > 0) {
    out.tool_calls = msg.tool_calls
  }
  // assistant messages with tool_calls may have null content
  if (msg.role === 'assistant' && msg.tool_calls && !msg.content) {
    out.content = null
  }

  return out
}

// ── OpenAI response types ─────────────────────────────────────

interface OpenAIResponse {
  choices?: Array<{
    message: {
      role: string
      content: string | null
      tool_calls?: Array<{
        id: string
        type: string
        function: { name: string; arguments: string }
      }>
    }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}
