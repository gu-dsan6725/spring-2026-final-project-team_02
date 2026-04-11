"""HERALD Research Agent — full 4-phase pipeline with self-validation.

Architecture:
  Phase 0 — Task Analysis:   Claude analyzes the query and produces a TaskPlan.
  Phase 1 — Generate:        Claude generates structured outputs (claims, bullets, etc.).
  Phase 2 — Validate:        BatchValidator runs HERALD tiers on all outputs.
  Phase 3 — Handle Escalations: INVALID outputs can be revised; Tier 4 cases
                               surface to the human interactively.

The agent is conversational: if the task is ambiguous it will ask clarifying
questions before proceeding. All generated outputs carry a result_id so the
user can call explain_verdict on any specific output.

Usage:
  uv run herald-research
  uv run herald-research --config configs/default.yaml --verbose
"""

import argparse
import json
import logging
import sys
import uuid

import anthropic

from herald.agent.analyzer import TaskAnalyzer
from herald.agent.batch import BatchValidator
from herald.agent.tools import store_packet
from herald.core.config import load_config
from herald.core.types import (
    BatchValidationResult,
    CheckpointType,
    GeneratedOutput,
    TaskPlan,
    Verdict,
)
from herald.pipeline.escalation import build_pipeline

logger = logging.getLogger("herald")


# ── Prompt for Phase 1: Output Generation ───────────────────────────────────

GENERATION_SYSTEM_PROMPT = """You are a rigorous research assistant that generates structured,
source-grounded outputs and then validates every claim against the source material.

When given a research query and source documents, you will:
1. Generate the requested outputs (claims, summaries, bullet points, etc.)
2. For each output, note which section of the source it references
3. Assign the most appropriate checkpoint type to each output

You must respond with a JSON object containing:
{{
  "clarification_needed": false,
  "outputs": [
    {{
      "text": "<the output text>",
      "output_type": "<comment|claim|paragraph|bullet point|answer|summary|recommendation>",
      "references_section": "<section title or quote that grounds this output, or null>",
      "suggested_checkpoint_type": "<retrieval|claim_extraction|synthesis|numerical|causal|epistemic>",
      "metadata": {{}}
    }}
  ]
}}

If the task is ambiguous and you need clarification, set clarification_needed to true and
include a "question" field explaining what you need to know.

Be faithful to the source. Do not add claims that are not in the source material.
Each output should be independently verifiable against the source."""


REVISION_SYSTEM_PROMPT = """You are revising a research output that was flagged as INVALID
by the HERALD validation pipeline.

You will be given:
- The original output text
- The source context it was validated against
- The validation reasoning explaining WHY it was invalid

Your task: revise the output so that it is strictly faithful to the source, fixing the
specific issues identified in the validation reasoning. Keep the same intent and structure
but correct any unsupported claims, causal overreach, or hallucinated details.

Respond with ONLY the revised text — no preamble, no explanation."""


