import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** A single message within a session. */
export interface SessionMessage {
  /** Message role. */
  role: 'user' | 'assistant' | 'system'
  /** Message content. */
  content: string
  /** Unix timestamp in milliseconds. */
  timestamp: number
}

/** A persistent chat session. */
export interface Session {
  /** Unique session identifier. */
  id: string
  /** Human-readable session title. */
  title: string
  /** Creation time (Unix ms). */
  createdAt: number
  /** Last update time (Unix ms). */
  updatedAt: number
  /** Ordered list of messages. */
  messages: SessionMessage[]
  /** Total input tokens consumed. */
  tokensIn: number
  /** Total output tokens consumed. */
  tokensOut: number
}

/**
 * Manages session persistence as individual JSON files under `.clashcode/sessions/`.
 */
export class SessionStore {
  private readonly sessionsDir: string

  /**
   * Create a new SessionStore.
   * @param projectRoot - Absolute path to the project root.
   */
  constructor(projectRoot: string) {
    this.sessionsDir = join(projectRoot, '.clashcode', 'sessions')
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true })
    }
  }

  /** Sanitize session ID to prevent path traversal. */
  private sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '')
  }

  /** Resolve file path for a session. */
  private filePath(id: string): string {
    const safe = this.sanitizeId(id)
    if (!safe) throw new Error('Invalid session ID')
    return join(this.sessionsDir, `${safe}.json`)
  }

  /** Write a session to disk. */
  private save(session: Session): void {
    writeFileSync(this.filePath(session.id), JSON.stringify(session, null, 2), 'utf-8')
  }

  /**
   * Create a new empty session.
   * @param title - Optional title (defaults to `'Untitled Session'`).
   * @returns The newly created session.
   */
  create(title?: string): Session {
    const now = Date.now()
    const session: Session = {
      id: randomUUID(),
      title: title ?? 'Untitled Session',
      createdAt: now,
      updatedAt: now,
      messages: [],
      tokensIn: 0,
      tokensOut: 0,
    }
    this.save(session)
    return session
  }

  /**
   * Retrieve a session by ID.
   * @param id - Session identifier.
   * @returns The session, or `null` if not found.
   */
  get(id: string): Session | null {
    const p = this.filePath(id)
    if (!existsSync(p)) return null
    try {
      return JSON.parse(readFileSync(p, 'utf-8')) as Session
    } catch {
      return null // corrupted session file
    }
  }

  /**
   * Append a message to an existing session.
   * @param id - Session identifier.
   * @param message - Message without timestamp (timestamp is added automatically).
   * @throws If the session does not exist.
   */
  append(id: string, message: Omit<SessionMessage, 'timestamp'>): void {
    const session = this.get(id)
    if (!session) {
      throw new Error(`Session not found: ${id}`)
    }
    const now = Date.now()
    session.messages.push({ ...message, timestamp: now })
    session.updatedAt = now
    this.save(session)
  }

  /**
   * List all sessions with summary info (no message bodies).
   * @returns Array of session summaries sorted by most recently updated.
   */
  list(): Array<{
    id: string
    title: string
    createdAt: number
    updatedAt: number
    messageCount: number
    tokensIn: number
    tokensOut: number
  }> {
    if (!existsSync(this.sessionsDir)) return []
    const files = readdirSync(this.sessionsDir).filter((f) => f.endsWith('.json'))
    const summaries = files.map((f) => {
      const session = JSON.parse(readFileSync(join(this.sessionsDir, f), 'utf-8')) as Session
      return {
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
        tokensIn: session.tokensIn ?? 0,
        tokensOut: session.tokensOut ?? 0,
      }
    })
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * Delete a session.
   * @param id - Session identifier.
   * @returns `true` if the session was deleted, `false` if it did not exist.
   */
  delete(id: string): boolean {
    const p = this.filePath(id)
    if (!existsSync(p)) return false
    unlinkSync(p)
    return true
  }

  /**
   * Increment token counters for a session.
   * @param id - Session identifier.
   * @param tokensIn - Number of input tokens to add.
   * @param tokensOut - Number of output tokens to add.
   * @throws If the session does not exist.
   */
  addTokens(id: string, tokensIn: number, tokensOut: number): void {
    const session = this.get(id)
    if (!session) {
      throw new Error(`Session not found: ${id}`)
    }
    session.tokensIn = (session.tokensIn ?? 0) + tokensIn
    session.tokensOut = (session.tokensOut ?? 0) + tokensOut
    this.save(session)
  }

  /**
   * Search sessions for messages containing the query string (case-insensitive).
   * @param query - Text to search for.
   * @returns Matching sessions with a snippet of the first matching message.
   */
  search(query: string): Array<{ id: string; title: string; snippet: string }> {
    if (!existsSync(this.sessionsDir)) return []
    const lowerQuery = query.toLowerCase()
    const files = readdirSync(this.sessionsDir).filter((f) => f.endsWith('.json'))
    const results: Array<{ id: string; title: string; snippet: string }> = []
    for (const f of files) {
      const session = JSON.parse(readFileSync(join(this.sessionsDir, f), 'utf-8')) as Session
      const match = session.messages.find((m) => m.content.toLowerCase().includes(lowerQuery))
      if (match) {
        const idx = match.content.toLowerCase().indexOf(lowerQuery)
        const start = Math.max(0, idx - 40)
        const end = Math.min(match.content.length, idx + query.length + 40)
        const snippet =
          (start > 0 ? '...' : '') +
          match.content.slice(start, end) +
          (end < match.content.length ? '...' : '')
        results.push({ id: session.id, title: session.title, snippet })
      }
    }
    return results
  }
}
