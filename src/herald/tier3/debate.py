"""Tier 3: Multi-Agent Debate (Groq or Gemini).

Three agents — Advocate, Critic, Judge — debate whether output is valid.
3 sequential API calls per case. Only fires for hard cases.
Switch providers via config: provider: "groq" | "gemini"
"""

import json
from herald.core.types import TierResult, Verdict, CheckpointOutput, DebateResult
from herald.core.llm import get_llm_client


ADVOCATE_PROMPT = """You are the ADVOCATE in a validation debate. Argue that the agent's output IS valid and faithful to the source.

Build the strongest case for validity. Consider direct textual support, reasonable inferences, and whether apparent issues are actually consistent. Be rigorous but genuinely advocate.

## Agent Output
{output_text}

## Source Context
{source_context}

## Prior Analysis
Tier 1 NLI: {tier1_scores}
Tier 2 Judge: {tier2_reasoning}

Provide your argument in 2-3 paragraphs."""


CRITIC_PROMPT = """You are the CRITIC in a validation debate. Argue that the agent's output is NOT valid.

Find every issue: unsupported claims, numerical errors, causal overreach, hallucinated details, missing caveats. Be thorough and specific.

## Agent Output
{output_text}

## Source Context
{source_context}

## Prior Analysis
Tier 1 NLI: {tier1_scores}
Tier 2 Judge: {tier2_reasoning}

Provide your argument in 2-3 paragraphs."""


DEBATE_JUDGE_PROMPT = """You are the JUDGE in a validation debate. You've heard the Advocate (argues valid) and Critic (argues invalid).

Weigh both arguments against the SOURCE EVIDENCE — not which argument sounds better.

## Agent Output
{output_text}

## Source Context
{source_context}

## Advocate's Argument
{advocate_argument}

## Critic's Argument
{critic_argument}

You MUST respond with ONLY valid JSON:
{{"reasoning": "your analysis", "verdict": "VALID", "confidence": 0.85, "advocate_strengths": "what they got right", "critic_strengths": "what they got right"}}

verdict must be VALID, INVALID, or UNCERTAIN. Respond with ONLY JSON."""


class MultiAgentDebate:
    """Tier 3: Structured Advocate/Critic/Judge debate."""

    def __init__(self, config: dict):
        self.client = get_llm_client(config)
        self.model = config.get("tier3", {}).get("model", "")

    def debate(
        self,
        checkpoint: CheckpointOutput,
        tier1_result: TierResult,
        tier2_result: TierResult,
        max_retries: int = 3,
        retry_delay: float = 2.0,
    ) -> DebateResult:
        import time
        ctx = {
            "output_text": checkpoint.output_text,
            "source_context": checkpoint.source_context,
            "tier1_scores": json.dumps(tier1_result.raw_scores, indent=2),
            "tier2_reasoning": tier2_result.reasoning,
        }

        for attempt in range(max_retries):
            try:
                advocate = self.client.complete(
                    ADVOCATE_PROMPT.format(**ctx), temperature=0.3
                ).content
                critic = self.client.complete(
                    CRITIC_PROMPT.format(**ctx), temperature=0.3
                ).content
                judge_resp = self.client.complete(
                    DEBATE_JUDGE_PROMPT.format(
                        **ctx,
                        advocate_argument=advocate,
                        critic_argument=critic,
                    ),
                    json_mode=True,
                    temperature=0.1,
                )
                result = json.loads(judge_resp.content)
                return DebateResult(
                    advocate_argument=advocate,
                    critic_argument=critic,
                    judge_verdict=Verdict(result["verdict"].lower()),
                    judge_confidence=float(result["confidence"]),
                    judge_reasoning=result["reasoning"],
                )
            except Exception as e:
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)
                else:
                    raise RuntimeError(f"LLM API failed after {max_retries} attempts: {e}")