class ResearchAgent:
    """Full research pipeline: analyze → generate → validate → handle escalations."""

    def __init__(
        self,
        config: dict,
        verbose: bool = False,
    ):
        self.config = config
        self.verbose = verbose

        anthropic_key = config.get("anthropic_api_key", "")
        if not anthropic_key:
            raise ValueError("ANTHROPIC_API_KEY not set. Add it to your .env file.")

        self.client = anthropic.Anthropic(api_key=anthropic_key)

        analysis_model = config.get("task_analysis", {}).get("model", "claude-sonnet-4-20250514")
        self.analyzer = TaskAnalyzer(client=self.client, model=analysis_model)

        print("Loading HERALD pipeline (Tier 1 NLI model may take a moment)...")
        self._pipeline = build_pipeline(config)

        t1_threshold = config.get("batch_validation", {}).get(
            "tier1_confidence_threshold",
            config.get("thresholds", {}).get("T1", 0.70),
        )
        self.batch_validator = BatchValidator(
            pipeline=self._pipeline,
            tier1_confidence_threshold=t1_threshold,
        )

    # ── Main entry point ────────────────────────────────────────────────────

    def run(self, query: str, source_documents: str) -> BatchValidationResult:
        """Execute the full Phase 0–3 pipeline.

        Returns validated outputs as a BatchValidationResult.
        Interactive Tier 4 cases are surfaced to the user during Phase 3.
        """
        print("\n" + "=" * 60)
        print("HERALD Research Agent")
        print("=" * 60)

        # ── Phase 0: Task Analysis ───────────────────────────────────────────
        print("\n[Phase 0] Analyzing task structure...")
        task_plan = self.analyzer.analyze(query, source_documents)
        print("  Task analysis complete.")
        print(f"  Expected outputs: {task_plan.expected_output_count} {task_plan.output_unit}(s)")
        print(f"  Checkpoint types: {[ct.value for ct in task_plan.primary_checkpoint_types]}")
        print(f"  Evaluation mode: {task_plan.evaluation_mode}")
        if task_plan.evaluation_mode == "sampled":
            print(f"  Sample size: {task_plan.sample_size}")
        print(f"  NLI skipped for: {[ct.value for ct in task_plan.skip_nli_for]}")
        if self.verbose:
            print(f"  Full TaskPlan: {_task_plan_to_dict(task_plan)}")

        # ── Phase 1: Generate Outputs ────────────────────────────────────────
        print(f"\n[Phase 1] Generating {task_plan.output_unit}(s)...")
        outputs, clarification = self._generate_outputs(query, source_documents, task_plan)

        # Handle clarification loop
        while clarification:
            print(f"\nClarification needed: {clarification}")
            try:
                user_answer = input("Your answer: ").strip()
            except (EOFError, KeyboardInterrupt):
                print("\nAborted.")
                sys.exit(0)
            if not user_answer:
                break
            enhanced_query = f"{query}\n\nAdditional context: {user_answer}"
            outputs, clarification = self._generate_outputs(
                enhanced_query, source_documents, task_plan
            )

        print(f"  Generated {len(outputs)} {task_plan.output_unit}(s).")

        # ── Phase 2: Batch Validation ────────────────────────────────────────
        print("\n[Phase 2] Validating outputs...")
        result = self.batch_validator.validate_batch(outputs, source_documents, task_plan)

        s = result.summary
        print(
            f"\n  Tier 1 resolved: {s['tier1_resolved']} | "
            f"Valid: {s['verdict_counts']['valid']} | "
            f"Invalid: {s['verdict_counts']['invalid']} | "
            f"Uncertain: {s['verdict_counts']['uncertain']}"
        )

        # ── Phase 3: Handle Escalations ──────────────────────────────────────
        if result.tier1_invalid or result.tier4_pending:
            print("\n[Phase 3] Handling escalations...")

        # Attempt revision of INVALID outputs
        if result.tier1_invalid:
            print(f"  Attempting revision of {len(result.tier1_invalid)} invalid output(s)...")
            for output, tier_result in result.tier1_invalid:
                self._attempt_revision(output, source_documents, tier_result.reasoning)

        # Surface Tier 4 cases to human
        if result.tier4_pending:
            print(f"\n  {len(result.tier4_pending)} output(s) require human review (Tier 4).")
            for output, packet in result.tier4_pending:
                # Store packet so user can call explain_verdict
                pid = store_packet(packet)
                print(f"\n  --- Human Review Required [result_id: {pid}] ---")
                print(f"  Output: {output.text[:200]}{'...' if len(output.text) > 200 else ''}")
                if packet.tier2_result:
                    print(f"  Tier 2 reasoning: {packet.tier2_result.reasoning[:300]}")
                if packet.tier3_result:
                    print(f"  Debate judge: {packet.tier3_result.judge_reasoning[:300]}")
                print()
                try:
                    verdict_input = (
                        input("  Your verdict [valid/invalid/uncertain/skip]: ").strip().lower()
                    )
                except (EOFError, KeyboardInterrupt):
                    verdict_input = "skip"

                if verdict_input in ("valid", "invalid", "uncertain"):
                    packet.final_verdict = Verdict(verdict_input)
                    packet.checkpoint.metadata["human_verdict"] = verdict_input
                    print(f"  Recorded: {verdict_input}")
                else:
                    print("  Skipped.")

        # ── Summary ──────────────────────────────────────────────────────────
        self._print_final_summary(result)

        return result

    # ── Phase 1: Generation ─────────────────────────────────────────────────

    def _generate_outputs(
        self,
        query: str,
        source_documents: str,
        task_plan: TaskPlan,
    ) -> tuple[list[GeneratedOutput], str | None]:
        """Call Claude to generate structured outputs for the query.

        Returns (outputs, clarification_question_or_None).
        """
        user_message = (
            f"Research query: {query}\n\n"
            f"Source documents:\n{source_documents}\n\n"
            f"Task plan context:\n"
            f"- Generate {task_plan.expected_output_count} {task_plan.output_unit}(s)\n"
            f"- Primary checkpoint types: {[ct.value for ct in task_plan.primary_checkpoint_types]}\n"
            f"- Source chunking: {task_plan.source_chunking}\n"
        )

        response = self.client.messages.create(
            model="claude-opus-4-6",
            max_tokens=8192,
            system=GENERATION_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )

        raw = response.content[0].text.strip()

        # Strip markdown fences
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.error(f"[ResearchAgent] Failed to parse generation response: {e}")
            logger.debug(f"Raw response: {raw[:500]}")
            return [], None

        if data.get("clarification_needed"):
            return [], data.get("question", "Please clarify the task.")

        raw_outputs = data.get("outputs", [])
        outputs = []
        for item in raw_outputs:
            output_id = str(uuid.uuid4())[:8]
            # Parse suggested checkpoint type
            suggested_ct = None
            ct_str = item.get("suggested_checkpoint_type")
            if ct_str:
                try:
                    suggested_ct = CheckpointType(ct_str)
                except ValueError:
                    pass

            outputs.append(
                GeneratedOutput(
                    id=output_id,
                    text=item.get("text", ""),
                    output_type=item.get("output_type", task_plan.output_unit),
                    references_section=item.get("references_section"),
                    suggested_checkpoint_type=suggested_ct,
                    metadata={
                        "query": query,
                        **item.get("metadata", {}),
                    },
                )
            )

        return outputs, None

    # ── Phase 3: Revision ───────────────────────────────────────────────────

    def _attempt_revision(
        self,
        output: GeneratedOutput,
        source_documents: str,
        validation_reasoning: str,
    ) -> None:
        """Attempt to revise an INVALID output and update it in-place.

        Prints a revision notice; the revised text replaces output.text.
        The original is saved in output.metadata["original_text"].
        """
        user_message = (
            f"Original output:\n{output.text}\n\n"
            f"Source context:\n{source_documents[:4000]}\n\n"
            f"Validation reasoning (why it was invalid):\n{validation_reasoning}"
        )

        try:
            response = self.client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1024,
                system=REVISION_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_message}],
            )
            revised = response.content[0].text.strip()
            output.metadata["original_text"] = output.text
            output.metadata["revised"] = True
            output.text = revised
            print(f"  Revised output [{output.id}]: {revised[:120]}...")
        except Exception as e:
            logger.warning(f"[ResearchAgent] Revision failed for output {output.id}: {e}")

    # ── Formatting ──────────────────────────────────────────────────────────

    def _print_final_summary(self, result: BatchValidationResult) -> None:
        s = result.summary
        print("\n" + "=" * 60)
        print("Validation Complete")
        print("=" * 60)
        print(f"Total outputs:     {s['total_outputs']}")
        print(f"Validated:         {s['outputs_validated']}")
        if s["outputs_skipped"] > 0:
            print(f"Skipped (sampled): {s['outputs_skipped']}")
        print(f"Valid:             {s['verdict_counts']['valid']} ({s['valid_pct']}%)")
        print(f"Invalid:           {s['verdict_counts']['invalid']} ({s['invalid_pct']}%)")
        print(f"Uncertain:         {s['verdict_counts']['uncertain']} ({s['uncertain_pct']}%)")
        if s["tier4_requiring_human"] > 0:
            print(f"Pending human review: {s['tier4_requiring_human']}")
        print()


