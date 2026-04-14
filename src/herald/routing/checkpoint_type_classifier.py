"""Checkpoint type classifiers for HERALD.

Two implementations that infer CheckpointType from output_text + query alone,
so callers (MCP clients, agents) don't need to know the taxonomy:

  RuleBasedClassifier   — regex/keyword heuristics, zero latency, no API calls
  LLMClassifier         — single small-LLM call, higher accuracy, ~0.5s latency

Both share the same interface:

    classifier = RuleBasedClassifier()          # or LLMClassifier(config)
    result = classifier.classify(output_text, query, source_context)
    # result.checkpoint_type  → CheckpointType
    # result.confidence       → float 0–1
    # result.rationale        → str (why this type was chosen)
    # result.method           → "rule_based" | "llm"

Usage in MCP / policy agent:
    Pass checkpoint_type="auto" to validate_checkpoint and the MCP server
    will call the configured classifier before running the pipeline.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

from herald.core.types import CheckpointType

logger = logging.getLogger("herald.routing")

# ── Shared result type ────────────────────────────────────────────────────────


@dataclass
class ClassifierResult:
    checkpoint_type: CheckpointType
    confidence: float  # 0.0–1.0
    rationale: str  # human-readable reason for the choice
    method: str  # "rule_based" | "llm"


# ─────────────────────────────────────────────────────────────────────────────
# 1. Rule-Based Classifier
# ─────────────────────────────────────────────────────────────────────────────

# Patterns are evaluated in priority order against specific fields.
# Rules come in two flavours:
#   _qrule  — matches only on the query  (high precision: the question tells us what type it is)
#   _orule  — matches only on output_text (fallback when query is absent or ambiguous)
#   _rule   — matches on query + output_text concatenated (legacy, use sparingly)
#
# Each entry: (CheckpointType, confidence, compiled_pattern, rationale, field)
# field: "query" | "output" | "both"

_RULE_TABLE: list[tuple[CheckpointType, float, re.Pattern, str, str]] = []


def _rule(
    ct: CheckpointType, conf: float, pattern: str, rationale: str, field: str = "both"
) -> None:
    _RULE_TABLE.append((ct, conf, re.compile(pattern, re.IGNORECASE | re.DOTALL), rationale, field))


def _qrule(ct: CheckpointType, conf: float, pattern: str, rationale: str) -> None:
    _rule(ct, conf, pattern, rationale, field="query")


def _orule(ct: CheckpointType, conf: float, pattern: str, rationale: str) -> None:
    _rule(ct, conf, pattern, rationale, field="output")


# ─────────────────────────────────────────────────────────────────────────────
# Rules — evaluated top to bottom; first match wins.
# ─────────────────────────────────────────────────────────────────────────────

# ── Retrieval (high precision: query explicitly asks for a report/document) ───
_qrule(
    CheckpointType.RETRIEVAL,
    0.92,
    r"\bwhat\b.{0,60}\b(gao|report|document|source|publication|paper|study|article)s?\b"
    r".{0,40}\b(address(es)?|cover(s)?|discuss(es)?|provid(es)?|background)\b",
    "query asks which document addresses a topic",
)
_qrule(
    CheckpointType.RETRIEVAL,
    0.88,
    r"\b(retriev(al|ed?)|relevant (document|source|report|paper)|topical(ly)?)\b",
    "query contains explicit retrieval language",
)

# ── Numerical: query is specifically about a quantity ─────────────────────────
# We gate on query first so a synthesis output that happens to mention a number
# doesn't get misclassified.
_qrule(
    CheckpointType.NUMERICAL,
    0.90,
    r"\b(how many|what (number|amount|percentage|proportion|share|rate|count|total)|"
    r"numeric(al)?|quantif(y|ied)|statistic(s|al)?|what (is|was|were) the (rate|number|"
    r"percentage|count|total|amount|figure|cost|price|budget))\b",
    "query asks for a specific quantity or numeric fact",
)
# Fallback: output leads with a number as its primary claim (not buried mid-sentence)
_orule(
    CheckpointType.NUMERICAL,
    0.82,
    r"^[\w\s,\-]{0,60}(\$[\d,\.]+\s*(million|billion|thousand)?|\b\d+[\.,]?\d*\s*%)",
    "output opens with a dollar amount or percentage — number is the primary claim",
)

# ── Causal: query asks about causes / factors / why something happened ────────
_qrule(
    CheckpointType.CAUSAL,
    0.92,
    r"\b(what (factor|cause|reason|barrier|challenge|driver)s?\b|"
    r"why (did|does|is|are|was|were)|"
    r"(contribut|lead|result|driv)\w* (to|in)\b|"
    r"what (contributes?|leads?|results?|drives?) to)\b",
    "query asks for causal factors or barriers",
)
_orule(
    CheckpointType.CAUSAL,
    0.85,
    r"\b(caus(e[ds]?|ing|ation)|lead(s|ing)? to|result(s|ed|ing)? (in|from)|"
    r"due to\b|attribut(e[ds]?|ing|ion)|driv(e[ns]?|ing)|contribut(e[ds]?|ing|ion) to|"
    r"because of|stemm(ed|ing) from|trigger(s|ed|ing)? (a|an|the)\b|"
    r"\bhindered?\b|\bimpeded?\b)\b",
    "output contains causal attribution language",
)

# ── Synthesis: query asks for a broad overview / how something works ───────────
# This fires BEFORE the generic claim_extraction so "how does X work" is
# captured here rather than falling to the claim_extraction default.
_qrule(
    CheckpointType.SYNTHESIS,
    0.90,
    r"\bhow (does|do|did|has|have|is|are)\b.{0,80}"
    r"\b(work|function|operat\w*|facilitat\w*|provid\w*|structur\w*|organiz\w*|design\w*|implement\w*)",
    "query asks how something works or operates",
)
_qrule(
    CheckpointType.SYNTHESIS,
    0.87,
    r"\b(what (is|are|was|were) the (overall|general|primary|main|key|broad)"
    r".{0,40}(approach|framework|process|mechanism|strategy|method|system|program))\b",
    "query asks for an overview of an approach or program",
)
_qrule(
    CheckpointType.SYNTHESIS,
    0.85,
    r"\b(descri(be|bes|bed)|explain|summar(ize|y)|overview|outline)"
    r".{0,60}(program|system|process|framework|approach|initiative|effort|policy)\b",
    "query asks for a description or summary of a program/process",
)
_orule(
    CheckpointType.SYNTHESIS,
    0.78,
    r"\b(summar(y|iz(e[ds]?|ing))|overall|in (general|summary|brief|total)|"
    r"synthesiz(e[ds]?|ing)|taken together|on the whole|comprehensive(ly)?|"
    r"multiple (advantages?|benefit|aspect|component|element|factor)|"
    r"(several|various|both) .{0,40}(advantage|benefit|aspect|component|element))\b",
    "output uses explicit summary/synthesis language or lists multiple aspects",
)

# ── Epistemic: uncertainty hedges ─────────────────────────────────────────────
_qrule(
    CheckpointType.EPISTEMIC,
    0.88,
    r"\b(uncertain(ty)?|confidence|limitation|hedge|caveat|"
    r"how (certain|confident|sure)|does (the (output|claim|answer)) (preserve|reflect|maintain)"
    r".{0,30}(uncertainty|hedge|caveat|limit))\b",
    "query asks about uncertainty or confidence calibration",
)
_orule(
    CheckpointType.EPISTEMIC,
    0.82,
    r"\b(it is (unclear|unknown|uncertain|possible|estimated)|"
    r"tentative(ly)?|hedge[ds]?|caveat[s]?|limitation[s]?\b|"
    r"acknowledg(e[ds]?|ing) (limit|uncertain|gap))\b",
    "output contains explicit epistemic hedge language",
)

# ── Claim extraction: catch-all for direct single-fact queries ────────────────
_qrule(
    CheckpointType.CLAIM_EXTRACTION,
    0.72,
    r"\b(what (is|are|was|were|did)|who (is|are|was|were)|when (did|does|was)|"
    r"where (is|are|was)|what (advantage|benefit|purpose|goal|objective|role|function)"
    r".{0,40}(provide|offer|serve|play))\b",
    "query is a direct what/who/when/where fact question",
)


class RuleBasedClassifier:
    """Zero-cost checkpoint type classifier using regex heuristics.

    Matches the combined query + output_text against an ordered rule table.
    The first rule that fires wins. If nothing fires, falls back to
    claim_extraction (the most common type, ~72% of the dev set).

    Confidence values reflect empirically estimated precision of each rule,
    NOT a probability distribution over types. Use them to decide whether to
    show the user a warning or fall back to the LLMClassifier.
    """

    FALLBACK_TYPE = CheckpointType.CLAIM_EXTRACTION
    FALLBACK_CONF = 0.55

    def classify(
        self,
        output_text: str,
        query: str = "",
        source_context: str = "",  # accepted for interface parity; not used
    ) -> ClassifierResult:
        """Classify a single output.

        Args:
            output_text:    The agent's output to be validated.
            query:          The research question that produced the output.
            source_context: Ignored by this classifier (no text analysis of source).

        Returns:
            ClassifierResult with checkpoint_type, confidence, rationale, method.
        """
        both = f"{query} {output_text}".strip()

        for cp_type, conf, pattern, rationale, field in _RULE_TABLE:
            target = query if field == "query" else (output_text if field == "output" else both)
            if pattern.search(target):
                logger.debug(f"[RuleBased] Matched {cp_type.value!r} via {field!r}: {rationale}")
                return ClassifierResult(
                    checkpoint_type=cp_type,
                    confidence=conf,
                    rationale=rationale,
                    method="rule_based",
                )

        logger.debug("[RuleBased] No rule matched; falling back to claim_extraction")
        return ClassifierResult(
            checkpoint_type=self.FALLBACK_TYPE,
            confidence=self.FALLBACK_CONF,
            rationale="No specific pattern matched; defaulting to claim_extraction",
            method="rule_based",
        )


# ─────────────────────────────────────────────────────────────────────────────
# 2. LLM-Based Classifier
# ─────────────────────────────────────────────────────────────────────────────

_LLM_SYSTEM = """You are a routing assistant for HERALD, an LLM output validation framework.

