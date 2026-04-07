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
       │ each user turn                                   │ ArenaEvents
       ▼                                                  │
    ┌──────────────┐       ┌──────────────────┐           │
    │  turn.ts     │──────▶│  ClashEngine     │───────────┘
    │  (solo/team) │       │  (src/core/      │
    │              │       │   clash-engine/)  │
    └──┬───────────┘       └──────┬───────────┘
       │                          │
       │                          │ tool calls
       ▼                          ▼
    ┌──────────────┐       ┌──────────────────┐
    │ team-cache   │       │ SandboxHandle    │
    │ (SHA256-key) │       │ docker | shuru | │
    └──────────────┘       │ local            │
                           └──────────────────┘
```

v1.3: The external `@jackchen_me/open-multi-agent` dependency has been
replaced by **ClashEngine**, a purpose-built orchestrator owned by ClashCode.
All inter-agent communication flows through the **SignalBus** event system,
enabling real-time TUI visualization of every agent action.

---

## 2. ClashEngine — Event-Driven Orchestration Core

ClashEngine lives in `src/core/clash-engine/` and is the single orchestration
layer for both team collaboration and structured debate.

### Architecture

```
┌────────────────────────────────────────────────────┐
│ ClashEngine (clash-engine.ts)                       │
│   Public facade: executeAgent, executeSquad,        │
│   executeClashDebate, onEvent, registerTool         │
├────────────────────────────────────────────────────┤
│ Arena (execution-context.ts)                        │
│   Owns: model, provider, apiKey, SignalBus,         │
│   ToolVault. No globals — one Arena per session.    │
├────────┬───────────────┬───────────────────────────┤
│ Signal │  ToolVault    │  LLM Client               │
│ Bus    │  (tool-       │  (llm-client.ts)           │
│ (event │  vault.ts)    │  Raw fetch to OpenAI-      │
│ -bus.  │  Built-in +   │  compatible endpoints.     │
│ ts)    │  sandbox      │  No external SDK.          │
│        │  tools.       │                            │
├────────┴───────────────┴───────────────────────────┤
│ Runners                                             │
│  ForgeRunner (team-runner.ts)  — 3-role squad      │
│  ClashRunner (debate-runner.ts) — 6-persona debate │
└────────────────────────────────────────────────────┘
```

### Key Files

| File | LOC | Responsibility |
|---|---:|---|
| `types.ts` | ~150 | All type definitions: AgentSpec, SquadBlueprint, ArenaEvent, ToolDef |
| `event-bus.ts` | ~90 | SignalBus: typed pub/sub with legacy bridge for backward compat |
| `execution-context.ts` | ~100 | Arena: resolved config, provider mapping, env key lookup |
| `agent-registry.ts` | ~75 | CODER/REVIEWER/CONSENSUS presets, defaultSquadBlueprint |
| `tool-vault.ts` | ~170 | ToolVault registry, defineTool, built-in tools (bash, file ops, grep) |
| `llm-client.ts` | ~120 | callModel: raw fetch to OpenAI-compatible chat/completions |
| `team-runner.ts` | ~140 | runSpark (single agent loop), runSquad (multi-agent + coordinator) |
| `debate-runner.ts` | ~180 | runClashDebate: 5-phase debate with rich event emission |
| `clash-engine.ts` | ~100 | Public facade class |

### Event-Driven Design

Every meaningful action emits a rich `ArenaEvent` through the SignalBus:

| Event Kind | Emitted When |
|---|---|
| `spark_ignited` | Agent starts processing |
| `spark_completed` | Agent finishes (includes token usage) |
| `tool_invoked` | Tool call initiated |
| `tool_resolved` | Tool call completed (includes elapsed time) |
| `round_opened` | Debate round begins |
| `convergence_probed` | Convergence score computed |
| `phase_shifted` | Workflow phase transition |
| `fault_recovered` | Error handled gracefully |
| `session_sealed` | Run complete |

The SignalBus includes a **legacy bridge** that auto-converts ArenaEvents
to the old `ViewEvent` format consumed by `coordination-view.ts`, ensuring
backward compatibility with the existing TUI.

### No Globals

The Arena owns all runtime state (model, API key, tools, signal bus).
There are no module-level singletons in the engine. This makes concurrent
sessions safe and testing trivial — construct a fresh ClashEngine per test.

---

## 2b. Module map

### Entrypoint & CLI (`src/cli/`)

| File | Lines | Responsibility |
|---|---:|---|
| `index.ts` | ~100 | Entrypoint. `init` subcommand short-circuit; otherwise `parse → bootstrap → build → repl`. |
| `bootstrap.ts` | ~170 | Arg parsing, log-level, telemetry exporters, global error handlers, `--help` / `--version`. |
| `runtime.ts` | ~160 | Builds the `Runtime` aggregate: settings, session store, team cache, ClashEngine, sandbox handle. |
| `repl.ts` | ~145 | Readline loop, paste detection, slash-command routing, graceful shutdown. |
| `turn.ts` | ~230 | Per-turn execution: solo vs team, cache probe, diagnostics panel. |
| `commands.ts` | ~710 | Slash-command registry (declarative `COMMAND_REGISTRY` map + handlers). |
| `coordination-view.ts` | ~555 | Live mission-control view rendered to stderr. TTY-aware fallback. |
| `completer.ts` | ~120 | Readline tab-completion. |
| `model-select.ts` | ~135 | `/model` menu — fetches model list from provider API. |
| `init-interactive.ts` | ~220 | `clashcode init --interactive` wizard. |
| `doctor.ts` | ~185 | `/doctor` diagnostics. |
| `ui.ts` | ~110 | ANSI colours, `banner`, `box`, `error`/`success`/`info` helpers. |

### Core services (`src/`)

| Path | Responsibility |
|---|---|
| `core/clash-engine/` | ClashEngine orchestrator — see section 2 above. |
| `orchestrator/index.ts` | `createOrchestrator` adapter: creates a ClashEngine, registers sandbox tools. |
| `orchestrator/tools.ts` | `SandboxHandle` lifecycle, sandbox tool definitions (sandbox_exec/write/read). |
| `consensus/index.ts` | Convergence scoring heuristics, `LexicalConvergenceScorer`, `formatDebateReport`. |
| `consensus/personas.ts` | Built-in personas, pluggable registries. |
| `consensus/types.ts` | Debate types, `ConvergenceScorer` and `PersonaRegistry` interfaces. |
| `consensus/store.ts` | `DebateStore` — persistent debate history. |
| `config/index.ts` | Settings load/save, migration, `DEFAULT_SETTINGS`. |
| `config/keychain.ts` | `keytar`-backed API-key storage. |
| `state/index.ts` | `SessionStore` — session persistence. |
| `state/team-cache.ts` | `TeamCache` — keyed on `(goal + agents + model)` hash; TTL-based pruning. |
| `sandbox/backend.ts` | `SandboxBackend` interface, `validateSandboxPath`. |
| `sandbox/factory.ts` | `createSandboxBackend`, `resolveBackend` — picks backend from config. |
| `sandbox/backends/` | Docker, Shuru (microVM), Local backends. |

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
    ├─ engine.executeSquad(blueprint, msg, coordinatorModel?)
    │    └─ Runs each agent via runSpark(), then coordinator synthesis
    ├─ extract coordinator.output as final answer
    ├─ if diagnostics: printDiagnosticsPanel()
    └─ if cacheWorkerOutputs: teamCache.set(...)
```

