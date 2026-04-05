# ClashCode Evaluation

This directory contains the **scorer self-test** — a set of hand-crafted
debate transcripts that verify ClashCode's coherence scorer ranks them
in the expected direction. It is deliberately *not* a live-LLM benchmark.

## What this is

Four hand-written transcripts:

- `fixtures/high-coherence.json` — personas converge on a shared
  recommendation with evidence markers. Expected score: ≥ 65.
- `fixtures/low-coherence.json` — personas talk past each other, no
  evidence, no synthesis. Expected score: ≤ 40.
- `fixtures/adversarial-same-vocab.json` — personas use identical
  vocabulary to argue opposite conclusions. **The scorer will score
  this high.** Documented failure mode; see
  `../docs/coherence-scoring.md`.
- `fixtures/evidence-stuffed.json` — a debate salted with evidence
  marker words ("benchmark", "measured", "profiled") but no real
  citations. **The scorer will score Evidence Grounding high.**
  Documented failure mode.

Runs via:

```sh
pnpm test:eval
```

## What this is NOT

- It is **not** a benchmark showing that team-mode or debate-mode
  produces better output than a single model call.
- It is **not** a semantic quality metric. The scorer is a heuristic;
  see `../docs/coherence-scoring.md`.
- It does **not** run live LLMs. Everything here is deterministic
  text processing over fixture files.

## Plugging in a live-LLM eval

If you want to run solo-vs-team-vs-debate on real tasks, the recipe is:

1. Pick a task set (HumanEval, ARC, your own architectural-decision set).
2. Set `XAI_API_KEY` (or equivalent) and run:
   - solo-mode: `orchestrator.runAgent(soloAgent, task)` per task.
   - team-mode: `orchestrator.runTeam(team, task)` per task.
   - debate-mode: `clashEngine.runDebate({topic: task, personas, rounds})`.
3. Score outputs with your own judge (exact match, unit tests,
   LLM-as-judge, human rubric).
4. Compare quality vs token cost.

We have not run this and we do not publish headline numbers we haven't
verified. If you run it, PRs with reproducible scripts are welcome.

## Why publish this at all

Because the alternative — a scorer with no evaluation artifact of any
kind — is worse. The self-test demonstrates:

1. The scorer is deterministic.
2. It ranks obviously-good vs obviously-bad transcripts correctly.
3. We know and document exactly where it fails.

That's a low bar. We think that's fine. The coherence score is a UX
signal, not a research claim.
