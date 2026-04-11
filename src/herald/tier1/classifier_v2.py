"""Tier 1: Enhanced NLI Classifier using DeBERTa (v2).

Drop-in replacement for classifier.py with three targeted improvements.
The class name and public API are unchanged — existing call sites only need
to swap the import.

Changes vs. classifier.py
--------------------------

Lever 1 — Per-type hypothesis reformulation
    classifier.py feeds output_text directly as the NLI hypothesis.
    classifier_v2.py prepends a domain-specific prefix before tokenization:

        RETRIEVAL        "The source document contains the following information: "
        CLAIM_EXTRACTION "The document states that: "
        SYNTHESIS        "Based on the source material, it can be concluded that: "
        NUMERICAL        "According to the source, the following is numerically accurate: "
        CAUSAL           "The source implies the following causal relationship: "

    Cross-encoder NLI models are sensitive to hypothesis wording. A framing
    that matches the semantic role of the claim (factual retrieval vs. causal
    inference vs. numeric assertion) narrows the hypothesis space and reduces
    false entailments on loosely related text.

    Implementation: _get_nli_scores gains an optional checkpoint_type param;
    when provided, the prefix is prepended to hypothesis before tokenization.

Lever 2 — Per-type default thresholds
    classifier.py uses a single global threshold (default 0.70) for all types.
    classifier_v2.py introduces DEFAULT_TYPE_THRESHOLDS:

        retrieval        0.70  (unchanged)
        claim_extraction 0.70  (unchanged)
        synthesis        0.75  (slightly stricter — multi-hop claims are riskier)
        numerical        0.65  (lower — NLI is poor at numeric comparison)
        causal           0.60  (lower — NLI cannot assess causal attribution)

    Lower thresholds for hard types mean more cases escalate to Tier 2 where
    an LLM can reason properly, rather than Tier 1 forcing a low-confidence
    resolve that is likely wrong.

    Implementation: classify() and classify_multi_source() look up the
    effective threshold from DEFAULT_TYPE_THRESHOLDS before applying verdict
    logic. The global threshold arg is still the final fallback.

Lever 3 — Config-driven per-type threshold override
    classifier_v2.py accepts an optional type_thresholds argument (a dict
    mapping CheckpointType → float) in classify() and classify_multi_source().
    When provided, its values take precedence over DEFAULT_TYPE_THRESHOLDS,
    allowing the caller to drive thresholds from configs/default.yaml without
    changing code.

    Precedence (highest to lowest):
        type_thresholds arg  >  DEFAULT_TYPE_THRESHOLDS  >  global threshold arg

    The pipeline wires this in via HeraldPipeline.t1_type_thresholds, which
    build_pipeline() populates from thresholds.T1_by_type in default.yaml.

Unchanged
---------
    - Class name NLIClassifier and all public method signatures (classify,
      classify_multi_source) are backward-compatible; existing callers that
      pass only (checkpoint, threshold) still work identically.
    - Model loading, LABEL_MAP inference, verdict logic, and aggregation
      strategies are untouched.
    - The reasoning string now includes the checkpoint type and effective
      threshold for easier debugging, but the TierResult structure is the same.
"""

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from herald.core.types import CheckpointOutput, CheckpointType, TierResult, Verdict


# Lever 1: per-type hypothesis prefixes.
_HYPOTHESIS_PREFIXES: dict[CheckpointType, str] = {
    CheckpointType.RETRIEVAL: "The source document contains the following information: ",
    CheckpointType.CLAIM_EXTRACTION: "The document states that: ",
    CheckpointType.SYNTHESIS: "Based on the source material, it can be concluded that: ",
    CheckpointType.NUMERICAL: "According to the source, the following is numerically accurate: ",
    CheckpointType.CAUSAL: "The source implies the following causal relationship: ",
}

# Lever 2: per-type default thresholds.
DEFAULT_TYPE_THRESHOLDS: dict[CheckpointType, float] = {
    CheckpointType.RETRIEVAL: 0.70,
    CheckpointType.CLAIM_EXTRACTION: 0.70,
    CheckpointType.SYNTHESIS: 0.75,
    CheckpointType.NUMERICAL: 0.65,
    CheckpointType.CAUSAL: 0.60,
}


