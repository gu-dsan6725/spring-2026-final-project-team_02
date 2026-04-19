# HERALD Threshold Calibration Plan

_Created: 2026-04-17_

## Context

HERALD uses hardcoded confidence thresholds at each tier to decide when to exit with a verdict vs. escalate to the next tier. These thresholds were set heuristically and have never been validated against labeled ground truth. The `TESTING_STATUS.md` describes a calibration approach: build a labeled eval set, run the pipeline, compute precision/recall, and sweep thresholds. The GitHub workflow (`.github/workflows/herald-benchmark.yml`) already triggers `backend/scripts/run_herald_benchmark.py` — but that script doesn't exist yet.

The current thresholds:

- **Tier 1 NLI exit:** `0.90` (statistical, comparative), `0.85` (causal) → `src/types/claims.ts` `CLAIM_TYPE_CONFIG`
- **Tier 2 exit:** `0.85`, high-priority escalation below `0.60` → `src/herald/tier2-llm-judge.ts:32-35`
- **Tier 3 exit:** `0.80` → `src/herald/tier3-debate.ts:34`

Additionally, `TESTING_STATUS.md` flags the **skeptic persona** as the highest-priority prompt to tune — it over-fires false `invalid` verdicts on well-supported claims.

---

## What Already Exists

- `evaluateClaim(claim: NotesLogEntry): Promise<HeraldResult>` in `src/herald/router.ts:68`
- 5 sample claims in `scripts/run-full-pipeline.ts` (lines 70–203) — used as demo, not ground-truth
- Test fixture helpers `makeEntry()` in `tests/herald/tier2.test.ts` and `tier3.test.ts`
- GitHub Actions workflow in `.github/workflows/herald-benchmark.yml` (triggers Python script)
- Existing tier unit tests in `tests/herald/` (all green)

---

## Implementation Plan

### Step 1 — Build the Ground-Truth Eval Set

**File to create:** `data/eval-set.json`

50 labeled claims covering:

- All 6 claim types (8–9 per type): statistical, causal, comparative, predictive, normative, synthesis
- All 4 derivation methods: direct_extraction, paraphrase, cross_source, agent_inference
- Mix of `valid`, `invalid`, `needs_revision` verdicts
- Edge cases that are known to trip the skeptic (well-supported causal claims, comparative claims with clear methodology)

Schema per entry:

```json
{
  "claim_id": "GT-001",
  "claim_text": "...",
  "claim_type": "statistical",
  "derivation": "direct_extraction",
  "sources": [
    {
      "source_id": "S-001",
      "source_title": "...",
      "source_url": "...",
      "relevant_chunk": "..."
    }
  ],
  "reasoning": "...",
  "ground_truth_verdict": "valid",
  "ground_truth_rationale": "Source directly states this number with matching units and population."
}
```

Claims should be written so the ground truth is unambiguous — this is about calibrating the pipeline, not testing hard judgment calls. See the separate Claude Chat prompt in this document for generating the initial eval set.

---

### Step 2 — Build the TypeScript Benchmark Runner

**File to create:** `scripts/run-herald-benchmark.ts`

Distinct from `scripts/run-full-pipeline.ts` (which is a demo). The benchmark script:

1. Loads `data/eval-set.json`
2. For each claim, calls `evaluateClaim()` (real or dry-run mode)
3. Compares `result.verdict` against `ground_truth_verdict`
4. Computes precision, recall, F1, accuracy — overall and per claim type
5. Writes results to `results/benchmark-YYYY-MM-DD.json`

CLI flags:

- `--eval-set <path>` (default: `data/eval-set.json`)
- `--output <dir>` (default: `results/`)
- `--dry-run` — use mock verdicts, skip API calls
- `--claim-types <types>` — comma-separated filter (e.g., `causal,synthesis`)

---

### Step 3 — Build the Python Threshold Sweep Script

**File to create:** `backend/scripts/run_herald_benchmark.py`
**File to create:** `backend/scripts/__init__.py`

This is what `.github/workflows/herald-benchmark.yml` calls. It:

1. Loads `data/eval-set.json`
2. Runs the NLI service directly (Tier 1) or calls `/api/herald/evaluate` (full pipeline)
3. **Threshold sweep loop**: varies each threshold across a grid:
   - `tier1_threshold`: 0.75 → 0.95 in steps of 0.05
   - `tier2_exit_threshold`: 0.75 → 0.95 in steps of 0.05
   - `tier3_exit_threshold`: 0.70 → 0.90 in steps of 0.05
