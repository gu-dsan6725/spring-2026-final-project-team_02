"""HERALD tools exposed to the Claude agent.

Six tools:
  validate_checkpoint    — runs the full 4-tier escalation pipeline
  explain_verdict        — unpacks a prior result in plain language
  request_human_review   — interactively asks the human to adjudicate,
                           replacing the passive save_packet() dead-end
  analyze_task           — Phase 0: analyze a query and return a TaskPlan
  validate_batch         — Phase 2: batch-validate multiple outputs, return summary
  generate_and_validate  — full pipeline: generate outputs for a task, validate, return results
"""

import json
import uuid

import anthropic

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


def get_packet(pid: str) -> EscalationPacket | None:
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
    {
        "name": "analyze_task",
        "description": (
            "Phase 0: Analyze a research task and return a TaskPlan as JSON. "
            "The TaskPlan describes how many outputs to expect, which checkpoint types apply, "
            "whether to use exhaustive or sampled validation, which checkpoint types should skip "
            "Tier 1 NLI, and how to chunk source documents. "
            "Use this before validate_batch or generate_and_validate to understand the task structure."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The user's research query or task description.",
                },
                "source_documents": {
                    "type": "string",
                    "description": "The source material to ground outputs in.",
                },
            },
            "required": ["query", "source_documents"],
        },
    },
    {
        "name": "validate_batch",
        "description": (
            "Phase 2: Batch-validate multiple outputs against source documents. "
            "Takes a list of outputs (as JSON array) and runs them through the HERALD pipeline, "
            "routing each output to the appropriate tiers per the TaskPlan. "
            "Returns aggregate statistics: how many were valid/invalid/uncertain, "
            "which tiers resolved them, and which need human review. "
            "Use this after generate_and_validate or after generating outputs manually."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "outputs": {
                    "type": "array",
                    "description": (
                        "List of output objects to validate. Each must have: "
                        "'text' (string), 'output_type' (string), "
                        "'suggested_checkpoint_type' (optional string enum: "
                        "retrieval|claim_extraction|synthesis|numerical|causal|epistemic)."
                    ),
                    "items": {
                        "type": "object",
                        "properties": {
                            "text": {"type": "string"},
                            "output_type": {"type": "string"},
                            "references_section": {"type": "string"},
                            "suggested_checkpoint_type": {
                                "type": "string",
                                "enum": [
                                    "retrieval",
                                    "claim_extraction",
                                    "synthesis",
                                    "numerical",
                                    "causal",
                                    "epistemic",
                                ],
                            },
                        },
                        "required": ["text", "output_type"],
                    },
                },
                "source_documents": {
                    "type": "string",
                    "description": "The source material all outputs should be grounded in.",
                },
                "task_plan": {
                    "type": "object",
                    "description": (
                        "Optional: a TaskPlan JSON from analyze_task. If omitted, "
                        "defaults are used (exhaustive evaluation, claim_extraction checkpoint)."
                    ),
                },
            },
            "required": ["outputs", "source_documents"],
        },
    },
    {
        "name": "generate_and_validate",
        "description": (
            "Full pipeline: analyze the task, generate outputs, validate them, and return results. "
            "Runs Phase 0 (task analysis) → Phase 1 (generation) → Phase 2 (batch validation). "
            "Returns validated outputs with result_ids, aggregate statistics, and any "
            "outputs requiring human review. "
            "Use this for end-to-end research tasks where you want HERALD to both generate "
            "and validate the outputs in one step."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The research query or task to execute.",
                },
                "source_documents": {
                    "type": "string",
                    "description": "The source material to ground outputs in.",
                },
            },
            "required": ["query", "source_documents"],
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
        "source_context": packet.checkpoint.source_context[:500]
        + ("..." if len(packet.checkpoint.source_context) > 500 else ""),
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
        lean = (
            f"debate judge leaned '{t3.judge_verdict.value}' (confidence {t3.judge_confidence:.2f})"
        )
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


def run_analyze_task(args: dict, anthropic_client: anthropic.Anthropic) -> dict:
    """Execute analyze_task tool — Phase 0 task analysis."""
    from herald.agent.analyzer import TaskAnalyzer

    analyzer = TaskAnalyzer(client=anthropic_client)
    try:
        plan = analyzer.analyze(
            query=args["query"],
            source_documents=args["source_documents"],
        )
        return {
            "expected_output_count": plan.expected_output_count,
            "output_unit": plan.output_unit,
            "primary_checkpoint_types": [ct.value for ct in plan.primary_checkpoint_types],
            "requires_source_mapping": plan.requires_source_mapping,
            "task_nature": plan.task_nature,
            "evaluation_mode": plan.evaluation_mode,
            "sample_size": plan.sample_size,
            "skip_nli_for": [ct.value for ct in plan.skip_nli_for],
            "debate_recommended_for": [ct.value for ct in plan.debate_recommended_for],
            "source_type": plan.source_type,
            "source_chunking": plan.source_chunking,
        }
    except Exception as exc:
        return {"error": str(exc)}


