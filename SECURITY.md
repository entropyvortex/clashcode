# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.8.x   | Yes       |
| 0.5.x+  | Yes (best-effort backports) |
| < 0.5   | No        |

## Reporting Vulnerabilities

Do not open public GitHub issues for security vulnerabilities.

Email security reports to the maintainer via the contact information on
the [GitHub profile](https://github.com/marceloceccon). Include:

- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Suggested fix (if you have one)

You will receive an acknowledgment within 48 hours.

## Responsible Disclosure Timeline

1. **Day 0** -- Report received, acknowledgment sent within 48 hours
2. **Day 1-7** -- Triage and initial assessment
3. **Day 7-30** -- Fix developed and tested
4. **Day 30** -- Patch released, advisory published
5. **Day 30+** -- Reporter credited (unless anonymity requested)

We ask that you do not publicly disclose the vulnerability until a fix
is released or 90 days have passed, whichever comes first.

## Security Considerations

### Sandbox backends

ClashCode executes LLM-generated code inside a pluggable sandbox.
See [docs/sandbox.md](docs/sandbox.md) for the full threat model.

- **Shuru microVM** (macOS/Apple Silicon) — true VM isolation via
  Apple's Virtualization.framework. Host filesystem unreachable by
  default (tmpfs overlay), no network unless allowlisted, host
  secrets never enter the guest (proxy substitution).
- **Docker** (default on Linux) — container with `--network=none`,
  `--memory=512m`, `--cpus=1`, `--pids-limit=256`. Non-persistent.
  File I/O via `docker cp` + `execFile()` (no shell interpolation).
- **Local** (opt-in, dev-only) — no isolation. Not for production.

Signal handlers await sandbox `destroy()` with a 10s grace timeout,
so Ctrl+C / SIGTERM / uncaughtException no longer leak containers.

### API keys

API keys are resolved in this priority order:

1. **OS keychain** via optional `keytar` peer dependency. Install
   with `pnpm add keytar` (macOS/Windows native; Linux requires
   `libsecret-1-dev`). Manage via `/keychain set <provider> <key>`
   and `/keychain delete <provider>`. **Recommended.**
2. Environment variable (`XAI_API_KEY`, `OPENAI_API_KEY`,
   `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `COPILOT_API_KEY`).
3. Plaintext `apiKeys.<provider>` in `.clashcode/settings.json`
   (fallback — not recommended for shared machines).

The CLI masks keys in `/config` output (first/last 4 chars). Add
`.clashcode/` to `.gitignore` — already done in the repo template.

### File Operations

- Session IDs are sanitized to `[a-zA-Z0-9_-]` to prevent path traversal
- The sandbox manager validates all paths before Docker operations
- JSON parsing in config and session loaders uses try/catch with
  safe fallbacks

### Dependencies

ClashCode maintains a minimal dependency tree to reduce supply-chain
attack surface. Runtime dependencies:

- `@jackchen_me/open-multi-agent` -- orchestrator
- `zod` -- schema validation

All other dependencies are devDependencies (build/test tooling only).
