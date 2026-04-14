"""Tier 2: Single LLM Judge (Groq, Gemini, or OpenAI).

Uses the provider abstraction in core.llm — switch providers via config.
Receives cases Tier 1 couldn't resolve with confidence.
"""

import json
import math

from herald.core.llm import get_llm_client
from herald.core.types import CheckpointOutput, TierResult, Verdict

JUDGE_SYSTEM = """You are a strict validation judge for policy research outputs. \
Your job is to catch errors, hallucinations, and unsupported claims — not to confirm them.

You will receive:
- The agent's output (claim to validate)
- The source context (the ONLY ground truth — do not use outside knowledge)
- Tier 1 NLI scores (context on where the model was uncertain)

Verdict rules (apply in order):
1. INVALID  — if the output contains ANY wrong number, fabricated statistic, detail \
not present in the source, or causal claim the source does not make. One error = INVALID.
2. UNCERTAIN — if the output is a plausible inference from the source but goes beyond \
what is explicitly stated. Defensible but not directly entailed.
3. VALID    — only if every factual claim in the output is directly and explicitly \
supported by the source. No assumptions, no extensions.

Before issuing your verdict, steelman the opposite conclusion:
- If you are leaning VALID, ask: what specific number, date, or claim in the output \
could be wrong? Search the source for disconfirming evidence before deciding.
- If you are leaning INVALID, ask: is the output a reasonable direct inference? \
Does the source actually contradict it, or just not state it explicitly?

Confidence rules:
- Use the FULL range 0.0–1.0. Do not default to 0.8 or 0.9.
- High confidence (>0.90): you can point to specific text that proves your verdict.
- Medium confidence (0.70–0.90): verdict is likely but some ambiguity exists.
- Low confidence (<0.70): escalate — use UNCERTAIN verdict.
- If Tier 1 shows high neutral score (>0.95), the claim likely goes beyond the source → lean UNCERTAIN or INVALID.

You MUST respond with ONLY valid JSON, no other text:
{"reasoning": "cite specific evidence or error", "verdict": "VALID|INVALID|UNCERTAIN", \
"confidence": 0.0-1.0, "key_issues": ["specific issue or empty list"]}"""


JUDGE_TEMPLATE = """## Agent Output
{output_text}

## Source Context
{source_context}

## Tier 1 NLI Scores
{tier1_scores}
{numerical_block}
Check carefully for: wrong numbers, fabricated details, false causality, \
unsupported inferences. Default to INVALID if unsure between VALID and INVALID.
Respond with ONLY valid JSON."""

# Injected into JUDGE_TEMPLATE for numerical and synthesis checkpoint types.
# Forces the model to enumerate and cross-check every specific value before
# issuing a verdict — the step it skips when not explicitly prompted.
_NUMERICAL_VERIFICATION_BLOCK = """
## Numerical Verification Required
Before issuing your verdict, work through these steps explicitly:
1. Extract EVERY number, date, year, percentage, dollar figure, and statistic \
from the Agent Output above.
2. For each one, find the corresponding value in the Source Context.
3. If ANY value does not match exactly — even a single digit or year — verdict \
MUST be INVALID.
Do this before writing your reasoning. A single wrong number = INVALID.
"""


def _calibrate_confidence(confidence: float) -> float:
    """Spread compressed model confidences across the full 0-1 range.

    Small models cluster around 0.80-0.90 regardless of true certainty.
    Applies a sigmoid stretch centered at 0.80 for better escalation routing.
    """
    center, k = 0.80, 8.0
    calibrated = 1.0 / (1.0 + math.exp(-k * (confidence - center)))
    return round(0.7 * calibrated + 0.3 * confidence, 4)


class LLMJudge:
    """Tier 2: Single LLM judge (Groq, Gemini, or OpenAI)."""

    def __init__(self, config: dict):
        self.client = get_llm_client(config, tier=2)
        self.model = self.client.model

    def judge(
        self,
        checkpoint: CheckpointOutput,
        tier1_result: TierResult,
        threshold: float = 0.80,
        max_retries: int = 3,
        retry_delay: float = 2.0,
    ) -> TierResult:
        import time

        # Inject the numerical verification block for types where the model
        # must do explicit value-by-value cross-checking before issuing a verdict.
        numerical_types = {"numerical", "synthesis"}
        numerical_block = (
            _NUMERICAL_VERIFICATION_BLOCK
            if checkpoint.checkpoint_type.value in numerical_types
            else ""
        )
        prompt = JUDGE_TEMPLATE.format(
            output_text=checkpoint.output_text,
            source_context=checkpoint.source_context,
            tier1_scores=json.dumps(tier1_result.raw_scores, indent=2),
            numerical_block=numerical_block,
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
                        "input_tokens": response.input_tokens,
                        "output_tokens": response.output_tokens,
                    },
                )
            except Exception as e:
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)
                else:
                    raise RuntimeError(f"LLM API failed after {max_retries} attempts: {e}") from e
