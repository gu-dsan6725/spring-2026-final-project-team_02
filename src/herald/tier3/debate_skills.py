"""Tier 3 Alternative: Skills-based validation.
Single LLM call with four dimension-check tools.
Aggregation is deterministic in Python, not in LLM.
For comparison against multi-agent debate approach.
"""

import json
from herald.core.types import TierResult, Verdict, CheckpointOutput, DebateResult
from herald.core.llm import get_llm_client


SKILLS_SYSTEM_PROMPT = """You are a claim validation analyst.
You have four tools to check a claim against its source.
You MUST call ALL four tools — do not skip any.
Do not draw a conclusion before calling all tools.
Use the source text only — no outside knowledge."""


SKILLS_USER_PROMPT = """Check this claim against its source using all four tools.

## Claim
{output_text}

## Source
{source_context}

## Prior Analysis
Tier 1 NLI: {tier1_scores}
Tier 2 Judge: {tier2_reasoning}

Call all four tools now."""


TOOLS = [
    {
        "name": "check_referential_accuracy",
        "description": (
            "Check whether all numbers, entities, and named things in the claim "
            "appear in the source and are used correctly. "
            "A single fabricated or incorrect detail is a FAIL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "verdict": {
                    "type": "string",
                    "enum": ["PASS", "FAIL", "UNCERTAIN"],
                    "description": "PASS if all referential details are source-faithful, FAIL if any are wrong or fabricated"
                },
                "claim_span": {
                    "type": "string",
                    "description": "Exact text from the claim being checked, or null if no specific span"
                },
                "source_span": {
                    "type": "string",
                    "description": "Exact text from the source that confirms or contradicts, or null"
                },
                "conflict": {
                    "type": "string",
                    "description": "One sentence describing the match or conflict, or null"
                }
            },
            "required": ["verdict", "claim_span", "source_span", "conflict"]
        }
    },
    {
        "name": "check_logical_containment",
        "description": (
            "Check whether the claim is a valid projection of the source. "
            "The claim may omit detail but must not add scope, add causation, "
            "or remove qualifiers that change meaning. "
            "A claim asserting more than the source licenses is a FAIL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "verdict": {
                    "type": "string",
                    "enum": ["PASS", "FAIL", "UNCERTAIN"]
                },
                "claim_span": {"type": "string"},
                "source_span": {"type": "string"},
                "conflict": {"type": "string"}
            },
            "required": ["verdict", "claim_span", "source_span", "conflict"]
        }
    },
    {
        "name": "check_qualifier_preservation",
        "description": (
            "Check whether the claim preserves the epistemic register of the source. "
            "A qualifier is meaning-critical if its removal would change the certainty, "
            "conditionality, or directionality of the claim as understood by a non-expert reader. "
            "Examples of violations: 'may reduce' → 'reduces', "
            "'associated with' → 'causes', 'in some cases' → omitted."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "verdict": {
                    "type": "string",
                    "enum": ["PASS", "FAIL", "UNCERTAIN"]
                },
                "claim_span": {"type": "string"},
                "source_span": {"type": "string"},
                "conflict": {"type": "string"}
            },
            "required": ["verdict", "claim_span", "source_span", "conflict"]
        }
    },
    {
        "name": "check_scope_preservation",
        "description": (
            "Check whether the claim stays within the population, geography, "
            "timeframe, and conditions stated in the source. "
            "Silent generalization beyond the source is a FAIL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "verdict": {
                    "type": "string",
                    "enum": ["PASS", "FAIL", "UNCERTAIN"]
                },
                "claim_span": {"type": "string"},
                "source_span": {"type": "string"},
                "conflict": {"type": "string"}
            },
            "required": ["verdict", "claim_span", "source_span", "conflict"]
        }
    }
]


