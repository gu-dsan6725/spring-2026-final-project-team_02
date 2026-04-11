"""Batch Validator — Phase 2 of the ResearchAgent pipeline.

Takes a list of GeneratedOutput objects and runs them through the HERALD
escalation pipeline, respecting the routing rules in the TaskPlan:

  - Outputs whose checkpoint type is in task_plan.skip_nli_for are routed
    directly to Tier 2, bypassing Tier 1 NLI (which is unreliable on causal
    and epistemic checkpoints).
  - All other outputs run Tier 1 first; only uncertain ones escalate.
  - Outputs resolved at Tier 4 (UNCERTAIN after all automated tiers) are
    collected in tier4_pending for interactive human review.

Groq rate limits (free tier: ~30 req/min on 70B models) are respected via
exponential backoff on 429 errors from the escalation pipeline.
"""

import logging
import math
import random
import time
import uuid
from typing import Callable

from herald.core.types import (
    BatchValidationResult,
    CheckpointOutput,
    CheckpointType,
    EscalationPacket,
    GeneratedOutput,
    TaskPlan,
    TierResult,
    Verdict,
)
from herald.pipeline.escalation import HeraldPipeline

logger = logging.getLogger("herald")


class BatchValidator:
    """Runs batch validation of multiple GeneratedOutputs against source documents.

    Implements the routing rules from TaskPlan:
      - skip_nli_for  → bypass Tier 1, run from Tier 2 directly
      - evaluation_mode == 'sampled'  → only validate task_plan.sample_size outputs
      - All outputs that reach Tier 4 are surfaced in BatchValidationResult.tier4_pending
    """

    def __init__(
        self,
        pipeline: HeraldPipeline,
        tier1_confidence_threshold: float = 0.70,
        progress_callback: Callable[[str], None] | None = None,
    ):
        self.pipeline = pipeline
        self.t1_threshold = tier1_confidence_threshold
        # Default progress callback prints to stdout
        self._progress = progress_callback or (lambda msg: print(msg, flush=True))

    # ── Public API ──────────────────────────────────────────────────────────

    def validate_batch(
        self,
        outputs: list[GeneratedOutput],
        sources: str,
        task_plan: TaskPlan,
    ) -> BatchValidationResult:
        """Validate a list of outputs against source documents per the TaskPlan.

        Returns a BatchValidationResult with per-verdict bucketing and aggregate stats.
        """
        # Apply sampling if evaluation_mode == 'sampled'
        to_validate = self._apply_sampling(outputs, task_plan)

        tier1_valid: list[tuple[GeneratedOutput, TierResult]] = []
        tier1_invalid: list[tuple[GeneratedOutput, TierResult]] = []
        escalated: list[tuple[GeneratedOutput, EscalationPacket]] = []
        tier4_pending: list[tuple[GeneratedOutput, EscalationPacket]] = []

        total = len(to_validate)
        for idx, output in enumerate(to_validate, 1):
            self._progress(
                f"  Validating {output.output_type} {idx}/{total} "
                f"[id: {output.id}]..."
            )

            checkpoint_type = self.map_to_checkpoint_type(output, task_plan)
            source_context = self.extract_source_context(output, sources, task_plan.source_chunking)
            skip_nli = checkpoint_type in task_plan.skip_nli_for

            checkpoint = CheckpointOutput(
                checkpoint_type=checkpoint_type,
                output_text=output.text,
                source_context=source_context,
                query=output.metadata.get("query", ""),
                metadata={"generated_output_id": output.id, **output.metadata},
            )

            packet = self._run_with_backoff(checkpoint, skip_nli=skip_nli)

            # Bucket the result
            if packet.resolved_at_tier == 1:
                t1 = packet.tier1_result
                if t1.verdict == Verdict.VALID:
                    tier1_valid.append((output, t1))
                    self._progress(f"    → Tier 1: VALID ({t1.confidence:.2f})")
                else:
                    tier1_invalid.append((output, t1))
                    self._progress(f"    → Tier 1: INVALID ({t1.confidence:.2f})")
            elif packet.resolved_at_tier == 4:
                tier4_pending.append((output, packet))
                self._progress(f"    → Tier 4: UNCERTAIN (needs human review)")
            else:
                escalated.append((output, packet))
                verdict_str = packet.final_verdict.value.upper() if packet.final_verdict else "?"
                self._progress(
                    f"    → Tier {packet.resolved_at_tier}: {verdict_str} "
                    f"({'skipped NLI' if skip_nli else 'escalated'})"
                )

        summary = self._build_summary(
            outputs, to_validate, tier1_valid, tier1_invalid, escalated, tier4_pending
        )

        return BatchValidationResult(
            task_plan=task_plan,
            total_outputs=len(outputs),
            tier1_valid=tier1_valid,
            tier1_invalid=tier1_invalid,
            escalated=escalated,
            tier4_pending=tier4_pending,
            summary=summary,
        )

    def extract_source_context(
        self,
        output: GeneratedOutput,
        sources: str,
        chunking_strategy: str,
    ) -> str:
        """Extract the relevant source context for a given output.

        Strategies:
          whole_document  → return the full source (up to a reasonable limit)
          per_output      → use output.references_section to find the relevant chunk
          by_section      → same as per_output: find the named section in the source
          by_page         → same heuristic; page markers not standardized so fall back to section
        """
        if chunking_strategy == "whole_document":
            # Cap at 8000 chars to avoid overwhelming the NLI model
            return sources[:8000]

        if output.references_section:
            section = output.references_section.lower().strip()
            # Try to find the section in the source (simple substring search)
            lower_src = sources.lower()
            idx = lower_src.find(section)
            if idx != -1:
                # Return a window around the found section
                start = max(0, idx - 100)
                end = min(len(sources), idx + 3000)
                return sources[start:end]

        # Fallback: return the full source (capped)
        return sources[:8000]

    def map_to_checkpoint_type(
        self, output: GeneratedOutput, task_plan: TaskPlan
    ) -> CheckpointType:
        """Determine which checkpoint type to use for a given output.

        Priority:
          1. output.suggested_checkpoint_type (set by the research agent)
          2. First type in task_plan.primary_checkpoint_types
          3. Fallback to claim_extraction
        """
        if output.suggested_checkpoint_type is not None:
            return output.suggested_checkpoint_type

        if task_plan.primary_checkpoint_types:
            return task_plan.primary_checkpoint_types[0]

        return CheckpointType.CLAIM_EXTRACTION

    # ── Internal helpers ────────────────────────────────────────────────────

    def _apply_sampling(
        self, outputs: list[GeneratedOutput], task_plan: TaskPlan
    ) -> list[GeneratedOutput]:
        """Return the subset of outputs to validate per the evaluation_mode."""
        if task_plan.evaluation_mode == "exhaustive":
            return outputs

        if task_plan.evaluation_mode == "sampled" and task_plan.sample_size is not None:
            n = min(task_plan.sample_size, len(outputs))
            if n < len(outputs):
                self._progress(
                    f"  Sampling {n}/{len(outputs)} outputs for validation "
                    f"(evaluation_mode=sampled)"
                )
                return random.sample(outputs, n)
            return outputs

        # adaptive: exhaustive up to 20, sampled above
        if len(outputs) <= 20:
            return outputs
        n = min(20, math.ceil(0.15 * len(outputs)))
        self._progress(
            f"  Adaptive sampling: validating {n}/{len(outputs)} outputs"
        )
        return random.sample(outputs, n)

    def _run_with_backoff(
        self,
        checkpoint: CheckpointOutput,
        skip_nli: bool = False,
        max_retries: int = 5,
    ) -> EscalationPacket:
        """Run validation with exponential backoff on Groq 429 rate-limit errors."""
        delay = 2.0
        for attempt in range(max_retries):
            try:
                if skip_nli:
                    return self._run_from_tier2(checkpoint)
                return self.pipeline.validate(checkpoint)
            except Exception as exc:
                err_str = str(exc).lower()
                is_rate_limit = "429" in err_str or "rate limit" in err_str or "too many" in err_str
                if is_rate_limit and attempt < max_retries - 1:
                    wait = delay * (2 ** attempt)
                    logger.warning(
                        f"[BatchValidator] Rate limit hit, retrying in {wait:.1f}s "
                        f"(attempt {attempt + 1}/{max_retries})"
                    )
                    time.sleep(wait)
                else:
                    raise

        raise RuntimeError("Exhausted retries in _run_with_backoff")

    def _run_from_tier2(self, checkpoint: CheckpointOutput) -> EscalationPacket:
        """Run the pipeline starting from Tier 2, bypassing Tier 1 NLI.

        Used for checkpoint types where NLI is unreliable (causal, epistemic).
        We create a synthetic Tier 1 UNCERTAIN result to trigger escalation,
        then run the standard pipeline which will proceed to Tier 2.
        """
        # Build a fake Tier 1 result that forces escalation
        from herald.core.types import TierResult

        fake_t1 = TierResult(
            tier=1,
            verdict=Verdict.UNCERTAIN,
            confidence=0.50,
            reasoning="Skipped: NLI is unreliable for this checkpoint type.",
            raw_scores={"entailment": 0.33, "contradiction": 0.33, "neutral": 0.34},
        )

        # Run Tier 2 directly via the pipeline's judge
        t2 = self.pipeline.tier2.judge(
            checkpoint, fake_t1, threshold=self.pipeline.t2
        )

        packet = EscalationPacket(checkpoint=checkpoint)
        packet.tier1_result = fake_t1

        if t2.verdict != Verdict.UNCERTAIN:
            # Optionally run Tier 2.5 counterfactual probe
            if self.pipeline.counterfactual_probe is not None:
                cf = self.pipeline.counterfactual_probe.probe(
                    checkpoint, t2, t2_threshold=self.pipeline.t2
                )
                packet.tier2_result = t2
                packet.tier2_5_result = cf
                if cf.verdict_overridden:
                    # Fall through to Tier 3
                    pass
                else:
                    packet.resolved_at_tier = 2
                    packet.final_verdict = t2.verdict
                    return packet
            else:
                packet.tier2_result = t2
                packet.resolved_at_tier = 2
                packet.final_verdict = t2.verdict
                return packet

        # Tier 2 uncertain (or overridden by 2.5) — escalate to Tier 3
        packet.tier2_result = t2
        t3 = self.pipeline.tier3.debate(checkpoint, fake_t1, t2)
        packet.tier3_result = t3

        if t3.judge_verdict != Verdict.UNCERTAIN:
            packet.resolved_at_tier = 3
            packet.final_verdict = t3.judge_verdict
            return packet

        # Tier 4 — couldn't resolve
        packet.resolved_at_tier = 4
        packet.final_verdict = Verdict.UNCERTAIN
        return packet

    def _build_summary(
        self,
        all_outputs: list[GeneratedOutput],
        validated: list[GeneratedOutput],
        tier1_valid: list,
        tier1_invalid: list,
        escalated: list,
        tier4_pending: list,
    ) -> dict:
        """Build aggregate statistics for BatchValidationResult.summary."""
        n_validated = len(validated)
        n_valid = len(tier1_valid) + sum(
            1 for _, p in escalated if p.final_verdict == Verdict.VALID
        )
        n_invalid = len(tier1_invalid) + sum(
            1 for _, p in escalated if p.final_verdict == Verdict.INVALID
        )
        n_uncertain = len(tier4_pending)

        # Tier distribution of escalated resolutions
        tier_counts: dict[int, int] = {}
        for _, packet in escalated:
            t = packet.resolved_at_tier or 0
            tier_counts[t] = tier_counts.get(t, 0) + 1

        return {
            "total_outputs": len(all_outputs),
            "outputs_validated": n_validated,
            "outputs_skipped": len(all_outputs) - n_validated,
            "verdict_counts": {
                "valid": n_valid,
                "invalid": n_invalid,
                "uncertain": n_uncertain,
            },
            "valid_pct": round(n_valid / n_validated * 100, 1) if n_validated else 0,
            "invalid_pct": round(n_invalid / n_validated * 100, 1) if n_validated else 0,
            "uncertain_pct": round(n_uncertain / n_validated * 100, 1) if n_validated else 0,
            "tier1_resolved": len(tier1_valid) + len(tier1_invalid),
            "tier_resolution_counts": tier_counts,
            "tier4_requiring_human": len(tier4_pending),
        }
