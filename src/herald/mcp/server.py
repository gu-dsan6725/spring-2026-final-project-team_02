"""HERALD MCP Server — exposes the validation pipeline as MCP Tools.

Any MCP-compatible client (Claude Desktop, Claude Agent SDK, LangGraph, etc.)
can call HERALD as a validation service without importing it as a Python library
or running a subprocess.

Tools exposed:
  validate_checkpoint  — run the full 4-tier pipeline on a single output
  validate_batch       — validate a list of outputs against the same source
  explain_verdict      — get a plain-language breakdown of a prior result

Resources exposed (read-only):
  herald://results/{run_id}       — JSON results of a named run
  herald://evaluations/{eval_id}  — evaluation metrics for a run

Usage:
  # Start the server (Streamable HTTP on port 8000):
  uv run herald-mcp

  # Or directly:
  uv run python -m herald.mcp.server

  # Connect from Claude Desktop by adding to claude_desktop_config.json:
  {
    "mcpServers": {
      "herald": {
        "url": "http://localhost:8000/mcp"
      }
    }
  }

Environment variables required (same as the rest of HERALD):
  GEMINI_API_KEY or GROQ_API_KEY or OPENAI_API_KEY
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from pathlib import Path

logger = logging.getLogger("herald.mcp")

# ── Lazy pipeline singleton ───────────────────────────────────────────────────
# The DeBERTa model takes several seconds to load. Build the pipeline once at
# server startup and reuse it across all tool calls.

_pipeline = None
_config = None


def _get_pipeline():
    global _pipeline, _config
    if _pipeline is not None:
        return _pipeline

    import yaml

    from herald.pipeline.escalation import build_pipeline

    config_path = os.environ.get("HERALD_CONFIG", "configs/default.yaml")
    with open(config_path) as f:
        _config = yaml.safe_load(f)

    logger.info(f"[MCP] Building pipeline from {config_path}…")
    _pipeline = build_pipeline(_config)
    logger.info("[MCP] Pipeline ready")
    return _pipeline


# ── In-session result store ───────────────────────────────────────────────────

_result_store: dict[str, dict] = {}


def _store_result(result: dict) -> str:
    rid = str(uuid.uuid4())[:8]
    _result_store[rid] = result
    return rid


# ── Server ────────────────────────────────────────────────────────────────────


def create_server():
    """Build and return the FastMCP server instance."""
    try:
        from mcp.server.fastmcp import FastMCP
    except ImportError as err:
        raise ImportError(
            "fastmcp is not installed. Run: uv add mcp\n"
            "See https://gofastmcp.com for docs."
        ) from err

    from herald.core.types import CheckpointOutput, CheckpointType

    mcp = FastMCP(
        "herald-validator",
        instructions=(
            "HERALD is a 4-tier LLM output validation pipeline. "
            "Use validate_checkpoint to check a single claim against its source. "
            "Use validate_batch for multiple outputs at once. "
            "Use explain_verdict to understand why a verdict was reached."
        ),
    )

    # ── Tool: validate_checkpoint ─────────────────────────────────────────────

    @mcp.tool()
    def validate_checkpoint(
        output_text: str,
        source_context: str,
        checkpoint_type: str,
        query: str = "",
    ) -> dict:
        """Run HERALD 4-tier validation on a single LLM output.

        Args:
            output_text:      The agent's output text to validate.
            source_context:   The source material the output must be grounded in.
            checkpoint_type:  One of: retrieval, claim_extraction, synthesis,
                              numerical, causal, epistemic.
            query:            Optional original research question.

        Returns a dict with verdict (valid/invalid/uncertain), resolved_at_tier,
        confidence, reasoning, and a result_id for use with explain_verdict.
        """
        pipeline = _get_pipeline()

        try:
            cp_type = CheckpointType(checkpoint_type)
        except ValueError:
            valid = [e.value for e in CheckpointType]
            return {"error": f"Unknown checkpoint_type '{checkpoint_type}'. Valid: {valid}"}

        checkpoint = CheckpointOutput(
            checkpoint_type=cp_type,
            output_text=output_text,
            source_context=source_context,
            query=query,
        )
        packet = pipeline.validate(checkpoint)

        result = {
            "verdict": packet.final_verdict.value,
            "resolved_at_tier": packet.resolved_at_tier,
            "checkpoint_type": checkpoint_type,
        }

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
                "verdict": packet.tier3_result.judge_verdict.value,
                "confidence": round(packet.tier3_result.judge_confidence, 3),
                "reasoning": packet.tier3_result.judge_reasoning,
            }

        result_id = _store_result(result)
        result["result_id"] = result_id
        return result

    # ── Tool: validate_batch ──────────────────────────────────────────────────

    @mcp.tool()
    def validate_batch(
        outputs: list[dict],
        source_context: str,
        checkpoint_type: str = "claim_extraction",
    ) -> dict:
        """Validate a list of outputs against the same source context.

        Args:
            outputs:          List of {"text": str, "checkpoint_type": str (optional)}.
            source_context:   Source all outputs are grounded in.
            checkpoint_type:  Default checkpoint type if not specified per output.

        Returns aggregate counts (valid/invalid/uncertain) and per-output verdicts.
        """
        pipeline = _get_pipeline()

        from herald.core.types import CheckpointOutput, CheckpointType

        results = []
        summary = {"valid": 0, "invalid": 0, "uncertain": 0}

        for i, item in enumerate(outputs):
            text = item.get("text", "")
            cp_str = item.get("checkpoint_type", checkpoint_type)
            try:
                cp_type = CheckpointType(cp_str)
            except ValueError:
                cp_type = CheckpointType("claim_extraction")

            checkpoint = CheckpointOutput(
                checkpoint_type=cp_type,
                output_text=text,
                source_context=source_context,
            )
            packet = pipeline.validate(checkpoint)
            verdict = packet.final_verdict.value
            summary[verdict] = summary.get(verdict, 0) + 1

            result = {
                "index": i,
                "text": text[:200],
                "verdict": verdict,
                "resolved_at_tier": packet.resolved_at_tier,
            }
            result_id = _store_result(result)
            result["result_id"] = result_id
            results.append(result)

        return {"summary": summary, "results": results}

    # ── Tool: explain_verdict ─────────────────────────────────────────────────

    @mcp.tool()
    def explain_verdict(result_id: str) -> dict:
        """Get a plain-language explanation of a prior validation result.

        Args:
            result_id: The result_id returned by validate_checkpoint or validate_batch.

        Returns the full tier-by-tier reasoning for why the verdict was reached.
        """
        result = _result_store.get(result_id)
        if result is None:
            return {
                "error": f"No result found for ID '{result_id}'. "
                "Call validate_checkpoint first and use the returned result_id."
            }
        return result

    # ── Resource: results file ────────────────────────────────────────────────

    @mcp.resource("herald://results/{run_id}")
    def get_run_results(run_id: str) -> str:
        """Read the JSON results file for a named run.

        Args:
            run_id: Run directory name, e.g. 'run_07_govreport_v2'.
        """
        path = Path("results/runs") / run_id / "results.json"
        if not path.exists():
            return json.dumps({"error": f"No results found for run '{run_id}' at {path}"})
        with open(path) as f:
            return f.read()

    @mcp.resource("herald://evaluations/{eval_id}")
    def get_evaluation(eval_id: str) -> str:
        """Read the evaluation metrics JSON for a named eval.

        Args:
            eval_id: Evaluation file stem, e.g. 'run_07_govreport_v2_eval'.
        """
        path = Path("results/evaluation") / f"{eval_id}.json"
        if not path.exists():
            return json.dumps({"error": f"No evaluation found for '{eval_id}' at {path}"})
        with open(path) as f:
            return f.read()

    return mcp


def main():
    """Entry point for `uv run herald-mcp`."""
    import argparse

    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description="HERALD MCP Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8000, help="Port to listen on (default: 8000)")
    parser.add_argument(
        "--transport",
        default="streamable-http",
        choices=["streamable-http", "stdio"],
        help="MCP transport (default: streamable-http)",
    )
    args = parser.parse_args()

    server = create_server()
    logger.info(f"[MCP] Starting HERALD MCP server on {args.host}:{args.port} ({args.transport})")
    server.run(transport=args.transport, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
