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
        // CLI shell — covered by integration tests, not unit tests
        'src/cli/**',
        'src/orchestrator/**', // sandbox tools + adapter, requires live LLM
        'src/core/**', // ClashEngine core, requires live LLM
        'src/consensus/store.ts', // trivial JSON persistence (tested in debate-store.test.ts)
        'src/consensus/types.ts',
        'src/sandbox/backends/shuru-bootstrap.ts', // requires shuru binary
        'src/sandbox/backends/shuru.ts', // requires macOS + Apple Silicon + shuru binary
        'src/sandbox/backends/docker.ts', // Docker commands covered by integration tests
        'src/sandbox/dockerfile.ts', // string constant
        'src/index.ts', // barrel re-exports
        // Dynamic-import OTel/Sentry exporters — require optional peer deps
        'src/telemetry.ts',
        'src/config/keychain.ts', // requires native keytar module
      ],
      reporter: ['text', 'html'],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
        statements: 90,
      },
    },
  },
})