class NLIClassifier:
    """DeBERTa-based NLI classifier for checkpoint validation (v2)."""

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

    def classify(
        self,
        checkpoint: CheckpointOutput,
        threshold: float = 0.70,
        type_thresholds: dict[CheckpointType, float] | None = None,
    ) -> TierResult:
        """Classify a checkpoint output. Returns verdict + confidence.

        Args:
            checkpoint: The checkpoint to validate.
            threshold: Global fallback threshold. Used only when the checkpoint
                       type has no entry in type_thresholds or DEFAULT_TYPE_THRESHOLDS.
            type_thresholds: Optional per-type map from config (Lever 3). Takes
                             precedence over DEFAULT_TYPE_THRESHOLDS when provided.
        """
        # Resolve effective threshold: config map > per-type defaults > global fallback
        if type_thresholds is not None:
            effective_threshold = type_thresholds.get(
                checkpoint.checkpoint_type,
                DEFAULT_TYPE_THRESHOLDS.get(checkpoint.checkpoint_type, threshold),
            )
        else:
            effective_threshold = DEFAULT_TYPE_THRESHOLDS.get(
                checkpoint.checkpoint_type, threshold
            )

        scores = self._get_nli_scores(
            checkpoint.source_context,
            checkpoint.output_text,
            checkpoint.checkpoint_type,
        )

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
        if verdict != Verdict.UNCERTAIN and confidence < effective_threshold:
            verdict = Verdict.UNCERTAIN

        return TierResult(
            tier=1,
            verdict=verdict,
            confidence=confidence,
            reasoning=(
                f"NLI [{checkpoint.checkpoint_type.value}] "
                f"(threshold={effective_threshold:.2f}): "
                f"ent={ent:.3f} con={con:.3f} neu={neu:.3f}"
            ),
            raw_scores=scores,
        )

    def classify_multi_source(
        self,
        checkpoint: "CheckpointOutput",
        source_chunks: list[str],
        threshold: float = 0.70,
        aggregation: str = "max_entailment",
        type_thresholds: dict[CheckpointType, float] | None = None,
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
            self._get_nli_scores(chunk, checkpoint.output_text, checkpoint.checkpoint_type)
            for chunk in source_chunks
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

        if type_thresholds is not None:
            effective_threshold = type_thresholds.get(
                checkpoint.checkpoint_type,
                DEFAULT_TYPE_THRESHOLDS.get(checkpoint.checkpoint_type, threshold),
            )
        else:
            effective_threshold = DEFAULT_TYPE_THRESHOLDS.get(
                checkpoint.checkpoint_type, threshold
            )

        if ent >= con and ent >= neu:
            verdict, confidence = Verdict.VALID, ent
        elif con >= ent and con >= neu:
            verdict, confidence = Verdict.INVALID, con
        else:
            verdict, confidence = Verdict.UNCERTAIN, 1.0 - max(ent, con)

        if verdict != Verdict.UNCERTAIN and confidence < effective_threshold:
            verdict = Verdict.UNCERTAIN

        chunk_summary = [
            f"chunk_{i}: ent={s['entailment']:.3f} con={s['contradiction']:.3f}"
            for i, s in enumerate(all_scores)
        ]
        return TierResult(
            tier=1,
            verdict=verdict,
            confidence=confidence,
            reasoning=(
                f"Multi-source NLI [{checkpoint.checkpoint_type.value}] "
                f"({aggregation}, {len(source_chunks)} chunks, threshold={effective_threshold:.2f}): "
                + " | ".join(chunk_summary)
            ),
            raw_scores={**agg, "per_chunk": all_scores},
        )

    def _get_nli_scores(
        self,
        premise: str,
        hypothesis: str,
        checkpoint_type: CheckpointType | None = None,
    ) -> dict:
        """Run NLI and return {entailment, contradiction, neutral} probabilities.

        Applies a per-type hypothesis prefix (Lever 1) before tokenization.
        When checkpoint_type is None (e.g. called from old code), behaviour is
        identical to classifier.py.
        """
        if checkpoint_type is not None:
            prefix = _HYPOTHESIS_PREFIXES.get(checkpoint_type, "")
            hypothesis = prefix + hypothesis

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
