# Run Tests

Run the test suite with pytest via uv.

Arguments: $ARGUMENTS (optional: specific test file, test name via -k, or empty for all tests)

Examples:
- `/test` — runs all tests
- `/test tests/test_pipeline.py` — runs a single file
- `/test -k test_escalation` — runs tests matching a name pattern

```bash
uv run pytest $ARGUMENTS -v
```

After running, report: how many passed/failed, and if any failed, show the failure output and suggest a fix.
