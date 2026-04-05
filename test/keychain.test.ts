import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { KeychainStore, resolveApiKey } from '../src/config/keychain.js'

describe('KeychainStore (keytar unavailable)', () => {
  // These tests run on systems where keytar is not installed (optional dep).
  // The store must gracefully return "unavailable" state.
  const store = new KeychainStore('clashcode-test')

  it('isAvailable returns false when keytar is not installed', async () => {
    // Note: in CI where libsecret-1-dev isn't present, keytar may fail to load
    // and this returns false. On developer machines with keytar installed,
    // this test may return true. Both are valid — we just want no throw.
    const available = await store.isAvailable()
    expect(typeof available).toBe('boolean')
  })

  it('get() returns null when unavailable (no throw)', async () => {
    const result = await store.get('test-provider')
    // Either null (unavailable) or whatever happens to be in the real keychain
    expect(result === null || typeof result === 'string').toBe(true)
  })

  it('set() returns boolean (no throw)', async () => {
    const result = await store.set('test-provider-xyz', 'fake-key')
    expect(typeof result).toBe('boolean')
  })

  it('delete() returns boolean (no throw)', async () => {
    const result = await store.delete('test-provider-xyz')
    expect(typeof result).toBe('boolean')
  })

  it('list() returns array (no throw)', async () => {
    const result = await store.list()
    expect(Array.isArray(result)).toBe(true)
  })
})

describe('resolveApiKey', () => {
  const ORIG_ENV = { ...process.env }

  beforeEach(() => {
    delete process.env['TEST_API_KEY']
  })
  afterEach(() => {
    process.env = { ...ORIG_ENV }
  })

  it('prefers explicit override', async () => {
    process.env['TEST_API_KEY'] = 'from-env'
    const key = await resolveApiKey(
      'test',
      'TEST_API_KEY',
      { test: 'from-settings' },
      'from-override',
    )
    expect(key).toBe('from-override')
  })

  it('falls back to env var', async () => {
    process.env['TEST_API_KEY'] = 'from-env'
    // Use a provider name unlikely to be in keychain
    const key = await resolveApiKey('nonexistent-provider-zzz', 'TEST_API_KEY', {})
    expect(key).toBe('from-env')
  })

  it('falls back to settings.json', async () => {
    const key = await resolveApiKey('nonexistent-provider-zzz', 'MISSING_ENV', {
      'nonexistent-provider-zzz': 'from-settings',
    })
    expect(key).toBe('from-settings')
  })

  it('returns undefined when no source has a key', async () => {
    const key = await resolveApiKey('nonexistent-provider-zzz', 'MISSING_ENV', {})
    expect(key).toBeUndefined()
  })
})
