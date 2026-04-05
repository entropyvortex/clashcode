# Contributing to ClashCode

## Development Setup

```sh
git clone https://github.com/entropyvortex/clashcode.git
cd clashcode
pnpm install
pnpm build
```

Requirements: Node.js >= 20, pnpm, Docker (optional, for sandbox tests).

Run in watch mode during development:

```sh
pnpm dev
```

## Code Style

- TypeScript strict mode (`tsconfig.json` has `strict: true`)
- ESM only (`"type": "module"` in package.json)
- Use `.js` extensions in all import paths (TypeScript ESM requirement)
- No default exports -- use named exports
- No semicolons (project convention, enforced by existing code)
- Prefer `const` over `let`, never use `var`
- Types in separate files when shared across modules (see `src/consensus/types.ts`)

## Adding a Persona

1. Open `src/consensus/personas.ts`
2. Add a new entry to the `BUILT_IN_PERSONAS` record:

```typescript
'your-persona': {
  name: 'your-persona',
  description: 'One-line description of the perspective.',
  systemPrompt:
    'You are the Your Persona. Describe the perspective in 2-4 sentences. ' +
    'Be specific about what this persona prioritizes and challenges.',
},
```

3. The persona is automatically available to `/consensus` and `/perspectives`.
   No wiring needed.

## Adding a Slash Command

1. Open `src/cli/commands.ts`
2. Add a handler function following the existing pattern:

```typescript
function handleYourCommand(args: string[], ctx: CommandContext): CommandResult {
  // Implementation
  return { output: 'result' }
}
```

3. Add one entry to `COMMAND_REGISTRY` (the declarative map at the bottom
   of `commands.ts`) — that's the entire dispatcher, no switch statement.
4. Add the command to `handleHelp()` commands array
5. Add tab-completion in `src/cli/completer.ts` if the command takes args.

See [ARCHITECTURE.md](ARCHITECTURE.md#5-extension-points) for a fuller
tour of the extension points (personas, sandbox backends, providers).

## Commit Messages

Use conventional commits:

```
feat: add persona for accessibility review
fix: handle empty debate topic gracefully
refactor: extract coherence scoring into separate module
docs: update CLI commands table
test: add debate phase progression tests
```

Keep the subject line under 72 characters. Body is optional but
encouraged for non-trivial changes.

## Pull Request Process

1. Fork the repository and create a branch from `main`
2. Make your changes with clear, focused commits
3. Run the full check suite before pushing:

```sh
pnpm lint           # typecheck
pnpm test           # unit tests
pnpm build          # ensure clean build
```

4. Open a PR against `main` with a clear description of what and why
5. PRs require passing CI (lint + test + build)

## Testing

Tests use vitest. The suite is split into two categories:

| Command | What runs | When to run |
|---|---|---|
| `pnpm test` | Unit tests (`test/*.test.ts`) — fast, in-process, no network | Every change; every commit; every CI run |
| `pnpm test:integration` | Integration tests (`test/integration/*.integration.test.ts`) — exercises real sandbox backends | Before PRs that touch `src/sandbox/**` or `src/orchestrator/**` |
| `pnpm test:coverage` | Unit tests with coverage report and 70% lines / 75% branches gate | If you change coverage-sensitive code |

New features must include unit tests. Bug fixes must include a regression
test. Use `pnpm test:watch` during development.

## Releases

This project uses [changesets](https://github.com/changesets/changesets).

1. After your change is merged, run `pnpm changeset` locally.
2. Pick the version bump (`patch` / `minor` / `major`) and write a
   user-facing description.
3. Commit the generated `.changeset/*.md` file.
4. The release workflow opens a "Version Packages" PR aggregating pending
   changesets; merging it publishes to npm.

For internal/doc-only changes, add an empty changeset or skip.

## Architecture Overview

Before making non-trivial changes, read [ARCHITECTURE.md](ARCHITECTURE.md).
It covers:

- Module map (what each file owns)
- Turn lifecycle (how a user message flows through the system)
- Known sharp edges (coordinator-model override, sandbox singleton, etc.)
- Extension points with step-by-step guides

## Reporting Issues

Use GitHub Issues. Include:

- What you expected vs. what happened
- Steps to reproduce
- Node version, OS, provider/model in use
- Relevant error output or logs

## Security Issues

Do not open public issues for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for responsible disclosure instructions.
