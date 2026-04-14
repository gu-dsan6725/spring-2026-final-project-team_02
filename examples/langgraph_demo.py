"""
HERALD + LangGraph Integration Demo
====================================
Demonstrates HERALD as an inline agent validator inside a LangGraph state graph.

Graph topology
--------------
  retrieve ──► validate_retrieval ──► synthesize ──► validate_synthesis
                    │                                        │
                    │ INVALID                                │ INVALID
                    └──► (retry retrieve with modified       └──► flag_for_review
                           query, up to MAX_RETRIES)
                    │ VALID / UNCERTAIN
                    └──► synthesize

Run:
    uv run python examples/langgraph_demo.py
"""

from __future__ import annotations

import sys
import textwrap
from pathlib import Path
from typing import Annotated, TypedDict

import yaml
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages

# ── ensure the src/ tree is importable when run directly ─────────────────────
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

# Load .env from the project root before any HERALD imports touch os.environ
from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).parent.parent / ".env")

from herald.core.types import CheckpointOutput, CheckpointType, Verdict  # noqa: E402
from herald.pipeline.escalation import build_pipeline  # noqa: E402

# ── Config ────────────────────────────────────────────────────────────────────
CONFIG_PATH = Path(__file__).parent.parent / "configs" / "default.yaml"
MAX_RETRIES = 2

# ── Mock document corpus ──────────────────────────────────────────────────────
# Each document is (title, body).  The retriever picks one based on the query.
DOCS: list[dict] = [
    {
        "id": "doc_climate",
        "title": "2023 IPCC Climate Report Summary",
        "body": (
            "Global surface temperatures have risen by approximately 1.1 °C above "
            "pre-industrial levels as of 2023. The report attributes more than 90 % "
            "of observed warming to human greenhouse-gas emissions since the 1850s. "
            "Arctic sea-ice extent has declined at a rate of 13 % per decade since "
            "1979. Extreme heat events that once occurred once every 50 years now "
            "occur approximately once every 10 years."
        ),
    },
    {
        "id": "doc_economy",
        "title": "US GDP Growth Q3 2024",
        "body": (
            "US GDP grew at an annualised rate of 2.8 % in Q3 2024, driven by "
            "strong consumer spending and government investment. The unemployment "
            "rate held at 4.1 %. Inflation, as measured by the PCE deflator, "
            "eased to 2.1 %, approaching the Federal Reserve's 2 % target."
        ),
    },
    {
        "id": "doc_ai_safety",
        "title": "AI Safety Benchmarks 2025",
        "body": (
            "The Stanford HELM benchmark evaluated 30 frontier models in early 2025. "
            "Models scored an average of 74 % on factual-accuracy tasks. Hallucination "
            "rates on long-form generation ranged from 8 % to 31 % depending on domain. "
            "Tool-use reliability improved by 22 % year-over-year across evaluated systems."
        ),
    },
    {
        "id": "doc_bad_retrieval",  # deliberately off-topic — triggers HERALD rejection
        "title": "Cooking Recipe: Pasta Carbonara",
        "body": (
            "Boil 400 g of spaghetti in salted water. In a bowl whisk 4 egg yolks "
            "with 100 g of Pecorino Romano and plenty of black pepper. Render 150 g "
            "of guanciale until crisp. Toss the hot pasta with the guanciale fat, "
            "then off heat add the egg mixture and a splash of pasta water. Serve immediately."
        ),
    },
]


def _pick_doc(query: str, retry_count: int) -> dict:
    """
    Naïve mock retriever.

    On the first attempt for specific queries we deliberately return an
    irrelevant document so HERALD's INVALID verdict triggers a retry.
    On subsequent attempts we return a relevant document.
    """
    q = query.lower()

    # Query 2 is designed to trigger a retry: first call returns doc_bad_retrieval
    if "climate" in q:
        if retry_count == 0:
            return DOCS[3]  # off-topic — will be flagged INVALID by HERALD
        return DOCS[0]  # correct doc after retry
    elif "economy" in q or "gdp" in q:
        return DOCS[1]
    elif "ai" in q or "hallucin" in q or "benchmark" in q:
        return DOCS[2]
    else:
        return DOCS[0]  # default


