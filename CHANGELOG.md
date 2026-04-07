# Changelog

## 1.3.0

### Breaking Changes

- **Removed `@jackchen_me/open-multi-agent` dependency.** ClashCode now owns
  its orchestration core entirely. The new **ClashEngine** replaces the
  external framework with a purpose-built, event-driven orchestrator.

- `createOrchestrator()` now returns `{ engine }` (a `ClashEngine` instance)
  instead of `{ orchestrator, registry }`. The `ClashEngine` provides
  `executeAgent()`, `executeSquad()`, and `executeClashDebate()` methods.

- The `Runtime.orchestrator` field has been replaced by `Runtime.engine`.
  The `Runtime.consensus` field has been absorbed into the engine.

### New Features

- **ClashEngine** (`src/core/clash-engine/`): A minimalist, event-driven
  orchestrator with:
  - **SignalBus**: Typed pub/sub event system that streams every agent
    action to the TUI in real time.
  - **Arena**: First-class execution context with no globals — model,
    provider, API key, tools, and signal bus all owned per-session.
  - **ToolVault**: Native tool registry with `defineTool()` helper for
    Zod-to-JSON-Schema conversion.
  - **LLM Client**: Zero-dependency fetch-based client for OpenAI-compatible
    APIs (xAI/Grok, OpenAI, Gemini, Copilot).
  - **ForgeRunner**: Team collaboration with explicit coordinator synthesis
    (no more coordinator-model override hack).
  - **ClashRunner**: Structured debate with rich per-round event emission.

- Rich `ArenaEvent` types for TUI visualization: `spark_ignited`,
  `tool_invoked`, `tool_resolved`, `round_opened`, `convergence_probed`,
  `phase_shifted`, `fault_recovered`, `session_sealed`, and more.

- `formatDebateReport()` extracted as a standalone function for use
  outside the engine.

### Improvements

- **Zero external agent framework dependencies.** Better security posture
  and full control over the orchestration layer.
- **No coordinator-model override hack.** ClashEngine accepts an explicit
  `coordinatorModel` parameter — no more mutating internal framework state.
- **Backward-compatible type aliases.** `AgentConfig` = `AgentSpec`,
  `TeamConfig` = `SquadBlueprint` for smooth migration.

## 1.2.0

- Initial public release.
