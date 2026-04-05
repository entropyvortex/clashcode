import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['esm'],
    target: 'node20',
    clean: true,
    splitting: false,
    sourcemap: true,
    shims: true,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node20',
    dts: true,
    clean: false,
    splitting: false,
    sourcemap: true,
    shims: true,
  },
])
