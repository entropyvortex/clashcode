/**
 * ToolVault — registry and execution layer for agent tools.
 *
 * Replaces the external ToolRegistry + defineTool + registerBuiltInTools.
 * Tools are defined with Zod-compatible JSON schemas and async executors.
 *
 * @module core/clash-engine/tool-vault
 */

import type { ToolDef, ToolResult } from './types.js'
import { z } from 'zod'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'

/** Convert a Zod schema to a JSON Schema object for the OpenAI API. */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType>
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [key, val] of Object.entries(shape)) {
      if (val instanceof z.ZodOptional) {
        properties[key] = zodToJsonSchema(val.unwrap())
      } else {
        properties[key] = zodToJsonSchema(val)
        required.push(key)
      }
    }
    return { type: 'object', properties, required: required.length > 0 ? required : undefined }
  }
  if (schema instanceof z.ZodString) return { type: 'string' }
  if (schema instanceof z.ZodNumber) return { type: 'number' }
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' }
  if (schema instanceof z.ZodArray) return { type: 'array', items: zodToJsonSchema(schema.element) }
  return { type: 'string' }
}

/**
 * Define a tool with a Zod input schema. Returns a ToolDef with JSON Schema parameters.
 */
export function defineTool<T extends z.ZodType>(opts: {
  name: string
  description: string
  inputSchema: T
  execute: (input: z.infer<T>) => Promise<ToolResult>
}): ToolDef {
  return {
    name: opts.name,
    description: opts.description,
    parameters: zodToJsonSchema(opts.inputSchema),
    execute: opts.execute as (input: Record<string, unknown>) => Promise<ToolResult>,
  }
}

/**
 * Central registry for all tools available to agents.
 */
export class ToolVault {
  private tools = new Map<string, ToolDef>()

  /** Register a tool definition. */
  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool)
  }

  /** Look up a tool by name. */
  get(name: string): ToolDef | undefined {
    return this.tools.get(name)
  }

  /** Get all registered tool names. */
  list(): string[] {
    return [...this.tools.keys()]
  }

  /** Get OpenAI-format tool definitions for a set of tool names. */
  toOpenAIFormat(
    names?: string[],
  ): Array<{
    type: 'function'
    function: { name: string; description: string; parameters: Record<string, unknown> }
  }> {
    const subset = names
      ? names.map((n) => this.tools.get(n)).filter((t): t is ToolDef => t !== undefined)
      : [...this.tools.values()]

    return subset.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))
  }

  /** Execute a tool by name with the given input. */
  async execute(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return { data: `Unknown tool: ${name}`, isError: true }
    }
    try {
      return await tool.execute(input)
    } catch (err) {
      return {
        data: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      }
    }
  }
}

// ── Built-in Tools ────────────────────────────────────────────

function execShell(
  command: string,
  timeout = 30_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(
      '/bin/sh',
      ['-c', command],
      { timeout, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const exitCode = err && 'code' in err ? ((err.code as number) ?? 1) : err ? 1 : 0
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode })
      },
    )
  })
}

/** Register the built-in tools (bash, file_read, file_write, file_edit, grep). */
export function registerBuiltInTools(vault: ToolVault): void {
  vault.register(
    defineTool({
      name: 'bash',
      description: 'Execute a shell command and return stdout/stderr.',
      inputSchema: z.object({
        command: z.string(),
        timeout: z.number().optional(),
      }),
      execute: async (input) => {
        const result = await execShell(input.command, input.timeout)
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
        return { data: output || '(no output)', metadata: { exitCode: result.exitCode } }
      },
    }),
  )

  vault.register(
    defineTool({
      name: 'file_read',
      description: 'Read the contents of a file.',
      inputSchema: z.object({
        path: z.string(),
      }),
      execute: async (input) => {
        try {
          const content = await readFile(input.path, 'utf-8')
          return { data: content }
        } catch (err) {
          return {
            data: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          }
        }
      },
    }),
  )

  vault.register(
    defineTool({
      name: 'file_write',
      description: 'Write content to a file (creates or overwrites).',
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
      }),
      execute: async (input) => {
        try {
          await writeFile(input.path, input.content, 'utf-8')
          return { data: `Written ${input.content.length} bytes to ${input.path}` }
        } catch (err) {
          return {
            data: `Failed to write file: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          }
        }
      },
    }),
  )

  vault.register(
    defineTool({
      name: 'file_edit',
      description: 'Replace a string in a file. Finds old_string and replaces with new_string.',
      inputSchema: z.object({
        path: z.string(),
        old_string: z.string(),
        new_string: z.string(),
      }),
      execute: async (input) => {
        try {
          const content = await readFile(input.path, 'utf-8')
          if (!content.includes(input.old_string)) {
            return { data: `String not found in ${input.path}`, isError: true }
          }
          const updated = content.replace(input.old_string, input.new_string)
          await writeFile(input.path, updated, 'utf-8')
          return { data: `Edited ${input.path}` }
        } catch (err) {
          return {
            data: `Failed to edit file: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          }
        }
      },
    }),
  )

  vault.register(
    defineTool({
      name: 'grep',
      description: 'Search for a pattern in files. Returns matching lines.',
      inputSchema: z.object({
        pattern: z.string(),
        path: z.string().optional(),
      }),
      execute: async (input) => {
        const target = input.path ?? '.'
        const result = await execShell(
          `grep -rn "${input.pattern.replace(/"/g, '\\"')}" "${target}" 2>/dev/null | head -50`,
        )
        return { data: result.stdout || '(no matches)' }
      },
    }),
  )
}
