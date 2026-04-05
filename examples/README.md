# ClashCode — runnable examples

These scripts demonstrate the public library API. Run them with
`pnpm tsx examples/<name>.ts` (install `tsx` first: `pnpm add -D tsx`)
or after building with `node --loader=tsx examples/<name>.ts`.

Each example is self-contained and includes a header comment explaining
what it demonstrates. Output dumps from `/consensus` runs live in the
companion markdown files (`architecture-debate.md`, etc.) which show
what the debate engine produces — these TS scripts drive the same
engine programmatically.

| Script | Demonstrates |
|---|---|
| `local-sandbox.ts` | Running shell commands via `LocalBackend` |
| `consensus-debate.ts` | Running a debate via `ClashEngine.runDebate` |
| `keychain-setup.ts` | Storing + retrieving API keys via `KeychainStore` |
| `team-run.ts` | Running a multi-agent team via `createOrchestrator` |
| `doctor-check.ts` | Running diagnostic checks programmatically |

## Prerequisites

```sh
pnpm install
pnpm add -D tsx      # first time only
export XAI_API_KEY=...  # or ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.
```

## Running

```sh
pnpm tsx examples/local-sandbox.ts
pnpm tsx examples/doctor-check.ts
pnpm tsx examples/consensus-debate.ts "Should we adopt Rust?"
```

Scripts that call real providers (`consensus-debate.ts`, `team-run.ts`)
will cost tokens. `local-sandbox.ts`, `keychain-setup.ts`, and
`doctor-check.ts` run entirely locally and are free.
