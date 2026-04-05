/**
 * local-sandbox.ts — run shell commands through the LocalBackend.
 *
 * This is the fastest, zero-dependency way to verify the sandbox
 * layer works. LocalBackend has NO isolation — it runs commands
 * directly on the host — so only use it for development/experiments.
 *
 * Run: pnpm tsx examples/local-sandbox.ts
 */

import { LocalBackend, validateSandboxPath } from '../src/index.js'

async function main(): Promise<void> {
  console.log('=== LocalBackend demo ===\n')

  const sandbox = new LocalBackend({ defaultTimeout: 5_000 })
  await sandbox.start()

  // Run a few commands
  for (const cmd of ['echo hello from the sandbox', 'uname -sm', 'date +%Y']) {
    const r = await sandbox.exec(cmd)
    console.log(`$ ${cmd}`)
    console.log(`  exit=${r.exitCode} stdout=${r.stdout.trim()}`)
  }

  // File I/O
  const path = '/tmp/clashcode-example-roundtrip.txt'
  await sandbox.writeFile(path, `written at ${new Date().toISOString()}\n`)
  const content = await sandbox.readFile(path)
  console.log(`\nFile round-trip: ${content.trim()}`)

  // Path validation blocks unsafe paths
  try {
    validateSandboxPath('/tmp/evil;rm -rf /')
  } catch (err) {
    console.log(`\nPath validator caught unsafe input: ${(err as Error).message}`)
  }

  await sandbox.destroy()
  console.log('\nDone.')
}

main().catch((err) => {
  console.error('Example failed:', err)
  process.exit(1)
})
