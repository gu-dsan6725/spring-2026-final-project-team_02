Proposed design: src/herald/agent/

src/herald/agent/
├── **init**.py
├── agent.py ← the conversational agent loop
└── tools.py ← HERALD pipeline wrapped as Claude tool-use tools
How it works:

The agent uses Claude's tool-use API. It has three tools:

Tool What it does
validate_checkpoint Runs full HERALD escalation on (output_text, source_context, checkpoint_type). Returns verdict + tier + reasoning.
explain_verdict Given a packet ID, explains in plain language why each tier reached its conclusion, surfacing debate arguments if Tier 3 was reached.
request_human_review Formats a structured question for the human and waits for their reply — replacing the passive save_packet() with an interactive dialogue.
The agent loop:

User submits a case in natural language or structured form
Agent calls validate_checkpoint → gets verdict
If confident: returns plain-language explanation
If Tier 4: agent calls request_human_review, asks the user directly, records their response
User can ask follow-ups; agent can call explain_verdict to dig into any tier
Concrete implementation
This is clean to build — ~200 lines. Want me to implement it now? The entry point would be a new script herald-agent added to pyproject.toml, using the Anthropic SDK (Claude) as the conversational layer with Groq still handling Tiers 2/3.

One decision to make first: should the agent use Claude (Anthropic SDK) or stay on Groq?

Claude gives you better reasoning about complex verdicts, cleaner tool use, and is the right choice if this is going into a course demo — it's also what the claude-api skill here supports
Groq (Llama) keeps the whole system on one provider, no new API key needed
My recommendation is Claude for the agent layer — it's architecturally cleaner (Groq = fast cheap inference for evaluation tiers, Claude = reasoning layer for human-facing interaction) and makes the tool-use implementation more robust. But it requires an ANTHROPIC_API_KEY in .env.

Which would you prefer?
