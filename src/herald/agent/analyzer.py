"""Phase 0: Task Analyzer.

Analyzes any user prompt + source documents before execution to understand
task structure and produce a TaskPlan that drives validation strategy.

The TaskAnalyzer calls Claude to determine:
  - How many outputs the task will produce (and what unit)
  - Which checkpoint types apply
  - Whether to run exhaustive, sampled, or adaptive validation
  - Which checkpoint types should skip Tier 1 NLI (it's weak on causal/epistemic)
  - Which benefit from multi-agent debate
  - How source documents should be chunked per output

This is intentionally a lightweight Claude call — use a smaller/cheaper model
(Sonnet) so Phase 0 adds minimal latency to the pipeline.
"""

import json
import logging
import time

import anthropic

from herald.core.types import CheckpointType, TaskPlan

logger = logging.getLogger("herald")


ANALYSIS_PROMPT = """You are a task analysis assistant for HERALD, an LLM evaluation framework.

Analyze the user's research task and return a structured plan describing how the task
should be evaluated.

## User Query
{query}

## Source Documents (summary/excerpt)
{source_summary}

## Your Task
Return a JSON object with EXACTLY these fields:

{{
  "expected_output_count": <integer or "single" or "multiple">,
  "output_unit": "<what each output is: 'comment', 'claim', 'paragraph', 'bullet point', 'answer', 'summary', 'recommendation', etc.>",
  "primary_checkpoint_types": [<list from: "retrieval", "claim_extraction", "synthesis", "numerical", "causal", "epistemic">],
  "requires_source_mapping": <true if outputs reference specific source sections, false otherwise>,
  "task_nature": "<'empirical' if outputs are factual/verifiable, 'subjective' if interpretive/opinion, 'mixed' if both>",
  "evaluation_mode": "<'exhaustive' for <=20 outputs, 'sampled' for >20, 'adaptive' for ambiguous count>",
  "sample_size": <integer if evaluation_mode is 'sampled', else null>,
  "skip_nli_for": [<checkpoint types where NLI is unreliable: typically 'causal', 'epistemic'>],
  "debate_recommended_for": [<checkpoint types that benefit from adversarial debate: typically 'causal', 'synthesis'>],
  "source_type": "<'single_document', 'multiple_documents', or 'conversation'>",
  "source_chunking": "<'by_section', 'by_page', 'whole_document', or 'per_output'>"
}}

## Guidelines
- expected_output_count: if query says "5 bullet points" → 5, "a summary" → "single", "100 comments" → 100
- primary_checkpoint_types: pick ALL that apply. Most tasks involve claim_extraction. Summaries add synthesis.
  Numeric tasks add numerical. Causal language ("led to", "caused") adds causal. Hedged language adds epistemic.
- skip_nli_for: NLI is a bag-of-words entailment model — it cannot evaluate causal attribution strength
  or whether uncertainty hedges are preserved. Always include "causal" and "epistemic" here.
- debate_recommended_for: multi-agent debate adds value for ambiguous causal claims and synthesis tasks
  where different framings are plausible. Include "causal" and "synthesis" here when present.
- source_chunking: 'per_output' means each output maps to a specific section; 'whole_document' means
  every output is validated against the full source; 'by_section' means the source has clear sections
  and outputs map to them.
- evaluation_mode: use 'exhaustive' for <=20 outputs, 'sampled' for >20 (validate a representative
  sample), 'adaptive' when the count is determined at runtime.
- sample_size: for 'sampled' mode, a reasonable default is min(20, ceil(0.15 * expected_output_count)).

Respond with ONLY the JSON object, no commentary."""


class TaskAnalyzer:
    """Phase 0: Analyzes a task and produces a TaskPlan for the validation pipeline."""

    def __init__(self, client: anthropic.Anthropic, model: str = "claude-sonnet-4-20250514"):
        self.client = client
        self.model = model

    def analyze(
        self,
        query: str,
        source_documents: str,
        max_retries: int = 3,
        retry_delay: float = 2.0,
    ) -> TaskPlan:
        """Analyze a task and return a TaskPlan.

        Args:
            query: The user's research question or task description.
            source_documents: The source material (may be long; we excerpt for the prompt).
            max_retries: Number of retry attempts on parse failure.
            retry_delay: Seconds to wait between retries.

        Returns:
            TaskPlan with all fields populated.
        """
        # Truncate source for the analysis prompt — we only need structure, not full content
        source_summary = source_documents[:2000]
        if len(source_documents) > 2000:
            source_summary += f"\n[...{len(source_documents) - 2000} more characters...]"

        prompt = ANALYSIS_PROMPT.format(
            query=query,
            source_summary=source_summary,
        )

        last_err = None
        for attempt in range(max_retries):
            try:
                response = self.client.messages.create(
                    model=self.model,
                    max_tokens=1024,
                    messages=[{"role": "user", "content": prompt}],
                )
                raw = response.content[0].text.strip()

                # Strip markdown code fences if present
                if raw.startswith("```"):
                    raw = raw.split("```")[1]
                    if raw.startswith("json"):
                        raw = raw[4:]
                    raw = raw.strip()

                data = json.loads(raw)
                return self._parse_plan(data)

            except (json.JSONDecodeError, KeyError, ValueError) as e:
                last_err = e
                logger.warning(f"[TaskAnalyzer] Parse failed attempt {attempt + 1}: {e}")
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)

        raise RuntimeError(
            f"TaskAnalyzer failed after {max_retries} attempts: {last_err}"
        )

    def _parse_plan(self, data: dict) -> TaskPlan:
        """Parse and validate raw JSON into a TaskPlan."""

        def _parse_checkpoint_list(raw: list) -> list[CheckpointType]:
            result = []
            for item in raw:
                try:
                    result.append(CheckpointType(item))
                except ValueError:
                    logger.warning(f"[TaskAnalyzer] Unknown checkpoint type '{item}', skipping")
            return result

        # expected_output_count: accept int or string
        eoc = data["expected_output_count"]
        if isinstance(eoc, str) and eoc.isdigit():
            eoc = int(eoc)

        primary = _parse_checkpoint_list(data.get("primary_checkpoint_types", []))
        skip_nli = _parse_checkpoint_list(data.get("skip_nli_for", []))
        debate = _parse_checkpoint_list(data.get("debate_recommended_for", []))

        # Validate literal fields
        task_nature = data.get("task_nature", "mixed")
        if task_nature not in ("empirical", "subjective", "mixed"):
            task_nature = "mixed"

        eval_mode = data.get("evaluation_mode", "adaptive")
        if eval_mode not in ("exhaustive", "sampled", "adaptive"):
            eval_mode = "adaptive"

        source_type = data.get("source_type", "single_document")
        if source_type not in ("single_document", "multiple_documents", "conversation"):
            source_type = "single_document"

        chunking = data.get("source_chunking", "whole_document")
        if chunking not in ("by_section", "by_page", "whole_document", "per_output"):
            chunking = "whole_document"

        sample_size = data.get("sample_size")
        if sample_size is not None:
            try:
                sample_size = int(sample_size)
            except (TypeError, ValueError):
                sample_size = None

        return TaskPlan(
            expected_output_count=eoc,
            output_unit=str(data.get("output_unit", "output")),
            primary_checkpoint_types=primary,
            requires_source_mapping=bool(data.get("requires_source_mapping", False)),
            task_nature=task_nature,
            evaluation_mode=eval_mode,
            sample_size=sample_size,
            skip_nli_for=skip_nli,
            debate_recommended_for=debate,
            source_type=source_type,
            source_chunking=chunking,
        )
