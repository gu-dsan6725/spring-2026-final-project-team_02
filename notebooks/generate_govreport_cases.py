"""Generate labeled HERALD cases from GAO policy reports (launch/gov_report).

Dataset loading fallback chain:
  1. launch/gov_report  structure config  (trust_remote_code=True)
  2. launch/gov_report  parquet files     (direct parquet load, bypasses script)
  3. ccdv/govreport-summarization         (flat text, sentence-chunked fallback)

With launch/gov_report (structure config) each document has named sections
with depth levels, giving semantically coherent source contexts and better
checkpoint type inference from section titles.

Usage:
    uv run python notebooks/generate_govreport_cases.py
    uv run python notebooks/generate_govreport_cases.py --n-docs 100 --yes
"""

import argparse
import json
import random
import re
import time
from pathlib import Path

from datasets import load_dataset
from dotenv import load_dotenv
from herald.core.cli import add_llm_override_args
from herald.core.config import load_config
from herald.core.llm import get_llm_client

load_dotenv()

# ---------------------------------------------------------------------------
# Economics policy keywords
# ---------------------------------------------------------------------------
ECON_KEYWORDS = [
    # Core fiscal/budget
    "budget", "fiscal", "spending", "appropriations", "revenue", "tax",
    "expenditure", "funding", "grant", "loan", "appropriation", "obligation",
    "deficit", "debt", "surplus", "cost", "price", "fee", "rate",
    # Economic/monetary
    "economic", "economy", "inflation", "monetary", "financial", "finance",
    "market", "growth", "recession", "gdp", "productivity", "investment",
    # Programs/policy
    "trade", "subsidy", "regulation", "deregulation", "program", "policy",
    "benefit", "entitlement", "insurance", "assistance", "relief", "stimulus",
    # Labor/social
    "labor", "employment", "unemployment", "workforce", "wage", "income",
    "poverty", "inequality", "pension", "retirement", "social security",
    "medicare", "medicaid", "welfare", "afdc", "tanf", "snap",
    # Infrastructure/sectors
    "housing", "infrastructure", "energy", "defense", "acquisition",
    "contract", "procurement", "audit", "oversight", "accountability",
    # GAO-specific formal language
    "opinion", "schedule", "consolidated", "federal debt", "long-term",
    "performance", "management", "high risk", "improper payment",
]

# ---------------------------------------------------------------------------
# Checkpoint type heuristics
# ---------------------------------------------------------------------------
NUMERICAL_PATTERN = re.compile(
    r"\d[\d,]*\.?\d*\s*(%|percent|billion|million|trillion|thousand)", re.I
)
CAUSAL_PATTERN = re.compile(
    r"\b(caused?|resulted? in|led to|due to|because|therefore|consequently|"
    r"impact of|effect of|attributed to)\b", re.I
)
SECTION_TITLE_NUMERICAL = re.compile(
    r"\b(cost|budget|spending|revenue|financial|price|rate|amount|figure|"
    r"appropriation|funding|expenditure)\b", re.I
)
SECTION_TITLE_CAUSAL = re.compile(
    r"\b(effect|impact|result|consequence|cause|factor|outcome|reason)\b", re.I
)


def infer_checkpoint_type(text: str, title: str = "") -> str:
    if SECTION_TITLE_NUMERICAL.search(title) or NUMERICAL_PATTERN.search(text):
        return "numerical"
    if SECTION_TITLE_CAUSAL.search(title) or CAUSAL_PATTERN.search(text):
        return "causal"
    return "claim_extraction"


def difficulty_for(label: str, checkpoint_type: str) -> str:
    if label == "ambiguous":
        return "hard"
    if label == "invalid" and checkpoint_type == "numerical":
        return "easy"
    if label == "valid" and checkpoint_type in ("causal", "synthesis"):
        return "medium"
    return "easy" if label == "valid" else "medium"


# ---------------------------------------------------------------------------
# Dataset loading — fallback chain
# ---------------------------------------------------------------------------
LAUNCH_PARQUET = (
    "hf://datasets/launch/gov_report@refs%2Fconvert%2Fparquet/structure/{split}/*.parquet"
)


