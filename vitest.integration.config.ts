import { defineConfig } from 'vitest/config'

/**
 * Integration test runner.
 *
 * Runs real end-to-end tests against docker / shuru / the local shell.
 * These are not part of the default `pnpm test` run — execute them
 * explicitly via `pnpm test:integration` after setting
 * `CLASHCODE_INTEGRATION=1` for backends that need it.
 */
export default defineConfig({
  test: {
    include: ['test/integration/**/*.integration.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
