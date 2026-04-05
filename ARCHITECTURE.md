# ClashCode Architecture

This document is the map for new contributors. It explains what each module
owns, how a turn flows through the system, and where the sharp edges are.

For user-facing docs, see [README.md](README.md).
For release / contribution mechanics, see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 1. High-level picture

```
┌─────────────────────────────────────────────────────────────────────┐
│ CLI entrypoint  (src/cli/index.ts)                                  │
│    parseCliArgs → buildRuntime → runRepl                            │
└──────────┬──────────────────────────────────────────────────────────┘
           │
    ┌──────▼──────┐       ┌─────────────────┐    ┌──────────────────┐
    │  Runtime    │◀──────│  commands.ts    │    │ coordination-    │
    │  (runtime.ts)│      │  (slash cmds)   │    │ view.ts          │
    └──┬───────────┘      └─────────────────┘    └────────▲─────────┘
       │                                                  │
       │ each user turn                                   │ view events
       ▼                                                  │
    ┌──────────────┐       ┌──────────────────┐           │
    │  turn.ts     │──────▶│  orchestrator    │───────────┘
    │  (solo/team) │       │  (open-multi-    │
    │              │       │   agent)         │
    └──┬───────────┘       └──────┬───────────┘
       │                          │
       │                          │ tool calls
       ▼                          ▼
    ┌──────────────┐       ┌──────────────────┐
    │ team-cache   │       │ sandbox factory  │
    │ (SQLite)     │       │ docker | shuru | │
    └──────────────┘       │ local            │
                           └──────────────────┘
```

Every arrow is a synchronous or async function call — nothing is event-bus
/ pub-sub. The only shared mutable state is the sandbox factory singleton
(configured once at startup) and the terminal stream that the coordination
view draws on.

---

## 2. Module map

### Entrypoint & CLI (`src/cli/`)

| File | Lines | Responsibility |
|---|---:|---|
| `index.ts` | ~100 | Entrypoint. `init` subcommand short-circuit; otherwise `parse → bootstrap → build → repl`. |
| `bootstrap.ts` | ~170 | Arg parsing, log-level, telemetry exporters, global error handlers, `--help` / `--version`. Pure functions; no I/O beyond logging. |
| `runtime.ts` | ~160 | Builds the `Runtime` aggregate: settings, session store, team cache, orchestrator, consensus engine, sandbox configuration. One-shot, side-effectful. |
| `repl.ts` | ~145 | Readline loop, paste detection, slash-command routing, graceful shutdown (Ctrl+C / SIGTERM / EOF). |
| `turn.ts` | ~230 | Per-turn execution: solo vs team, cache probe, coordinator-model override, diagnostics panel. The hot path. |
| `commands.ts` | ~710 | Slash-command registry (declarative `COMMAND_REGISTRY` map + handlers). Adding a command = one entry + one handler. |
| `coordination-view.ts` | ~535 | Live mission-control view rendered to stderr. TTY-aware; falls back to line-logging in pipes / CI. |
| `completer.ts` | ~120 | Readline tab-completion. Pulls command names from `commands.ts`, arguments from dynamic context. |
| `model-select.ts` | ~135 | `/model` menu — fetches model list from provider API, renders paginated picker. |
| `init-interactive.ts` | ~220 | `clashcode init --interactive` wizard. |
| `doctor.ts` | ~185 | `/doctor` and `clashcode --doctor` diagnostics. |
| `ui.ts` | ~110 | ANSI colours, `banner`, `box`, `error`/`success`/`info` helpers. |

### Core services (`src/`)

| Path | Responsibility |
|---|---|
| `config/index.ts` | Settings load/save, migration, `DEFAULT_SETTINGS`. Schema is versioned via `CURRENT_CONFIG_VERSION`. |
| `config/keychain.ts` | `keytar`-backed API-key storage + `resolveApiKey(provider, envVar, settings)` precedence: **keychain → env → settings.json**. |
| `state/index.ts` | `SessionStore` — SQLite + JSONL session persistence. |
| `state/team-cache.ts` | `TeamCache` — keyed on `(goal + agents + model)` hash; TTL-based pruning. |
| `orchestrator/index.ts` | `createOrchestrator`, agent presets (`CODER_AGENT`, `REVIEWER_AGENT`, `CONSENSUS_AGENT`), `defaultTeamConfig`. |
| `orchestrator/tools.ts` | Tool implementations exposed to the agent — file I/O, shell, etc. Also hosts the sandbox-factory configuration. |
| `consensus/index.ts` | `ClashEngine` — 5-phase debate orchestration, coherence scoring. |
| `consensus/personas.ts` | Built-in personas (`BUILT_IN_PERSONAS`). |
| `consensus/store.ts` | `DebateStore` — persistent debate history. |
| `sandbox/backend.ts` | `SandboxBackend` interface, `validateSandboxPath` path-traversal guard. |
| `sandbox/factory.ts` | `createSandboxBackend`, `resolveBackend` — picks backend from config, caches singleton. |
| `sandbox/backends/docker.ts` | Docker backend. |
| `sandbox/backends/shuru.ts` | Shuru microVM backend (macOS/Apple Silicon; true VM isolation). |
| `sandbox/backends/shuru-bootstrap.ts` | Lazy install / checkpoint restore. |
| `sandbox/backends/local.ts` | **Local** backend — runs commands unsandboxed in the host cwd. Development only; emits a loud warning at startup. |
| `logger.ts` | 5-level logger (`debug`/`info`/`warn`/`error`/`silent`), env + API controlled. |
| `retry.ts` | `withRetry` + exponential-backoff helper, used by providers and sandbox bootstrap. |
| `telemetry.ts` | In-process counters + optional OTel/Sentry exporters (dynamic import, fail-open). |
| `errors.ts` | Typed error classes: `ClashCodeError`, `ConfigError`, `SandboxError`, `ProviderError`, `SessionError`, `DebateError`. |

