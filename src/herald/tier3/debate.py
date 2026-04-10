"""Tier 3: Multi-Agent Debate (Groq or Gemini).

Three agents — Advocate, Critic, Judge — debate whether output is valid.
3 sequential API calls per case. Only fires for hard cases.
Switch providers via config: provider: "groq" | "gemini"
"""

import json
from herald.core.types import TierResult, Verdict, CheckpointOutput, DebateResult
from herald.core.llm import get_llm_client

ANALYST1_PROMPT = """You are reviewing a claim against its source.
Your focus is two dimensions only: Referential Accuracy and Logical Containment.

Tier 2 flagged this case as ambiguous — use its reasoning to identify 
where to look, not as evidence of a verdict.

## Agent Output
{output_text}

## Source Context
{source_context}

## Prior Analysis
Tier 1 NLI: {tier1_scores}
Tier 2 Judge: {tier2_reasoning}

Evaluate each dimension:

REFERENTIAL ACCURACY (hard constraint)
- Are all numbers, entities, and named things in the claim present in 
  the source and used correctly?
- A single incorrect or fabricated detail is a FAIL.

LOGICAL CONTAINMENT
- Is the claim a valid projection of the source?
- It may omit detail but must not add scope, add causation, or remove 
  qualifiers that change meaning.
- A claim that asserts more than the source licenses is a FAIL.

For each dimension report:
- Verdict: PASS / FAIL / UNCERTAIN
- Evidence: exact text from claim, exact text from source, one sentence 
  describing the match or conflict

Respond with ONLY valid JSON:
{{
  "referential_accuracy": {{
    "verdict": "PASS|FAIL|UNCERTAIN",
    "claim_span": "exact text from claim or null",
    "source_span": "exact text from source or null",
    "conflict": "one sentence or null"
  }},
  "logical_containment": {{
    "verdict": "PASS|FAIL|UNCERTAIN",
    "claim_span": "exact text from claim or null",
    "source_span": "exact text from source or null",
    "conflict": "one sentence or null"
  }}
}}"""

ANALYST2_PROMPT = """You are reviewing a claim against its source.
Your focus is two dimensions only: Qualifier Preservation and Scope Preservation.

Tier 2 flagged this case as ambiguous — use its reasoning to identify 
where to look, not as evidence of a verdict.

## Analyst 1 Findings (Referential Accuracy + Logical Containment)
{analyst1_findings}

## Agent Output
{output_text}

## Source Context
{source_context}

## Prior Analysis
Tier 1 NLI: {tier1_scores}
Tier 2 Judge: {tier2_reasoning}

Evaluate each dimension:

QUALIFIER PRESERVATION
- Does the claim preserve the epistemic register of the source?
- A qualifier is meaning-critical if its removal would change the 
  certainty, conditionality, or directionality of the claim as 
  understood by a non-expert reader.
- Dropping minor detail is acceptable. Removing meaning-critical 
  qualifiers is a FAIL.
- Examples of violations: "may reduce" → "reduces", 
  "associated with" → "causes", "in some cases" → omitted.

SCOPE PRESERVATION
- Does the claim stay within the population, geography, timeframe, 
  and conditions stated in the source?
- Silent generalization beyond the source is a FAIL.

If your findings contradict Analyst 1's, say so explicitly in the 
conflict field.

For each dimension report:
- Verdict: PASS / FAIL / UNCERTAIN
- Evidence: exact text from claim, exact text from source, one sentence 
  describing the match or conflict

Respond with ONLY valid JSON:
{{
  "qualifier_preservation": {{
    "verdict": "PASS|FAIL|UNCERTAIN",
    "claim_span": "exact text from claim or null",
    "source_span": "exact text from source or null",
    "conflict": "one sentence or null"
  }},
  "scope_preservation": {{
    "verdict": "PASS|FAIL|UNCERTAIN",
    "claim_span": "exact text from claim or null",
    "source_span": "exact text from source or null",
    "conflict": "one sentence or null"
  }}
}}"""



JUDGE_PROMPT = """You are the Judge in a structured claim validation review.
Two analysts have each examined two dimensions of this claim against its source.
Your job is to aggregate their findings into a final verdict using the rules below.

## Agent Output
{output_text}

## Source Context
{source_context}

## Analyst 1 Findings (Referential Accuracy + Logical Containment)
{analyst1_findings}

## Analyst 2 Findings (Qualifier Preservation + Scope Preservation)
{analyst2_findings}

Aggregation rules (apply in order):
1. If ANY dimension is FAIL with specific source evidence → INVALID
2. If ALL dimensions are PASS with specific source evidence → VALID
3. If any dimension is UNCERTAIN and none are FAIL → UNCERTAIN

A violation is material if it would lead a reasonable reader to draw 
a stronger, broader, or more certain conclusion than the source supports.
Do not return INVALID unless a specific claim span and source span 
demonstrate the violation.

Respond with ONLY valid JSON:
{{
  "dimension_verdicts": {{
    "referential_accuracy": "PASS|FAIL|UNCERTAIN",
    "logical_containment": "PASS|FAIL|UNCERTAIN",
    "qualifier_preservation": "PASS|FAIL|UNCERTAIN",
    "scope_preservation": "PASS|FAIL|UNCERTAIN"
  }},
  "verdict": "VALID|INVALID|UNCERTAIN",
  "confidence": 0.0-1.0,
  "reasoning": "which dimension decided this and why",
  "key_issues": [],
  "evidence": {{
    "claim_span": "exact text from claim or null",
    "source_span": "exact text from source or null",
    "conflict": "one sentence describing the mismatch or null"
  }}
}}"""

""" *********"""

class MultiAgentDebate:
    """Tier 3: Structured dimension-scoped review with sequential analysts."""

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
                # Analyst 1: Referential Accuracy + Logical Containment
                analyst1_resp = self.client.complete(
                    ANALYST1_PROMPT.format(**ctx),
                    temperature=0.1,
                    json_mode=True,
                )
                analyst1_findings = analyst1_resp.content

                # Analyst 2: Qualifier + Scope, sees Analyst 1's findings
                analyst2_resp = self.client.complete(
                    ANALYST2_PROMPT.format(
                        **ctx,
                        analyst1_findings=analyst1_findings,
                    ),
                    temperature=0.1,
                    json_mode=True,
                )
                analyst2_findings = analyst2_resp.content

                # Judge: aggregates both with explicit rules
                judge_resp = self.client.complete(
                    JUDGE_PROMPT.format(
                        **ctx,
                        analyst1_findings=analyst1_findings,
                        analyst2_findings=analyst2_findings,
                    ),
                    json_mode=True,
                    temperature=0.1,
                )

                result = json.loads(judge_resp.content)

                return DebateResult(
                    analyst1_argument=analyst1_findings,
                    analyst2_argument=analyst2_findings,
                    judge_verdict=Verdict(result["verdict"].lower()),
                    judge_confidence=float(result["confidence"]),
                    judge_reasoning=result["reasoning"],
                    dimension_verdicts=result["dimension_verdicts"],
                    key_issues=result.get("key_issues", []),
                    evidence=result.get("evidence", {}),
                )

            except Exception as e:
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)
                else:
                    raise RuntimeError(
                        f"Tier 3 failed after {max_retries} attempts: {e}"
                    )
                


