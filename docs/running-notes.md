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