Your job: given a research query and the agent's output, choose the single best
checkpoint_type from this fixed list:

  retrieval        — Was the retrieved document/source relevant to the query?
                     Use when the output IS a document description or the query asks
                     which report/paper addresses a topic.

  claim_extraction — Is every direct assertion explicitly entailed by the source?
                     Use for single-sentence or short factual claims being checked
                     against a specific passage. Default for straightforward fact-checks.

  synthesis        — Does a multi-claim summary faithfully represent the source?
                     Use for overviews, descriptions of how a program works, or any
                     output that condenses multiple source facts into a paragraph.

  numerical        — Do reported numbers match the source?
                     Use whenever the output contains specific figures: percentages,
                     dollar amounts, counts, years, or fiscal period references.

  causal           — Does causal language stay within what the source supports?
                     Use when the output attributes causes ("led to", "due to",
                     "contributed to", "resulted in") or explains why something happened.

  epistemic        — Does the output preserve uncertainty hedges from the source?
                     Use when the output uses hedging language ("may", "might",
                     "appears to", "suggests") or discusses confidence/limitations.

Priority guidance:
- numerical BEATS claim_extraction if there are specific numbers.
- causal BEATS synthesis if causal attribution is the main claim.
- epistemic BEATS claim_extraction if hedges/uncertainty are the focus.
- synthesis BEATS claim_extraction if the output covers multiple facts from the source.
- retrieval is rare — only use it when the output IS describing a source document.

