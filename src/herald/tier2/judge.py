"""Tier 2: Single LLM Judge (Groq or Gemini).

Uses the provider abstraction in core.llm — switch providers via config.
Receives cases Tier 1 couldn't resolve with confidence.
"""

import json
import math
from herald.core.types import TierResult, Verdict, CheckpointOutput
from herald.core.llm import get_llm_client


JUDGE_SYSTEM = """You are a strict validation judge for policy research outputs. \
Your taks is to determine whether the agent's output is a faithful, non-expansive representation of the source.\
Your job is to catch errors, hallucinations, and unsupported claims — not to confirm them.

You will receive:
- The agent's output (claim to validate)
- The source context (the ONLY ground truth — do not use outside knowledge)
- Tier 1 NLI scores (context on where the model was uncertain)
Core Principle:
A VALID claim is a meaning-preserving compression of the source. \
It may omit detail, but must not add, strengthen, or distort what the source supports.

You must evaluate the claim across FOUR dimensions:

1. Referential Accuracy (HARD CONSTRAINT)
- Are all numbers, entities, and factual details present in the source and used correctly?
- Any incorrect or fabricated detail is a HARD FAIL.

2. Relationship Strength
- Does the claim strengthen the relationship beyond the source?
  (e.g., "associated with" → "causes", "may" → "does")
- Strengthening is a violation.

3. Scope Preservation
- Does the claim expand population, geography, timeframe, or conditions beyond the source?
- The claim must not generalize beyond what is stated.

4. Qualifier Preservation
- Does the claim remove or weaken uncertainty, hedging, or limitations from the source?
- A qualifier is meaning-critical it its removal would change the population, certainty directionality, or conditionality of the claim as understood by a non-expert reader.
- Dropping minor detail is acceptable; removing meaning-critical qualifiers is a violation.

Verdict rules (apply in order):
1. VALID - if:
- the output is a faithful, non-expansive representation of the source
- all FOUR dimensions are satisfied:
    -no referential errors
    -no strengthening or relationships
    -no expansion of scope
    -no removal of meaning-critical qualifiers
-any differences are minor, non-material compression
2. INVALID - if:
-ANY referential error exists (wrong number, fabricated detail), OR
-there is a clear MATERIAL violation of:
    - relationship strength (e.g., association - causation)
    - scope (generalization beyond the source)
    - qualifiers (removal of uncertainty that changes meaning)
3. UNCERTAIN - if:
-a potential violation exists, but it is unclear whether it is MATERIAL
-the claim may be a reasonable compression, but you cannot confirm it preserves meaning

A violation is MATERIAL if it would lead a reasonable reader to draw a stronger, broader, \
or more certain conclusion than the source supports.



Confidence rules:
- Use the FULL range 0.0–1.0. Do not default to 0.8 or 0.9.
- High confidence (>0.90): you can point to specific text that supports VALID or clearly demonstrate a MATERIAL violation for INVALID.
- Medium confidence (0.70–0.90): verdict is likely correct but some ambiguity exists.
- Low confidence (<0.70): you are unsure whether a violation is material - use UNCERTAIN verdict.
- If Tier 1 shows high neutral score (>0.95):
    The NLI model found neither entailment nor contradiction.

    This indicates the claim is not directly entailed and may involve compression,
    paraphrasing, or transformation of the source.

    Do NOT treat this as evidence of a violation by itself.

    Instead, examine carefully:
    - scope preservation
    - qualifier preservation
    - relationship strength

    Only assign INVALID if you can identify a MATERIAL violation and clearly explain how the meaning differs from the source.
    Otherwise, consider UNCERTAIN or VALID based on whether meaning is preserved.

You MUST respond with ONLY valid JSON, no other text:
{"reasoning": "cite specific evidence or error", "verdict": "VALID|INVALID|UNCERTAIN", \
"confidence": 0.0-1.0, "key_issues": ["specific issue or empty list"]}"""


JUDGE_TEMPLATE = """## Agent Output
{output_text}

## Source Context
{source_context}

## Tier 1 NLI Scores
{tier1_scores}

Check carefully for: wrong numbers, fabricated details, false causality, \
unsupported inferences. Default to INVALID if unsure between VALID and INVALID.
Respond with ONLY valid JSON."""


def _calibrate_confidence(confidence: float) -> float:
    """Spread compressed model confidences across the full 0-1 range.

    Small models cluster around 0.80-0.90 regardless of true certainty.
    Applies a sigmoid stretch centered at 0.80 for better escalation routing.
    """
    center, k = 0.80, 8.0
    calibrated = 1.0 / (1.0 + math.exp(-k * (confidence - center)))
    return round(0.7 * calibrated + 0.3 * confidence, 4)


class LLMJudge:
    """Tier 2: Single LLM judge (Groq or Gemini)."""

    def __init__(self, config: dict):
        self.client = get_llm_client(config)
        self.model = config.get("tier2", {}).get("model", "")

    def judge(
        self,
        checkpoint: CheckpointOutput,
        tier1_result: TierResult,
        threshold: float = 0.80,
        max_retries: int = 3,
        retry_delay: float = 2.0,
    ) -> TierResult:
        import time
        prompt = JUDGE_TEMPLATE.format(
            output_text=checkpoint.output_text,
            source_context=checkpoint.source_context,
            tier1_scores=json.dumps(tier1_result.raw_scores, indent=2),
        )

        for attempt in range(max_retries):
            try:
                response = self.client.complete(
                    prompt=prompt,
                    system=JUDGE_SYSTEM,
                    json_mode=True,
                    temperature=0.1,
                )
                result = json.loads(response.content)
                verdict = Verdict(result["verdict"].lower())
                raw_confidence = float(result["confidence"])
                confidence = _calibrate_confidence(raw_confidence)
                if verdict != Verdict.UNCERTAIN and confidence < threshold:
                    verdict = Verdict.UNCERTAIN
                return TierResult(
                    tier=2,
                    verdict=verdict,
                    confidence=confidence,
                    reasoning=result["reasoning"],
                    raw_scores={
                        "verdict": result["verdict"],
                        "raw_confidence": raw_confidence,
                        "calibrated_confidence": confidence,
                        "key_issues": result.get("key_issues", []),
                        "provider": response.provider,
                    },
                )
            except Exception as e:
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)
                else:
                    raise RuntimeError(f"LLM API failed after {max_retries} attempts: {e}")
