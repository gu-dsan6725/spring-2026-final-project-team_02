"""HERALD Web UI — FastAPI Backend

Start with:
    cd <repo-root>
    uv run uvicorn ui.api:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import json
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, Optional

# Ensure src/ is importable
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ────────────────────────────────────────────────────────────────────────────
# Paths
# ────────────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent.parent
STATIC = Path(__file__).parent / "static"
RESULTS_PATH = ROOT / "results" / "ui_results.json"
REVIEW_DIR = ROOT / "results" / "human_review"
CONFIG_PATH = ROOT / "configs" / "default.yaml"

# ────────────────────────────────────────────────────────────────────────────
# Lazy global pipeline state
# ────────────────────────────────────────────────────────────────────────────
_config: Optional[Dict] = None
_tier1 = None
_tier2 = None
_tier3 = None
_model_status: str = "unloaded"   # unloaded | loading | ready | error
_model_error: str = ""

# ────────────────────────────────────────────────────────────────────────────
# App
# ────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="HERALD", version="0.1.0")
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


@app.get("/")
def root():
    return FileResponse(str(STATIC / "index.html"))


# ────────────────────────────────────────────────────────────────────────────
# Config & lazy init helpers
# ────────────────────────────────────────────────────────────────────────────

def _load_config() -> Dict:
    global _config
    if _config is None:
        from herald.core.config import load_config
        _config = load_config(str(CONFIG_PATH))
    return _config


def _ensure_tier1():
    global _tier1
    if _tier1 is None:
        from herald.tier1.classifier import NLIClassifier
        cfg = _load_config()
        _tier1 = NLIClassifier(
            model_name=cfg["tier1"]["model_name"],
            device=cfg["tier1"].get("device", "cpu"),
        )
    return _tier1


def _ensure_tier2():
    global _tier2
    if _tier2 is None:
        from herald.tier2.judge import LLMJudge
        _tier2 = LLMJudge(config=_load_config())
    return _tier2


def _ensure_tier3():
    global _tier3
    if _tier3 is None:
        from herald.tier3.debate import MultiAgentDebate
        _tier3 = MultiAgentDebate(config=_load_config())
    return _tier3


# ────────────────────────────────────────────────────────────────────────────
# Request/response models
# ────────────────────────────────────────────────────────────────────────────

class CaseInput(BaseModel):
    checkpoint_type: str
    output_text: str
    source_context: str
    query: str = ""
    label: Optional[str] = None


class ConfigUpdate(BaseModel):
    t1_threshold: Optional[float] = None
    t2_threshold: Optional[float] = None
    provider: Optional[str] = None


class ReviewDecision(BaseModel):
    verdict: str
    notes: str = ""


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

def _sse(event_type: str, data: Dict[str, Any]) -> str:
    """Format a Server-Sent Events line."""
    return f"data: {json.dumps({'type': event_type, **data})}\n\n"


def _load_results() -> list:
    if RESULTS_PATH.exists():
        try:
            return json.loads(RESULTS_PATH.read_text())
        except Exception:
            return []
    return []


def _append_result(record: Dict) -> None:
    results = _load_results()
    results.append(record)
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.write_text(json.dumps(results, indent=2))


# ────────────────────────────────────────────────────────────────────────────
# Status & model warmup
# ────────────────────────────────────────────────────────────────────────────

@app.get("/api/status")
def api_status():
    return {
        "model_status": _model_status,
        "model_error": _model_error,
        "tier1_ready": _tier1 is not None,
    }


@app.get("/api/warmup")
async def api_warmup():
    """SSE stream: load DeBERTa model and emit progress events."""
    global _model_status, _model_error

    async def gen() -> AsyncGenerator[str, None]:
        global _model_status, _model_error
        if _tier1 is not None:
            _model_status = "ready"
            yield _sse("ready", {"message": "Model already loaded"})
            return

        _model_status = "loading"
        yield _sse("loading", {
            "message": "Loading DeBERTa NLI model — may take ~30s on first run…"
        })

        try:
            await asyncio.to_thread(_ensure_tier1)
            _model_status = "ready"
            yield _sse("ready", {"message": "Model loaded and ready"})
        except Exception as exc:
            _model_status = "error"
            _model_error = str(exc)
            yield _sse("error", {"message": str(exc)})

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ────────────────────────────────────────────────────────────────────────────
# Examples, config
# ────────────────────────────────────────────────────────────────────────────

@app.get("/api/examples")
def api_examples():
    path = ROOT / "data" / "test_sets" / "sample_cases.json"
    return json.loads(path.read_text()) if path.exists() else []


@app.get("/api/config")
def api_get_config():
    try:
        cfg = _load_config()
        return {
            "provider": cfg.get("provider", "gemini"),
            "t1_threshold": cfg["thresholds"]["T1"],
            "t2_threshold": cfg["thresholds"]["T2"],
            "tier2_model": cfg.get("tier2", {}).get("model", ""),
            "tier3_model": cfg.get("tier3", {}).get("model", ""),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/config")
def api_update_config(update: ConfigUpdate):
    global _config, _tier2, _tier3
    import yaml

    with open(CONFIG_PATH) as f:
        raw = yaml.safe_load(f)

    if update.t1_threshold is not None:
        raw["thresholds"]["T1"] = round(update.t1_threshold, 2)
    if update.t2_threshold is not None:
        raw["thresholds"]["T2"] = round(update.t2_threshold, 2)
    if update.provider is not None:
        raw["provider"] = update.provider

    with open(CONFIG_PATH, "w") as f:
        yaml.dump(raw, f, default_flow_style=False)

    # Invalidate cached config and provider-dependent components
    _config = None
    _tier2 = None
    _tier3 = None
    return {"ok": True}


# ────────────────────────────────────────────────────────────────────────────
# Core: Validate stream (POST + fetch ReadableStream — works around SSE POST limit)
# ────────────────────────────────────────────────────────────────────────────

@app.post("/api/validate/stream")
async def api_validate_stream(case: CaseInput):
    """Run full HERALD pipeline and emit SSE events at each tier boundary."""

    async def gen() -> AsyncGenerator[str, None]:
        from herald.core.types import (
            CheckpointOutput, CheckpointType, Verdict, EscalationPacket,
        )
        from herald.tier4.human_review import generate_packet

        try:
            cfg = _load_config()
            checkpoint = CheckpointOutput(
                checkpoint_type=CheckpointType(case.checkpoint_type),
                output_text=case.output_text,
                source_context=case.source_context,
                query=case.query,
            )

            record: Dict[str, Any] = {
                "id": datetime.now().isoformat(),
                "timestamp": datetime.now().isoformat(),
                "checkpoint_type": case.checkpoint_type,
                "output_text": case.output_text,
                "source_context": case.source_context,
                "query": case.query,
                "label": case.label,
                "resolved_at_tier": None,
                "final_verdict": None,
                "tier1": None, "tier2": None, "tier3": None,
            }

            yield _sse("started", {"message": "Pipeline started"})

            # ── Tier 1: DeBERTa NLI ─────────────────────────────────────
            yield _sse("tier_start", {
                "tier": 1,
                "message": "Running DeBERTa NLI classifier locally (no API, no cost)…",
            })

            t1 = _ensure_tier1()
            t1r = await asyncio.to_thread(t1.classify, checkpoint, cfg["thresholds"]["T1"])

            t1_data = {
                "verdict": t1r.verdict.value,
                "confidence": round(t1r.confidence, 4),
                "reasoning": t1r.reasoning,
                "raw_scores": t1r.raw_scores,
            }
            record["tier1"] = t1_data

            yield _sse("tier_done", {"tier": 1, **t1_data})

            if t1r.verdict != Verdict.UNCERTAIN:
                record["resolved_at_tier"] = 1
                record["final_verdict"] = t1r.verdict.value
                _append_result(record)
                yield _sse("resolved", {
                    "tier": 1, "verdict": t1r.verdict.value,
                    "confidence": round(t1r.confidence, 4),
                })
                return

            yield _sse("escalating", {
                "from_tier": 1, "to_tier": 2,
                "reason": f"Confidence {t1r.confidence:.2f} < threshold {cfg['thresholds']['T1']}",
            })

            # ── Tier 2: LLM Judge ────────────────────────────────────────
            model2 = cfg.get("tier2", {}).get("model", "")
            provider = cfg.get("provider", "").title()
            yield _sse("tier_start", {
                "tier": 2,
                "message": f"Consulting LLM Judge ({provider}: {model2})…",
            })

            t2 = _ensure_tier2()
            t2r = await asyncio.to_thread(t2.judge, checkpoint, t1r, cfg["thresholds"]["T2"])

            t2_data = {
                "verdict": t2r.verdict.value,
                "confidence": round(t2r.confidence, 4),
                "reasoning": t2r.reasoning,
                "raw_scores": t2r.raw_scores,
            }
            record["tier2"] = t2_data

            yield _sse("tier_done", {"tier": 2, **t2_data})

            if t2r.verdict != Verdict.UNCERTAIN:
                record["resolved_at_tier"] = 2
                record["final_verdict"] = t2r.verdict.value
                _append_result(record)
                yield _sse("resolved", {
                    "tier": 2, "verdict": t2r.verdict.value,
                    "confidence": round(t2r.confidence, 4),
                })
                return

            yield _sse("escalating", {
                "from_tier": 2, "to_tier": 3,
                "reason": f"Judge confidence {t2r.confidence:.2f} < threshold {cfg['thresholds']['T2']}",
            })

            # ── Tier 3: Multi-Agent Debate ───────────────────────────────
            yield _sse("tier_start", {
                "tier": 3,
                "message": "Launching 3-agent debate: Advocate → Critic → Judge…",
            })

            t3 = _ensure_tier3()
            t3r = await asyncio.to_thread(t3.debate, checkpoint, t1r, t2r)

            t3_data = {
                "verdict": t3r.judge_verdict.value,
                "confidence": round(t3r.judge_confidence, 4),
                "reasoning": t3r.judge_reasoning,
                "advocate": t3r.advocate_argument,
                "critic": t3r.critic_argument,
            }
            record["tier3"] = t3_data

            yield _sse("tier_done", {"tier": 3, **t3_data})

            if t3r.judge_verdict != Verdict.UNCERTAIN:
                record["resolved_at_tier"] = 3
                record["final_verdict"] = t3r.judge_verdict.value
                _append_result(record)
                yield _sse("resolved", {
                    "tier": 3, "verdict": t3r.judge_verdict.value,
                    "confidence": round(t3r.judge_confidence, 4),
                })
                return

            yield _sse("escalating", {
                "from_tier": 3, "to_tier": 4,
                "reason": "All automated tiers uncertain — human judgement required",
            })

            # ── Tier 4: Human Review ─────────────────────────────────────
            yield _sse("tier_start", {
                "tier": 4, "message": "Generating structured human review packet…"
            })

            packet = EscalationPacket(
                checkpoint=checkpoint,
                tier1_result=t1r,
                tier2_result=t2r,
                tier3_result=t3r,
                resolved_at_tier=4,
                final_verdict=Verdict.UNCERTAIN,
            )
            review = generate_packet(packet)
            ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            fname = f"review_{ts}.json"
            REVIEW_DIR.mkdir(parents=True, exist_ok=True)
            (REVIEW_DIR / fname).write_text(json.dumps(review, indent=2))

            record["resolved_at_tier"] = 4
            record["final_verdict"] = "uncertain"
            record["review_file"] = fname
            _append_result(record)

            yield _sse("tier_done", {
                "tier": 4, "message": "Review packet saved", "filename": fname,
            })
            yield _sse("human_review_required", {"packet": review, "filename": fname})

        except Exception as exc:
            yield _sse("error", {"message": str(exc), "trace": traceback.format_exc()})

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ────────────────────────────────────────────────────────────────────────────
# Results
# ────────────────────────────────────────────────────────────────────────────

@app.get("/api/results")
def api_results():
    return _load_results()


@app.delete("/api/results")
def api_clear_results():
    RESULTS_PATH.write_text("[]")
    return {"ok": True}


# ────────────────────────────────────────────────────────────────────────────
# Human review queue
# ────────────────────────────────────────────────────────────────────────────

@app.get("/api/review-queue")
def api_review_queue():
    if not REVIEW_DIR.exists():
        return []
    items = []
    for f in sorted(REVIEW_DIR.glob("review_*.json")):
        try:
            data = json.loads(f.read_text())
            dec_path = REVIEW_DIR / f"decision_{f.stem}.json"
            data["filename"] = f.name
            data["decided"] = dec_path.exists()
            if dec_path.exists():
                data["decision"] = json.loads(dec_path.read_text())
            items.append(data)
        except Exception:
            pass
    return items


@app.post("/api/review-queue/{filename}/decision")
def api_review_decision(filename: str, decision: ReviewDecision):
    if not (REVIEW_DIR / filename).exists():
        raise HTTPException(status_code=404, detail="Packet not found")
    data = {
        "filename": filename,
        "verdict": decision.verdict,
        "notes": decision.notes,
        "decided_at": datetime.now().isoformat(),
    }
    stem = Path(filename).stem
    (REVIEW_DIR / f"decision_{stem}.json").write_text(json.dumps(data, indent=2))
    return {"ok": True}


# ────────────────────────────────────────────────────────────────────────────
# Metrics
# ────────────────────────────────────────────────────────────────────────────

@app.get("/api/metrics")
def api_metrics():
    results = _load_results()
    if not results:
        return {"total": 0, "verdicts": {}, "tiers": {}, "by_type": {}, "accuracy": None}

    verdicts: Dict[str, int] = {}
    tiers: Dict[str, int] = {}
    by_type: Dict[str, Dict] = {}
    correct = labeled = 0

    for r in results:
        v = r.get("final_verdict", "unknown")
        verdicts[v] = verdicts.get(v, 0) + 1

        t = str(r.get("resolved_at_tier", "?"))
        tiers[t] = tiers.get(t, 0) + 1

        cp = r.get("checkpoint_type", "unknown")
        if cp not in by_type:
            by_type[cp] = {"total": 0, "valid": 0, "invalid": 0, "uncertain": 0}
        by_type[cp]["total"] += 1
        by_type[cp][v] = by_type[cp].get(v, 0) + 1

        lbl = r.get("label")
        if lbl and lbl != "ambiguous":
            labeled += 1
            if v == lbl:
                correct += 1

    return {
        "total": len(results),
        "verdicts": verdicts,
        "tiers": tiers,
        "by_type": by_type,
        "accuracy": round(correct / labeled, 3) if labeled else None,
        "labeled": labeled,
    }
