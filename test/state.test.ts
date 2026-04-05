import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionStore } from '../src/state/index.js'

describe('SessionStore', () => {
  let tmpDir: string
  let store: SessionStore

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'clashcode-state-test-'))
    store = new SessionStore(tmpDir)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('create', () => {
    it('creates a session file', () => {
      const session = store.create('Test Session')
      expect(session.id).toBeTruthy()
      expect(session.title).toBe('Test Session')
      expect(session.messages).toEqual([])
      const filePath = join(tmpDir, '.clashcode', 'sessions', `${session.id}.json`)
      expect(existsSync(filePath)).toBe(true)
    })

    it('uses default title when none provided', () => {
      const session = store.create()
      expect(session.title).toBe('Untitled Session')
    })
  })

  describe('get', () => {
    it('retrieves a session', () => {
      const created = store.create('My Session')
      const retrieved = store.get(created.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(created.id)
      expect(retrieved!.title).toBe('My Session')
    })

    it('returns null for non-existent session', () => {
      expect(store.get('non-existent-id')).toBeNull()
    })
  })

  describe('append', () => {
    it('adds messages', () => {
      const session = store.create('Chat')
      store.append(session.id, { role: 'user', content: 'Hello' })
      store.append(session.id, { role: 'assistant', content: 'Hi there!' })

      const updated = store.get(session.id)
      expect(updated!.messages).toHaveLength(2)
      expect(updated!.messages[0]!.role).toBe('user')
      expect(updated!.messages[0]!.content).toBe('Hello')
      expect(updated!.messages[1]!.role).toBe('assistant')
      expect(updated!.messages[1]!.content).toBe('Hi there!')
      expect(updated!.messages[0]!.timestamp).toBeGreaterThan(0)
    })

    it('throws for non-existent session', () => {
      expect(() => store.append('bad-id', { role: 'user', content: 'test' })).toThrow(
        'Session not found',
      )
    })
  })

  describe('list', () => {
    it('returns all sessions sorted by updatedAt', async () => {
      const s1 = store.create('First')
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10))
      const s2 = store.create('Second')
      await new Promise((r) => setTimeout(r, 10))
      store.append(s1.id, { role: 'user', content: 'update first' })

      const list = store.list()
      expect(list).toHaveLength(2)
      // s1 was updated most recently (after append)
      expect(list[0]!.id).toBe(s1.id)
      expect(list[0]!.messageCount).toBe(1)
      expect(list[1]!.id).toBe(s2.id)
      expect(list[1]!.messageCount).toBe(0)
    })

    it('returns empty array when no sessions', () => {
      expect(store.list()).toEqual([])
    })
  })

  describe('delete', () => {
    it('removes a session', () => {
      const session = store.create('To Delete')
      expect(store.delete(session.id)).toBe(true)
      expect(store.get(session.id)).toBeNull()
    })

    it('returns false for non-existent session', () => {
      expect(store.delete('non-existent')).toBe(false)
    })
  })

  describe('search', () => {
    it('finds matching messages', () => {
      const s1 = store.create('Session A')
      store.append(s1.id, { role: 'user', content: 'How do I use TypeScript generics?' })
      store.append(s1.id, {
        role: 'assistant',
        content: 'Generics allow you to write reusable code.',
      })

      const s2 = store.create('Session B')
      store.append(s2.id, { role: 'user', content: 'Tell me about Python decorators' })

      const results = store.search('typescript')
      expect(results).toHaveLength(1)
      expect(results[0]!.id).toBe(s1.id)
      expect(results[0]!.snippet).toContain('TypeScript')
    })

    it('returns empty array when no matches', () => {
      const s = store.create('Empty search')
      store.append(s.id, { role: 'user', content: 'Hello world' })
      expect(store.search('nonexistentquery')).toEqual([])
    })

    it('is case-insensitive', () => {
      const s = store.create('Case test')
      store.append(s.id, { role: 'user', content: 'UPPERCASE content here' })
      const results = store.search('uppercase')
      expect(results).toHaveLength(1)
    })
  })
})
