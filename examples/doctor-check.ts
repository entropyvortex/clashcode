/**
 * doctor-check.ts — run ClashCode's diagnostic checks programmatically.
 *
 * The same checks that `/doctor` runs inside the CLI, but as a
 * scriptable API. Useful for health-check endpoints, CI smoke tests,
 * or bug-report bundle generation.
 *
 * Run: pnpm tsx examples/doctor-check.ts
 */

import { runDoctor, formatDoctorReport, DEFAULT_SETTINGS } from '../src/index.js'

async function main(): Promise<void> {
  const checks = await runDoctor(DEFAULT_SETTINGS)
  console.log(formatDoctorReport(checks))

  // Exit non-zero if any check failed — useful for CI
  const failed = checks.filter((c) => c.status === 'fail')
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed. Details:`)
    for (const c of failed) console.error(`  - ${c.name}: ${c.detail}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Doctor check failed:', err)
  process.exit(1)
})
