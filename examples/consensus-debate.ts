/**
 * consensus-debate.ts — run a multi-persona debate programmatically.
 *
 * Runs ClashEngine.executeClashDebate with 3 personas × 2 rounds on a topic
 * passed as argv[2]. Prints the structured report at the end.
 *
 * ⚠ This calls the real LLM provider and will cost tokens.
 *
 * Requires: XAI_API_KEY (or another provider key).
 *
 * Run:
 *   pnpm tsx examples/consensus-debate.ts "Should we adopt Rust?"
 */

import {
  createOrchestrator,
  formatDebateReport,
  BUILT_IN_PERSONAS,
  resolveApiKey,
} from '../src/index.js'

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

  const { engine } = createOrchestrator({
    defaultModel: 'grok-4',
    defaultProvider: 'xai',
    defaultApiKey: apiKey,
  })

  const result = await engine.executeClashDebate({
    topic,
    rounds: 2,
    personas: ['pragmatist', 'elegance-purist', 'security-maximalist'],
  })

  console.log('\n' + formatDebateReport(result))
}

main().catch((err) => {
  console.error('Debate failed:', err)
  process.exit(1)
})