# ── Helpers ──────────────────────────────────────────────────────────────────


def _task_plan_to_dict(plan: TaskPlan) -> dict:
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


# ── Interactive session ──────────────────────────────────────────────────────


def run_research_agent(
    config_path: str = "configs/default.yaml",
    verbose: bool = False,
) -> None:
    """Run the interactive HERALD research agent."""
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.WARNING,
        format="%(asctime)s [herald] %(message)s",
    )

    config = load_config(config_path)

    agent = ResearchAgent(config=config, verbose=verbose)

    print("\n" + "=" * 60)
    print("HERALD Research Agent — Interactive Mode")
    print("=" * 60)
    print("Enter a research query to generate and validate outputs.")
    print("Then paste or describe your source documents.")
    print("Type 'exit' to quit.\n")

    while True:
        try:
            query = input("Query: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye.")
            break

        if not query:
            continue
        if query.lower() in ("exit", "quit", "q"):
            print("Goodbye.")
            break

        print("\nPaste your source documents (press Enter twice when done):")
        lines = []
        try:
            while True:
                line = input()
                if line == "" and lines and lines[-1] == "":
                    break
                lines.append(line)
        except (EOFError, KeyboardInterrupt):
            pass

        sources = "\n".join(lines).strip()
        if not sources:
            print("No source documents provided. Please paste your source material.")
            continue

        try:
            agent.run(query=query, source_documents=sources)
        except Exception as exc:
            print(f"\nError: {exc}", file=sys.stderr)
            if verbose:
                import traceback

                traceback.print_exc()

        print("\n" + "-" * 60 + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="HERALD Research Agent — Generate and validate research outputs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  uv run herald-research
  uv run herald-research --config configs/default.yaml
  uv run herald-research --verbose
        """,
    )
    parser.add_argument(
        "--config",
        default="configs/default.yaml",
        help="Path to HERALD config YAML (default: configs/default.yaml)",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Show full TaskPlan and debug output",
    )
    args = parser.parse_args()
    run_research_agent(config_path=args.config, verbose=args.verbose)


if __name__ == "__main__":
    main()