---

## 3. Turn lifecycle (the hot path)

```
user types "refactor the auth module"
    │
    ▼
repl.ts  handleLine(trimmed)
    │  ├─ starts with '/'? → commands.ts handleCommand() → return
    │  └─ else → turn.ts executeTurn()
    ▼
turn.ts  executeTurn(runtime, msg)
    │  1. store.append(session, { role:'user', content:msg })
    │  2. showCoordinationView(msg, viewAgents)
    │  3. if teamMode → runTeamTurn
    │     else        → runSoloTurn
    │  4. freezeCoordinationView()
    │  5. print summary + response
    │  6. store.append(session, { role:'assistant', content:output })
    │  7. store.addTokens(session, in, out)
    ▼
runTeamTurn:
    ├─ TeamCache.key(msg, agents, model) → cache.get() → HIT? return
    ├─ orchestrator.createTeam(uniqueName, teamConfig)
    ├─ swap orchestrator.config.defaultModel to coordinatorModel
    ├─ orchestrator.runTeam(team, msg)  // framework does the work
    ├─ restore defaultModel
    ├─ extract coordinator.output as final answer
    ├─ if diagnostics: printDiagnosticsPanel()
    └─ if cacheWorkerOutputs: teamCache.set(...)
```

Key invariants:
- **The coordination view is the only thing writing to stderr during a
  turn.** Tool output goes to the session log; agent progress is `feedEvent`
  messages from the orchestrator's `onProgress` callback.
- **Cache hits record 0 tokens** to the session store (fair accounting —
  you didn't actually pay for them).
- **`teamCallCount` monotonically increases** to keep team names unique
  within the orchestrator's registry.

---

## 4. Sharp edges (known coupling)

### 4.1 Coordinator-model override
`src/cli/turn.ts` and `docs/coordinator-model-override.md`. The upstream
framework hardcodes the coordinator's model to `orchestrator.config.defaultModel`.
We mutate that field before `runTeam()` and restore in a `finally`. Narrow
structural cast; safe at runtime but coupled to framework internals.

### 4.2 Sandbox factory singleton
`src/orchestrator/tools.ts` holds a module-level `currentBackend` that
tools call into. `configureSandbox()` mutates it; `resolveBackend()` reads
it. This means you cannot run two clashcode sessions with different sandbox
configs in the same process.

### 4.3 `teamCallCount` as global counter
Lives on the `Runtime`. If we ever support parallel team runs in the same
session, this needs to move to a monotonic UUID or similar.

### 4.4 Coordination view and `patch_stdout`
Direct ANSI cursor control on stderr. Fine in a real terminal; breaks
under `prompt_toolkit`-style stdout patching. If you're embedding clashcode,
set `CLASHCODE_NO_TUI=1`.

---

## 5. Extension points

### Add a slash command
1. Write a handler in `src/cli/commands.ts` returning `CommandResult`.
2. Add one line to `COMMAND_REGISTRY`.
3. Update autocomplete arguments in `src/cli/completer.ts` if it takes args.
No dispatcher / help / test changes needed.

### Add a debate persona
Add an entry to `BUILT_IN_PERSONAS` in `src/consensus/personas.ts`.
`/perspectives` and `/consensus` pick it up automatically.

### Add a sandbox backend
1. Implement `SandboxBackend` interface from `src/sandbox/backend.ts`.
2. Register in `src/sandbox/factory.ts` under a new `SandboxBackendName`.
3. Add a doctor check in `src/cli/doctor.ts`.

### Add a provider
`createOrchestrator` uses the framework's provider registry. For new
providers, add them to `VALID_PROVIDERS` in `src/cli/bootstrap.ts` and the
keychain-lookup map in `src/config/keychain.ts`.

---

## 6. Testing strategy

- **Unit** (`test/*.test.ts`) — fast, in-process, no network. 14 files,
  173 tests. Each module has a `.test.ts` sibling.
- **Integration** (`test/integration/*.integration.test.ts`) — exercises
  real sandbox backends. `sandbox-local.integration.test.ts` runs in CI on
  all platforms; `sandbox-docker.integration.test.ts` runs when Docker is
  available.
- **Snapshot** (`test/consensus-report.snapshot.test.ts`) — pins debate
  report format.

Coverage gate: **74% lines / 79% branches** (enforced by
`vitest.config.ts`).

---

## 7. Config, logs, telemetry — data flow

```
~/.clashcode/settings.json  ─┐
env XAI_API_KEY              ├──▶ resolveApiKey ──▶ orchestrator
OS keychain (keytar)         ─┘

env CLASHCODE_LOG_LEVEL  ─▶ bootstrap.applyLogLevel ─▶ logger ─▶ stderr
--log-level <l>          ─┘

env CLASHCODE_OTEL_ENDPOINT  ─▶ enableOtelExport  ─▶ in-proc metrics
env CLASHCODE_SENTRY_DSN     ─▶ enableSentry      ─▶ error capture
```

Telemetry is opt-in and fail-open: missing peer deps log a warning and
continue. See `src/telemetry.ts`.
