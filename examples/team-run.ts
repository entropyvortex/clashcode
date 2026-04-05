/**
 * team-run.ts — run a multi-agent team via the orchestrator.
 *
 * Uses coder + reviewer + consensus agents via
 * @jackchen_me/open-multi-agent. The coordinator synthesises the
 * final answer.
 *
 * ⚠ This calls the real LLM provider and will cost tokens.
 *
 * Requires: XAI_API_KEY (or another provider key).
 *
 * Run:
 *   pnpm tsx examples/team-run.ts "write a python function that checks if a number is prime"
 */

import { createOrchestrator, defaultTeamConfig, resolveApiKey } from '../src/index.js'

async function main(): Promise<void> {
  const task =
    process.argv[2] ?? 'write a concise bash one-liner that finds the 3 largest files under /tmp'

  const apiKey = await resolveApiKey('grok', 'XAI_API_KEY', {})
  if (!apiKey) {
    console.error('No XAI_API_KEY found.')
    process.exit(2)
  }

  const { orchestrator } = createOrchestrator({
    defaultModel: 'grok-4',
    defaultProvider: 'grok',
    defaultApiKey: apiKey,
    onProgress: (event) => {
      if (event.type === 'agent_start') console.log(`▸ agent starting…`)
      if (event.type === 'agent_complete') console.log(`✓ agent done`)
    },
  })

  const teamConfig = defaultTeamConfig('grok-4')
  const team = orchestrator.createTeam(teamConfig.name, teamConfig)
  console.log(`\nTask: ${task}\n`)

  const result = await orchestrator.runTeam(team, task)

  const output =
    result.agentResults.get('coordinator')?.output ??
    [...result.agentResults.values()].find((r) => r.output)?.output ??
    '(no output)'

  console.log('\n─── Coordinator synthesis ───\n')
  console.log(output)
  console.log(
    `\nTokens: ${result.totalTokenUsage.input_tokens} in / ${result.totalTokenUsage.output_tokens} out`,
  )
}

main().catch((err) => {
  console.error('Team run failed:', err)
  process.exit(1)
})
