# ClashCode

**A sandbox-isolated multi-agent coding CLI.** Runs agent-generated code in
Docker containers or true microVMs, with optional structured-debate mode
for surfacing disagreement between AI personas on design decisions.


[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

---

## What's different

Most terminal AI coding tools run commands directly on your host shell or
in an unmanaged container. ClashCode ships three sandbox backends as
first-class citizens:

- **Shuru microVM** (macOS / Apple Silicon) — true VM isolation via
  Apple's Virtualization.framework. Ephemeral guest, host filesystem
  unreachable by default, outbound network blocked unless allowlisted,
  host secrets never enter the VM.
- **Docker** (Linux / cross-platform) — containers with CPU / memory /
  PID limits and `--network=none` by default.
- **Local** (dev only) — zero isolation, prints a loud red warning at
  startup and on every `/sandbox` switch. Suppressible with an explicit
  env-var opt-in.

Backend selection is auto-detecting: Shuru on `mac-arm64` if installed,
Docker on Linux with a reachable daemon, local otherwise (with warnings).

On top of that isolation layer, ClashCode offers a **team mode** (coder +
reviewer + coordinator) and an experimental **debate engine** (six
personas argue design decisions through structured phases). See the
*Debate engine* section below — and read the limitations first.

![Debate Screenshot](/docs/convergence-screenshot.png)
---

## Limitations (read this before the features)

This project is honest about what it is.

- ** It is experimental ** This is proving grounds with unproved thesis and orchestration.

- **The debate score is a `ConvergenceHeuristic`, not a quality metric.**
  It's computed from keyword Jaccard similarity, evidence-marker counts,
  and pattern matching — classic bag-of-words stats. Two personas can
  argue opposite sides using the same vocabulary and score high. The
  type is named `ConvergenceHeuristic` deliberately: it's a directional
  UX signal showing how lexically similar the final-round outputs are,
  not ground truth about whether perspectives actually converged. See
  [docs/coherence-scoring.md](docs/coherence-scoring.md) for the full
  methodology, measured failure modes, and worked examples from
  `eval/fixtures/`.
- **Multi-agent debate is not proven to improve output quality.** The
  research literature is mixed — some papers show gains, others show
  the gains evaporate on careful evals. ClashCode does not ship a
  benchmark proving team mode beats a single well-prompted model call.
  What it *does* give you is explicit visibility into disagreement and
  a structured record of the debate. If that transparency helps your
  decision, use it. If you just want the fastest answer, use solo mode.
- **Higher token cost.** Team mode runs multiple agents; consensus mode
  runs `personas × rounds` LLM calls. Expect 3-10× the token spend of
  a single-model call for the same question.
- **Own orchestration core.** ClashCode v1.3 owns its orchestration
  layer (ClashEngine) with zero external agent framework dependencies.
  This gives full control over security, TUI integration, and the
  agent-tool calling loop.
- **The local sandbox is not a sandbox.** It's there because
  inner-loop dev iteration needs fast paths; it runs agent commands on
  your host shell with your user's privileges. Use Docker or Shuru for
  anything resembling production.

If these trade-offs are acceptable, keep reading.

---

## Quick start

```sh
# 1. Clone and build
git clone https://github.com/entropyvortex/clashcode.git
cd clashcode && pnpm install && pnpm build

# 2. Set an API key (xAI / Grok is the default)
export XAI_API_KEY="..."

# 3. Interactive first-run setup (recommended)
node dist/cli/index.js init --interactive

# 4. Run
node dist/cli/index.js
```

To install globally:

```sh
pnpm link --global
clashcode
```

To switch providers at runtime:

```sh
export OPENAI_API_KEY="..."
clashcode
/config set provider openai
/config set model gpt-4o
```

---

## Sandbox backends

| Backend | Isolation | Platform | Network default | Notes |
|---|---|---|---|---|
| `shuru` | microVM (Apple Virtualization.framework) | macOS / Apple Silicon | blocked, allowlist supported | Ephemeral guest, host FS unreachable, host secrets never enter. First cold boot ~30-60s to build the `clashcode-env` checkpoint; subsequent boots ~1s. |
| `docker` | container, `--network=none`, cpu/mem/pid limits | Linux / any Docker host | blocked | Shares host kernel. |
| `local` | **none** | any | host network | Dev only. Loud warning at startup. |
| `auto` | picks the first available | — | — | Default. |

See [docs/sandbox.md](docs/sandbox.md) for the full security model, tuning
knobs, and how to build a custom Shuru checkpoint.

---

## Team mode

```
user prompt
  └─ coordinator (synthesizes final answer)
       ├─ coder     (writes code, uses sandbox tools)
       └─ reviewer  (critiques coder's output)
```

The coordinator receives the worker outputs and produces the final
answer you see. You can route the coordinator through a cheaper model
(`coordinatorModel` setting) to save tokens on synthesis while keeping
the workers on a stronger model. Team outputs are cached by
`(goal, agents, model)` hash with 24h TTL.

Toggle with `/team on` / `/team off`. See the CLI table below.

---

## Debate engine (experimental)

ClashEngine runs multiple personas through structured debate phases and
produces a convergence-heuristic report.

**Again: this is a heuristic.** The score tells you whether the
final-round outputs use similar vocabulary and whether evidence
markers appeared. It does not tell you whether the personas reached
actual agreement.

### Personas

Six built-in personas, each with a distinct priority:

| Persona                | Focus                                            |
|------------------------|--------------------------------------------------|
| `pragmatist`           | What ships and works. Battle-tested over clever. |
| `security-maximalist`  | Every input is hostile. Defense in depth.        |
| `performance-extremist`| Measure everything. Demand benchmarks.           |
| `elegance-purist`      | Clean abstractions, type safety, readability.    |
| `future-architect`     | Extensibility, migration paths, two-year view.   |
| `devils-advocate`      | Find the failure modes everyone else missed.     |

Add your own in `src/consensus/personas.ts` — a single object entry, no
wiring needed (see CONTRIBUTING.md).

### Debate phases

Default 4 rounds:

| Round | Phase                  | Purpose                                     |
|-------|------------------------|---------------------------------------------|
| 1     | `initial-analysis`     | Each persona states its position            |
| 2     | `counterarguments`     | Respond to other perspectives               |
| 3     | `evidence-assessment`  | Ground arguments in specifics               |
| 4     | `synthesis`            | Converge on a balanced recommendation       |
| 5+    | `refinement`           | Further refinement (optional extra rounds)  |

Each persona sees the full debate history in every round.

### What the score means

| Sub-metric | Weight | What it actually measures |
|---|---|---|
| Agreement Convergence | 25% | Jaccard overlap of extracted keywords in final round |
| Contradiction Resolution | 15% | Ratio of disagreement markers early vs acknowledgment markers late |
| Evidence Grounding | 20% | Density of evidence markers ("benchmark", "measured", etc.) vs vague language |
| Proposal Similarity | 25% | Overlap of recommendation-bearing sentences |
| Consensus Speed | 15% | How early agreement vocabulary appears |

A high score means the final-round outputs look *lexically similar and
evidence-rich*. It does **not** mean the personas actually agree. If
they all say "the answer is clearly X" vs "the answer is clearly not X",
you'll still score high on Agreement Convergence.

Full methodology, worked examples, and known failure modes:
[docs/coherence-scoring.md](docs/coherence-scoring.md).

### Example output

```
ClashEngine Debate
  Topic:     Should we use a monorepo or polyrepo for the new platform?
  Convergence: 72/100 (heuristic — see docs/coherence-scoring.md)
  6 personas × 4 rounds

  pragmatist (round 4)
    │ Monorepo with Turborepo gives you shared tooling without...

  security-maximalist (round 4)
    │ Monorepo concentrates blast radius. Polyrepo isolates...

  Convergence Heuristic Breakdown
    Agreement (lexical)   ████████████████░░░░ 78
    Contradictions        ████████████░░░░░░░░ 61
    Evidence density      ██████████████░░░░░░ 70
    Proposal overlap      ███████████████░░░░░ 74
    Consensus speed       █████████████░░░░░░░ 65

  Synthesis
    ...

  Tokens: 12,400 in / 8,200 out   Time: 34.2s
```

---

## Evaluation

There is no published benchmark yet showing that team mode or debate mode
beats a single well-prompted call. That's intellectually honest scope:
running a proper eval requires time and token budget we haven't spent
and we don't want to publish marketing numbers.

What we *do* ship is a **scorer self-test**: hand-crafted high-convergence
and low-convergence debate transcripts that verify the scorer ranks them
in the expected direction, plus two adversarial fixtures that prove the
scorer's documented failure modes are real. Run with:

```sh
pnpm test:eval
```

This confirms the scorer does what it claims on controlled inputs. It
does not tell you anything about whether multi-agent orchestration
produces better code or design decisions in the wild.

See `eval/README.md` for the methodology, the transcripts, and
instructions for plugging in your own live-LLM eval.

---

## Configuration

Settings are stored at `.clashcode/settings.json`. First run creates
sensible defaults. Alternatively:

```sh
clashcode init --interactive
```

walks through provider, API key (with optional OS keychain storage),
sandbox backend, and team mode, then runs `/doctor` to verify.

Full config reference and all `CLASHCODE_*` environment variables are
documented in `clashcode --help`.

---

## CLI Commands

| Command                      | Description                                  |
|------------------------------|----------------------------------------------|
| `/help`                      | Show all available commands                  |
| `/config`                    | Show current configuration                   |
| `/config set <key> <value>`  | Update a setting (dot-path supported)        |
| `/model`                     | Browse available models from provider API    |
| `/model <name\|number>`      | Switch to a model by name or menu number     |
| `/team [on\|off]`            | Show or toggle multi-agent team mode         |
| `/agent`                     | List agents in current team                  |
| `/agent add <name>`          | Add an agent preset to the team              |
| `/agent remove <name>`       | Remove an agent from the team                |
| `/consensus <topic>`         | Run a ClashEngine debate on a topic          |
| `/debate <topic>`            | Alias for /consensus                         |
| `/convergence`               | Show convergence-heuristic report from last debate |
| `/coherence`                 | Alias for `/convergence` (historical)        |
| `/debates`                   | List past debates or view one by ID          |
| `/perspectives`              | List available debate personas               |
| `/diagnostics [on\|off]`     | Toggle per-agent token/time breakdown        |
| `/sandbox`                   | Show active sandbox backend                  |
| `/sandbox <backend>`         | Switch backend (auto\|docker\|shuru\|local)  |
| `/doctor`                    | Run diagnostic self-check                    |
| `/keychain`                  | Show API keys stored in OS keychain          |
| `/keychain set <provider>`   | Store an API key in the OS keychain          |
| `/session`                   | List all sessions with token usage           |
| `/session new [title]`       | Create a new session                         |
| `/session delete <id>`       | Delete a session                             |
| `/clear`                     | Clear the terminal                           |
| `/exit`, `/quit`             | Exit ClashCode                               |

---

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the module map, turn
lifecycle, extension points (personas, sandbox backends, slash commands,
providers), and the known coupling seams.

---

## Development

```sh
git clone https://github.com/entropyvortex/clashcode.git
cd clashcode
pnpm install
pnpm build          # production build via tsup
pnpm dev            # watch mode
pnpm test           # run tests via vitest
pnpm test:eval      # scorer self-test on controlled transcripts
pnpm lint           # typecheck + eslint
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for code style, test categories,
release flow, and how to add personas or commands.

---

## Roadmap

- Embeddings-based semantic similarity score (bolt onto the existing
  `ConvergenceHeuristic` as a second metric — not replace it)
- Published live-LLM eval (solo vs team vs debate, token cost vs quality)
- Custom persona support via CLI / settings
- Multi-model debates (different provider/model per persona)
- Debate export to markdown / JSON
- Streaming debate output

---

## Credits

**ClashEngine** — the orchestration core is fully owned by ClashCode as of
v1.3. No external agent framework dependencies.

The **Shuru microVM sandbox** is
[superhq-ai/shuru](https://github.com/superhq-ai/shuru) — ephemeral
Linux VMs via Apple's Virtualization.framework with host-secret proxying
on Apple Silicon. MIT-licensed.

---

## License

MIT — see [LICENSE](LICENSE).