def run_validate_batch(args: dict, pipeline: HeraldPipeline) -> dict:
    """Execute validate_batch tool — Phase 2 batch validation."""
    import uuid

    from herald.agent.batch import BatchValidator
    from herald.core.types import CheckpointType, GeneratedOutput, TaskPlan

    # Build GeneratedOutput list
    outputs = []
    for item in args["outputs"]:
        suggested_ct = None
        ct_str = item.get("suggested_checkpoint_type")
        if ct_str:
            try:
                suggested_ct = CheckpointType(ct_str)
            except ValueError:
                pass
        outputs.append(
            GeneratedOutput(
                id=str(uuid.uuid4())[:8],
                text=item["text"],
                output_type=item.get("output_type", "output"),
                references_section=item.get("references_section"),
                suggested_checkpoint_type=suggested_ct,
                metadata={},
            )
        )

    # Build or default TaskPlan
    raw_plan = args.get("task_plan") or {}
    if raw_plan:
        try:
            from herald.agent.analyzer import TaskAnalyzer

            plan = TaskAnalyzer(client=None)._parse_plan(raw_plan)  # type: ignore[arg-type]
        except Exception:
            raw_plan = {}

    if not raw_plan:
        plan = TaskPlan(
            expected_output_count=len(outputs),
            output_unit="output",
            primary_checkpoint_types=[CheckpointType.CLAIM_EXTRACTION],
            requires_source_mapping=False,
            task_nature="empirical",
            evaluation_mode="exhaustive",
            sample_size=None,
            skip_nli_for=[CheckpointType.CAUSAL, CheckpointType.EPISTEMIC],
            debate_recommended_for=[CheckpointType.CAUSAL, CheckpointType.SYNTHESIS],
            source_type="single_document",
            source_chunking="whole_document",
        )

    validator = BatchValidator(pipeline=pipeline)
    try:
        result = validator.validate_batch(
            outputs=outputs,
            sources=args["source_documents"],
            task_plan=plan,
        )
        # Store escalated packets so users can call explain_verdict
        tier4_ids = []
        for output, packet in result.tier4_pending:
            pid = store_packet(packet)
            tier4_ids.append({"output_id": output.id, "result_id": pid, "text": output.text[:200]})

        return {
            "summary": result.summary,
            "tier4_pending": tier4_ids,
            "note": (
                "Call explain_verdict with any result_id from tier4_pending "
                "to see the full evidence, then request_human_review to adjudicate."
            )
            if tier4_ids
            else None,
        }
    except Exception as exc:
        return {"error": str(exc)}


def run_generate_and_validate(
    args: dict,
    pipeline: HeraldPipeline,
    anthropic_client: anthropic.Anthropic,
) -> dict:
    """Execute generate_and_validate tool — full Phase 0→1→2 pipeline."""
    from herald.agent.research_agent import ResearchAgent, _task_plan_to_dict

    # Build a minimal config that ResearchAgent can use
    # The pipeline is already built; we pass its components directly
    config = {
        "anthropic_api_key": anthropic_client.api_key,
        "groq_api_key": pipeline.tier2.client.api_key,
        "tier1": {
            "model_name": pipeline.tier1.model_name,
            "device": getattr(pipeline.tier1, "device", "cpu"),
        },
        "tier2": {"model": pipeline.tier2.model},
        "tier3": {"model": pipeline.tier3.model},
        "thresholds": {"T1": pipeline.t1, "T2": pipeline.t2},
    }
    if pipeline.counterfactual_probe is not None:
        config["counterfactual_probe"] = {
            "enabled": True,
            "model": pipeline.counterfactual_probe.model,
        }

    try:
        agent = ResearchAgent(config=config)
        result = agent.run(
            query=args["query"],
            source_documents=args["source_documents"],
        )

        tier4_ids = []
        for output, packet in result.tier4_pending:
            pid = store_packet(packet)
            tier4_ids.append({"output_id": output.id, "result_id": pid, "text": output.text[:200]})

        return {
            "task_plan": _task_plan_to_dict(result.task_plan),
            "summary": result.summary,
            "tier4_pending": tier4_ids,
        }
    except Exception as exc:
        return {"error": str(exc)}


# ── Dispatcher ───────────────────────────────────────────────────────────────


def execute_tool(
    tool_name: str,
    tool_input: dict,
    pipeline: HeraldPipeline,
    anthropic_client: anthropic.Anthropic | None = None,
) -> str:
    """Route a tool call to the right function and return JSON string result."""
    if tool_name == "validate_checkpoint":
        result = run_validate_checkpoint(tool_input, pipeline)
    elif tool_name == "explain_verdict":
        result = run_explain_verdict(tool_input)
    elif tool_name == "request_human_review":
        result = run_request_human_review(tool_input)
    elif tool_name == "analyze_task":
        if anthropic_client is None:
            result = {"error": "anthropic_client required for analyze_task"}
        else:
            result = run_analyze_task(tool_input, anthropic_client)
    elif tool_name == "validate_batch":
        result = run_validate_batch(tool_input, pipeline)
    elif tool_name == "generate_and_validate":
        if anthropic_client is None:
            result = {"error": "anthropic_client required for generate_and_validate"}
        else:
            result = run_generate_and_validate(tool_input, pipeline, anthropic_client)
    else:
        result = {"error": f"Unknown tool: {tool_name}"}

    return json.dumps(result, indent=2)
