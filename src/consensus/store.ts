import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DebateResult } from './types.js'

/**
 * Persists debate results as JSON files under .clashcode/debates/.
 */
export class DebateStore {
  private readonly dir: string

  constructor(projectRoot: string) {
    this.dir = join(projectRoot, '.clashcode', 'debates')
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
  }

  /** Save a debate result. */
  save(result: DebateResult): void {
    writeFileSync(join(this.dir, `${result.id}.json`), JSON.stringify(result, null, 2), 'utf-8')
  }

  /** Get a debate by ID. */
  get(id: string): DebateResult | null {
    const p = join(this.dir, `${id.replace(/[^a-zA-Z0-9_-]/g, '')}.json`)
    if (!existsSync(p)) return null
    try {
      return JSON.parse(readFileSync(p, 'utf-8')) as DebateResult
    } catch {
      return null
    }
  }

  /** List all debates, most recent first. */
  list(): Array<{
    id: string
    topic: string
    convergence: number
    rounds: number
    timestamp: number
  }> {
    if (!existsSync(this.dir)) return []
    const files = readdirSync(this.dir).filter((f) => f.endsWith('.json'))
    const results: Array<{
      id: string
      topic: string
      convergence: number
      rounds: number
      timestamp: number
    }> = []
    for (const f of files) {
      try {
        const r = JSON.parse(readFileSync(join(this.dir, f), 'utf-8')) as DebateResult
        results.push({
          id: r.id,
          topic: r.topic,
          convergence: r.convergence.overall,
          rounds: r.rounds,
          timestamp: r.timestamp,
        })
      } catch {
        continue
      }
    }
    return results.sort((a, b) => b.timestamp - a.timestamp)
  }
}
