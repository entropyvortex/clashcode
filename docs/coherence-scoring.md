# Coherence Scoring — Methodology and Limitations

> **Read this first.** The coherence score is a **heuristic** derived from
> bag-of-words text statistics. It is not a semantic quality metric and
> it can be fooled by design. Use it as a directional UX signal about
> lexical convergence, not as ground truth about whether the personas
> actually agreed.

## What it is

After a debate runs, ClashEngine computes a `CoherenceScore`: five
sub-metrics rolled up into a weighted 0-100 overall score. It's rendered
as a bar chart at the end of `/consensus` output.

| Sub-metric | Weight | What it computes |
|---|---|---|
| `agreementConvergence` | 25% | Pairwise Jaccard similarity of extracted keywords across final-round entries |
| `contradictionResolution` | 15% | Ratio of disagreement markers (early rounds) to acknowledgment markers (late rounds) |
| `evidenceGrounding` | 20% | Density of evidence-marker tokens ("benchmark", "measured", "RFC", numeric citations) minus density of vague-language tokens |
| `proposalSimilarity` | 25% | Overlap of recommendation-bearing sentences across final entries |
| `consensusSpeed` | 15% | How early in the debate agreement vocabulary first appears |

Implementation: `src/consensus/index.ts`, functions prefixed with
`score*`. Each function is pure, deterministic, and unit-tested
against hand-crafted transcripts.

## Why it's a heuristic

Every sub-metric is a text-statistics proxy for something deeper that
would require a semantic model to measure properly:

- **Keyword overlap ≠ agreement.** Two personas arguing opposite sides
  will share vocabulary (`monorepo`, `polyrepo`, `tooling`, `scale`)
  regardless of whether they agree. A debate between "X is clearly
  correct" and "X is clearly wrong" has near-perfect Jaccard overlap.
- **Evidence-marker counting ≠ evidence quality.** Saying "measured"
  or "benchmark" scores the same as citing an actual measurement.
  Hallucinated citations score identically to real ones.
- **Disagreement-marker counting ≠ contradiction.** Personas often use
  hedging language ("however", "on the other hand") for rhetorical
  flow, not because they actually contradict the previous entry.
- **Sentence overlap ≠ shared proposal.** Two different
  recommendations can reuse template phrases ("we recommend X because
  Y") and score high.

## Known failure modes

The scorer self-test (`pnpm test:eval`) verifies the scorer ranks
hand-crafted high-vs-low-coherence transcripts in the expected
direction. It does **not** guard against these failure modes, which
are inherent to bag-of-words approaches:

### 1. Adversarial same-vocabulary disagreement
Two personas using identical terminology to argue opposite conclusions
score high on Agreement Convergence. Example:

> pragmatist: "Kubernetes is clearly the correct choice..."
> devils-advocate: "Kubernetes is clearly the wrong choice..."

**Measured on `eval/fixtures/adversarial-same-vocab.json`**:

| Metric | Score |
|---|---|
| overall | **81/100** |
| agreementConvergence | 100/100 |
| proposalSimilarity | 100/100 |
| evidenceGrounding | 100/100 |

Compare to `eval/fixtures/high-coherence.json` (genuine agreement):
**88/100**. The scorer cannot distinguish opposite-conclusions-with-
identical-vocabulary (81) from genuine agreement (88). A 7-point gap
is not enough signal. Run `pnpm test:eval` to reproduce.

### 2. Evidence-marker stuffing
A persona that salts its output with words like "benchmark",
"measured", "profiled", "RFC", "spec" scores high on Evidence Grounding
whether or not it cites real evidence.

### 3. Template synthesis convergence
If personas converge on "We recommend X because Y, with caveats Z" as
a template phrasing but substitute different X/Y/Z, Proposal Similarity
scores high without actual proposal overlap.

### 4. Short-circuit early-agreement
A persona that says "I agree" in round 1 (perhaps because it
misread the prompt) inflates Consensus Speed even if the rest of the
debate reveals fundamental disagreement.

## When the score *is* useful

Despite the failure modes, the score is informative in the aggregate:

- **Spotting low-quality runs.** Scores below ~40 reliably indicate
  debates that went nowhere — personas talking past each other, no
  structured output, token-burning.
- **Comparing configurations.** Same topic, same personas, different
  models / rounds / prompts → relative scores track approximate
  lexical convergence.
- **Regression testing prompts.** If you tweak a persona's system
  prompt and scores drop 20 points on a fixed topic, something shifted.

## What would make it a real metric

The roadmap item for this is:

1. **Embeddings-based semantic similarity** — replace Jaccard keyword
   overlap with cosine similarity of sentence embeddings from a
   multilingual encoder. Would catch the "same vocabulary, opposite
   meaning" failure.
2. **LLM-as-judge** — feed the final-round entries to a held-out
   model with a rubric. Expensive, non-deterministic, but closer to
   ground truth.
3. **Entailment-based contradiction detection** — run an NLI model
   over pairs of claims. Proper contradiction scoring.

We haven't shipped these yet. When we do, they'll be added as
**additional** sub-metrics alongside the heuristic one, so you can
compare them side-by-side, not replace the existing score silently.

## The short version

If you're using ClashCode to drive real decisions, use the coherence
score the way you'd use a linter's style score: useful for spotting
regressions and comparing runs, not a substitute for reading the
actual output and thinking about whether the personas actually
converged on anything meaningful.

See also: `eval/README.md` for how the scorer self-test works.
