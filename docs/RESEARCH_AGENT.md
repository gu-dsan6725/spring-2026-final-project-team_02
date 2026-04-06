# HERALD Research Agent

The HERALD Research Agent adds a self-validating generation pipeline on top of the existing
4-tier evaluation framework. Instead of passively validating pre-existing outputs, the research
agent **generates** outputs for a task and **immediately validates** every one of them against
the source material before returning results.

## Architecture: 4-Phase Pipeline

```
Phase 0 — Task Analysis    Claude (Sonnet) analyzes the query → TaskPlan
Phase 1 — Generate         Claude (Opus) generates structured outputs
Phase 2 — Batch Validate   HERALD tiers validate all outputs per TaskPlan routing
Phase 3 — Handle Escalations  Revise INVALID outputs; surface Tier 4 to human
```

**Key design decisions:**
- Phase 0 uses Claude Sonnet (cheaper) for structural analysis; Phase 1 uses Opus for quality generation.
- Tier 1 NLI is bypassed for `causal` and `epistemic` checkpoint types — NLI cannot evaluate
  causal attribution strength or hedge preservation, so those route directly to Tier 2 (Groq/Llama).
- Groq rate limits are handled with exponential backoff (no crashes on 429).
- INVALID outputs are automatically revised in Phase 3; Tier 4 UNCERTAIN cases are surfaced
  interactively so the human can adjudicate.

---

## Usage

### Entry points

```bash
# Dedicated research agent entry point
uv run herald-research

# Or via the standard agent with --research flag
uv run herald-agent --research

# With custom config or verbose output
uv run herald-research --config configs/default.yaml --verbose
```

### Interactive session

```
HERALD Research Agent — Interactive Mode
Enter a research query to generate and validate outputs.
Then paste or describe your source documents.
Type 'exit' to quit.

Query: Summarize the Fed's 2020 policy response in 5 bullet points

Paste your source documents (press Enter twice when done):
[... paste source here ...]
```

---

## Example 1: Single-output query (empirical)

**Query:** `What was US GDP growth in Q2 2020?`

**Generated TaskPlan:**
```json
{
  "expected_output_count": "single",
  "output_unit": "answer",
  "primary_checkpoint_types": ["numerical", "claim_extraction"],
  "requires_source_mapping": true,
  "task_nature": "empirical",
  "evaluation_mode": "exhaustive",
  "sample_size": null,
  "skip_nli_for": ["causal", "epistemic"],
  "debate_recommended_for": ["causal", "synthesis"],
  "source_type": "single_document",
  "source_chunking": "whole_document"
}
```

**How validation proceeds:**
1. Phase 0 identifies this as `numerical` + `claim_extraction` — both suitable for Tier 1 NLI.
2. Phase 1 generates 1 answer (e.g., "US GDP contracted by 9.0% in Q2 2020 (annualized: -31.4%)").
3. Phase 2 runs Tier 1 NLI against the source; if entailment confidence ≥ 0.70 → VALID at Tier 1.
4. If NLI is uncertain (e.g., source uses different rounding), escalates to Tier 2 (LLM judge).

**Console output:**
```
[Phase 0] Analyzing task structure...
  Task analysis complete.
  Expected outputs: single answer(s)
  Checkpoint types: ['numerical', 'claim_extraction']
  Evaluation mode: exhaustive
  NLI skipped for: ['causal', 'epistemic']

[Phase 1] Generating answer(s)...
  Generated 1 answer(s).

[Phase 2] Validating outputs...
  Validating answer 1/1 [id: a3f2b1c0]...
    → Tier 1: VALID (0.91)

============================================================
Validation Complete
============================================================
Total outputs:     1
Validated:         1
Valid:             1 (100.0%)
Invalid:           0 (0.0%)
Uncertain:         0 (0.0%)
```

---

## Example 2: Multi-output query (5 bullet points)

**Query:** `Summarize the Fed's 2020 policy response in 5 bullet points`

**Generated TaskPlan:**
```json
{
  "expected_output_count": 5,
  "output_unit": "bullet point",
  "primary_checkpoint_types": ["synthesis", "claim_extraction"],
  "requires_source_mapping": true,
  "task_nature": "empirical",
  "evaluation_mode": "exhaustive",
  "sample_size": null,
  "skip_nli_for": ["causal", "epistemic"],
  "debate_recommended_for": ["causal", "synthesis"],
  "source_type": "single_document",
  "source_chunking": "by_section"
}
```

**How validation proceeds:**
1. `synthesis` is in `debate_recommended_for` — Tier 3 debate runs if Tier 2 is uncertain.
2. All 5 bullet points are validated exhaustively (≤ 20 outputs → exhaustive mode).
3. Each bullet's `references_section` metadata tells the batch validator which source section to extract.
4. Any bullet flagged INVALID triggers a Phase 3 revision attempt.

