# HERALD Benchmark Session Start Prompt

> This file is the prompt you paste at the start of a new Claude session to resume
> calibration work. Current state is always the **last entry in `changelog.md`** — do
> not maintain a duplicate summary here.

---

I am continuing HERALD benchmark calibration work on the policy memo agent project.
Please read the following files before we begin:

1. `CLAUDE.md` — full architecture, claim taxonomy, HERALD tier routing table, and
   coding conventions. Pay particular attention to the HERALD Evaluation Framework section
   and the Benchmark Logging protocol.

2. `docs/benchmark-notes/changelog.md` — the complete history of every benchmark run,
   what was changed before each run, what the results revealed, and which claims are still
   failing. **The last entry is the canonical current state — treat it as your starting
   point.**

3. `docs/benchmark-notes/benchmark05.md` — detailed analysis of Run 12, the most recent
   run, including per-claim diagnosis and the Run 13 action plan.

The benchmark command is:

```bash
npx tsx --env-file=.env scripts/run-herald-benchmark.ts --concurrency 1
```

Results are written to `results/` with timestamp-based filenames.

---

## TypeScript files that matter for the benchmark

- `src/herald/prompts/judge-system.ts` — per-claim-type evaluation criteria for Tier 2
- `src/herald/prompts/judge-synthesis.ts` — Judge synthesis instructions for Tier 3
- `src/herald/prompts/domain-expert.ts` — Domain Expert persona
- `src/herald/prompts/methodologist.ts` — Methodologist persona
- `src/herald/prompts/skeptic.ts` — Skeptic persona
- `src/herald/tier2-llm-judge.ts` — Tier 2 orchestration and confidence thresholds
- `src/herald/router.ts` — claim routing and escalation

**DO NOT edit `backend/src/policy_memo_agent/herald/prompts/`** — these are Python files
for the FastAPI server and have no effect on benchmark results. Run 6 in the changelog is
the cautionary tale.

---

## How to evaluate results and diagnose errors

After running the benchmark, compare the new result file against the previous one:

```python
python3 -c "
import json, sys
with open('results/NEW_FILE.json') as f: new = json.load(f)
with open('results/PREV_FILE.json') as f: old = json.load(f)
old_map = {r['claim_id']: r for r in old['per_claim_results']}
new_map = {r['claim_id']: r for r in new['per_claim_results']}
print('=== CHANGED ===')
for cid, nr in new_map.items():
    or_ = old_map[cid]
    if nr['predicted_verdict'] != or_['predicted_verdict'] or nr['tier_reached'] != or_['tier_reached']:
        print(f\"{cid} ({nr['claim_type']}, {nr['derivation']})\")
        print(f\"  verdict: {or_['predicted_verdict']} -> {nr['predicted_verdict']} (GT: {nr['ground_truth_verdict']})\")
        print(f\"  tier: {or_['tier_reached']} -> {nr['tier_reached']}\")
print()
print('=== STILL WRONG ===')
for cid, nr in new_map.items():
    if not nr['correct']:
        print(f\"{cid} ({nr['claim_type']}, {nr['derivation']}) GT={nr['ground_truth_verdict']} pred={nr['predicted_verdict']} tier={nr['tier_reached']} conf={nr['confidence']}\")
"
```

### Three-step diagnostic

1. **Check `tier_reached`** — if a claim exits at Tier 2, the problem is in `judge-system.ts`
   criteria or `tier2-llm-judge.ts` thresholds. If it exits at Tier 3, the problem is in one
   of the persona prompts or `judge-synthesis.ts`.

2. **Check `confidence`** — if wrong claims exit with confidence ≥ 0.9, the model is
   confidently wrong. This is a prompt problem, not a threshold problem. Lowering thresholds
   won't help — you need to change what the model is being told to evaluate.

3. **Check `claim_type` and `derivation` clustering** — errors that cluster by type point to
   the type-specific criteria block in `judge-system.ts` and the persona prompts. Errors that
   cluster by derivation (e.g. all paraphrase wrong) point to the paraphrase-specific
   instructions in `BASE_INSTRUCTIONS` and the persona prompts.

### Synthesis errors

Two distinct failure modes have emerged:

**False invalids (over-flagging):** The model treats "no single source states this conclusion"
as grounds for invalid. The correct standard is logical soundness across combined sources.
Fixes live in `CRITERIA_SYNTHESIS` and the synthesis bullets of all three persona prompts.
These must be consistent — if only the Judge gets the fix, personas can still vote 3-0 invalid.

**False valids (under-flagging):** The model accepts synthesis conclusions that introduce
external factual context not present in any cited source (e.g., "despite national GDP growth"
when no source discusses GDP; "programs are failing" when no source evaluates programs).
The unsourced-premises check in `CRITERIA_SYNTHESIS` criterion 1 partially works — it fixed
GT-036 — but GT-023 and GT-042 remain wrong because the model fills in missing premises
with world knowledge rather than flagging their absence. The criterion-level examples are
being read but not applied. The next fix is structural: require the model to explicitly
list each factual premise and name the cited source that establishes it.

### Paraphrase carve-out propagation (critical pattern)

**A carve-out in `judge-system.ts` (Tier 2) does NOT automatically help claims that
escalate to Tier 3.** The persona prompts (`domain-expert.ts`, `methodologist.ts`,
`skeptic.ts`) must have matching, equally specific carve-outs. Vague general statements
in persona bullets ("evaluate semantic fidelity") are insufficient to override unanimous
3-0 invalid votes — specific examples are required.

Current status by claim (after Run 12):
- GT-008 (normative paraphrase): **FIXED** Run 9
- GT-036 (synthesis agent_inference): **FIXED** Run 10
- GT-030 (causal paraphrase): **FIXED** Run 11 — Tier 1 NLI conf=0.9975
- GT-018 (predictive paraphrase): exits T2 invalid conf=0.85 — all prompt carve-outs exhausted; next: lower paraphrase threshold to 0.75 to force T3
- GT-034 (normative paraphrase): exits T2 invalid conf=0.90 — "at least Y%" carve-out added but no effect; model finding different grounds for invalid; need to read Run 12 reasoning
- GT-023 (synthesis cross_source): exits T2 valid conf=0.9 — STRICT RULE added but no effect; model reads "despite GDP growth" as framing not unsourced premise; next: few-shot example or gpt-4o upgrade
- GT-042 (synthesis cross_source): exits T2 valid conf=0.9 — STRICT RULE added but no effect; model infers program failure from "cited as leading reason"; next: few-shot example or gpt-4o upgrade

---

## Open questions to explore

1. **Asymmetric error penalization** — Run 12: precision=91.7%, recall=91.7%, F1=91.7%.
   Error profile: 2 false invalids (GT-018, GT-034) vs 2 false valids (GT-023, GT-042).
   False valids are higher cost in a policy memo context. Consider tracking F2 score:
   `F2 = 5 * precision * recall / (4 * precision + recall)`.

2. **Prompt saturation confirmed** — Run 12 is a complete null result (0 claims changed).
   All textual approaches for the 4 remaining wrong claims have been exhausted. Next levers
   are structural: (a) lower paraphrase threshold to 0.75 for GT-018, (b) few-shot examples
   for GT-023/GT-042, (c) model upgrade to gpt-4o at Tier 2.

3. **GT-034 confidence escalation pattern** — confidence has climbed run-over-run (0.85 →
   0.90 → 0.90) as each carve-out is added. The model is not constrained by the carve-outs;
   it accepts them for the specific issues they address and finds new grounds for invalid.
   Reading the Run 12 reasoning JSON is needed to diagnose which criterion is currently firing.

3. **Topic-aware evaluation** — `policyTopic` and `memoSummary` are wired through the
   pipeline but the benchmark runner does not pass them yet. Adding `--policy-topic` and
   `--memo-summary` flags is an untested experiment. Try after the paraphrase/synthesis
   regressions are resolved.

4. **Topic-specific Tier 3 personas** — The Domain Expert takes `claim_type` but not
   `policy_topic`. Dynamic persona generation per memo topic is a future experiment.
   See `getDomainExpertPrompt()` in `src/herald/prompts/domain-expert.ts`.

---

After each run, update **both** `docs/benchmark-notes/changelog.md` (full entry per CLAUDE.md
protocol) **and** the "Current state" block at the top of this file.