def load_govreport(split: str) -> tuple[object, str]:
    """Try three loading strategies in order. Returns (dataset, source_name)."""

    # Strategy 1: launch/gov_report structure config with trust_remote_code
    print("  Trying launch/gov_report (structure, trust_remote_code=True)...")
    try:
        ds = load_dataset(
            "launch/gov_report", "structure",
            split=split,
            trust_remote_code=True,
        )
        print(f"  ✓ Loaded via launch/gov_report structure config ({len(ds)} docs)")
        return ds, "launch_structure"
    except Exception as e:
        print(f"  ✗ Failed: {e}")

    # Strategy 2: launch/gov_report parquet files directly
    parquet_url = LAUNCH_PARQUET.format(split=split)
    print(f"  Trying launch/gov_report parquet ({parquet_url})...")
    try:
        ds = load_dataset("parquet", data_files={split: parquet_url}, split=split)
        # Verify expected columns
        sample = ds[0]
        assert "document_sections" in sample, "missing document_sections column"
        print(f"  ✓ Loaded via launch/gov_report parquet ({len(ds)} docs)")
        return ds, "launch_parquet"
    except Exception as e:
        print(f"  ✗ Failed: {e}")

    # Strategy 3: ccdv/govreport-summarization (flat text fallback)
    print("  Falling back to ccdv/govreport-summarization (flat text)...")
    ds = load_dataset("ccdv/govreport-summarization", split=split)
    print(f"  ✓ Loaded via ccdv fallback ({len(ds)} docs)")
    return ds, "ccdv_flat"


# ---------------------------------------------------------------------------
# Format-aware helpers
# ---------------------------------------------------------------------------

def is_econ_policy(doc: dict, source: str) -> bool:
    """Check if a doc covers economics policy. Works for both formats.

    Checks title first; if no keyword match, also checks the first 500 chars
    of the first section body. This catches docs with formal GAO titles like
    'Opinion on Schedules of Federal Debt' that contain keywords in body text.
    """
    if source in ("launch_structure", "launch_parquet"):
        ds = doc.get("document_sections", {})
        titles = ds.get("title", [])
        paragraphs = ds.get("paragraphs", [])
        title_text = " ".join(titles[:3]).lower()
        body_text = " ".join(p[:200] for p in paragraphs[:2]).lower()
        text = title_text + " " + body_text
    else:  # ccdv_flat
        text = doc.get("report", "")[:600].lower()
    return any(kw in text for kw in ECON_KEYWORDS)


def doc_title(doc: dict, source: str, idx: int) -> str:
    """Human-readable doc identifier for logging."""
    if source in ("launch_structure", "launch_parquet"):
        titles = doc.get("document_sections", {}).get("title", [])
        return titles[0][:80] if titles else f"doc_{idx}"
    return doc.get("report", "")[:80].replace("\n", " ")


def extract_sections_launch(doc: dict, min_len: int, max_len: int) -> list[dict]:
    """Extract named depth-1 sections from launch/gov_report structure format."""
    ds = doc.get("document_sections", {})
    titles = ds.get("title", [])
    paragraphs = ds.get("paragraphs", [])
    depths = ds.get("depth", [])

    sections = []
    for title, para, depth in zip(titles, paragraphs, depths):
        if depth != 1:
            continue
        text = para.strip().replace("\n", " ")
        if len(text) > max_len:
            text = text[:max_len]
        if len(text) >= min_len:
            sections.append({"title": title, "text": text})
    return sections


def make_synthesis_launch(doc: dict, min_len: int) -> dict | None:
    """Combine 2-3 depth-1 sections into a synthesis source (launch format)."""
    ds = doc.get("document_sections", {})
    paragraphs = ds.get("paragraphs", [])
    depths = ds.get("depth", [])

    chunks = []
    for para, depth in zip(paragraphs, depths):
        if depth == 1:
            text = para.strip().replace("\n", " ")
            if len(text) >= min_len:
                chunks.append(text[:600])  # cap each chunk
        if len(chunks) >= 3:
            break

    if len(chunks) < 2:
        return None
    combined = " ".join(chunks)
    if len(combined) > 1500:
        combined = combined[:1500] + "..."
    return {"title": "multi-section synthesis", "text": combined}


