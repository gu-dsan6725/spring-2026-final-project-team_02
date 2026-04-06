# HERALD Validity Definitions

This document defines what "valid" means for each of the five checkpoint types in the HERALD pipeline. All annotators and automated systems must use these definitions consistently.

---

## Overview

A claim is evaluated against a **source context** — the retrieved passage, extracted claim set, or reference data that was the basis for the agentic output. The core question for every checkpoint type is:

> **Is the output fully warranted by the source, or does it assert something the source does not support?**

Labels:

| Label | Meaning |
|---|---|
| `valid` | The output is fully and directly supported by the source context with no unsupported additions |
| `invalid` | The output contains at least one factual error, fabrication, or assertion the source does not support |
| `ambiguous` | The output is a reasonable inference that goes slightly beyond the source but is neither clearly correct nor clearly wrong |

---

## Checkpoint Type Definitions

### CP1 — Retrieval

**Valid means:** The retrieved document is topically relevant to the query. Relevance is judged by whether a reader of the document could plausibly find information useful for answering the query. The document does not need to fully answer the query — relevance is sufficient.

**Invalid means:** The retrieved document is off-topic, addresses a different domain, geography, or time period than the query requires, and a reasonable reader would not consider it useful for answering the query.

**Ambiguous means:** The document is tangentially related — it covers a related domain or a different time period that partially overlaps with the query scope.

**Examples:**
- Query: "What drove 2022 U.S. inflation?" — Fed Monetary Policy Report (2022) → **valid**
- Query: "What drove 2022 U.S. inflation?" — EU agricultural subsidies report (2019) → **invalid**
- Query: "What drove 2022 U.S. inflation?" — IMF World Economic Outlook (2015) covering different period → **ambiguous**

**Key rule:** For retrieval, you are not checking whether the document contains the *answer* — only whether it is *relevant* to the question.

---

### CP2 — Claim Extraction

**Valid means:** Every factual assertion in the output is **directly entailed** by the source passage. This means:
- Numbers match the source exactly (or within stated rounding)
- Time periods, dates, and entities match the source
- No causal or inferential claims appear that are not explicit in the source
- No information is added that requires knowledge outside the source

**Invalid means:** The output contains at least one of:
- A wrong number, date, entity, or percentage
- A claim stated as fact that is not in the source
- A causal or mechanistic assertion the source does not make
- A reversal or distortion of what the source says

**Ambiguous means:** The output accurately restates source content but *extends* it with a reasonable inference — e.g., inferring that a trend "is likely to continue" or that an effect "suggests" a policy implication. The inference is defensible but not stated in the source.

**Examples:**
- Source: "CPI rose 7.0% in 2021" — Claim: "CPI rose 7.0% in 2021" → **valid**
- Source: "CPI rose 7.0% in 2021" — Claim: "CPI rose 7.5% in 2021" → **invalid**
- Source: "CPI rose 7.0% in 2021" — Claim: "Inflation raised concerns about Fed credibility" → **ambiguous**

**Key rule:** The test is strict entailment. If the claim requires any fact not present in the source, it is at minimum ambiguous, and likely invalid if the added fact is stated assertively.

---

### CP3 — Synthesis

**Valid means:** The summary faithfully represents the full set of claims in the source without:
- Introducing new claims not present in the source claims
- Distorting the meaning, magnitude, or direction of any source claim
- Omitting qualifiers that are essential to accuracy (e.g., "contributed to" vs. "caused")

**Invalid means:** The synthesis:
- Adds a factual claim not present in any source claim
- Merges or distorts claims in a way that changes their meaning
- Removes essential hedges (e.g., presents correlation as causation)
- Contains a factual error in the summary

**Ambiguous means:** The synthesis is accurate to all stated source claims but adds a mild interpretive framing or editorial conclusion. The synthesis may omit a minor qualifier but does not materially distort.

**Examples:**
- Claims: {CPI up 7%, energy up 29.3%, supply chains disrupted} — Summary faithfully covers all three → **valid**
- Same claims — Summary adds "wage pressures" (not in source claims) → **invalid**
- Same claims — Summary concludes "Fed was slow to respond" → **ambiguous**

**Key rule:** Synthesis validity requires faithfulness to the *claim set*, not to some external ground truth. A synthesis can be economically wrong but still valid if it faithfully represents what the source claims say.

---

### CP4 — Numerical

**Valid means:** Every number in the output matches the source within reasonable rounding conventions:
- Percentages: ±0.1 percentage points (e.g., "approximately 6%" for 5.9% is valid)
- Dollar amounts: within standard significant-figure rounding
- Counts: exact, unless the source itself approximates
- Dates and time periods: exact

**Invalid means:** A number in the output differs from the source beyond reasonable rounding, or the direction of a change is wrong (e.g., "rose" vs. "fell"), or the unit is wrong.

**Ambiguous means:** The rounding is debatable — e.g., describing 5.9% as "nearly 6%" is a judgment call that most readers would accept, but some might consider it imprecise.

**Examples:**
- Source: "peaked at 14.7% in April 2020" — Claim: "peaked at roughly 14.7% in April 2020" → **valid**
- Source: "peaked at 14.7% in April 2020" — Claim: "peaked near 20% in April 2020" → **invalid**
- Source: "grew 5.9% in 2021" — Claim: "growth approaching 6%" → **ambiguous**

