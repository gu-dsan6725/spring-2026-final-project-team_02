"""Tier 3: Multi-Agent Debate (Groq, Gemini, or OpenAI).

Three agents — Advocate, Critic, Judge — debate whether output is valid.
3 sequential API calls per case. Only fires for hard cases.
Switch providers via config: provider: "groq" | "gemini" | "openai"
"""

import json

from herald.core.llm import get_llm_client
from herald.core.types import CheckpointOutput, DebateResult, TierResult, Verdict

# The advocate and critic receive NO prior verdict — only raw NLI signal and the
# source. Giving them the T2 verdict causes all three agents to anchor on the
# same prior, which means debate inherits T2's errors instead of correcting them.
# The judge receives T2 reasoning as one additional input, but only after forming
# its own view from the two independent arguments.
ADVOCATE_PROMPT = """You are the ADVOCATE in a validation debate. Argue that the agent's output IS valid and faithful to the source.

Build the strongest case for validity. Consider direct textual support, reasonable inferences, and whether apparent issues are actually consistent. Be rigorous but genuinely advocate.

## Agent Output
{output_text}

## Source Context
{source_context}

## Tier 1 NLI Signal
{tier1_scores}

Provide your argument in 2-3 paragraphs. Do not defer to any prior verdict — form your own view from the source."""


CRITIC_PROMPT = """You are the CRITIC in a validation debate. Argue that the agent's output is NOT valid.

Find every issue: unsupported claims, numerical errors, causal overreach, hallucinated details, missing caveats. Be thorough and specific.

## Agent Output
{output_text}

## Source Context
{source_context}

## Tier 1 NLI Signal
{tier1_scores}

Provide your argument in 2-3 paragraphs. Do not defer to any prior verdict — form your own view from the source."""


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

## Prior Tier 2 Analysis (one input among many — do not treat as authoritative)
{tier2_reasoning}

You MUST respond with ONLY valid JSON:
{{"reasoning": "your analysis", "verdict": "VALID", "confidence": 0.85, "advocate_strengths": "what they got right", "critic_strengths": "what they got right"}}

verdict must be VALID, INVALID, or UNCERTAIN. Respond with ONLY JSON."""


class MultiAgentDebate:
    """Tier 3: Structured Advocate/Critic/Judge debate."""

    def __init__(self, config: dict):
        self.client = get_llm_client(config, tier=3)
        self.model = self.client.model

    def debate(
        self,
        checkpoint: CheckpointOutput,
        tier1_result: TierResult,
        tier2_result: TierResult,
        max_retries: int = 3,
        retry_delay: float = 2.0,
    ) -> DebateResult:
        import time

        # Advocate and critic get only the raw source and NLI signal — no T2
        # verdict — so they form independent views. The judge gets T2 reasoning
        # as additional context, but only after weighing both arguments.
        advocate_ctx = {
            "output_text": checkpoint.output_text,
            "source_context": checkpoint.source_context,
            "tier1_scores": json.dumps(tier1_result.raw_scores, indent=2),
        }

        for attempt in range(max_retries):
            try:
                advocate_resp = self.client.complete(
                    ADVOCATE_PROMPT.format(**advocate_ctx), temperature=0.3
                )
                critic_resp = self.client.complete(
                    CRITIC_PROMPT.format(**advocate_ctx), temperature=0.3
                )
                judge_resp = self.client.complete(
                    DEBATE_JUDGE_PROMPT.format(
                        **advocate_ctx,
                        advocate_argument=advocate_resp.content,
                        critic_argument=critic_resp.content,
                        tier2_reasoning=tier2_result.reasoning,
                    ),
                    json_mode=True,
                    temperature=0.1,
                )
                result = json.loads(judge_resp.content)
                total_in = advocate_resp.input_tokens + critic_resp.input_tokens + judge_resp.input_tokens
                total_out = advocate_resp.output_tokens + critic_resp.output_tokens + judge_resp.output_tokens
                return DebateResult(
                    advocate_argument=advocate_resp.content,
                    critic_argument=critic_resp.content,
                    judge_verdict=Verdict(result["verdict"].lower()),
                    judge_confidence=float(result["confidence"]),
                    judge_reasoning=result["reasoning"],
                    input_tokens=total_in,
                    output_tokens=total_out,
                )
            except Exception as e:
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)
                else:
                    raise RuntimeError(f"LLM API failed after {max_retries} attempts: {e}") from e
