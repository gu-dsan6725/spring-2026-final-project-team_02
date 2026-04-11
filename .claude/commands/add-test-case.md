# Add Test Case

Add a new labeled test case to a test set JSON file. Use this when you want to add a case for a specific checkpoint type.

Arguments: $ARGUMENTS — describe the test case you want to add (checkpoint type, what the output claims, source context, and expected label)

Steps:
1. Read the target test set file (default: `data/test_sets/feasibility_samples.json`) to understand the JSON schema
2. Construct a new entry following this schema:
   ```json
   {
     "checkpoint_type": "retrieval|claim_extraction|synthesis|numerical|causal",
     "output_text": "the LLM output to validate",
     "source_context": "the source passage that is ground truth",
     "query": "the original research question (optional)",
     "label": "valid|invalid|ambiguous"
   }
   ```
3. Append it to the file
4. Confirm the case was added and show a count of total cases in the file

Use the validity definitions in `docs/validity_definitions.md` to verify the label is consistent with the checkpoint type definitions before saving.
