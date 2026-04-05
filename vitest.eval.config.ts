import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['eval/**/*.eval.test.ts'],
    // No coverage — these are deterministic fixture tests, not unit tests.
  },
})
