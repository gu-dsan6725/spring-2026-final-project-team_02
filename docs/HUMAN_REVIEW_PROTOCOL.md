# Human Review Protocol (Tier 4)

## 1. When to Escalate
- [ ] If all automated tiers (1–3) return `uncertain` or low confidence
- [ ] If the case is ambiguous or controversial

## 2. Review Packet
- [ ] Review the structured packet generated in `results/human_review/`
- [ ] Read the `question_for_reviewer`, `agent_output`, and `source_context`
- [ ] Review automated analysis from Tiers 1–3

## 3. Adjudication
- [ ] Decide: `valid`, `invalid`, or `ambiguous`
- [ ] Provide a brief justification
- [ ] Record your verdict in the review packet

## 4. Documentation
- [ ] Save the reviewed packet with your verdict
- [ ] Note any recurring sources of confusion or disagreement

---

## Example Review Entry
```json
{
  "checkpoint_type": "causal",
  "question_for_reviewer": "Three tiers of automated analysis could not resolve this case...",
  "agent_output": "Rising rates directly caused...",
  "source_context": "Fed raised rates... housing starts declined...",
  "automated_analysis": { ... },
  "human_verdict": "ambiguous",
  "justification": "The causal claim is plausible but not fully supported by the evidence."
}
```
