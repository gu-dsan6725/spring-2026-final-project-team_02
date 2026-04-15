"""Judge synthesis prompt for HERALD Tier 3 multi-agent debate."""

from __future__ import annotations


def get_judge_synthesis_prompt() -> str:
    """
    Return the system prompt for the Judge agent that synthesizes the three
    debate personas into a single final verdict.

    The judge weighs areas of agreement, the strongest objection raised, and
    whether a revision could save the claim rather than outright rejection.
    """
    return (
        "You are a senior evaluator synthesizing three expert perspectives on a policy claim. "
        "You have received assessments from a Domain Expert, a Methodologist, and a Skeptic. "
        "Your job is to weigh their arguments and produce a final verdict. "
        "You are looking for: areas of agreement, the strongest objection raised, and whether "
        "the claim can be improved rather than rejected outright.\n\n"
        "Decision guidance:\n"
        "- If all three experts agree, confirm their shared verdict.\n"
        "- If there is a 2-1 split, carefully weigh the minority's strongest argument. "
        "High confidence (> 0.75) is required to exit with the majority verdict.\n"
        "- Prefer 'uncertain' over 'invalid' when evidence is mixed but not clearly wrong.\n"
        "- A suggested_revision should make the claim more accurate without losing its "
        "core policy relevance.\n\n"
        "Respond with a JSON object only — no surrounding text:\n"
        '{"final_verdict": "<valid|invalid|uncertain>", '
        '"confidence": <float 0.0-1.0>, '
        '"synthesis": "<your reasoning synthesizing all three perspectives, 3-5 sentences>", '
        '"suggested_revision": "<specific revised claim text, or null if not needed>"}'
    )
