"""Shared CLI helpers for consistent LLM provider/model overrides."""


def add_llm_override_args(
    parser,
    *,
    include_tier2: bool = False,
    include_tier3: bool = False,
    include_single_model: bool = False,
    single_model_help: str = "Override the model used by this script.",
):
    """Add standard LLM provider/model flags to an argparse parser."""
    parser.add_argument(
        "--provider",
        choices=["groq", "gemini", "openai"],
        default=None,
        help="Override the configured LLM provider for this run.",
    )

    if include_tier2:
        parser.add_argument(
            "--tier2-model",
            default=None,
            help="Override the Tier 2 LLM model for this run.",
        )

    if include_tier3:
        parser.add_argument(
            "--tier3-model",
            default=None,
            help="Override the Tier 3 LLM model for this run.",
        )

    if include_single_model:
        parser.add_argument(
            "--model",
            default=None,
            help=single_model_help,
        )