def sentence_chunks(text: str, target: int = 600, max_len: int = 1200) -> list[str]:
    """Split text into sentence-boundary-aware chunks of ~target chars."""
    # Split on sentence-ending punctuation followed by space+capital
    sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text.replace("\n", " "))
    chunks, current = [], ""
    for sent in sentences:
        if not sent.strip():
            continue
        if len(current) + len(sent) <= max_len:
            current = (current + " " + sent).strip()
        else:
            if len(current) >= target // 2:
                chunks.append(current)
            current = sent[:max_len]
    if len(current) >= target // 2:
        chunks.append(current)
    return chunks


def extract_sections_ccdv(doc: dict, min_len: int, max_len: int) -> list[dict]:
    """Sentence-chunked sections from ccdv flat report text."""
    report = doc.get("report", "")
    # First try double-newline paragraph split; fall back to sentence chunking
    double_paras = [p.strip().replace("\n", " ") for p in report.split("\n\n") if p.strip()]
    usable = [p for p in double_paras if min_len <= len(p) <= max_len]

    if len(usable) >= 2:
        return [{"title": f"paragraph_{i}", "text": p} for i, p in enumerate(usable)]

    # Fall back to sentence-aware chunking
    chunks = sentence_chunks(report, target=600, max_len=max_len)
    return [
        {"title": f"chunk_{i}", "text": c}
        for i, c in enumerate(chunks)
        if len(c) >= min_len
    ]


def make_synthesis_ccdv(doc: dict, min_len: int) -> dict | None:
    """Combine 2-3 sentence chunks into a synthesis source (ccdv fallback)."""
    chunks = sentence_chunks(doc.get("report", ""), target=400, max_len=600)
    usable = [c for c in chunks if len(c) >= min_len][:3]
    if len(usable) < 2:
        return None
    combined = " ".join(usable)
    if len(combined) > 1500:
        combined = combined[:1500] + "..."
    return {"title": "multi-section synthesis", "text": combined}


def extract_sections(doc: dict, source: str, min_len: int, max_len: int) -> list[dict]:
    if source in ("launch_structure", "launch_parquet"):
        return extract_sections_launch(doc, min_len, max_len)
    return extract_sections_ccdv(doc, min_len, max_len)


def make_synthesis_section(doc: dict, source: str, min_len: int) -> dict | None:
    if source in ("launch_structure", "launch_parquet"):
        return make_synthesis_launch(doc, min_len)
    return make_synthesis_ccdv(doc, min_len)


# ---------------------------------------------------------------------------
# Groq prompt
# ---------------------------------------------------------------------------
GENERATION_PROMPT = """You are building training data for an LLM output validation system \
focused on U.S. government policy reports (GAO).

Given a SOURCE PASSAGE and a CHECKPOINT TYPE, generate:
1. QUERY: a concise research question (1 sentence) a policy analyst might ask.
2. Three LLM output examples:
   - VALID: 1-2 sentences faithfully representing the source, no errors.
   - INVALID: 1-2 sentences with exactly one subtle error (wrong number, \
fabricated statistic, false causal claim, or detail not in the source).
   - AMBIGUOUS: 1-2 sentences that are a reasonable inference but go slightly \
beyond what the source explicitly states.

CHECKPOINT TYPE: {checkpoint_type}

SOURCE PASSAGE:
{source}

Respond with ONLY valid JSON, no markdown:
{{"query": "...", "valid": "...", "invalid": "...", "ambiguous": "..."}}"""


