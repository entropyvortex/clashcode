/**
 * keychain-setup.ts — store + retrieve API keys via the OS keychain.
 *
 * Demonstrates the KeychainStore wrapper around the optional keytar
 * peer dependency. On macOS this uses Keychain Access, on Windows
 * Credential Manager, on Linux libsecret.
 *
 * Install keytar first: pnpm add keytar
 * Run: pnpm tsx examples/keychain-setup.ts
 */

import { KeychainStore, resolveApiKey } from '../src/index.js'

async function main(): Promise<void> {
  const chain = new KeychainStore('clashcode-example')

  if (!(await chain.isAvailable())) {
    console.error('keytar not installed or native module failed to load.')
    console.error('Install with: pnpm add keytar')
    process.exit(2)
  }

  // Store a test key
  const provider = 'demo-provider'
  const fakeKey = 'sk-example-' + Math.random().toString(36).slice(2, 10)
  console.log(`Storing key for "${provider}"...`)
  const ok = await chain.set(provider, fakeKey)
  console.log(`  ${ok ? '✓ stored' : '✗ failed'}`)

  // List stored keys
  const keys = await chain.list()
  console.log(`\nStored keys under service "clashcode-example": ${keys.join(', ') || '(none)'}`)

  // Retrieve via the priority chain (override → keychain → env → settings)
  const resolved = await resolveApiKey(provider, 'EXAMPLE_API_KEY', {})
  console.log(`\nresolveApiKey() returned: ${resolved?.slice(0, 16)}...`)

  // Clean up
  await chain.delete(provider)
  console.log(`\nCleanup: deleted "${provider}" from keychain.`)
}

main().catch((err) => {
  console.error('Keychain demo failed:', err)
  process.exit(1)
})
