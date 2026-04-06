"""HERALD tools exposed to the Claude agent.

Three tools:
  validate_checkpoint    — runs the full 4-tier escalation pipeline
  explain_verdict        — unpacks a prior result in plain language
  request_human_review   — interactively asks the human to adjudicate,
                           replacing the passive save_packet() dead-end
"""

import json
import uuid
from dataclasses import dataclass
from typing import Optional

from herald.core.types import (
    CheckpointOutput,
    CheckpointType,
    EscalationPacket,
    Verdict,
)
from herald.pipeline.escalation import HeraldPipeline


# ── In-memory store so the agent can reference prior results by ID ──────────
_packet_store: dict[str, EscalationPacket] = {}


def store_packet(packet: EscalationPacket) -> str:
    """Persist a packet in the session store and return its ID."""
    pid = str(uuid.uuid4())[:8]
    _packet_store[pid] = packet
    return pid


def get_packet(pid: str) -> Optional[EscalationPacket]:
    return _packet_store.get(pid)


# ── Tool schemas (passed to Claude as tool definitions) ──────────────────────

TOOL_DEFINITIONS = [
    {
        "name": "validate_checkpoint",
        "description": (
            "Run the full HERALD 4-tier validation pipeline on a single agent output. "
            "Returns the verdict (VALID, INVALID, or UNCERTAIN), which tier resolved it, "
            "a confidence score, and reasoning. Use this whenever the user submits an "
            "output to validate, or when you need to check a claim against its source."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "output_text": {
                    "type": "string",
                    "description": "The agent's output text to validate.",
                },
                "source_context": {
                    "type": "string",
                    "description": "The source material the output should be grounded in.",
                },
                "checkpoint_type": {
                    "type": "string",
                    "enum": [
                        "retrieval",
                        "claim_extraction",
                        "synthesis",
                        "numerical",
                        "causal",
                        "epistemic",
                    ],
                    "description": (
                        "The type of checkpoint being validated. "
                        "retrieval=document relevance, "
                        "claim_extraction=faithful fact extraction, "
                        "synthesis=multi-claim summary, "
                        "numerical=numeric accuracy, "
                        "causal=causal attribution strength, "
                        "epistemic=confidence calibration (does the output preserve "
                        "hedges and uncertainty present in the source?)."
                    ),
                },
                "query": {
                    "type": "string",
                    "description": "Optional: the original research question that produced this output.",
                },
            },
            "required": ["output_text", "source_context", "checkpoint_type"],
        },
    },
    {
        "name": "explain_verdict",
        "description": (
            "Retrieve and explain a prior validation result in plain language. "
            "Returns a detailed breakdown of what each tier found, including "
            "NLI scores, LLM judge reasoning, and debate arguments if Tier 3 ran. "
            "Use this when the user asks 'why was this flagged?' or wants to "
            "understand a verdict in more depth."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "result_id": {
                    "type": "string",
                    "description": "The result ID returned by a prior validate_checkpoint call.",
                },
            },
            "required": ["result_id"],
        },
    },
    {
        "name": "request_human_review",
        "description": (
            "Ask the human reviewer to adjudicate a case that automated tiers could not resolve. "
            "Presents all prior tier evidence and asks a focused yes/no/uncertain question. "
            "Records the human's verdict so it feeds back into the session. "
            "Use this when validate_checkpoint returns UNCERTAIN at Tier 4."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "result_id": {
                    "type": "string",
                    "description": "The result ID of the UNCERTAIN case to adjudicate.",
                },
                "human_verdict": {
                    "type": "string",
                    "enum": ["valid", "invalid", "uncertain"],
                    "description": (
                        "The human reviewer's verdict AFTER they have been shown the evidence "
                        "and provided their answer. Leave this out on the first call to present "
                        "the evidence; include it on the follow-up call to record the decision."
                    ),
                },
                "human_reasoning": {
                    "type": "string",
                    "description": "Optional: the human's explanation for their verdict.",
                },
            },
            "required": ["result_id"],
        },
    },
]


# ── Tool execution functions ─────────────────────────────────────────────────

def run_validate_checkpoint(args: dict, pipeline: HeraldPipeline) -> dict:
    """Execute validate_checkpoint tool."""
    checkpoint = CheckpointOutput(
        checkpoint_type=CheckpointType(args["checkpoint_type"]),
        output_text=args["output_text"],
        source_context=args["source_context"],
        query=args.get("query", ""),
    )

    packet = pipeline.validate(checkpoint)
    result_id = store_packet(packet)

    result = {
        "result_id": result_id,
        "verdict": packet.final_verdict.value,
        "resolved_at_tier": packet.resolved_at_tier,
        "checkpoint_type": checkpoint.checkpoint_type.value,
    }

    # Add tier-specific reasoning
    if packet.tier1_result:
        result["tier1"] = {
            "verdict": packet.tier1_result.verdict.value,
            "confidence": round(packet.tier1_result.confidence, 3),
            "reasoning": packet.tier1_result.reasoning,
        }

    if packet.tier2_result:
        result["tier2"] = {
            "verdict": packet.tier2_result.verdict.value,
            "confidence": round(packet.tier2_result.confidence, 3),
            "reasoning": packet.tier2_result.reasoning,
        }

    if packet.tier3_result:
        result["tier3"] = {
            "judge_verdict": packet.tier3_result.judge_verdict.value,
            "judge_confidence": round(packet.tier3_result.judge_confidence, 3),
            "judge_reasoning": packet.tier3_result.judge_reasoning,
        }

    if packet.resolved_at_tier == 4:
        result["note"] = (
            "All automated tiers returned UNCERTAIN. "
            "Use request_human_review to adjudicate this case."
        )

    return result


