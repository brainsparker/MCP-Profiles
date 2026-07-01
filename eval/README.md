# Evaluation harness

Ablation-controlled evaluation of `you-aware`'s retrieval mechanics: does compiling harness context into the query measurably beat passing the natural-language question through?

## Arms

All arms run through the same Search API — the variable is query formulation and parameter use, not the index:

1. **control** — natural-language query passthrough, no parameters
2. **compiled** — MCP-compiled lexical query (`operators` mode: vocabulary injection, ledger exclusions, `-site:` negations, date operators) plus client-side rank adjustment
3. **compiled+decomposition** — arm 2, plus sub-queries for tasks the multi-hop detector flags. In production the harness's frontier model authors sub-queries; the gold set carries reference sub-queries (`subqueries`) so the ablation is reproducible without a model in the loop.

## Metrics

- **UDCG@K** — uniform-weight gain, the primary gate. Agents consume all K results, so position-discounted metrics mis-measure the workload. Normalized to [0,1] against the ideal ordering. Ship gate: **≥ 0.05 lift** over control.
- **nDCG@10** — reported alongside for continuity, not as a gate.
- **Citation precision@10 / recall@10** — against each task's reference citations. Gate: **≥ 10% absolute lift**.
- **Calls-per-task-completion** — measurable reduction on session-shaped tasks.
- **Near-duplicate query rate** — reduction vs. the ~32%-of-sessions external baseline (CMU DRGym) in compilation arms.

LLM-judge result-set usefulness is out of scope for this runner (it needs a separately calibrated judge).

## Gold set

**Composition requirement:** 200–300 technical-research tasks, *session-shaped* (multi-call), with the query distribution validated against agent-shape markers (operator density, query length) rather than single natural-language questions. Validating against a human-shaped workload would mis-measure the product.

Format: JSONL, one task per line — see [`goldset.sample.jsonl`](./goldset.sample.jsonl) for the shape:

```jsonc
{
  "id": "task-001",
  "queries": ["...", "..."],                  // the session's calls, in order
  "subqueries": { "<multi-hop query>": ["...", "..."] },  // reference decompositions
  "reference_citations": ["react.dev/reference/react/useTransition", "..."],
  "context": {
    "trusted_sources": ["react.dev"],
    "blocked_sources": ["w3schools.com"],
    "project_context": "TypeScript app ...",
    "freshness": "stable",
    "decisions": ["Rejected moment.js in favor of date-fns."]
  }
}
```

The sample file demonstrates the format; the real 200–300-task gold set is built with the substrate eval framework workstream (annotation-sampling / LLM-judge calibration), so the gold set and judge calibration do double duty for the PRD gate and the substrate eval buildout.

## Running

```bash
YDC_API_KEY=… npm run eval -- --goldset eval/goldset.sample.jsonl --arm all --k 10
```

Output is a JSON array of per-arm aggregates on stdout. Thresholds are pre-blessed by the Search API roadmap owner before ship; below threshold, the parameters do not ship as native API surface in their current form.
