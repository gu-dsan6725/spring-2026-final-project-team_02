"""HERALD Escalation Pipeline — the core orchestrator.

Routes each checkpoint output through Tier 1 → 2 → 3 → 4,
stopping as soon as any tier resolves with sufficient confidence.

Checkpoint-type routing
-----------------------
Not all checkpoint types are equally suited for NLI or debate. The config's
``checkpoint_routing`` block governs three behaviours:

* ``skip_nli``       — T1 runs for its signal but its verdict is NEVER final;
                       the case always escalates to T2. Use for types where NLI
                       scores surface-level entailment while missing factual
                       errors (numerical, causal, synthesis).
* ``prefer_debate``  — After a confident T2 verdict, the case is still sent to
                       T3 debate instead of resolving. Use where multi-agent
                       adversarial framing catches errors a single judge misses.
* ``nli_sufficient`` — T1 is trusted at its normal threshold; no override.

These sets are read once at construction and used inside ``validate()``.
"""

import logging

from herald.core.types import (
    CheckpointOutput,
    EscalationPacket,
    Verdict,
)
from herald.tier1.classifier import NLIClassifier
from herald.tier2.counterfactual import CounterfactualProbe
from herald.tier2.judge import LLMJudge
from herald.tier3.debate import MultiAgentDebate
from herald.tier4.human_review import save_packet

logger = logging.getLogger("herald")


