"""HERALD Interactive Evaluation Agent.

A conversational Claude agent that wraps the HERALD pipeline as tools,
enabling natural-language interaction with the 4-tier validation system.

Architecture:
  - Claude (claude-opus-4-6) acts as the reasoning/conversational layer
  - HERALD pipeline (Groq + local NLI) handles the actual evaluation tiers
  - Six tools: validate_checkpoint, explain_verdict, request_human_review,
    analyze_task, validate_batch, generate_and_validate
  - Manual agentic loop for full control (human-in-the-loop at Tier 4)

Modes:
  uv run herald-agent            — interactive validation mode (default)
  uv run herald-agent --research — research agent mode (generate + validate)

Usage:
  uv run herald-agent
  uv run herald-agent --config configs/default.yaml
  uv run herald-agent --verbose
  uv run herald-agent --research
"""

import argparse
import json
import logging
import sys

import anthropic

from herald.agent.tools import TOOL_DEFINITIONS, execute_tool
from herald.core.config import load_config
from herald.pipeline.escalation import build_pipeline

SYSTEM_PROMPT = """You are HERALD, an interactive LLM evaluation assistant specializing in \
validating economics research agent outputs for faithfulness to their source material.

You have six tools:

1. **validate_checkpoint** — Run the full 4-tier HERALD validation pipeline on a single output.
   Tiers: NLI classifier (local) → LLM judge → multi-agent debate → human review.
   Use this whenever the user submits a single output to validate.

2. **explain_verdict** — Unpack a prior result in plain language.
   Use this when the user asks "why?" or wants to understand a verdict.

3. **request_human_review** — Interactively adjudicate cases that automation couldn't resolve.
   First call presents the evidence; second call (with human_verdict) records the decision.
   Use this when validate_checkpoint returns UNCERTAIN at Tier 4.

4. **analyze_task** — Phase 0: analyze a research task and return a TaskPlan.
   Returns structured metadata: output count, checkpoint types, evaluation mode, NLI routing.
   Use this before validate_batch to understand the task structure.

5. **validate_batch** — Phase 2: batch-validate multiple outputs at once.
   Takes a list of outputs and runs them through HERALD per the TaskPlan routing rules.
   Returns aggregate statistics and flags any outputs needing human review.

6. **generate_and_validate** — Full pipeline: analyze → generate outputs → validate.
   Given a query + source documents, generates the requested outputs AND validates them.
   Use this for end-to-end research tasks.

Checkpoint types and what they mean:
- retrieval: Was the retrieved document topically relevant to the query?
- claim_extraction: Is every assertion directly entailed by the source (no added inference)?
- synthesis: Does the summary faithfully represent the source without introducing new claims?
- numerical: Do reported numbers match the source within reasonable rounding?
- causal: Does causal language stay within the strength of evidence the source provides?
- epistemic: Does the output preserve the uncertainty hedges present in the source?

Interaction guidelines:
- When a user pastes a single output + source, use validate_checkpoint.
- When a user submits multiple outputs or asks for full research task execution, use
  generate_and_validate (which runs Phase 0→1→2) or validate_batch (Phase 2 only).
- Always surface the verdict, tier, confidence, and key reasoning in plain language.
- For UNCERTAIN Tier 4 results, proactively call request_human_review to present evidence,
  then wait for the user's verdict before recording it.
- For follow-up questions about a prior result, use explain_verdict with the result_id.
- Be concise. Lead with the verdict, then explain. Don't repeat the full source context back.
- You can validate multiple checkpoints in one session — each gets its own result_id."""


def _print_streaming(stream: anthropic.Stream) -> str:
    """Stream response text to stdout and return the full text."""
    full_text = ""
    for event in stream:
        if event.type == "content_block_delta" and event.delta.type == "text_delta":
            chunk = event.delta.text
            print(chunk, end="", flush=True)
            full_text += chunk
    return full_text