def run_explain_verdict(args: dict) -> dict:
    """Execute explain_verdict tool."""
    pid = args["result_id"]
    packet = get_packet(pid)

    if packet is None:
        return {"error": f"No result found for ID '{pid}'. Run validate_checkpoint first."}

    explanation: dict = {
        "result_id": pid,
        "final_verdict": packet.final_verdict.value,
        "resolved_at_tier": packet.resolved_at_tier,
        "checkpoint_type": packet.checkpoint.checkpoint_type.value,
        "output_text": packet.checkpoint.output_text,
        "source_context": packet.checkpoint.source_context[:500] + ("..." if len(packet.checkpoint.source_context) > 500 else ""),
        "tier_breakdown": {},
    }

    if packet.tier1_result:
        scores = packet.tier1_result.raw_scores
        explanation["tier_breakdown"]["tier1_nli"] = {
            "verdict": packet.tier1_result.verdict.value,
            "confidence": round(packet.tier1_result.confidence, 3),
            "entailment": round(scores.get("entailment", 0), 3),
            "contradiction": round(scores.get("contradiction", 0), 3),
            "neutral": round(scores.get("neutral", 0), 3),
            "interpretation": (
                "NLI found the output well-supported by the source."
                if packet.tier1_result.verdict == Verdict.VALID
                else "NLI found the output contradicted by or unsupported in the source."
                if packet.tier1_result.verdict == Verdict.INVALID
                else "NLI was uncertain — output was not clearly entailed or contradicted."
            ),
        }

    if packet.tier2_result:
        explanation["tier_breakdown"]["tier2_llm_judge"] = {
            "verdict": packet.tier2_result.verdict.value,
            "confidence": round(packet.tier2_result.confidence, 3),
            "reasoning": packet.tier2_result.reasoning,
            "key_issues": packet.tier2_result.raw_scores.get("key_issues", []),
        }

    if packet.tier3_result:
        explanation["tier_breakdown"]["tier3_debate"] = {
            "judge_verdict": packet.tier3_result.judge_verdict.value,
            "judge_confidence": round(packet.tier3_result.judge_confidence, 3),
            "advocate_argument": packet.tier3_result.advocate_argument,
            "critic_argument": packet.tier3_result.critic_argument,
            "judge_reasoning": packet.tier3_result.judge_reasoning,
        }

    if packet.resolved_at_tier == 4:
        explanation["status"] = (
            "This case reached Tier 4 (human review). "
            "All automated tiers returned UNCERTAIN. "
            "Call request_human_review to adjudicate."
        )

    return explanation


def run_request_human_review(args: dict) -> dict:
    """Execute request_human_review tool."""
    pid = args["result_id"]
    packet = get_packet(pid)

    if packet is None:
        return {"error": f"No result found for ID '{pid}'. Run validate_checkpoint first."}

    # If human_verdict is provided, record it
    if "human_verdict" in args:
        verdict_str = args["human_verdict"]
        reasoning = args.get("human_reasoning", "")
        packet.final_verdict = Verdict(verdict_str)
        packet.checkpoint.metadata["human_verdict"] = verdict_str
        packet.checkpoint.metadata["human_reasoning"] = reasoning
        return {
            "status": "recorded",
            "result_id": pid,
            "human_verdict": verdict_str,
            "human_reasoning": reasoning,
            "message": f"Human verdict '{verdict_str}' recorded for case {pid}.",
        }

    # Otherwise, present the evidence for the human to review
    t3 = packet.tier3_result
    t2 = packet.tier2_result

    lean = "no clear lean"
    if t3:
        lean = f"debate judge leaned '{t3.judge_verdict.value}' (confidence {t3.judge_confidence:.2f})"
    elif t2:
        lean = f"LLM judge returned '{t2.verdict.value}' with low confidence ({t2.confidence:.2f})"

    review_packet = {
        "status": "awaiting_human_verdict",
        "result_id": pid,
        "question": (
            f"Automated analysis could not resolve this case ({lean}). "
            "Please review the evidence below and provide your verdict."
        ),
        "checkpoint_type": packet.checkpoint.checkpoint_type.value,
        "output_text": packet.checkpoint.output_text,
        "source_context": packet.checkpoint.source_context,
        "automated_evidence": {},
        "instructions": (
            "After reviewing, call request_human_review again with "
            f"result_id='{pid}' and your human_verdict ('valid', 'invalid', or 'uncertain')."
        ),
    }

    if packet.tier1_result:
        review_packet["automated_evidence"]["tier1_nli"] = packet.tier1_result.reasoning

    if packet.tier2_result:
        review_packet["automated_evidence"]["tier2_judge_reasoning"] = packet.tier2_result.reasoning

    if t3:
        review_packet["automated_evidence"]["tier3_advocate"] = t3.advocate_argument
        review_packet["automated_evidence"]["tier3_critic"] = t3.critic_argument
        review_packet["automated_evidence"]["tier3_judge"] = t3.judge_reasoning

    return review_packet


# ── Dispatcher ───────────────────────────────────────────────────────────────

def execute_tool(tool_name: str, tool_input: dict, pipeline: HeraldPipeline) -> str:
    """Route a tool call to the right function and return JSON string result."""
    if tool_name == "validate_checkpoint":
        result = run_validate_checkpoint(tool_input, pipeline)
    elif tool_name == "explain_verdict":
        result = run_explain_verdict(tool_input)
    elif tool_name == "request_human_review":
        result = run_request_human_review(tool_input)
    else:
        result = {"error": f"Unknown tool: {tool_name}"}

    return json.dumps(result, indent=2)
