"""
NLI (Natural Language Inference) service - Tier 1 of the HERALD evaluation pipeline.

Uses DeBERTa-v3-large-mnli via Hugging Face Transformers (CPU by default) or
ONNX Runtime when NLI_ONNX_MODEL_PATH is set in the environment.

The model is loaded ONCE on application startup via the FastAPI lifespan handler.
It is NEVER replaced by an LLM call - this is the cheap, local filter that
prevents unnecessary Anthropic API calls in Tiers 2-3.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

_DEFAULT_HF_MODEL = "cross-encoder/nli-deberta-v3-large"

# Normalise labels that differ by case or by numeric LABEL_N scheme.
# Some exports expose numeric labels in the same order used by the ONNX path
# below: 0=contradiction, 1=neutral, 2=entailment.
_LABEL_NORMALISE: dict[str, str] = {
    "entailment": "entailment",
    "neutral": "neutral",
    "contradiction": "contradiction",
    "ENTAILMENT": "entailment",
    "NEUTRAL": "neutral",
    "CONTRADICTION": "contradiction",
    # Numeric labels used by some ONNX exports
    "LABEL_0": "contradiction",
    "LABEL_1": "neutral",
    "LABEL_2": "entailment",
}


@dataclass
class NLIResult:
    """Result from a single premise-hypothesis NLI inference."""

    label: str  # "entailment" | "neutral" | "contradiction"
    scores: dict[str, float] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Module-level parsing helper (importable for unit tests)
# ---------------------------------------------------------------------------


def _parse_hf_output(raw: object) -> NLIResult:
    """
    Normalise HuggingFace pipeline output into NLIResult.

    With top_k=None the pipeline returns a list of dicts for each input:
      [{"label": "ENTAILMENT", "score": 0.9}, {"label": "NEUTRAL", ...}, ...]

    With top_k=1 it returns a single dict:
      {"label": "ENTAILMENT", "score": 0.9}
    """
    if isinstance(raw, dict):
        items: list[dict[str, object]] = [raw]
    else:
        items = list(raw)  # type: ignore[call-overload]

    scores: dict[str, float] = {}
    for item in items:
        label_raw: str = str(item["label"])
        score: float = float(str(item["score"]))
        normalised = _LABEL_NORMALISE.get(label_raw, label_raw.lower())
        scores[normalised] = score

    # Ensure all three canonical labels are always present
    for lbl in ("entailment", "neutral", "contradiction"):
        scores.setdefault(lbl, 0.0)

    best_label = max(scores, key=lambda k: scores[k])
    return NLIResult(label=best_label, scores=scores)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class NLIService:
    """
    Wraps either a HuggingFace Transformers pipeline or an ONNX Runtime session
    to provide NLI inference for HERALD Tier 1.

    Usage
    -----
    service = NLIService()
    service.load()                       # called once at startup
    result = service.predict(premise, hypothesis)
    """

    def __init__(self) -> None:
        self._pipeline: object | None = None
        self._ort_session: object | None = None
        self._tokenizer: object | None = None
        self._use_onnx: bool = False
        self._loaded: bool = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def load(self) -> None:
        """
        Load the NLI model.  Called once at app startup.

        Resolution order:
        1. If NLI_ONNX_MODEL_PATH is set -> load ONNX model + tokenizer from that path.
        2. Otherwise -> load HuggingFace pipeline for the model at HF_MODEL_PATH
           (defaults to 'microsoft/deberta-v3-large-mnli').
        """
        from .braintrust_service import ModelLoadLog, get_braintrust

        model_name = os.getenv("HF_MODEL_PATH", _DEFAULT_HF_MODEL)
        onnx_path = os.getenv("NLI_ONNX_MODEL_PATH")
        t0 = time.perf_counter()
        error: str | None = None

        try:
            if onnx_path:
                self._load_onnx(onnx_path)
            else:
                self._load_hf()
            self._loaded = True
        except Exception as exc:
            error = str(exc)
            raise
        finally:
            latency_ms = (time.perf_counter() - t0) * 1000.0
            get_braintrust().log_model_load(
                ModelLoadLog(
                    use_onnx=bool(onnx_path),
                    model_name=onnx_path or model_name,
                    latency_ms=latency_ms,
                    success=error is None,
                    error=error,
                )
            )

        logger.info("NLI model loaded (onnx=%s)", self._use_onnx)

    def is_loaded(self) -> bool:
        """Return True once load() has completed successfully."""
        return self._loaded

    def predict(self, premise: str, hypothesis: str, claim_id: str = "") -> NLIResult:
        """
        Run NLI inference for a single premise-hypothesis pair.

        Parameters
        ----------
        premise:    The source chunk that supposedly supports the claim.
        hypothesis: The claim text being evaluated.
        claim_id:   Optional claim identifier for observability logging.
        """
        if not self._loaded:
            msg = "NLIService.predict() called before load()"
            raise RuntimeError(msg)

        from .braintrust_service import NLIInferenceLog, get_braintrust

        t0 = time.perf_counter()
        if self._use_onnx:
            result = self._predict_onnx(premise, hypothesis)
        else:
            result = self._predict_hf(premise, hypothesis)
        latency_ms = (time.perf_counter() - t0) * 1000.0

        get_braintrust().log_nli_inference(
            NLIInferenceLog(
                claim_id=claim_id,
                claim_text=hypothesis,
                premise_chunk=premise,
                label=result.label,
                entailment_score=result.scores.get("entailment", 0.0),
                neutral_score=result.scores.get("neutral", 0.0),
                contradiction_score=result.scores.get("contradiction", 0.0),
                latency_ms=latency_ms,
                use_onnx=self._use_onnx,
            )
        )
        return result

    def predict_batch(
        self,
        pairs: list[tuple[str, str]],
        claim_ids: list[str] | None = None,
    ) -> list[NLIResult]:
        """
        Run NLI inference on a batch of (premise, hypothesis) pairs.
        Falls back to sequential calls when using ONNX (no native batching).

        Parameters
        ----------
        pairs:      List of (premise, hypothesis) tuples.
        claim_ids:  Optional parallel list of claim IDs for logging.
        """
        if not self._loaded:
            msg = "NLIService.predict_batch() called before load()"
            raise RuntimeError(msg)

        from .braintrust_service import NLIBatchLog, get_braintrust

        t0 = time.perf_counter()
        if self._use_onnx:
            results = [self._predict_onnx(p, h) for p, h in pairs]
        else:
            results = self._predict_hf_batch(pairs)
        latency_ms = (time.perf_counter() - t0) * 1000.0

        ids = claim_ids if claim_ids is not None else [f"pair-{i}" for i in range(len(pairs))]
        get_braintrust().log_nli_batch(
            NLIBatchLog(
                claim_ids=ids,
                labels=[r.label for r in results],
                latency_ms=latency_ms,
                pair_count=len(pairs),
                use_onnx=self._use_onnx,
            )
        )
        return results

    # ------------------------------------------------------------------
    # HuggingFace Transformers backend
    # ------------------------------------------------------------------

    def _load_hf(self) -> None:
        try:
            from transformers import pipeline
        except ImportError as exc:
            msg = (
                "transformers is not installed. "
                "Run: uv sync --extra nli  (or install transformers + torch manually)."
            )
            raise ImportError(msg) from exc

        model_name = os.getenv("HF_MODEL_PATH", _DEFAULT_HF_MODEL)
        logger.info("Loading HuggingFace NLI pipeline: %s", model_name)

        device = self._detect_device()
        self._pipeline = pipeline(
            "text-classification",
            model=model_name,
            device=device,
            top_k=None,  # return all labels with scores
        )
        self._use_onnx = False

    def _predict_hf(self, premise: str, hypothesis: str) -> NLIResult:
        raw = self._pipeline(premise, text_pair=hypothesis)  # type: ignore[operator, misc]
        return _parse_hf_output(raw)

    def _predict_hf_batch(self, pairs: list[tuple[str, str]]) -> list[NLIResult]:
        # Hugging Face pipeline accepts list of (text, text_pair) dicts
        inputs = [{"text": p, "text_pair": h} for p, h in pairs]
        raw_batch = self._pipeline(inputs)  # type: ignore[operator, misc]
        return [_parse_hf_output(r) for r in raw_batch]

    # ------------------------------------------------------------------
    # ONNX Runtime backend
    # ------------------------------------------------------------------

    def _load_onnx(self, model_dir: str) -> None:
        """Load a quantised ONNX model and its tokenizer from *model_dir*."""
        try:
            import onnxruntime as ort
            from transformers import AutoTokenizer
        except ImportError as exc:
            msg = "onnxruntime and/or transformers are not installed. Run: uv sync --extra nli."
            raise ImportError(msg) from exc

        import pathlib

        model_path = pathlib.Path(model_dir)
        onnx_file = model_path / "model.onnx"
        if not onnx_file.exists():
            msg = f"ONNX model file not found: {onnx_file}"
            raise FileNotFoundError(msg)

        logger.info("Loading ONNX NLI model from %s", onnx_file)
        sess_options = ort.SessionOptions()
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self._ort_session = ort.InferenceSession(
            str(onnx_file),
            sess_options=sess_options,
            providers=["CPUExecutionProvider"],
        )

        tokenizer_name = os.getenv("HF_MODEL_PATH", _DEFAULT_HF_MODEL)
        self._tokenizer = AutoTokenizer.from_pretrained(tokenizer_name)
        self._use_onnx = True

    def _predict_onnx(self, premise: str, hypothesis: str) -> NLIResult:
        import numpy as np

        tokenizer = self._tokenizer
        session = self._ort_session

        encoding = tokenizer(  # type: ignore[operator, misc]
            premise,
            hypothesis,
            return_tensors="np",
            truncation=True,
            max_length=512,
            padding=True,
        )
        inputs = {k: v.astype(np.int64) for k, v in encoding.items()}
        logits = session.run(None, inputs)[0][0]  # type: ignore[union-attr]  # shape: (3,)

        # Softmax to get probabilities
        exp_logits = np.exp(logits - np.max(logits))
        probs = (exp_logits / exp_logits.sum()).tolist()

        # label order: 0=CONTRADICTION, 1=NEUTRAL, 2=ENTAILMENT
        label_order = ["contradiction", "neutral", "entailment"]
        scores = {label_order[i]: float(probs[i]) for i in range(len(label_order))}
        best_label = max(scores, key=lambda k: scores[k])
        return NLIResult(label=best_label, scores=scores)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _detect_device() -> int:
        """Return 0 for CUDA GPU if available, else -1 for CPU."""
        try:
            import torch

            return 0 if torch.cuda.is_available() else -1
        except ImportError:
            return -1


# ---------------------------------------------------------------------------
# Module-level singleton - acquired by the FastAPI lifespan handler
# ---------------------------------------------------------------------------

_service_instance: NLIService | None = None


def get_nli_service() -> NLIService:
    """Return the module-level NLI service singleton (must be loaded first)."""
    global _service_instance
    if _service_instance is None:
        _service_instance = NLIService()
    return _service_instance
