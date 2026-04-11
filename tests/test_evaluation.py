import json

from herald.evaluation.evaluate import main as eval_main


def test_evaluation_script_runs(monkeypatch, tmp_path):
    # Build matching temp fixtures so the lengths always agree
    gt = [{"label": "valid", "checkpoint_type": "claim_extraction"}]
    results = [
        {
            "final_verdict": "valid",
            "checkpoint_type": "claim_extraction",
            "resolved_at_tier": 1,
        }
    ]
    gt_file = tmp_path / "gt.json"
    results_file = tmp_path / "results.json"
    gt_file.write_text(json.dumps(gt))
    results_file.write_text(json.dumps(results))

    out_file = tmp_path / "eval_out.json"
    monkeypatch.setattr(
        "sys.argv",
        [
            "evaluate.py",
            "--results",
            str(results_file),
            "--ground-truth",
            str(gt_file),
            "--output",
            str(out_file),
        ],
    )
    eval_main()
    assert out_file.exists()
