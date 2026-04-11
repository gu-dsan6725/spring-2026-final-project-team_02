# Review Tier Prompts

Review and improve the prompts used in HERALD's LLM tiers (Tier 2 judge, Tier 3 debate).

Arguments: $ARGUMENTS (optional: "tier2", "tier3", or empty for both)

Steps:
1. Read the relevant source files:
   - Tier 2: `src/herald/tier2/judge.py` — `JUDGE_SYSTEM` and `JUDGE_TEMPLATE`
   - Tier 3: `src/herald/tier3/debate.py` — `ADVOCATE_PROMPT`, `CRITIC_PROMPT`, `DEBATE_JUDGE_PROMPT`
2. Read `docs/validity_definitions.md` to check alignment with ground-truth label definitions
3. Evaluate each prompt for:
   - Clarity of verdict criteria (VALID / INVALID / UNCERTAIN)
   - Confidence calibration guidance
   - Whether the JSON output schema is unambiguous
   - Consistency with the validity definitions
4. Propose specific improvements as diffs, explaining the reasoning for each change
5. Do NOT change the prompt unless the user confirms

Always start a fresh session before editing prompts — do not reuse the context that ran the pipeline.
