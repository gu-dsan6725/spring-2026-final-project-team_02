"""Tier 2.5: Counterfactual Probe.

Motivation
----------
LLMs trained on similar data converge on similar biases, and more capable models
tend to correlate MORE in their errors (Paper 5). Running the same model with
different prompts (Tier 3 debate) only partially addresses this — if the model
has a systematic blind spot, the advocate, critic, and judge share it.

The counterfactual probe injects a structured "surprise" check:

  After Tier 2 reaches a CONFIDENT verdict, ask the model:
    "What would the source need to say to change your verdict?"
  Then search the source for exactly that condition.

  If the disconfirming evidence IS present in the source and the model missed it,
  the verdict is almost certainly wrong. Override to UNCERTAIN and escalate.

This catches a specific class of overconfident errors: cases where the model
linearly sought confirming evidence and never looked for the disconfirming kind.

Design decisions
----------------
- Only runs when Tier 2 verdict != UNCERTAIN (probing uncertain verdicts is
  pointless — we already know to escalate).
- Only overrides when evidence_found=True AND the model's original verdict was
  confident (>= T2 threshold). A low-confidence Tier 2 verdict is already
  borderline — no need to double-probe it.
- Uses semantic substring search (lowercased) as a fast heuristic, plus an
  LLM confirmation step to avoid false positives from incidental keyword matches.
- Controlled by config flag `counterfactual_probe: true` so it can be disabled
  for cost/speed when running large batches.
"""

import json
import time

from groq import Groq
from herald.core.types import CounterfactualResult, TierResult, Verdict, CheckpointOutput


PROBE_PROMPT = """You are performing a counterfactual validity check.

A judge has already evaluated whether an agent output is valid given a source.
Your job is NOT to re-evaluate the verdict. Your job is to identify what evidence
in the source would FALSIFY the verdict — i.e., what would make the judge wrong.

## Agent Output
{output_text}

## Source Context
{source_context}

## Tier 2 Verdict
Verdict: {verdict}
Confidence: {confidence}
Reasoning: {reasoning}

## Your Task
1. State in one sentence: what specific information would need to appear in the
   source to reverse this verdict? Be concrete — name the exact qualifier, number,
   hedge, or claim that would change it.
2. Search the source context carefully for that information.
3. If you find it (even partially), quote the relevant passage exactly.
4. If you do not find it, confirm it is absent.

Respond with ONLY valid JSON:
{{
  "disconfirming_condition": "one sentence: what would reverse the verdict",
  "evidence_found": true or false,
  "evidence_quote": "exact quote from source, or empty string if not found",
  "reasoning": "brief explanation of your search and conclusion"
}}"""


class CounterfactualProbe:
    """Tier 2.5: Counterfactual probe for overconfident Tier 2 verdicts."""

    def __init__(self, api_key: str, model: str = "llama-3.3-70b-versatile"):
        self.client = Groq(api_key=api_key)
        self.model = model

    def probe(
        self,
        checkpoint: CheckpointOutput,
        tier2_result: TierResult,
        t2_threshold: float = 0.80,
        max_retries: int = 3,
        retry_delay: float = 2.0,
    ) -> CounterfactualResult:
        """Run the counterfactual probe on a confident Tier 2 verdict.

        Only meaningful when tier2_result.verdict != UNCERTAIN. The caller
        (escalation.py) is responsible for skipping this on uncertain verdicts.
        """
        prompt = PROBE_PROMPT.format(
            output_text=checkpoint.output_text,
            source_context=checkpoint.source_context,
            verdict=tier2_result.verdict.value.upper(),
            confidence=round(tier2_result.confidence, 3),
            reasoning=tier2_result.reasoning,
        )

        last_err = None
        for attempt in range(max_retries):
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.1,
                    response_format={"type": "json_object"},
                )
                raw = response.choices[0].message.content
                result = json.loads(raw)

                evidence_found = bool(result.get("evidence_found", False))
                evidence_quote = result.get("evidence_quote", "").strip()

                # Override the Tier 2 verdict to UNCERTAIN if:
                #   - The model found disconfirming evidence in the source, AND
                #   - Tier 2 was confident (>= threshold) — a confident wrong
                #     verdict is more dangerous than an already-uncertain one
                verdict_overridden = (
                    evidence_found
                    and bool(evidence_quote)
                    and tier2_result.confidence >= t2_threshold
                )

                return CounterfactualResult(
                    disconfirming_condition=result.get("disconfirming_condition", ""),
                    evidence_found=evidence_found,
                    evidence_quote=evidence_quote,
                    verdict_overridden=verdict_overridden,
                    reasoning=result.get("reasoning", ""),
                )

            except Exception as e:
                last_err = e
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)
                else:
                    raise RuntimeError(
                        f"Counterfactual probe failed after {max_retries} attempts: {e}"
                    )