# Retrieval checkpoint: source_context is the query, output is a retrieved doc description
RETRIEVAL_PROMPT = """You are building training data for an LLM retrieval validation system \
focused on U.S. government policy research.

Given a TOPIC (derived from a GAO report section) and a POLICY QUESTION, generate three \
examples of what an LLM might return as a "retrieved document" reference:
   - VALID: a 1-2 sentence description of a real-sounding, directly relevant GAO/CBO/OMB \
document that would genuinely answer the question.
   - INVALID: a 1-2 sentence description of a document that sounds plausible but is \
off-topic, wrong agency, wrong time period, or fabricated.
   - AMBIGUOUS: a 1-2 sentence description of a document that is tangentially related \
but not a direct answer to the question.

TOPIC: {topic}
POLICY QUESTION: {query}

Respond with ONLY valid JSON, no markdown:
{{"valid": "...", "invalid": "...", "ambiguous": "..."}}"""


def generate_cases(client, source: str, checkpoint_type: str) -> dict:
    response = client.complete(
        prompt=GENERATION_PROMPT.format(checkpoint_type=checkpoint_type, source=source),
        json_mode=True,
        temperature=0.7,
    )
    return json.loads(response.content)


def generate_retrieval_cases(client, topic: str, query: str) -> dict:
    response = client.complete(
        prompt=RETRIEVAL_PROMPT.format(topic=topic, query=query),
        json_mode=True,
        temperature=0.7,
    )
    return json.loads(response.content)


# Target checkpoint distribution (approximate fractions)
CHECKPOINT_TARGETS = {
    "claim_extraction": 0.25,
    "numerical":        0.30,
    "causal":           0.20,
    "synthesis":        0.15,
    "retrieval":        0.10,
}