def _bad_synthesis(doc: dict) -> str:
    """Return a synthesis that contradicts the source (for demo purposes)."""
    return (
        "According to recent data, global temperatures have risen by 3.5 °C "
        "above pre-industrial levels, with Arctic sea-ice declining at a rate "
        "of 50 % per decade. These figures represent a dramatic worsening "
        "beyond what any official body has reported."
    )


def _good_synthesis(doc: dict) -> str:
    """Return a faithful one-paragraph synthesis of the document."""
    return (
        f"Based on '{doc['title']}': {doc['body'][:300].rstrip('.')}."
        " These findings reflect the current state of knowledge as documented."
    )


# ── AgentState ────────────────────────────────────────────────────────────────


class AgentState(TypedDict):
    query: str
    retrieved_doc: dict | None
    herald_verdict: str | None  # "valid" | "invalid" | "uncertain"
    synthesis: str | None
    retry_count: int
    flagged_for_review: bool
    final_answer: str | None
    # log keeps a running narrative for the demo printout
    log: Annotated[list[str], add_messages]
    # set to True to force a bad synthesis (demo trigger)
    force_bad_synthesis: bool


# ── Pipeline (initialised once at module level) ───────────────────────────────


def _load_pipeline() -> object:
    with open(CONFIG_PATH) as f:
        config = yaml.safe_load(f)
    return build_pipeline(config)


_pipeline = _load_pipeline()


# ── Graph nodes ───────────────────────────────────────────────────────────────


def retrieve(state: AgentState) -> AgentState:
    doc = _pick_doc(state["query"], state["retry_count"])
    msg = f"[retrieve] Fetched: '{doc['title']}'"
    print(f"\n  {msg}")
    # Increment retry_count here (not in the router) so LangGraph persists it
    return {**state, "retrieved_doc": doc, "retry_count": state["retry_count"] + 1, "log": [msg]}


def validate_retrieval(state: AgentState) -> AgentState:
    doc = state["retrieved_doc"]
    # output_text = the retrieved doc; source_context = the query it should answer.
    # HERALD checks: "does this document actually address the user's question?"
    checkpoint = CheckpointOutput(
        checkpoint_type=CheckpointType.RETRIEVAL,
        output_text=doc["body"],
        source_context=state["query"],
        query=state["query"],
    )
    packet = _pipeline.validate(checkpoint)
    verdict = packet.final_verdict.value  # "valid" | "invalid" | "uncertain"
    tier = packet.resolved_at_tier

    msg = f"[validate_retrieval] HERALD verdict: {verdict.upper()} (resolved at Tier {tier})"
    print(f"  {msg}")
    return {**state, "herald_verdict": verdict, "log": [msg]}


def synthesize(state: AgentState) -> AgentState:
    doc = state["retrieved_doc"]
    if state.get("force_bad_synthesis"):
        text = _bad_synthesis(doc)
        msg = "[synthesize] Generated synthesis (intentionally flawed for demo)"
    else:
        text = _good_synthesis(doc)
        msg = "[synthesize] Generated synthesis"
    print(f"  {msg}")
    return {**state, "synthesis": text, "log": [msg]}


def validate_synthesis(state: AgentState) -> AgentState:
    doc = state["retrieved_doc"]
    checkpoint = CheckpointOutput(
        checkpoint_type=CheckpointType.SYNTHESIS,
        output_text=state["synthesis"],
        source_context=doc["body"],
        query=state["query"],
    )
    packet = _pipeline.validate(checkpoint)
    verdict = packet.final_verdict.value
    tier = packet.resolved_at_tier

    msg = f"[validate_synthesis] HERALD verdict: {verdict.upper()} (resolved at Tier {tier})"
    print(f"  {msg}")
    return {**state, "herald_verdict": verdict, "log": [msg]}


def flag_for_review(state: AgentState) -> AgentState:
    msg = "[flag_for_review] Synthesis flagged for human review — pipeline halted."
    print(f"  {msg}")
    return {**state, "flagged_for_review": True, "final_answer": None, "log": [msg]}


def emit_answer(state: AgentState) -> AgentState:
    answer = state["synthesis"]
    msg = "[emit_answer] Final answer accepted by HERALD."
    print(f"  {msg}")
    wrapped = textwrap.fill(answer, width=80, initial_indent="    ", subsequent_indent="    ")
    print(wrapped)
    return {**state, "final_answer": answer, "log": [msg]}


