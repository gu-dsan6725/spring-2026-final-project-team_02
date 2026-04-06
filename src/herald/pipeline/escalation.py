"""HERALD Escalation Pipeline — the core orchestrator.

Routes each checkpoint output through Tier 1 → 2 → 3 → 4,
stopping as soon as any tier resolves with sufficient confidence.
"""

import logging
from typing import Optional
from herald.core.types import (
    CheckpointOutput, EscalationPacket, Verdict,
)
from herald.tier1.classifier import NLIClassifier
from herald.tier2.judge import LLMJudge
from herald.tier2.counterfactual import CounterfactualProbe
from herald.tier3.debate import MultiAgentDebate
from herald.tier4.human_review import save_packet

logger = logging.getLogger("herald")


class HeraldPipeline:
    """Four-tier escalation pipeline with optional Tier 2.5 counterfactual probe.

    Tier 2.5 runs after a confident Tier 2 verdict and asks the model what
    evidence would reverse it, then checks if that evidence exists in the source.
    If found, the verdict is overridden to UNCERTAIN and escalated to Tier 3.
    This catches correlated overconfidence errors that same-model debate misses.
    """

    def __init__(
        self,
        tier1: NLIClassifier,
        tier2: LLMJudge,
        tier3: MultiAgentDebate,
        t1_threshold: float = 0.70,
        t2_threshold: float = 0.80,
        counterfactual_probe: Optional[CounterfactualProbe] = None,
    ):
        self.tier1 = tier1
        self.tier2 = tier2
        self.tier3 = tier3
        self.t1 = t1_threshold
        self.t2 = t2_threshold
        self.counterfactual_probe = counterfactual_probe

    def validate(self, checkpoint: CheckpointOutput) -> EscalationPacket:
        """Run full escalation on a single checkpoint output."""
        packet = EscalationPacket(checkpoint=checkpoint)

        # ── TIER 1: NLI Classifier ──────────────────────────────────────────
        logger.info(f"[Tier 1] {checkpoint.checkpoint_type.value}")
        t1 = self.tier1.classify(checkpoint, threshold=self.t1)
        packet.tier1_result = t1

        if t1.verdict != Verdict.UNCERTAIN:
            packet.resolved_at_tier = 1
            packet.final_verdict = t1.verdict
            logger.info(f"[Tier 1] Resolved: {t1.verdict.value} ({t1.confidence:.3f})")
            return packet

        logger.info(f"[Tier 1] Uncertain ({t1.confidence:.3f}) → escalating")

        # ── TIER 2: LLM Judge ────────────────────────────────────────────────
        t2 = self.tier2.judge(checkpoint, t1, threshold=self.t2)
        packet.tier2_result = t2

        if t2.verdict != Verdict.UNCERTAIN:
            # ── TIER 2.5: Counterfactual Probe (optional) ───────────────────
            # Only runs on confident verdicts — probing uncertainty is redundant.
            if self.counterfactual_probe is not None:
                logger.info(
                    f"[Tier 2.5] Probing confident {t2.verdict.value} verdict "
                    f"({t2.confidence:.3f}) for disconfirming evidence"
                )
                cf = self.counterfactual_probe.probe(
                    checkpoint, t2, t2_threshold=self.t2
                )
                packet.tier2_5_result = cf

                if cf.verdict_overridden:
                    logger.info(
                        f"[Tier 2.5] Override triggered — disconfirming evidence found: "
                        f'"{cf.evidence_quote[:80]}..." → escalating to Tier 3'
                    )
                    # Fall through to Tier 3 instead of returning here
                else:
                    logger.info(
                        f"[Tier 2.5] No disconfirming evidence found — "
                        f"Tier 2 verdict {t2.verdict.value} stands"
                    )
                    packet.resolved_at_tier = 2
                    packet.final_verdict = t2.verdict
                    return packet
            else:
                packet.resolved_at_tier = 2
                packet.final_verdict = t2.verdict
                logger.info(f"[Tier 2] Resolved: {t2.verdict.value} ({t2.confidence:.3f})")
                return packet

        logger.info(f"[Tier 2] Uncertain ({t2.confidence:.3f}) → escalating")

        # ── TIER 3: Multi-Agent Debate ───────────────────────────────────────
        t3 = self.tier3.debate(checkpoint, t1, t2)
        packet.tier3_result = t3

        if t3.judge_verdict != Verdict.UNCERTAIN:
            packet.resolved_at_tier = 3
            packet.final_verdict = t3.judge_verdict
            logger.info(f"[Tier 3] Resolved: {t3.judge_verdict.value} ({t3.judge_confidence:.3f})")
            return packet

        logger.info("[Tier 3] Uncertain → escalating to human review")

        # ── TIER 4: Human Review ─────────────────────────────────────────────
        packet.resolved_at_tier = 4
        packet.final_verdict = Verdict.UNCERTAIN
        filepath = save_packet(packet)
        logger.info(f"[Tier 4] Review packet saved: {filepath}")

        return packet


def build_pipeline(config: dict) -> HeraldPipeline:
    """Build pipeline from config dict."""
    tier1 = NLIClassifier(
        model_name=config["tier1"]["model_name"],
        device=config["tier1"].get("device", "cpu"),
    )
    tier2 = LLMJudge(
        api_key=config["groq_api_key"],
        model=config["tier2"]["model"],
    )
    tier3 = MultiAgentDebate(
        api_key=config["groq_api_key"],
        model=config["tier3"]["model"],
    )

    # Tier 2.5 is opt-in via config
    cf_probe = None
    if config.get("counterfactual_probe", {}).get("enabled", False):
        cf_probe = CounterfactualProbe(
            api_key=config["groq_api_key"],
            model=config["counterfactual_probe"].get(
                "model", config["tier2"]["model"]
            ),
        )
        logger.info("[Config] Tier 2.5 counterfactual probe enabled")

    return HeraldPipeline(
        tier1=tier1,
        tier2=tier2,
        tier3=tier3,
        t1_threshold=config["thresholds"]["T1"],
        t2_threshold=config["thresholds"]["T2"],
        counterfactual_probe=cf_probe,
    )
