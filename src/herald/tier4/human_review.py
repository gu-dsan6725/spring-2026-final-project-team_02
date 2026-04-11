"""Tier 4: Human Review Packet Generator.

Packages all prior tier results so the human reviewer
adjudicates a specific question — not a blank validation task.
"""

import json
from datetime import datetime
from pathlib import Path

from herald.core.types import EscalationPacket


def generate_packet(packet: EscalationPacket) -> dict:
    """Build structured review packet from escalation history."""
    review = {
        "timestamp": datetime.now().isoformat(),
        "checkpoint_type": packet.checkpoint.checkpoint_type.value,
        "query": packet.checkpoint.query,
        "question_for_reviewer": _frame_question(packet),
        "agent_output": packet.checkpoint.output_text,
        "source_context": packet.checkpoint.source_context,
        "automated_analysis": {},
    }

    if packet.tier1_result:
        review["automated_analysis"]["tier1"] = {
            "verdict": packet.tier1_result.verdict.value,
            "confidence": packet.tier1_result.confidence,
            "nli_scores": packet.tier1_result.raw_scores,
        }
    if packet.tier2_result:
        review["automated_analysis"]["tier2"] = {
            "verdict": packet.tier2_result.verdict.value,
            "confidence": packet.tier2_result.confidence,
            "reasoning": packet.tier2_result.reasoning,
        }
    if packet.tier3_result:
        review["automated_analysis"]["tier3_debate"] = {
            "advocate": packet.tier3_result.advocate_argument,
            "critic": packet.tier3_result.critic_argument,
            "judge_verdict": packet.tier3_result.judge_verdict.value,
            "judge_confidence": packet.tier3_result.judge_confidence,
            "judge_reasoning": packet.tier3_result.judge_reasoning,
        }
    return review


def save_packet(packet: EscalationPacket, output_dir: str = "results/human_review") -> Path:
    """Save review packet to JSON."""
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    review = generate_packet(packet)
    filepath = Path(output_dir) / f"review_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(filepath, "w") as f:
        json.dump(review, f, indent=2)
    return filepath


def _frame_question(packet: EscalationPacket) -> str:
    """Frame a specific question for the reviewer."""
    if packet.tier3_result:
        return (
            f"Three tiers of automated analysis could not resolve this case. "
            f"The debate judge leaned '{packet.tier3_result.judge_verdict.value}' "
            f"(confidence: {packet.tier3_result.judge_confidence:.2f}). "
            f"Is this output VALID, INVALID, or genuinely UNCERTAIN?"
        )
    if packet.tier2_result:
        return (
            f"Tier 2 judge returned '{packet.tier2_result.verdict.value}' with low confidence "
            f"({packet.tier2_result.confidence:.2f}). Please adjudicate."
        )
    return "Please validate this output against the source context."
