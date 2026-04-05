/** ANSI color / style helpers. */
export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
}

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

function loadVersion(): string {
  try {
    // Walk up from dist/cli/ or src/cli/ to find package.json
    let dir = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url))
    for (let i = 0; i < 5; i++) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
        if (pkg.version) return pkg.version as string
      } catch {
        /* keep searching */
      }
      dir = dirname(dir)
    }
  } catch {
    /* fallback */
  }
  return '0.1.0'
}

export const VERSION = loadVersion()

/** Print a startup banner with model / provider info. */
export function banner(model: string, provider: string): string {
  const title = `${c.bold}${c.cyan}ClashCode${c.reset} ${c.dim}v${VERSION}${c.reset}`
  const sub = `${c.dim}model: ${c.reset}${model}  ${c.dim}provider: ${c.reset}${provider}`
  const line = `${c.dim}${'─'.repeat(48)}${c.reset}`
  return `\n${line}\n  ${title}\n  ${sub}\n${line}\n`
}

/** Animated spinner that writes to stderr. */
export class Spinner {
  private interval: ReturnType<typeof setInterval> | null = null
  private frame = 0
  private frames = ['   ', '.  ', '.. ', '...']

  start(label?: string): void {
    const prefix = label ?? 'Thinking'
    this.frame = 0
    this.interval = setInterval(() => {
      const f = this.frames[this.frame % this.frames.length]!
      process.stderr.write(`\r${c.dim}${prefix}${f}${c.reset}`)
      this.frame++
    }, 250)
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    process.stderr.write('\r\x1b[K') // clear line
  }
}

/** Format an assistant response with a left-border. */
export function formatResponse(text: string): string {
  const lines = text.split('\n')
  const formatted = lines.map((l) => `${c.dim}│${c.reset} ${l}`).join('\n')
  return `\n${formatted}\n`
}

/** Draw a box around content with a title. */
export function box(title: string, content: string): string {
  const width = 48
  const top = `${c.dim}╭─ ${c.reset}${c.bold}${title}${c.reset}${c.dim} ${'─'.repeat(Math.max(0, width - title.length - 4))}╮${c.reset}`
  const bottom = `${c.dim}╰${'─'.repeat(width)}╯${c.reset}`
  const lines = content.split('\n').map((l) => `${c.dim}│${c.reset} ${l}`)
  return `${top}\n${lines.join('\n')}\n${bottom}`
}

/** Dim text. */
export function dim(text: string): string {
  return `${c.dim}${text}${c.reset}`
}

/** Format an error message. */
export function error(msg: string): string {
  return `${c.red}${c.bold}✗${c.reset} ${c.red}${msg}${c.reset}`
}

/** Format a success message. */
export function success(msg: string): string {
  return `${c.green}${c.bold}✓${c.reset} ${c.green}${msg}${c.reset}`
}

/** Format an info message. */
export function info(msg: string): string {
  return `${c.blue}ℹ${c.reset} ${msg}`
}
