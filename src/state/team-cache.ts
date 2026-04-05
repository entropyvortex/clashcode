/**
 * Persistent team-run cache.
 *
 * Caches the output of identical `(goal, team-agents, model)` triples so
 * repeat prompts in the same or future sessions skip the full
 * coordinator+workers LLM roundtrip. Stored as JSON files under
 * `.clashcode/cache/` keyed by a sha256 of the triple.
 *
 * Entries past `ttlMs` are considered stale and ignored on read
 * (but not proactively deleted — call {@link TeamCache.prune} to
 * sweep them).
 *
 * @module state/team-cache
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export interface CachedTeamRun {
  output: string
  tokIn: number
  tokOut: number
  agentBreakdown: string
  elapsed: number
  storedAt: number
}

export interface TeamCacheOptions {
  /** Time-to-live for cached entries in ms. Default: 24h. */
  ttlMs?: number
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

export class TeamCache {
  private readonly dir: string
  private readonly ttlMs: number

  constructor(projectRoot: string, options: TeamCacheOptions = {}) {
    this.dir = join(projectRoot, '.clashcode', 'cache')
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true })
    }
  }

  /** Compute a stable cache key for the (goal, agents, model) triple. */
  static key(
    goal: string,
    agents: readonly { name: string; model?: string }[],
    model: string,
  ): string {
    const agentKey = agents.map((a) => `${a.name}:${a.model ?? model}`).join('|')
    const raw = `${model}::${agentKey}::${goal}`
    return createHash('sha256').update(raw).digest('hex').slice(0, 32)
  }

  private filePath(key: string): string {
    return join(this.dir, `${key}.json`)
  }

  /** Read a cached entry. Returns null on miss or when expired. */
  get(key: string): CachedTeamRun | null {
    const p = this.filePath(key)
    if (!existsSync(p)) return null
    try {
      const entry = JSON.parse(readFileSync(p, 'utf-8')) as CachedTeamRun
      if (Date.now() - entry.storedAt > this.ttlMs) return null
      return entry
    } catch {
      return null
    }
  }

  /** Write an entry. Overwrites any existing file. */
  set(key: string, entry: Omit<CachedTeamRun, 'storedAt'>): void {
    const full: CachedTeamRun = { ...entry, storedAt: Date.now() }
    writeFileSync(this.filePath(key), JSON.stringify(full, null, 2), 'utf-8')
  }

  /** Delete a single entry. Safe to call on missing key. */
  delete(key: string): void {
    const p = this.filePath(key)
    if (existsSync(p)) {
      try {
        unlinkSync(p)
      } catch {
        /* best effort */
      }
    }
  }

  /** Delete all entries. Returns count removed. */
  clear(): number {
    let count = 0
    try {
      for (const f of readdirSync(this.dir)) {
        if (f.endsWith('.json')) {
          try {
            unlinkSync(join(this.dir, f))
            count++
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore missing dir */
    }
    return count
  }

  /** Remove entries older than TTL. Returns count pruned. */
  prune(): number {
    let count = 0
    const cutoff = Date.now() - this.ttlMs
    try {
      for (const f of readdirSync(this.dir)) {
        if (!f.endsWith('.json')) continue
        const p = join(this.dir, f)
        try {
          const stat = statSync(p)
          if (stat.mtimeMs < cutoff) {
            unlinkSync(p)
            count++
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    return count
  }

  /** List statistics about the cache. */
  stats(): { entries: number; totalBytes: number; dir: string } {
    let entries = 0
    let totalBytes = 0
    try {
      for (const f of readdirSync(this.dir)) {
        if (!f.endsWith('.json')) continue
        entries++
        try {
          totalBytes += statSync(join(this.dir, f)).size
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    return { entries, totalBytes, dir: this.dir }
  }
}