Key invariants:
- **The coordination view is the only thing writing to stderr during a
  turn.** Agent progress flows through ArenaEvents → SignalBus → legacy
  bridge → feedEvent.
- **Cache hits record 0 tokens** (fair accounting).
- **Team names are UUID-suffixed.** Concurrent turns are safe.
- **No coordinator-model override hack.** ClashEngine's `executeSquad`
  accepts an explicit `coordinatorModel` parameter.

---

## 4. Sharp edges (known coupling)

### 4.1 Sandbox lifecycle
`src/orchestrator/tools.ts` uses `SandboxHandle` — a class that owns
one lazy-created backend instance. The legacy `configureSandbox()` singleton
API still works for backward compatibility.

### 4.2 Coordination view and cursor control
Direct ANSI cursor control on stderr. Fine in a real terminal; breaks
under `prompt_toolkit`-style stdout patching. If embedding clashcode,
call `disableTUI()` or set `CLASHCODE_NO_TUI=1`.

---

## 5. Extension points

### Add a slash command
1. Write a handler in `src/cli/commands.ts` returning `CommandResult`.
2. Add one line to `COMMAND_REGISTRY`.
3. Update autocomplete arguments in `src/cli/completer.ts` if it takes args.

### Add a debate persona
Three ways:
1. **Built-in:** Add to `BUILT_IN_PERSONAS` in `src/consensus/personas.ts`.
2. **Config file:** Create `.clashcode/personas.json` with an array of
   `Persona` objects; load with `ConfigPersonaRegistry`.
