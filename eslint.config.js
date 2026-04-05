// @ts-check
import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import prettier from 'eslint-config-prettier'

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.clashcode/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'examples/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: ['./tsconfig.json', './tsconfig.test.json', './examples/tsconfig.json'],
      },
      globals: {
        // Node.js globals we care about
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        NodeJS: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      // TypeScript replaces several core rules
      'no-unused-vars': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-non-null-assertion': 'off', // we rely on ! in places
      // Core rules
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'prefer-const': 'error',
    },
  },
  prettier,
]