def _aggregate(dimension_results: dict) -> tuple[Verdict, float, str]:
    """Deterministic aggregation — no LLM involved.
    
    Rules (applied in order):
    1. ANY FAIL with evidence → INVALID
    2. ALL PASS → VALID  
    3. ANY UNCERTAIN, no FAIL → UNCERTAIN
    """
    verdicts = {k: v["verdict"] for k, v in dimension_results.items()}
    
    fails = [k for k, v in verdicts.items() if v == "FAIL"]
    passes = [k for k, v in verdicts.items() if v == "PASS"]
    uncertains = [k for k, v in verdicts.items() if v == "UNCERTAIN"]

    if fails:
        # Find the first failed dimension for evidence
        first_fail = fails[0]
        evidence = dimension_results[first_fail]
        confidence = 0.90 if len(fails) >= 2 else 0.80
        reasoning = f"FAIL on {', '.join(fails)}: {evidence.get('conflict', '')}"
        return Verdict.INVALID, confidence, reasoning

    if len(passes) == 4:
        confidence = 0.92
        reasoning = "All four dimensions PASS with source evidence"
        return Verdict.VALID, confidence, reasoning

    # Some uncertain, no fails
    confidence = 0.65
    reasoning = f"UNCERTAIN on {', '.join(uncertains)}, no hard failures found"
    return Verdict.UNCERTAIN, confidence, reasoning


class SkillsDebate:
    """Tier 3 Alternative: Single LLM call with dimension-check tools.
    
    Comparison target against MultiAgentDebate.
    Same input/output interface as MultiAgentDebate for clean comparison.
    """

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

        prompt = SKILLS_USER_PROMPT.format(
            output_text=checkpoint.output_text,
            source_context=checkpoint.source_context,
            tier1_scores=json.dumps(tier1_result.raw_scores, indent=2),
            tier2_reasoning=tier2_result.reasoning,
        )

        for attempt in range(max_retries):
            try:
                response = self.client.complete_with_tools(
                    prompt=prompt,
                    system=SKILLS_SYSTEM_PROMPT,
                    tools=TOOLS,
                    temperature=0.1,
                )

                # Extract tool call results by name
                dimension_results = {}
                for tool_call in response.tool_calls:
                    dimension_results[tool_call.name.replace("check_", "")] = (
                        tool_call.input
                    )

                # Verify all four dimensions were checked
                required = {
                    "referential_accuracy",
                    "logical_containment", 
                    "qualifier_preservation",
                    "scope_preservation"
                }
                missing = required - set(dimension_results.keys())
                if missing:
                    raise ValueError(f"Model skipped tools: {missing}")

                # Deterministic aggregation — no LLM
                verdict, confidence, reasoning = _aggregate(dimension_results)

                # Find evidence from the deciding dimension
                fails = [k for k, v in dimension_results.items() 
                         if v["verdict"] == "FAIL"]
                evidence_key = fails[0] if fails else list(dimension_results.keys())[0]
                evidence = dimension_results[evidence_key]

                return DebateResult(
                    analyst1_argument=json.dumps({
                        k: v for k, v in dimension_results.items()
                        if k in {"referential_accuracy", "logical_containment"}
                    }),
                    analyst2_argument=json.dumps({
                        k: v for k, v in dimension_results.items()
                        if k in {"qualifier_preservation", "scope_preservation"}
                    }),
                    judge_verdict=verdict,
                    judge_confidence=confidence,
                    judge_reasoning=reasoning,
                    dimension_verdicts={
                        k: v["verdict"] for k, v in dimension_results.items()
                    },
                    key_issues=[
                        dimension_results[f]["conflict"]
                        for f in fails
                        if dimension_results[f].get("conflict")
                    ],
                    evidence={
                        "claim_span": evidence.get("claim_span"),
                        "source_span": evidence.get("source_span"),
                        "conflict": evidence.get("conflict"),
                    },
                )

            except Exception as e:
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)
                else:
                    raise RuntimeError(
                        f"Tier 3 Skills failed after {max_retries} attempts: {e}"
                    )