Respond with ONLY valid JSON, no other text:
{"checkpoint_type": "<one of the six types>", "confidence": <0.0-1.0>, "rationale": "<one sentence>"}"""

_LLM_TEMPLATE = """Query: {query}

Agent output (first 600 chars):
{output_text}

Choose the single best checkpoint_type."""


class LLMClassifier:
    """Checkpoint type classifier backed by a small LLM call.

    Uses the same provider/model abstraction as the rest of HERALD (GeminiClient,
    GroqClient, OpenAIClient). By default uses the Tier 2 model from config, but
    you can override with a cheaper/faster model via the `model` argument.

    Recommended: gemini-2.0-flash or groq llama-3.1-8b-instant (fast + cheap).
    Falls back to RuleBasedClassifier if the LLM call fails.
    """

    def __init__(self, config: dict, model: str | None = None):
        """
        Args:
            config: Standard HERALD config dict (same as build_pipeline).
            model:  Override model name. If None, uses the Tier 2 model from config.
                    For cheapest routing: "gemini-2.0-flash" or "llama-3.1-8b-instant".
        """
        from herald.core.llm import get_llm_client

        # Allow model override without mutating caller's config
        if model is not None:
            config = {**config, "tier2": {**config.get("tier2", {}), "model": model}}

        self.client = get_llm_client(config, tier=2)
        self._fallback = RuleBasedClassifier()
        logger.info(f"[LLMClassifier] Using {self.client.provider}/{self.client.model}")

    def classify(
        self,
        output_text: str,
        query: str = "",
        source_context: str = "",  # accepted for interface parity; not used
    ) -> ClassifierResult:
        """Classify a single output via a single LLM call.

        Falls back to RuleBasedClassifier on any parse/API failure.

        Args:
            output_text:    The agent's output to be validated.
            query:          The research question that produced the output.
            source_context: Ignored (source is not needed for type routing).

        Returns:
            ClassifierResult with checkpoint_type, confidence, rationale, method="llm".
        """
        prompt = _LLM_TEMPLATE.format(
            query=query or "(no query provided)",
            output_text=output_text[:600],
        )

        try:
            response = self.client.complete(
                prompt=prompt,
                system=_LLM_SYSTEM,
                json_mode=True,
                temperature=0.0,
            )
            data = json.loads(response.content)
            ct = CheckpointType(data["checkpoint_type"])
            conf = float(data.get("confidence", 0.80))
            rationale = str(data.get("rationale", ""))
            logger.debug(f"[LLMClassifier] → {ct.value} (conf={conf:.2f})")
            return ClassifierResult(
                checkpoint_type=ct,
                confidence=conf,
                rationale=rationale,
                method="llm",
            )

        except Exception as exc:
            logger.warning(f"[LLMClassifier] LLM call failed ({exc}); falling back to rule-based")
            result = self._fallback.classify(output_text, query)
            result.method = "llm_fallback"
            return result


# ─────────────────────────────────────────────────────────────────────────────
# Factory
# ─────────────────────────────────────────────────────────────────────────────


def get_classifier(method: str = "rule_based", config: dict | None = None, **kwargs):
    """Build a classifier by name.

    Args:
        method:  "rule_based" | "llm"
        config:  Required when method="llm". Standard HERALD config dict.
        **kwargs: Forwarded to LLMClassifier (e.g. model="gemini-2.0-flash").

    Returns:
        RuleBasedClassifier or LLMClassifier instance.
    """
    if method == "rule_based":
        return RuleBasedClassifier()
    elif method == "llm":
        if config is None:
            raise ValueError("config is required for method='llm'")
        return LLMClassifier(config=config, **kwargs)
    else:
        raise ValueError(f"Unknown classifier method: {method!r}. Use 'rule_based' or 'llm'.")
