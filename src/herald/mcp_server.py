"""HERALD MCP Server.

Exposes the HERALD 4-tier validation pipeline as MCP tools so that any
MCP-compatible agent can call into HERALD for validation without embedding
the full pipeline in its own codebase.

Six tools are exposed:
  validate_checkpoint    — run the full 4-tier escalation on a single output
  explain_verdict        — unpack a prior result in plain language
  request_human_review   — surface a Tier-4 case for human adjudication
  analyze_task           — Phase 0 task analysis → TaskPlan
  validate_batch         — Phase 2 batch validation
  generate_and_validate  — Phase 0→1→2 end-to-end pipeline

Configuration
-------------
The server reads config from configs/default.yaml by default.
Override with the HERALD_CONFIG env var:

    HERALD_CONFIG=/path/to/config.yaml uv run herald-mcp

Add to Claude Code (.claude/settings.json):

    {
      "mcpServers": {
        "herald": {
          "command": "uv",
          "args": ["run", "herald-mcp"],
          "cwd": "/path/to/project"
        }
      }
    }

Or claude_desktop_config.json:

    {
      "mcpServers": {
        "herald": {
          "command": "uv",
          "args": ["--directory", "/path/to/project", "run", "herald-mcp"]
        }
      }
    }
"""

import asyncio
import json
import logging
import os
import sys

from mcp import types
from mcp.server import Server
from mcp.server.stdio import stdio_server

from herald.agent.tools import TOOL_DEFINITIONS, execute_tool

logger = logging.getLogger("herald.mcp")

# ── Lazy singletons ──────────────────────────────────────────────────────────
# Initialized on first tool call so the MCP handshake completes immediately
# even though the DeBERTa model takes several seconds to load.

_pipeline = None
_anthropic_client = None
_init_error: str | None = None
_init_lock = asyncio.Lock()


def _load_pipeline() -> None:
    """Blocking pipeline init — called via asyncio.to_thread."""
    global _pipeline, _init_error
    try:
        from herald.core.config import load_config
        from herald.pipeline.escalation import build_pipeline

        config_path = os.environ.get("HERALD_CONFIG", "configs/default.yaml")
        logger.warning("Loading HERALD pipeline (Tier 1 NLI model may take a moment)...")
        config = load_config(config_path)
        _pipeline = build_pipeline(config)
        logger.warning("HERALD pipeline ready.")
    except Exception as exc:
        _init_error = str(exc)
        logger.error("HERALD pipeline init failed: %s", exc)


def _get_anthropic_client():
    """Return an Anthropic client if ANTHROPIC_API_KEY is set, else None."""
    global _anthropic_client
    if _anthropic_client is not None:
        return _anthropic_client
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if api_key:
        import anthropic
        _anthropic_client = anthropic.Anthropic(api_key=api_key)
    return _anthropic_client


async def _ensure_pipeline() -> None:
    """Initialize the pipeline exactly once, thread-safely."""
    global _pipeline, _init_error
    if _pipeline is not None or _init_error is not None:
        return
    async with _init_lock:
        # Re-check after acquiring lock in case another coroutine raced us.
        if _pipeline is None and _init_error is None:
            await asyncio.to_thread(_load_pipeline)


# ── MCP server ───────────────────────────────────────────────────────────────

server = Server("herald")


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    """Return all HERALD tools as MCP Tool objects."""
    return [
        types.Tool(
            name=t["name"],
            description=t["description"],
            inputSchema=t["input_schema"],
        )
        for t in TOOL_DEFINITIONS
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    """Dispatch a tool call to the HERALD pipeline."""
    await _ensure_pipeline()

    if _init_error:
        payload = json.dumps({"error": f"Pipeline failed to initialize: {_init_error}"})
        return [types.TextContent(type="text", text=payload)]

    if _pipeline is None:
        payload = json.dumps({"error": "Pipeline not available. Check server logs."})
        return [types.TextContent(type="text", text=payload)]

    # execute_tool is synchronous (NLI + LLM calls); run in a thread so we
    # don't block the MCP event loop during long Tier 2/3 LLM calls.
    result_str = await asyncio.to_thread(
        execute_tool,
        name,
        arguments,
        _pipeline,
        _get_anthropic_client(),
    )
    return [types.TextContent(type="text", text=result_str)]


# ── Entry point ──────────────────────────────────────────────────────────────

async def _run() -> None:
    logging.basicConfig(
        level=logging.WARNING,
        format="%(asctime)s [herald.mcp] %(message)s",
        stream=sys.stderr,
    )
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(),
        )


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
