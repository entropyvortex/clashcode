import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration tests run separately via `pnpm test:integration`
    exclude: ['test/integration/**', 'eval/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        // CLI shell — covered by integration tests (Phase 2.4), not unit tests
        'src/cli/**',
        'src/orchestrator/**', // thin framework adapter, requires live LLM
        'src/consensus/store.ts', // trivial JSON persistence
        'src/consensus/types.ts',
        'src/sandbox/backends/shuru-bootstrap.ts', // requires shuru binary
        'src/sandbox/dockerfile.ts', // string constant
        'src/index.ts', // barrel re-exports
      ],
      reporter: ['text', 'html'],
      thresholds: {
        lines: 70,
        branches: 75,
        functions: 80,
        statements: 70,
      },
    },
  },
})
