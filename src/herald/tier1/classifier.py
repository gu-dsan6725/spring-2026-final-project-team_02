"""Tier 1: Local NLI Classifier using DeBERTa.

Runs entirely locally — no API calls, no cost.
Maps NLI labels to validation verdicts:
    entailment   → VALID
    contradiction → INVALID
    neutral       → UNCERTAIN (escalate)
"""

import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from herald.core.types import TierResult, Verdict, CheckpointOutput


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

        return TierResult(
            tier=1,
            verdict=verdict,
            confidence=confidence,
            reasoning=f"NLI: ent={ent:.3f} con={con:.3f} neu={neu:.3f}",
            raw_scores=scores,
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

        all_scores = [self._get_nli_scores(chunk, checkpoint.output_text) for chunk in source_chunks]

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
            raise ValueError(f"Unknown aggregation: {aggregation!r}. Use 'max_entailment', 'max_contradiction', or 'mean'.")

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
            reasoning=f"Multi-source NLI ({aggregation}, {len(source_chunks)} chunks): " + " | ".join(chunk_summary),
            raw_scores={**agg, "per_chunk": all_scores},
        )

    def _get_nli_scores(self, premise: str, hypothesis: str) -> dict:
        """Run NLI and return {entailment, contradiction, neutral} probabilities."""
        inputs = self.tokenizer(
            premise, hypothesis,
            return_tensors="pt", truncation=True, max_length=512, padding=True,
        ).to(self.device)

        with torch.no_grad():
            outputs = self.model(**inputs)
            probs = torch.softmax(outputs.logits, dim=-1)[0]

        return {self.LABEL_MAP[i]: probs[i].item() for i in range(3)}