4. For each threshold combo, runs all eval claims with deterministic mocked LLM responses (so the sweep is cheap)
5. Computes precision/recall/F1 per claim type per combo
6. Identifies the Pareto-optimal threshold set (maximizes F1 while minimizing Tier 4 escalations)
7. Writes sweep results to `results/threshold-sweep-YYYY-MM-DD.json`

Key design: most sweep iterations use **mocked LLM responses** (fixed confidence scores from the baseline real run). Only the baseline uses real API calls. This keeps sweep cost near zero.

---

### Step 4 — Tune the Skeptic Persona Prompt

**File to modify:** `src/herald/prompts/skeptic.ts`

The current prompt is adversarial by design (`getSkepticPrompt`, line 9). The issue: the "active counter-evidence search" section (lines 26–30) asks "Could a reasonable person read this source and reach a different conclusion?" — this triggers false invalids even when the source directly supports the claim.

Fix: add an explicit guardrail after the counter-evidence section:

```
## Important Constraint
If the source chunk provided directly and specifically states what the claim asserts —
same figure, same population, same timeframe, same units — do not raise general
methodological objections. Reserve INVALID for cases where the source genuinely
contradicts or fails to support the specific claim. Vague "this could be wrong"
reasoning is not sufficient to mark a claim invalid.
```

Re-run benchmark after this change to confirm the false-invalid rate drops without losing genuine detection capability.

---

### Step 5 — Add a Summary Printer

**File to create:** `scripts/print-benchmark-summary.ts`

Reads the latest `results/benchmark-*.json` and prints a formatted table to stdout:

- Per-tier accuracy
- Per-claim-type precision/recall
- Recommended threshold adjustments
- False-invalid rate for the skeptic specifically

---

### Step 6 — Python Unit Tests for the Benchmark Module

**File to create:** `backend/tests/test_herald/test_benchmark.py`

- Eval set loads and validates against schema
- Precision/recall computation with synthetic results
- Threshold sweep output structure
- Pareto-optimal threshold selection logic

---

## Files Modified / Created

| File                                          | Action     | Notes                                  |
| --------------------------------------------- | ---------- | -------------------------------------- |
| `data/eval-set.json`                          | **CREATE** | 50 ground-truth labeled claims         |
| `scripts/run-herald-benchmark.ts`             | **CREATE** | TypeScript benchmark runner            |
| `backend/scripts/__init__.py`                 | **CREATE** | Make scripts a Python module           |
| `backend/scripts/run_herald_benchmark.py`     | **CREATE** | Python threshold sweep (called by CI)  |
| `scripts/print-benchmark-summary.ts`          | **CREATE** | Human-readable results printer         |
| `src/herald/prompts/skeptic.ts`               | **MODIFY** | Add false-invalid guardrail (line ~30) |
| `backend/tests/test_herald/test_benchmark.py` | **CREATE** | Python benchmark unit tests            |

---

## Order of Execution

1. Generate eval set with the Claude Chat prompt below → save to `data/eval-set.json`
2. Build and validate TypeScript benchmark runner (dry-run first)
3. Run real baseline to get current precision/recall numbers
4. Build Python threshold sweep, run against mocked confidence scores
5. Tune skeptic prompt, re-run benchmark to verify improvement
6. Add summary printer and Python unit tests

---

## Verification

```bash
# Dry run (no API keys needed)
npx tsx scripts/run-herald-benchmark.ts --dry-run

# Real baseline run (needs ANTHROPIC_API_KEY)
npx tsx scripts/run-herald-benchmark.ts --eval-set data/eval-set.json

# Print latest results
npx tsx scripts/print-benchmark-summary.ts

# Python threshold sweep
cd backend && uv run python -m scripts.run_herald_benchmark --dry-run

# Python unit tests
cd backend && uv run pytest tests/test_herald/test_benchmark.py -v

# Verify skeptic fix (focus on well-supported statistical/comparative claims)
npx tsx scripts/run-herald-benchmark.ts --claim-types statistical,comparative
```

---

## Claude Chat Prompt — Generating the Ground-Truth Eval Set

Use this prompt in Claude.ai (claude.ai/chat) to generate the initial `data/eval-set.json`. Paste the full prompt as-is.

---

````
You are a policy research expert and AI evaluation specialist. I need you to generate a ground-truth evaluation dataset for calibrating an AI claim evaluation pipeline called HERALD. The pipeline evaluates claims in policy memos across 6 claim types.

## Background: The 6 Claim Types

1. **statistical** — A specific number, percentage, rate, or quantitative measure attributed to a named source.
   Example: "Maternal mortality in Chad stands at 1,140 per 100,000 live births (WHO, 2022)."

2. **causal** — Asserts that X causes, drives, contributes to, or leads to Y.
   Example: "Removal of fuel subsidies contributed to a 15% increase in rural transportation costs."