class HeraldPipeline:
    """Four-tier escalation pipeline with optional Tier 2.5 counterfactual probe.

    Tier 2.5 runs after a confident Tier 2 verdict and asks the model what
    evidence would reverse it, then checks if that evidence exists in the source.
    If found, the verdict is overridden to UNCERTAIN and escalated to Tier 3.
    This catches correlated overconfidence errors that same-model debate misses.

    Checkpoint-type routing rules (from config ``checkpoint_routing``) control
    which tiers can resolve each type — see module docstring for details.
    """

    def __init__(
        self,
        tier1: NLIClassifier,
        tier2: LLMJudge,
        tier3: MultiAgentDebate,
        t1_threshold: float = 0.70,
        t2_threshold: float = 0.80,
        counterfactual_probe: CounterfactualProbe | None = None,
        skip_nli_types: set[str] | None = None,
        prefer_debate_types: set[str] | None = None,
        t1_thresholds_by_type: dict[str, float] | None = None,
    ):
        self.tier1 = tier1
        self.tier2 = tier2
        self.tier3 = tier3
        self.t1 = t1_threshold
        self.t2 = t2_threshold
        self.counterfactual_probe = counterfactual_probe
        # Checkpoint types where T1 verdict is never final (always escalate to T2)
        self.skip_nli_types: set[str] = skip_nli_types or set()
        # Checkpoint types where T2 verdict always escalates to T3 debate
        self.prefer_debate_types: set[str] = prefer_debate_types or set()
        # Per-type T1 threshold overrides (fall back to self.t1 for unlisted types)
        self.t1_thresholds_by_type: dict[str, float] = t1_thresholds_by_type or {}

    def validate(self, checkpoint: CheckpointOutput) -> EscalationPacket:
        """Run full escalation on a single checkpoint output."""
        packet = EscalationPacket(checkpoint=checkpoint)
        cp_type = checkpoint.checkpoint_type.value

        # ── TIER 1: NLI Classifier ──────────────────────────────────────────
        logger.info(f"[Tier 1] {cp_type}")
        # Use a per-type threshold if configured, otherwise fall back to the global T1.
        t1_threshold = self.t1_thresholds_by_type.get(cp_type, self.t1)
        t1 = self.tier1.classify(checkpoint, threshold=t1_threshold)
        packet.tier1_result = t1

        # For skip_nli types, T1 provides signal but never resolves the case.
        # NLI cannot reliably detect factual errors (wrong numbers, wrong dates,
        # causal overreach) because it measures textual entailment, not factual
        # accuracy. High entailment on a numerically wrong claim is common.
        if cp_type not in self.skip_nli_types and t1.verdict != Verdict.UNCERTAIN:
            packet.resolved_at_tier = 1
            packet.final_verdict = t1.verdict
            logger.info(f"[Tier 1] Resolved: {t1.verdict.value} ({t1.confidence:.3f})")
            return packet

        if cp_type in self.skip_nli_types:
            logger.info(
                f"[Tier 1] '{cp_type}' is in skip_nli — T1 verdict suppressed "
                f"({t1.verdict.value} {t1.confidence:.3f}) → escalating to T2"
            )
        else:
            logger.info(f"[Tier 1] Uncertain ({t1.confidence:.3f}) → escalating")

        # ── TIER 2: LLM Judge ────────────────────────────────────────────────
        t2 = self.tier2.judge(checkpoint, t1, threshold=self.t2)
        packet.tier2_result = t2

        if t2.verdict != Verdict.UNCERTAIN:
            # ── TIER 2.5: Counterfactual Probe (optional) ───────────────────
            # Only runs on confident verdicts — probing uncertainty is redundant.
            # For prefer_debate types, the probe still runs; if it fires it
            # escalates to T3 (same as any other type). If it does NOT fire,
            # prefer_debate triggers a T3 escalation anyway — but only for
            # low-to-medium T2 confidence, not for highly confident verdicts
            # where the risk of T3 degrading the result outweighs the benefit.
            cf_overridden = False
            if self.counterfactual_probe is not None:
                logger.info(
                    f"[Tier 2.5] Probing confident {t2.verdict.value} verdict "
                    f"({t2.confidence:.3f}) for disconfirming evidence"
                )
                cf = self.counterfactual_probe.probe(checkpoint, t2, t2_threshold=self.t2)
                packet.tier2_5_result = cf
                cf_overridden = cf.verdict_overridden

                if cf_overridden:
                    logger.info(
                        f"[Tier 2.5] Override triggered — disconfirming evidence found: "
                        f'"{cf.evidence_quote[:80]}..." → escalating to Tier 3'
                    )
                    # Fall through to Tier 3
                else:
                    logger.info(
                        f"[Tier 2.5] No disconfirming evidence found — "
                        f"Tier 2 verdict {t2.verdict.value} stands"
                    )

            if not cf_overridden:
                # For prefer_debate types, escalate to T3 only when T2 confidence
                # is below a high-confidence bar (0.92). Above that bar the verdict
                # is reliable enough that sending it to a noisier T3 debate hurts
                # more than it helps — as confirmed by run 06 results.
                HIGH_CONFIDENCE_BAR = 0.92
                if cp_type in self.prefer_debate_types and t2.confidence < HIGH_CONFIDENCE_BAR:
                    logger.info(
                        f"[Tier 2] '{cp_type}' is in prefer_debate and T2 confidence "
                        f"({t2.confidence:.3f}) < {HIGH_CONFIDENCE_BAR} — forwarding to T3 debate"
                    )
                    # Fall through to Tier 3
                else:
                    if cp_type in self.prefer_debate_types:
                        logger.info(
                            f"[Tier 2] '{cp_type}' in prefer_debate but confidence "
                            f"({t2.confidence:.3f}) >= {HIGH_CONFIDENCE_BAR} — T2 verdict stands"
                        )
                    packet.resolved_at_tier = 2
                    packet.final_verdict = t2.verdict
                    logger.info(f"[Tier 2] Resolved: {t2.verdict.value} ({t2.confidence:.3f})")
                    return packet

        if t2.verdict == Verdict.UNCERTAIN:
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
    tier2 = LLMJudge(config=config)
    tier3 = MultiAgentDebate(config=config)

    # Tier 2.5 is opt-in via config
    cf_probe = None
    if config.get("counterfactual_probe", {}).get("enabled", False):
        cf_probe = CounterfactualProbe(config=config)
        logger.info("[Config] Tier 2.5 counterfactual probe enabled")

    # Checkpoint-type routing from config
    routing = config.get("checkpoint_routing", {})
    skip_nli_types = set(routing.get("skip_nli", []))
    prefer_debate_types = set(routing.get("prefer_debate", []))
    if skip_nli_types:
        logger.info(f"[Config] skip_nli types: {sorted(skip_nli_types)}")
    if prefer_debate_types:
        logger.info(f"[Config] prefer_debate types: {sorted(prefer_debate_types)}")

    # Per-type T1 threshold overrides
    t1_thresholds_by_type = config.get("thresholds", {}).get("T1_by_type", {})
    if t1_thresholds_by_type:
        logger.info(f"[Config] T1 per-type thresholds: {t1_thresholds_by_type}")

    return HeraldPipeline(
        tier1=tier1,
        tier2=tier2,
        tier3=tier3,
        t1_threshold=config["thresholds"]["T1"],
        t2_threshold=config["thresholds"]["T2"],
        counterfactual_probe=cf_probe,
        skip_nli_types=skip_nli_types,
        prefer_debate_types=prefer_debate_types,
        t1_thresholds_by_type=t1_thresholds_by_type,
    )