**Console output:**
```
[Phase 0] Analyzing task structure...
  Expected outputs: 5 bullet point(s)
  Checkpoint types: ['synthesis', 'claim_extraction']
  Evaluation mode: exhaustive

[Phase 1] Generating bullet point(s)...
  Generated 5 bullet point(s).

[Phase 2] Validating outputs...
  Validating bullet point 1/5 [id: b1c2d3e4]...
    → Tier 1: VALID (0.84)
  Validating bullet point 2/5 [id: f5a6b7c8]...
    → Tier 1: VALID (0.79)
  Validating bullet point 3/5 [id: d9e0f1a2]...
    → Tier 2: VALID (escalated from Tier 1 uncertain: 0.61)
  Validating bullet point 4/5 [id: b3c4d5e6]...
    → Tier 1: INVALID (0.88)
  Validating bullet point 5/5 [id: f7a8b9c0]...
    → Tier 1: VALID (0.92)

[Phase 3] Handling escalations...
  Attempting revision of 1 invalid output(s)...
  Revised output [b3c4d5e6]: The Fed cut rates to near-zero in March 2020...

Valid: 4 (80.0%) | Invalid: 1 (20.0%) | Uncertain: 0 (0.0%)
```

---

## Example 3: Large batch (100 peer review comments)

**Query:** `Analyze this economics paper and generate 100 peer review comments`

**Generated TaskPlan:**
```json
{
  "expected_output_count": 100,
  "output_unit": "comment",
  "primary_checkpoint_types": ["synthesis", "causal", "epistemic"],
  "requires_source_mapping": true,
  "task_nature": "mixed",
  "evaluation_mode": "sampled",
  "sample_size": 15,
  "skip_nli_for": ["causal", "epistemic"],
  "debate_recommended_for": ["causal", "synthesis"],
  "source_type": "single_document",
  "source_chunking": "per_output"
}
```

**How validation proceeds:**
1. 100 comments → `sampled` evaluation mode (15 comments validated, ~15%).
2. `causal` and `epistemic` comments bypass Tier 1 NLI entirely and start at Tier 2 (Groq).
3. `synthesis` comments run Tier 1; uncertain ones escalate through Tier 2 → optional Tier 3 debate.
4. The Tier 2.5 counterfactual probe runs after any confident Tier 2 verdict to catch overconfidence.
5. Groq rate limits are handled transparently with exponential backoff.

**Console output:**
```
[Phase 0] Analyzing task structure...
  Expected outputs: 100 comment(s)
  Checkpoint types: ['synthesis', 'causal', 'epistemic']
  Evaluation mode: sampled
  Sample size: 15
  NLI skipped for: ['causal', 'epistemic']

[Phase 1] Generating comment(s)...
  Generated 100 comment(s).

[Phase 2] Validating outputs...
  Sampling 15/100 outputs for validation (evaluation_mode=sampled)
  Validating comment 1/15 [id: a1b2c3d4]...
    → Tier 2: VALID (skipped NLI — causal checkpoint)
  Validating comment 2/15 [id: e5f6a7b8]...
    → Tier 1: VALID (0.77)
  ...
  Validating comment 14/15 [id: c9d0e1f2]...
    → Tier 4: UNCERTAIN (needs human review)
  Validating comment 15/15 [id: a3b4c5d6]...
    → Tier 2: INVALID (skipped NLI — epistemic checkpoint)

[Phase 3] Handling escalations...
  1 output(s) require human review (Tier 4).

  --- Human Review Required [result_id: 7f3a2b1c] ---
  Output: The authors' causal identification strategy is flawed because...
  Tier 2 reasoning: The comment overstates the certainty of the causal critique...
  Debate judge: Both advocate and critic raised valid points; insufficient evidence...

  Your verdict [valid/invalid/uncertain/skip]: uncertain
  Recorded: uncertain

Valid: 11 (73.3%) | Invalid: 2 (13.3%) | Uncertain: 2 (13.3%)
```

---

## Using the new tools in herald-agent

The three new tools are also available in the standard `herald-agent` interactive session:

### `analyze_task`

```
You: Analyze this task: summarize a Fed policy document in 3 bullet points

HERALD: [Calls analyze_task with query + source]
        → Returns TaskPlan JSON showing evaluation_mode=exhaustive, checkpoint_types=[synthesis, claim_extraction]
```

### `validate_batch`

```
You: Here are 5 outputs to validate:
     [output1], [output2], ... against [source]

HERALD: [Calls validate_batch with outputs array + source]
        → Returns summary: 4 valid, 1 uncertain (result_id: abc12345)
```

### `generate_and_validate`

```
You: Generate and validate 3 key findings from this paper: [source]

HERALD: [Calls generate_and_validate]
        → Runs Phase 0→1→2, returns validated outputs + summary
```

---

## Configuration reference

```yaml
# configs/default.yaml additions

task_analysis:
  enabled: true
  model: "claude-sonnet-4-20250514"   # Cheaper model for structural analysis

batch_validation:
  max_concurrent_tier1: 50             # NLI concurrency (currently sequential)
  escalation_sample_rate: 1.0          # 1.0 = validate all escalated; <1.0 = sample
  tier1_confidence_threshold: 0.70     # Override global T1 threshold for batch mode

checkpoint_routing:
  skip_nli: ["causal", "epistemic"]    # These go straight to Tier 2
  prefer_debate: ["causal", "synthesis"]  # Tier 3 debate adds value here
  nli_sufficient: ["retrieval", "claim_extraction", "numerical"]  # NLI alone OK
```

## Disabling Tier 2.5 for large batches

The Tier 2.5 counterfactual probe adds one extra Groq call per confident Tier 2 verdict.
For large batches (100+ outputs) on Groq's free tier, you may want to disable it to
stay within rate limits:

```yaml
counterfactual_probe:
  enabled: false
```

Re-enable it for smaller batches or when running targeted validation where overconfidence
is a concern (causal claims especially benefit from the probe).