def assign_checkpoint_type(
    text: str,
    title: str,
    current_counts: dict,
    total_so_far: int,
) -> str:
    """Return checkpoint type, nudging toward target distribution when over-represented."""
    natural = infer_checkpoint_type(text, title)

    if total_so_far < 10:
        return natural  # don't force distribution on first few docs

    # Check which types are under their target share
    under = []
    for cp, target in CHECKPOINT_TARGETS.items():
        if cp == "retrieval":
            continue  # retrieval is generated separately, not via this function
        actual = current_counts.get(cp, 0) / max(total_so_far, 1)
        if actual < target - 0.05:  # 5% tolerance
            under.append(cp)

    if under and natural not in under:
        # Redirect to the most under-represented type
        return min(under, key=lambda cp: current_counts.get(cp, 0) / max(total_so_far, 1))
    return natural


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Generate HERALD cases from GovReport")
    parser.add_argument("--output", default="data/test_sets/gov_report_cases.json")
    parser.add_argument("--n-docs", type=int, default=50)
    parser.add_argument("--sections-per-doc", type=int, default=2)
    parser.add_argument("--config", default="configs/default.yaml")
    parser.add_argument("--sleep", type=float, default=0.5, help="Seconds between API calls (gemini needs less)")
    parser.add_argument("--min-section-length", type=int, default=200)
    parser.add_argument("--max-section-length", type=int, default=1000)
    parser.add_argument("--split", default="train", choices=["train", "validation", "test"])
    parser.add_argument("--yes", action="store_true", help="Skip confirmation prompt")
    add_llm_override_args(
        parser,
        include_single_model=True,
        single_model_help="Override the generation model for this run.",
    )
    args = parser.parse_args()

    config = load_config(
        args.config,
        provider=args.provider,
        tier2_model=args.model,
    )

    # ------------------------------------------------------------------
    # CHECKPOINT 1: Load dataset
    # ------------------------------------------------------------------
    print("=" * 60)
    print("CHECKPOINT 1: Loading dataset")
    print("=" * 60)
    dataset, source_name = load_govreport(args.split)
    print(f"\nSource format: {source_name}")
    print(f"Total docs in '{args.split}' split: {len(dataset)}")

    # ------------------------------------------------------------------
    # CHECKPOINT 2: Filter to econ policy
    # ------------------------------------------------------------------
    print("\n" + "=" * 60)
    print("CHECKPOINT 2: Filtering to economics policy documents")
    print("=" * 60)
    econ_docs = [doc for doc in dataset if is_econ_policy(doc, source_name)]
    econ_pct = 100 * len(econ_docs) / len(dataset)
    print(f"Economics policy docs:  {len(econ_docs)} / {len(dataset)}  ({econ_pct:.1f}%)")

    if len(econ_docs) < args.n_docs:
        print(f"WARNING: Only {len(econ_docs)} econ docs — reducing --n-docs to {len(econ_docs)}")
        args.n_docs = len(econ_docs)

    # ------------------------------------------------------------------
    # CHECKPOINT 3: Random selection
    # ------------------------------------------------------------------
    print("\n" + "=" * 60)
    print("CHECKPOINT 3: Random selection")
    print("=" * 60)
    random.shuffle(econ_docs)
    docs_to_process = econ_docs[:args.n_docs]
    print(f"Randomly selected {len(docs_to_process)} docs from pool of {len(econ_docs)}")
    print("Sample titles:")
    for i, doc in enumerate(docs_to_process[:5]):
        print(f"  • {doc_title(doc, source_name, i)}")
    if len(docs_to_process) > 5:
        print(f"  ... and {len(docs_to_process) - 5} more")

    # ------------------------------------------------------------------
    # CHECKPOINT 4: Pre-flight estimate (no API calls yet)
    # ------------------------------------------------------------------
    print("\n" + "=" * 60)
    print("CHECKPOINT 4: Pre-flight estimate")
    print("=" * 60)

    section_counts = []
    for doc in docs_to_process:
        secs = extract_sections(doc, source_name, args.min_section_length, args.max_section_length)
        n = min(len(secs), args.sections_per_doc)
        has_synth = make_synthesis_section(doc, source_name, args.min_section_length) is not None
        section_counts.append(n + (1 if has_synth else 0))

    estimated_calls = sum(section_counts)
    estimated_cases = estimated_calls * 3
    estimated_secs = estimated_calls * args.sleep
    avg_sections = estimated_calls / len(docs_to_process) if docs_to_process else 0
    zero_section_docs = sum(1 for c in section_counts if c == 0)

    print(f"Source format:          {source_name}")
    print(f"Docs to process:        {len(docs_to_process)}")
    print(f"Avg sections/doc:       {avg_sections:.1f}  (max {args.sections_per_doc} + 1 synthesis)")
    print(f"Docs with 0 sections:   {zero_section_docs}  (will be skipped)")
    print(f"Estimated API calls:    {estimated_calls}")
    print(f"Estimated cases output: ~{estimated_cases}  (3 labels per call)")
    print(f"Sleep between calls:    {args.sleep}s")
    print(f"Estimated runtime:      ~{estimated_secs/60:.1f} min  ({estimated_secs:.0f}s)")
    print(f"Provider:               {config['provider']}")
    print(f"Model:                  {config['tier2']['model']}")
    print(f"Output file:            {args.output}")

    if args.yes:
        print("\nProceeding (--yes flag set).")
    else:
        try:
            confirm = input("\nProceed with LLM API calls? [y/N] ").strip().lower()
        except EOFError:
            confirm = ""
        if confirm != "y":
            print("Aborted. Re-run with --yes to skip this prompt.")
            return

    client = get_llm_client(config)
    print(f"Provider: {config['provider']} / Model: {config['tier2']['model']}\n")

    results = []
    errors = 0
    total_api_calls = 0
    type_counts: dict[str, int] = {}

    for doc_idx, doc in enumerate(docs_to_process):
        title = doc_title(doc, source_name, doc_idx)
        print(f"[{doc_idx+1:3d}/{len(docs_to_process)}] {title[:75]}")

        sections = extract_sections(doc, source_name, args.min_section_length, args.max_section_length)
        selected = sections[:args.sections_per_doc]

        synth = make_synthesis_section(doc, source_name, args.min_section_length)
        if synth:
            selected.append({**synth, "_checkpoint_override": "synthesis"})

        if not selected:
            print("         (no usable sections — skipping)")
            continue

        # Every ~10 docs, generate one retrieval case to hit target distribution (R5)
        add_retrieval = (doc_idx % 10 == 0) and (type_counts.get("retrieval", 0) / max(len(results) // 3, 1) < CHECKPOINT_TARGETS["retrieval"] + 0.05)

        for section in selected:
            checkpoint_type = section.get("_checkpoint_override") or assign_checkpoint_type(
                section["text"], section.get("title", ""), type_counts, len(results) // 3
            )
            source = section["text"]

            try:
                generated = generate_cases(client, source, checkpoint_type)
                total_api_calls += 1
                query = generated.get("query", f"What does this report say about {section['title']}?")

                for label in ("valid", "invalid", "ambiguous"):
                    output_text = generated.get(label, "").strip()
                    if not output_text:
                        continue
                    results.append({
                        "checkpoint_type": checkpoint_type,
                        "source_context": source,
                        "output_text": output_text,
                        "query": query,
                        "label": label,
                        "difficulty": difficulty_for(label, checkpoint_type),
                        "doc_id": str(doc_idx),
                        "section_title": section.get("title", ""),
                        "data_source": source_name,
                    })
                type_counts[checkpoint_type] = type_counts.get(checkpoint_type, 0) + 1

                print(f"         ✓ [{section.get('title','')[:35]:35s}] {checkpoint_type} → {len(results)} cases")
                time.sleep(args.sleep)

            except Exception as e:
                print(f"         ✗ ERROR [{section.get('title','')[:35]}]: {e}")
                errors += 1
                time.sleep(args.sleep * 2)

        # Retrieval case for this doc (R5)
        if add_retrieval:
            try:
                retrieval_query = f"What GAO reports address {title[:80]}?"
                generated = generate_retrieval_cases(client, title, retrieval_query)
                total_api_calls += 1
                for label in ("valid", "invalid", "ambiguous"):
                    output_text = generated.get(label, "").strip()
                    if not output_text:
                        continue
                    results.append({
                        "checkpoint_type": "retrieval",
                        "source_context": retrieval_query,
                        "output_text": output_text,
                        "query": retrieval_query,
                        "label": label,
                        "difficulty": difficulty_for(label, "retrieval"),
                        "doc_id": str(doc_idx),
                        "section_title": "retrieval",
                        "data_source": source_name,
                    })
                type_counts["retrieval"] = type_counts.get("retrieval", 0) + 1
                print(f"         ✓ [retrieval                          ] retrieval → {len(results)} cases")
                time.sleep(args.sleep)
            except Exception as e:
                print(f"         ✗ ERROR [retrieval]: {e}")
                errors += 1

    # Save
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(results, f, indent=2)

    # Summary
    label_counts = {}
    type_counts = {}
    for r in results:
        label_counts[r["label"]] = label_counts.get(r["label"], 0) + 1
        type_counts[r["checkpoint_type"]] = type_counts.get(r["checkpoint_type"], 0) + 1

    n_cases = len(results)
    n_triples = n_cases // 3
    print(f"\n{'='*60}")
    print(f"Generated {n_cases} cases ({errors} errors) → {output_path}")
    print(f"Data source:    {source_name}")
    print(f"API calls made: {total_api_calls}")
    print(f"\nLabel distribution:  {label_counts}")
    print(f"\nCheckpoint distribution vs targets:")
    for cp, target in CHECKPOINT_TARGETS.items():
        count = type_counts.get(cp, 0)
        actual = count / max(n_triples, 1)
        bar = "█" * int(actual * 20)
        diff = actual - target
        flag = "✓" if abs(diff) < 0.07 else ("▲" if diff > 0 else "▼")
        print(f"  {cp:20s} {flag} {actual:5.1%} (target {target:.0%})  {bar}")
    print(f"\nNEXT STEP:")
    print(f"  uv run python -m herald.pipeline.run --input {output_path} -v")


if __name__ == "__main__":
    main()