**Key rule:** Numbers are either right or wrong — the only ambiguous zone is rounding. Precision errors (wrong sig figs that change the substance) are invalid. Direction errors are always invalid.

---

### CP5 — Causal

**Valid means:** The causal claim does not exceed the strength of evidence in the source:
- Source says "contributed to" → output may say "contributed to" or "was a factor in" (valid), not "caused" (invalid)
- Source acknowledges multiple confounders → output may attribute partial causation but must not single out one cause as exclusive
- Source shows correlation with explicit hedging → output must preserve the hedging
- Mechanistic claims must be present in the source, not inferred by the LLM

**Invalid means:** The output:
- Uses "caused" or "directly caused" when the source only shows correlation or partial attribution
- Ignores stated confounders and presents a clean causal story
- Reverses causal direction
- Claims a specific quantitative causal effect the source does not state

**Ambiguous means:** The output strengthens a causal claim in a way that is defensible given the evidence — e.g., calling a factor "likely dominant" when the source shows it was large but doesn't rank it. The causal inference is reasonable but goes beyond what the source explicitly states.

**Examples:**
- Source: "rates rose; housing permits fell; multiple factors cited" — Claim: "rates were one contributor" → **valid**
- Same source — Claim: "rates directly caused the permit decline" → **invalid**
- Same source — Claim: "rates were likely the dominant driver" → **ambiguous**

**Key rule:** Causal language is a spectrum: correlation < associated with < contributed to < one of several causes < a primary cause < caused < directly caused. The output's position on this spectrum must not exceed the source's position.

---

### CP6 — Epistemic

**Motivation:** LLMs systematically remove uncertainty that was present in source material. A research agent that states a finding confidently when the source hedges it, or that claims consensus when the source acknowledges debate, is introducing a specific and common failure mode that no other checkpoint type catches. The epistemic checkpoint validates whether the agent's *confidence level* matches the source's *evidence strength*.

**Valid means:** The agent's claim accurately reflects the epistemic status of the finding in the source:
- Source hedges with "may," "suggests," "is consistent with" → output preserves those hedges
- Source acknowledges competing explanations → output does not present one as settled
- Source notes a gap in evidence → output does not assert a conclusion that fills the gap
- Source presents a finding as preliminary or contested → output does not present it as established

**Invalid means:** The agent's output removes or weakens epistemic hedges present in the source:
- Source says "results suggest X may contribute" → output says "X contributes"
- Source says "evidence is mixed" → output says "evidence shows"
- Source identifies an open question → output asserts an answer
- Source says "no study has examined" → output implies the answer is known
- Source presents a debate → output presents one side as the consensus

**Ambiguous means:** The agent slightly strengthens confidence in a way that is defensible given the overall weight of evidence in the source — e.g., calling a "strongly suggested" finding "likely" — but does not fully assert certainty.

**Examples:**
- Source: "These findings suggest interest rates *may* have dampened investment" — Claim: "Rates may have dampened investment" → **valid**
- Same source — Claim: "Rates dampened investment" → **invalid** (hedge removed)
- Source: "Economists debate whether the effect is supply- or demand-driven" — Claim: "The effect appears supply-driven" → **invalid** (debate resolved)
- Source: "Evidence strongly suggests X" — Claim: "X is likely true" → **ambiguous**

**Key rule:** This checkpoint evaluates *calibration*, not factual accuracy. An output can be economically correct but still INVALID on this checkpoint if it expresses more certainty than the source warrants. The question is: would a careful reader of both the output and the source conclude that the output misrepresents the strength of evidence?

**Relationship to Causal (CP5):** Causal overreach is a subset of epistemic overreach. CP5 specifically targets causal language; CP6 catches the broader class of confidence inflation across all claim types — including empirical findings, correlational evidence, and contested interpretations.

---

## Inter-Annotator Agreement

Before finalizing labels, have at least two independent annotators label the same 20+ cases. Compute Cohen's Kappa:

- κ ≥ 0.70: Good agreement — proceed
- κ 0.50–0.70: Moderate — tighten definitions for disagreement cases
- κ < 0.50: Poor — revisit definitions before proceeding

Common disagreement patterns and resolutions:

| Disagreement | Resolution |
|---|---|
| Valid vs. Ambiguous | Default to Ambiguous if any fact goes beyond the source, even slightly |
| Ambiguous vs. Invalid | Default to Invalid if an added assertion is stated as fact (not hedged) |
| Valid vs. Invalid | Always re-read the source carefully; most disagreements here are reading errors |

---

## Notes for Automated Systems

- Tier 1 (NLI): Maps entailment → valid, contradiction → invalid, neutral → uncertain/ambiguous
- Tier 2 (LLM Judge): Must follow these definitions explicitly in its system prompt
- Tier 2.5 (Counterfactual Probe): After a confident Tier 2 verdict, asks what disconfirming
  evidence would look like and checks for it in the source. Overrides to UNCERTAIN if found.
  Addresses correlated model bias. Especially valuable for CP5 (causal) and CP6 (epistemic).
- Tier 3 (Debate): Advocate argues valid; Critic argues invalid; Judge applies these definitions
- When in doubt, flag for human review (Tier 4)
- CP6 (epistemic) is NLI-hostile: hedging language is subtle and DeBERTa will frequently
  return neutral. Expect most CP6 cases to escalate to Tier 2 or beyond.