def run_agent(config_path: str = "configs/default.yaml", verbose: bool = False) -> None:
    """Run the interactive HERALD agent loop."""
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.WARNING,
        format="%(asctime)s [herald] %(message)s",
    )

    # ── Load config and build pipeline ──────────────────────────────────────
    config = load_config(config_path)

    anthropic_api_key = config.get("anthropic_api_key", "")
    if not anthropic_api_key:
        print(
            "Error: ANTHROPIC_API_KEY not set.\n"
            "Add it to your .env file: ANTHROPIC_API_KEY=your_key_here\n"
            "Get a key at https://console.anthropic.com",
            file=sys.stderr,
        )
        sys.exit(1)

    print("Loading HERALD pipeline (Tier 1 NLI model may take a moment)...")
    pipeline = build_pipeline(config)

    client = anthropic.Anthropic(api_key=anthropic_api_key)

    # ── Session state ────────────────────────────────────────────────────────
    messages: list[dict] = []

    print("\n" + "=" * 60)
    print("HERALD — Interactive Evaluation Agent")
    print("=" * 60)
    print("Paste an agent output + source context to validate.")
    print("Ask 'why?' to explain any verdict. Type 'exit' to quit.\n")

    # ── Main conversation loop ───────────────────────────────────────────────
    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye.")
            break

        if not user_input:
            continue
        if user_input.lower() in ("exit", "quit", "q"):
            print("Goodbye.")
            break

        messages.append({"role": "user", "content": user_input})

        # ── Agentic loop: run until Claude stops calling tools ───────────────
        while True:
            print("\nHERALD: ", end="", flush=True)

            with client.messages.stream(
                model="claude-opus-4-6",
                max_tokens=4096,
                thinking={"type": "adaptive"},
                system=SYSTEM_PROMPT,
                tools=TOOL_DEFINITIONS,
                messages=messages,
            ) as stream:
                final = stream.get_final_message()

            # Print any text blocks (thinking blocks are silent)
            assistant_text = ""
            for block in final.content:
                if block.type == "text":
                    print(block.text, end="", flush=True)
                    assistant_text += block.text

            # Append full content (preserves tool_use and thinking blocks)
            messages.append({"role": "assistant", "content": final.content})

            # Check stop reason
            if final.stop_reason == "end_turn":
                print()  # newline after response
                break

            if final.stop_reason != "tool_use":
                print(f"\n[Unexpected stop reason: {final.stop_reason}]")
                break

            # ── Execute all tool calls ───────────────────────────────────────
            tool_results = []
            for block in final.content:
                if block.type != "tool_use":
                    continue

                tool_name = block.name
                tool_input = block.input

                if verbose:
                    print(f"\n[Tool call: {tool_name}({json.dumps(tool_input, indent=2)})]")
                else:
                    print(f"\n[Running {tool_name}...]", flush=True)

                try:
                    result_str = execute_tool(
                        tool_name, tool_input, pipeline, anthropic_client=client
                    )
                except Exception as exc:
                    result_str = json.dumps({"error": str(exc)})

                if verbose:
                    print(f"[Tool result: {result_str[:300]}...]")

                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result_str,
                    }
                )

            messages.append({"role": "user", "content": tool_results})
            # Loop continues — Claude will now respond to tool results

        print()  # blank line between turns


def main() -> None:
    parser = argparse.ArgumentParser(
        description="HERALD Interactive Evaluation Agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  uv run herald-agent
  uv run herald-agent --config configs/default.yaml
  uv run herald-agent --verbose
  uv run herald-agent --research          # full research agent mode
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
        help="Show tool call inputs/outputs for debugging",
    )
    parser.add_argument(
        "--research",
        action="store_true",
        help=(
            "Run in research agent mode: provide a query + source documents, "
            "and HERALD will generate and validate outputs end-to-end."
        ),
    )
    args = parser.parse_args()

    if args.research:
        from herald.agent.research_agent import run_research_agent

        run_research_agent(config_path=args.config, verbose=args.verbose)
    else:
        run_agent(config_path=args.config, verbose=args.verbose)


if __name__ == "__main__":
    main()
