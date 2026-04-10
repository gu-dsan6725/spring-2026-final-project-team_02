import pytest
from herald.evaluation.evaluate import main as eval_main

def test_evaluation_script_runs(monkeypatch):
    # This is a smoke test; just check that the script can be called
    monkeypatch.setattr('sys.argv', ['evaluate.py', '--results', 'results/run_results.json', '--ground-truth', 'data/test_sets/sample_cases.json'])
    try:
        eval_main()
    except SystemExit:
        pass  # argparse may call sys.exit
