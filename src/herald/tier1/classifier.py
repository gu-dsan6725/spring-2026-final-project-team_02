"""Tier 1: Local NLI Classifier using DeBERTa.

Runs entirely locally — no API calls, no cost.
Maps NLI labels to validation verdicts:
    entailment   → VALID
    contradiction → INVALID
    neutral       → UNCERTAIN (escalate)

Numeric mismatch guard
----------------------
DeBERTa is trained on MNLI (news, fiction, captions) and measures textual
entailment — not factual precision. It routinely assigns 0.97–0.99 entailment
to claims that are structurally similar to the source but contain a wrong
number or date (e.g. source says "1988", claim says "1984").

The guard runs after NLI scores are computed. If the NLI verdict is VALID but
the claim and source share similar structure, it extracts all numeric tokens
from both texts and checks for mismatches. A single mismatch downgrades the
verdict to UNCERTAIN so the case escalates to Tier 2, which can do explicit
value-by-value cross-checking via the numerical verification block in its prompt.

The guard only fires on high-confidence VALID verdicts (entailment ≥ 0.80) to
avoid adding false uncertainty to cases the model already doubts. It is a
heuristic safety net, not a replacement for Tier 2 — the goal is to catch the
most egregious false-positive class (confident wrong number) cheaply.
"""

import re

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from herald.core.types import CheckpointOutput, TierResult, Verdict

# Checkpoint types where numeric precision matters enough to run the mismatch guard.
_NUMERIC_GUARD_TYPES = {"numerical", "synthesis", "causal"}

# Entailment confidence above which the guard activates. Below this the model
# already has doubts and the case will escalate via normal threshold logic.
_NUMERIC_GUARD_MIN_CONFIDENCE = 0.80


def _extract_numbers(text: str) -> list[str]:
    """Return all numeric tokens from text as normalised strings.

    Matches integers, decimals, percentages, dollar amounts, and years.
    Strips currency symbols and percent signs so "95%" and "95" are the same
    token (the guard checks structural mismatches, not unit differences).
    """
    raw = re.findall(
        r"""
        \$?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?   # comma-grouped numbers, optional $ and %
        | \d+\.\d+%?                           # plain decimals
        | \d{4}                                # years / 4-digit numbers
        | \d+%?                                # plain integers
        """,
        text,
        flags=re.VERBOSE,
    )
    # Normalise: strip punctuation and leading zeros so "021" == "21", "$95" == "95"
    normalised = []
    for tok in raw:
        tok = tok.replace(",", "").replace("$", "").replace("%", "").lstrip("0") or "0"
        normalised.append(tok)
    return normalised


def _numeric_mismatch(source: str, claim: str) -> bool:
    """Return True if the claim contains a number not present in the source.

    Only flags numbers that appear in the claim but are absent from the source —
    not the other way around (extra source numbers are fine).
    """
    source_nums = set(_extract_numbers(source))
    claim_nums = _extract_numbers(claim)
    # A claim number is suspicious when it does not appear anywhere in the source.
    # We allow a small set of common non-factual numbers (1, 2, 3, 100) to avoid
    # false positives on ordinal references like "three principles" or "100 percent".
    _IGNORE = {"1", "2", "3", "4", "5", "10", "100"}
    mismatches = [n for n in claim_nums if n not in source_nums and n not in _IGNORE]
    return len(mismatches) > 0


