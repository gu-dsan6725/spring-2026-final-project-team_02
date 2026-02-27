"""Tier 2: Single LLM Judge via Groq.

Uses Groq's free API (OpenAI-compatible) with Llama 3.3 70B.
Receives cases Tier 1 couldn't resolve with confidence.
"""

import json
from groq import Groq
from herald.core.types import TierResult, Verdict, CheckpointOutput


JUDGE_SYSTEM = """You are a validation judge. Determine whether an agent's output is faithful to its source context.

You will receive:
- The agent's output (claim to validate)
- The source context (reference material)
- Tier 1 NLI scores (for context)

Instructions:
1. Compare the output against source context carefully
2. Identify specific points of agreement or disagreement
3. Return your verdict as JSON

You MUST respond with ONLY valid JSON in this exact format, no other text:
{"reasoning": "your analysis", "verdict": "VALID", "confidence": 0.85, "key_issues": ["issue 1"]}

verdict must be one of: VALID, INVALID, UNCERTAIN
confidence must be a number between 0.0 and 1.0"""


JUDGE_TEMPLATE = """## Agent Output
{output_text}

## Source Context
{source_context}

## Tier 1 NLI Scores
{tier1_scores}

Analyze whether the agent's output is faithfully supported by the source context.
Respond with ONLY valid JSON."""


class LLMJudge:
    """Tier 2: Single LLM judge via Groq."""

    def __init__(self, api_key: str, model: str = "llama-3.3-70b-versatile"):
        self.client = Groq(api_key=api_key)
        self.model = model

    def judge(
        self,
        checkpoint: CheckpointOutput,
        tier1_result: TierResult,
        threshold: float = 0.80,
        max_retries: int = 3,
        retry_delay: float = 2.0,
    ) -> TierResult:
        """Run LLM judge on escalated case, with retry logic for API errors."""
        import time
        user_msg = JUDGE_TEMPLATE.format(
            output_text=checkpoint.output_text,
            source_context=checkpoint.source_context,
            tier1_scores=json.dumps(tier1_result.raw_scores, indent=2),
        )
        last_err = None
        for attempt in range(max_retries):
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": JUDGE_SYSTEM},
                        {"role": "user", "content": user_msg},
                    ],
                    temperature=0.1,
                    response_format={"type": "json_object"},
                )
                raw = response.choices[0].message.content
                result = json.loads(raw)
                verdict = Verdict(result["verdict"].lower())
                confidence = float(result["confidence"])
                if verdict != Verdict.UNCERTAIN and confidence < threshold:
                    verdict = Verdict.UNCERTAIN
                return TierResult(
                    tier=2,
                    verdict=verdict,
                    confidence=confidence,
                    reasoning=result["reasoning"],
                    raw_scores={
                        "verdict": result["verdict"],
                        "confidence": confidence,
                        "key_issues": result.get("key_issues", []),
                    },
                )
            except Exception as e:
                last_err = e
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)
                else:
                    raise RuntimeError(f"Groq API failed after {max_retries} attempts: {e}")
