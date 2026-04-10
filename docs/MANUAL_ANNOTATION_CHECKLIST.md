# Manual Annotation Checklist

## 1. Test Set Expansion
- [ ] At least 30–50 cases per checkpoint type (CP1–CP5)
- [ ] Use real economics passages (Fed, FRED, NBER, CBO, etc.)
- [ ] For each passage, write 3 variants: valid, invalid, ambiguous
- [ ] Add `checkpoint_type` field to each case

## 2. Inter-Annotator Agreement
- [ ] At least 2 annotators label 20+ cases independently
- [ ] Compute Cohen’s Kappa (κ)
- [ ] If κ < 0.7, refine definitions in docs/validity_definitions.md

## 3. Labeling Rules
- [ ] Follow definitions in docs/validity_definitions.md
- [ ] Use only valid/invalid/ambiguous labels
- [ ] Document any disagreements and resolutions

## 4. Data Format
- [ ] Save as JSON: `[ { "checkpoint_type": ..., "source_context": ..., "output_text": ..., "label": ... }, ... ]`

---

## Example Entry
```json
{
  "checkpoint_type": "claim_extraction",
  "source_context": "The Federal Reserve raised rates...",
  "output_text": "The Fed raised rates in 2018.",
  "label": "valid"
}
```