3. **comparative** — Claims something is greater, lesser, faster, or ranked relative to something else.
   Example: "Cash transfer programs showed stronger enrollment effects than fee waiver programs."

4. **predictive** — Forward-looking: what will happen, is projected, or is expected.
   Example: "Urban water demand in the Sahel is projected to exceed supply capacity by 2032."

5. **normative** — Claims about what should be done, what best practice is, what is recommended.
   Example: "Multi-stakeholder governance is considered best practice for transboundary water management."

6. **synthesis** — A novel inference drawn by combining multiple sources, not stated in any single source.
   Example: "Declining enrollment and rising child labor suggest subsidy programs have not reached the most vulnerable."

## Background: Derivation Methods

Each claim also has a derivation method:
- `direct_extraction` — Lifted verbatim or near-verbatim from one source (low risk)
- `paraphrase` — Restated from one source (low risk)
- `cross_source` — Combined from 2+ sources (medium risk)
- `agent_inference` — Agent's own reasoning beyond what sources state (high risk)

## Your Task

Generate a JSON array of exactly 50 policy claim examples for the `data/eval-set.json` file. The claims should be realistic policy memo content about global development topics (health, education, agriculture, water, energy, climate, gender, governance — pick a mix).

### Distribution Requirements

- At least 8 claims per claim type (spread across all 6 types)
- At least 8 claims per derivation method (spread across all 4 methods)
- Verdicts: approximately 25 valid, 15 invalid, 10 needs_revision
- Include 5–8 "skeptic trap" claims: claims that are genuinely well-supported by their source chunk, but which could plausibly be challenged on methodological grounds — these should be labeled `valid` and will be used to test whether the skeptic persona over-fires

### Format

Output a valid JSON array. Each element must match this schema exactly:

```json
{
  "claim_id": "GT-001",
  "claim_text": "A single, atomic factual assertion as it would appear in a policy memo.",
  "claim_type": "statistical | causal | comparative | predictive | normative | synthesis",
  "derivation": "direct_extraction | paraphrase | cross_source | agent_inference",
  "sources": [
    {
      "source_id": "S-001",
      "source_title": "Author(s) (Year) — Title",
      "source_url": "https://realistic-but-not-required-to-be-real.org/path",
      "relevant_chunk": "The exact excerpt from the source that supports (or fails to support) the claim. This should be a realistic 2–4 sentence passage from a policy report, academic paper, or international organization publication."
    }
  ],
  "reasoning": "One sentence explaining how the claim was derived from the source(s).",
  "ground_truth_verdict": "valid | invalid | needs_revision",
  "ground_truth_rationale": "2–3 sentences explaining WHY this is the correct verdict. Be specific: what in the source chunk does or does not support the claim? What qualifier is missing, or what does the source actually say?"
}
````

### Quality Rules

1. **Make source chunks realistic.** Write them as actual excerpts from policy reports, World Bank documents, WHO publications, academic papers, or UN agency reports. They should sound like real source text.

2. **Make invalid claims clearly wrong in a specific way:**
   - Wrong number (source says 23%, claim says 32%)
   - Wrong population (source is about Sub-Saharan Africa, claim says "globally")
   - Wrong direction of causality (source shows correlation, claim asserts causation)
   - Missing qualifier (source says "in urban areas", claim omits that)
   - Overclaiming from a synthesis (conclusion doesn't follow from the premises)

3. **Make needs_revision claims partially supported but missing a key qualifier:**
   - The number is right but the year is omitted
   - The comparison is fair but the confidence interval matters
   - The projection exists but the claim omits the assumed scenario

4. **For synthesis claims**, include 2 sources. The synthesis claim should combine them into a conclusion. For `valid` synthesis claims, the conclusion should follow logically. For `invalid` synthesis claims, there should be a clear logical gap (e.g., combining two different populations into a single conclusion).

5. **Skeptic trap claims** (label with a comment in `ground_truth_rationale`): These are claims that are directly and specifically supported by the source chunk — same figure, same population, same units — but which sound like they could be challenged. Flag them with the phrase "SKEPTIC TRAP:" at the start of the rationale.

### Domain Guidance

Use these policy domains (mix across the 50 claims):

- Sub-Saharan Africa health outcomes (maternal mortality, vaccine coverage, HIV)
- Education and school enrollment (conditional cash transfers, gender parity)
- Agricultural productivity and food security
- Climate and clean energy transition
- Water and sanitation access
- Gender equality and women's economic participation
- Governance and public financial management
- Urban development and infrastructure

Output ONLY the JSON array. No introduction, no explanation, no markdown fences. Start with `[` and end with `]`.

```

```
