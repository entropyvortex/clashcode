/**
 * consensus-debate.ts — run a multi-persona debate programmatically.
 *
 * Runs ClashEngine.runDebate with 3 personas × 2 rounds on a topic
 * passed as argv[2]. Prints the structured report at the end.
 *
 * ⚠ This calls the real LLM provider and will cost tokens.
 *
 * Requires: XAI_API_KEY (or another provider key).
 *
 * Run:
 *   pnpm tsx examples/consensus-debate.ts "Should we adopt Rust?"
 */

import { ClashEngine, BUILT_IN_PERSONAS, createOrchestrator, resolveApiKey } from '../src/index.js'

async function main(): Promise<void> {
  const topic = process.argv[2] ?? 'Should we prefer SQL over NoSQL for a new social network?'

  const apiKey = await resolveApiKey('grok', 'XAI_API_KEY', {})
  if (!apiKey) {
    console.error('No XAI_API_KEY found. Set it in the environment or keychain.')
    process.exit(2)
  }

  console.log(`\nDebate topic: ${topic}\n`)
  console.log('Personas available:', Object.keys(BUILT_IN_PERSONAS).join(', '))
  console.log()

  const { orchestrator } = createOrchestrator({
    defaultModel: 'grok-4',
    defaultProvider: 'grok',
    defaultApiKey: apiKey,
  })
  const engine = new ClashEngine('grok-4', 'grok')

  const result = await engine.runDebate(
    {
      topic,
      rounds: 2,
      personas: ['pragmatist', 'elegance-purist', 'security-maximalist'],
    },
    orchestrator,
  )

  console.log('\n' + engine.formatReport(result))
}

main().catch((err) => {
  console.error('Debate failed:', err)
  process.exit(1)
})