# ── Conditional edge functions ────────────────────────────────────────────────


def route_after_retrieval(state: AgentState) -> str:
    verdict = state["herald_verdict"]
    # retry_count was already incremented by retrieve(), so compare directly
    if verdict == Verdict.INVALID.value and state["retry_count"] <= MAX_RETRIES:
        print(
            f"  --> HERALD says INVALID → Retrying retrieval "
            f"(attempt {state['retry_count']}/{MAX_RETRIES})"
        )
        return "retry_retrieve"
    elif verdict == Verdict.INVALID.value:
        print("  --> HERALD says INVALID but max retries reached → proceeding anyway")
        return "synthesize"
    else:
        print(f"  --> HERALD says {verdict.upper()} → proceeding to synthesize")
        return "synthesize"


def route_after_synthesis(state: AgentState) -> str:
    verdict = state["herald_verdict"]
    if verdict == Verdict.INVALID.value:
        print("  --> HERALD says INVALID → flagging for human review")
        return "flag_for_review"
    else:
        print(f"  --> HERALD says {verdict.upper()} → emitting final answer")
        return "emit_answer"


# ── Build the graph ───────────────────────────────────────────────────────────


def build_graph() -> StateGraph:
    g = StateGraph(AgentState)

    g.add_node("retrieve", retrieve)
    g.add_node("validate_retrieval", validate_retrieval)
    g.add_node("synthesize", synthesize)
    g.add_node("validate_synthesis", validate_synthesis)
    g.add_node("flag_for_review", flag_for_review)
    g.add_node("emit_answer", emit_answer)

    g.set_entry_point("retrieve")
    g.add_edge("retrieve", "validate_retrieval")

    g.add_conditional_edges(
        "validate_retrieval",
        route_after_retrieval,
        {
            "retry_retrieve": "retrieve",
            "synthesize": "synthesize",
        },
    )

    g.add_edge("synthesize", "validate_synthesis")

    g.add_conditional_edges(
        "validate_synthesis",
        route_after_synthesis,
        {
            "flag_for_review": "flag_for_review",
            "emit_answer": "emit_answer",
        },
    )

    g.add_edge("flag_for_review", END)
    g.add_edge("emit_answer", END)

    return g.compile()


# ── Demo runner ───────────────────────────────────────────────────────────────


def run_demo(
    query: str,
    force_bad_synthesis: bool = False,
    label: str = "",
) -> None:
    header = f"Query: {query}"
    if label:
        header = f"{label} — {header}"
    print("\n" + "=" * 70)
    print(header)
    print("=" * 70)

    graph = build_graph()
    initial: AgentState = {
        "query": query,
        "retrieved_doc": None,
        "herald_verdict": None,
        "synthesis": None,
        "retry_count": 0,
        "flagged_for_review": False,
        "final_answer": None,
        "log": [],
        "force_bad_synthesis": force_bad_synthesis,
    }
    final = graph.invoke(initial)

    print("\n  --- Result ---")
    if final["flagged_for_review"]:
        print("  STATUS: Flagged for human review (synthesis rejected by HERALD)")
    elif final["final_answer"]:
        print("  STATUS: Answer delivered successfully")
    print()


if __name__ == "__main__":
    # ── Example 1: Clean run — good retrieval, faithful synthesis ────────────
    run_demo(
        query="What caused the increase in US GDP in Q3 2024?",
        label="Example 1 (clean run)",
    )

    # ── Example 2: Bad retrieval → HERALD triggers retry → success ───────────
    # The mock retriever returns an off-topic cooking doc on the first attempt.
    # HERALD's Tier 1 NLI detects the mismatch with the user's query and returns
    # INVALID.  The graph loops back to retrieve(), which returns the correct
    # climate report on the second attempt.
    run_demo(
        query="How much have global temperatures risen due to climate change?",
        label="Example 2 (retrieval retry demo)",
    )

    # ── Example 3: Good retrieval, bad synthesis → flagged for review ─────────
    # Synthesis contradicts the source document with fabricated statistics.
    # HERALD's Tier 2 LLM Judge catches the hallucination and returns INVALID,
    # routing the graph to flag_for_review instead of emitting an answer.
    run_demo(
        query="What do AI safety benchmarks say about hallucination rates?",
        force_bad_synthesis=True,
        label="Example 3 (hallucinated synthesis → human review)",
    )