3. **Custom registry:** Implement `PersonaRegistry` interface and pass to
   `ClashEngine` constructor via `debateOptions.personaRegistry`.

### Plug in a custom convergence scorer
Implement `ConvergenceScorer` (see `src/consensus/types.ts`) and pass it
to `ClashEngine` constructor via `debateOptions.scorer`.

### Add a sandbox backend
1. Implement `SandboxBackend` interface from `src/sandbox/backend.ts`.
2. Register in `src/sandbox/factory.ts` under a new `SandboxBackendName`.
3. Add a doctor check in `src/cli/doctor.ts`.

### Add a provider
Add to the provider maps in `src/core/clash-engine/execution-context.ts`
(`UPSTREAM_MAP`, `BASE_URLS`, `ENV_KEY_MAP`).

### Register custom tools
Call `engine.registerTool(toolDef)` to add tools available to agents.
The `defineTool()` helper converts Zod schemas to JSON Schema automatically.

---

## 6. Testing strategy

- **Unit** (`test/*.test.ts`) — fast, in-process, no network. ~20 files,
  ~250+ tests.
- **Integration** (`test/integration/*.integration.test.ts`) — exercises
  real sandbox backends.
- **Snapshot** (`test/consensus-report.snapshot.test.ts`) — pins debate
  report format.

Coverage gate: **90% lines / 85% branches**.

---

## 7. Config, logs, telemetry — data flow

```
~/.clashcode/settings.json  ─┐
env XAI_API_KEY              ├──▶ resolveApiKey ──▶ ClashEngine (Arena)
OS keychain (keytar)         ─┘

env CLASHCODE_LOG_LEVEL  ─▶ bootstrap.applyLogLevel ─▶ logger ─▶ stderr
--log-level <l>          ─┘

env CLASHCODE_OTEL_ENDPOINT  ─▶ enableOtelExport  ─▶ in-proc metrics
env CLASHCODE_SENTRY_DSN     ─▶ enableSentry      ─▶ error capture
```

---

## 8. Docker security hardening

| Option | Default | Description |
|---|---|---|
| `noNewPrivileges` | `true` | Blocks setuid/setgid bit elevation |
| `readOnlyRootfs` | `false` | Read-only container root |
| `seccompProfile` | `undefined` | Path to seccomp JSON, or `'builtin'` |
| `apparmorProfile` | `undefined` | AppArmor profile name |
| `capAdd` | `undefined` | Drops ALL capabilities and only adds these back |

Shuru (microVM) provides stronger isolation than Docker by running in a
true VM boundary.

---

## 9. Future directions

### Embeddings-based convergence scoring
The `ConvergenceScorer` interface is designed for this. An embeddings-based
implementation would call an embedding API, compute cosine similarity, and
map to the 0-100 scale.

### Streaming agent output
ClashEngine's SignalBus can be extended with a `content_delta` event kind
to stream agent output token-by-token to the TUI.

### Distributed team execution
The Arena-per-session model is compatible with distributing agents across
processes. Each process would get its own Arena with an independent
SandboxHandle.

### Plugin system for tools and commands
The ToolVault and slash-command registry are both extensible. A plugin
interface could load tools and commands from `.clashcode/plugins/`.