class NLIClassifier:
    """DeBERTa-based NLI classifier for checkpoint validation."""

    # cross-encoder/nli-deberta-v3-large (default, no HF auth): {0: contradiction, 1: entailment, 2: neutral}
    # microsoft/deberta-v3-large-mnli (requires hf auth login):  {0: contradiction, 1: neutral,      2: entailment}
    # The LABEL_MAP is set from the model's own id2label config at load time.
    LABEL_MAP = {0: "contradiction", 1: "entailment", 2: "neutral"}  # default: cross-encoder model

    def __init__(self, model_name: str = "cross-encoder/nli-deberta-v3-large", device: str = "cpu"):
        self.device = torch.device(device)
        print(f"  Loading {model_name} on {device}...")
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModelForSequenceClassification.from_pretrained(model_name)
        self.model.to(self.device)
        self.model.eval()
        # Read label map from the model's own config so it's always correct regardless of which model is loaded
        if hasattr(self.model.config, "id2label") and self.model.config.id2label:
            self.LABEL_MAP = {int(k): v.lower() for k, v in self.model.config.id2label.items()}
        print(f"  Label map: {self.LABEL_MAP}")
        print("  Tier 1 classifier ready.")

    def classify(self, checkpoint: CheckpointOutput, threshold: float = 0.70) -> TierResult:
        """Classify a checkpoint output. Returns verdict + confidence."""
        scores = self._get_nli_scores(checkpoint.source_context, checkpoint.output_text)

        ent = scores["entailment"]
        con = scores["contradiction"]
        neu = scores["neutral"]

        if ent >= con and ent >= neu:
            verdict, confidence = Verdict.VALID, ent
        elif con >= ent and con >= neu:
            verdict, confidence = Verdict.INVALID, con
        else:
            verdict, confidence = Verdict.UNCERTAIN, 1.0 - max(ent, con)

        # Below threshold → uncertain, trigger escalation
        if verdict != Verdict.UNCERTAIN and confidence < threshold:
            verdict = Verdict.UNCERTAIN

        # Numeric mismatch guard: DeBERTa cannot compare numbers — it measures
        # textual entailment. A claim with a wrong date or figure often gets
        # very high entailment because the sentence structure matches the source.
        # If the verdict is a confident VALID and the checkpoint type is one where
        # numeric precision matters, check whether any number in the claim is
        # absent from the source. If so, downgrade to UNCERTAIN so Tier 2's
        # numerical verification block can do explicit value-by-value checking.
        numeric_guard_fired = False
        if (
            verdict == Verdict.VALID
            and confidence >= _NUMERIC_GUARD_MIN_CONFIDENCE
            and checkpoint.checkpoint_type.value in _NUMERIC_GUARD_TYPES
            and _numeric_mismatch(checkpoint.source_context, checkpoint.output_text)
        ):
            verdict = Verdict.UNCERTAIN
            numeric_guard_fired = True

        reasoning = f"NLI: ent={ent:.3f} con={con:.3f} neu={neu:.3f}"
        if numeric_guard_fired:
            reasoning += " | numeric_guard=FIRED (claim contains number absent from source)"

        return TierResult(
            tier=1,
            verdict=verdict,
            confidence=confidence,
            reasoning=reasoning,
            raw_scores={**scores, "numeric_guard_fired": numeric_guard_fired},
        )

    def classify_multi_source(
        self,
        checkpoint: "CheckpointOutput",
        source_chunks: list[str],
        threshold: float = 0.70,
        aggregation: str = "max_entailment",
    ) -> "TierResult":
        """Classify against multiple source chunks via pairwise NLI and aggregation.

        For retrieval (CP1) and synthesis (CP3) where source context may span
        multiple documents or claim sets, runs NLI independently on each
        (chunk, hypothesis) pair and aggregates.

        aggregation options:
          "max_entailment"    — take the chunk with the highest entailment score
                                (any chunk supporting the claim makes it valid)
          "max_contradiction" — flag invalid if ANY chunk strongly contradicts
          "mean"              — average scores across all chunks
        """
        if not source_chunks:
            raise ValueError("source_chunks must not be empty")

        all_scores = [
            self._get_nli_scores(chunk, checkpoint.output_text) for chunk in source_chunks
        ]

        if aggregation == "max_entailment":
            # Most generous: valid if any chunk entails it
            agg = {
                "entailment": max(s["entailment"] for s in all_scores),
                "contradiction": min(s["contradiction"] for s in all_scores),
                "neutral": min(s["neutral"] for s in all_scores),
            }
        elif aggregation == "max_contradiction":
            # Most strict: invalid if any chunk contradicts it
            agg = {
                "entailment": min(s["entailment"] for s in all_scores),
                "contradiction": max(s["contradiction"] for s in all_scores),
                "neutral": min(s["neutral"] for s in all_scores),
            }
        elif aggregation == "mean":
            keys = ["entailment", "contradiction", "neutral"]
            agg = {k: sum(s[k] for s in all_scores) / len(all_scores) for k in keys}
        else:
            raise ValueError(
                f"Unknown aggregation: {aggregation!r}. Use 'max_entailment', 'max_contradiction', or 'mean'."
            )

        ent, con, neu = agg["entailment"], agg["contradiction"], agg["neutral"]

        if ent >= con and ent >= neu:
            verdict, confidence = Verdict.VALID, ent
        elif con >= ent and con >= neu:
            verdict, confidence = Verdict.INVALID, con
        else:
            verdict, confidence = Verdict.UNCERTAIN, 1.0 - max(ent, con)

        if verdict != Verdict.UNCERTAIN and confidence < threshold:
            verdict = Verdict.UNCERTAIN

        chunk_summary = [
            f"chunk_{i}: ent={s['entailment']:.3f} con={s['contradiction']:.3f}"
            for i, s in enumerate(all_scores)
        ]
        return TierResult(
            tier=1,
            verdict=verdict,
            confidence=confidence,
            reasoning=f"Multi-source NLI ({aggregation}, {len(source_chunks)} chunks): "
            + " | ".join(chunk_summary),
            raw_scores={**agg, "per_chunk": all_scores},
        )

    def _get_nli_scores(self, premise: str, hypothesis: str) -> dict:
        """Run NLI and return {entailment, contradiction, neutral} probabilities."""
        inputs = self.tokenizer(
            premise,
            hypothesis,
            return_tensors="pt",
            truncation=True,
            max_length=512,
            padding=True,
        ).to(self.device)

        with torch.no_grad():
            outputs = self.model(**inputs)
            probs = torch.softmax(outputs.logits, dim=-1)[0]

        return {self.LABEL_MAP[i]: probs[i].item() for i in range(3)}
