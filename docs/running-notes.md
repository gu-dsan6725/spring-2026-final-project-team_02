Changes suggested from Benchmark run 01

1. NLI backend wasn't running!!!! run with:

```
cd backend
uv run uvicorn policy_memo_agent.api.app:create_app --factory --reload
```

2. **Synthesis prompt — the only critical failure**
   F1 = 0.50, 50% hard error rate on 8 claims. The root cause from your notes is specific: the judge is deferential to the agent's reasoning field instead of independently evaluating the inference.

What to change in src/herald/prompts/judge-system.ts → CRITERIA_SYNTHESIS:

- Add a hard directive: "For claims with derivation: agent_inference, your default posture is skeptical. Do not treat the agent's reasoning field as evidence — it is the claim under evaluation, not support for it."
- Require the judge to explicitly name at least one alternative explanation before it can return valid. If it can't think of one, that's evidence the claim is well-supported; if it can, the claim needs revision.
- Add a population-overlap check as a named criterion: "Do the source populations overlap sufficiently to support the synthesis? A claim combining two studies with different geographies, time periods, or demographic groups requires explicit acknowledgment of that gap."

3. **Normative prompt — addressable with one sentence**
   25% hard error rate. Your diagnosis is correct: the judge passes normative claims sourced from a single institution without applying the consensus test.

What to change in CRITERIA_NORMATIVE criterion 1:
Add an explicit heuristic: "A single NGO, think tank, or non-intergovernmental body does not constitute consensus. If the sole source is one such institution, the claim must be at minimum needs_revision unless the claim itself attributes the view to that specific body (e.g., 'According to the World Bank...' rather than 'Best practice is...')."

This is a one-sentence change that should close most of that 25% gap.

## TIER 1 CALibration

ight now, Tier 1 only handles statistical, comparative, and causal claims in claims.ts (line 43). On the available benchmark runs with Tier 1 active, results/benchmark-2026-04-19.2.json and results/benchmark-2026-04-19.3.json, Tier 1 resolved 12 claims and got 11/12 exactly right:

Tier 1 exact accuracy: 0.917
Tier 1 hard error rate: 0.083
Only observed Tier 1 miss: GT-003
ground truth: needs_revision
predicted: valid
type: causal
derivation: paraphrase
confidence: 0.9987
So the short version is: Tier 1 is doing well overall, but it is overconfident on at least one paraphrase-causal case. That’s the main calibration target.

Ways to make Tier 1 stronger:

Make Tier 1 more selective for causal + paraphrase.

Best practical change: if claim_type === causal and derivation === paraphrase, either raise the Tier 1 exit threshold or force Tier 2 unless the entailment margin is very large.
This specifically guards against “associated with / coincided with” being read as stronger causal language.
Add a margin rule, not just a raw threshold, in tier1-nli.ts (line 1).

Example: require bestEntailment >= threshold and bestEntailment - bestContradiction >= 0.20.
That prevents very high entailment from masking meaningful contradiction/ambiguity.
Use derivation-aware thresholds.

direct_extraction: keep current threshold
paraphrase: slightly stricter
cross_source / agent_inference: Tier 1 should probably not resolve these at all
This is the cleanest way to make “meaning drift” less likely at Tier 1.
Add lexical hedge checks before accepting valid.

If source contains phrases like associated with, coincided with, may, could, is projected, but claim uses stronger wording like caused, will, best practice, then downgrade Tier 1 to uncertain.
This is cheap and especially useful for causal/predictive-style paraphrases.
Log more Tier 1 calibration signals.

For each resolved claim, save:
best_entailment
best_contradiction
entailment_margin
used_canonicalized_hypothesis
claim_type
derivation
Then you can threshold-sweep these offline without rerunning the full LLM stack.
My recommendation is to calibrate in this order:

Add a margin requirement in Tier 1.
Make causal + paraphrase stricter than other Tier 1 cases.
Add a hedge-strength mismatch check.
Re-run the benchmark and inspect only Tier 1-resolved claims.
