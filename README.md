# Policy Memo Writing Agent

This repository is being built around the architecture defined in `CLAUDE.md` and the checkpoint-by-checkpoint implementation plan in `claude_prompts.md`.

The target system is an AI-powered policy memo writer with a structured provenance trail and a multi-tier claim evaluation framework called HERALD: Hierarchical Evidence Review and Automated Legitimacy Detection.

## What This Project Is

The product goal is a research and writing system that:

- accepts a policy topic, framing context, and optional source material
- uses tools and external data sources to research the topic
- produces a policy memo plus a structured notes log
- links every memo claim back to source evidence
- lets users selectively evaluate claims through a tiered validation pipeline
- supports revision when claims are weak, unsupported, or overstated

This README describes the intended build and operating model. `CLAUDE.md` remains the architecture source of truth.

## Core System Flow

The proposed system has four major phases:

1. User input and prompt assembly
2. Research and memo generation
3. User review of memo and provenance
4. HERALD claim evaluation and revision

In practice, that means:

- the user submits a topic, context, and optional sources
- the agent assembles a structured research-and-writing prompt
- the agent researches with tools, logs evidence, and builds a notes log before drafting
- the memo is rendered with claim markers and provenance
- selected claims are routed into HERALD for evaluation
- invalid or weak claims are revised and re-checked

## HERALD at a Glance

HERALD is a four-tier escalation framework for evaluating claims in the memo:

1. Tier 1: local NLI checks for claims that are well suited to entailment testing
2. Tier 2: LLM-as-judge evaluation for source faithfulness and reasoning quality
3. Tier 3: multi-agent debate across domain expert, methodologist, and skeptic personas
4. Tier 4: human review when automated tiers cannot confidently resolve the claim

Claims are classified into six types, and that type determines how evaluation starts:

- statistical or numeric
- causal
- comparative
- predictive or projective
- normative or prescriptive
- synthesis

The architecture also tracks derivation risk:

- `direct_extraction`
- `paraphrase`
- `cross_source`
- `agent_inference`

## Notes Log and Provenance

A core design principle in this project is that the memo is not enough by itself. The system must also generate a notes log during research.

Each claim should carry:

- a stable claim ID
- claim text
- claim type
- derivation method
- one or more linked sources
- relevant supporting excerpts
- agent reasoning about how the claim was formed

That notes log is what powers provenance inspection, claim selection, HERALD routing, and revision.

## Architecture Blueprint

The project is designed as a TypeScript frontend and orchestration layer plus a Python backend for services and evaluation infrastructure.

Planned major areas include:

- `src/agent/` for prompt assembly, research loops, claim extraction, and memo generation
- `src/herald/` for routing, tier execution, and revision feedback
- `src/mcp/` for external tools such as arXiv, World Bank, web search, and file readers
- `src/observability/` for Braintrust and telemetry integration
- `src/ui/` for the user-facing workflow across input, generation, review, and evaluation
- `src/types/` for the core TypeScript schemas
- `backend/src/policy_memo_agent/` for FastAPI routes, services, models, DB access, and Python HERALD logic
- `backend/tests/` and `tests/` for Python and TypeScript test coverage

Two architecture rules matter a lot:

- TypeScript and Python models must stay in sync.
- Every final memo claim should map back to structured provenance.

## Build Plan

The implementation flow is driven by `claude_prompts.md`, which is organized as a sequential set of prompts for Claude Code.

The high-level checkpoint order is:

1. repository initialization, Python setup, hooks, and CI
2. TypeScript scaffold and shared types
3. prompt assembler and research agent loop
4. claim extraction and HERALD routing
5. HERALD tiers 1 through 3
6. frontend workflow for input, progress, memo review, and results
7. real API integrations and Braintrust observability
8. reliability features, memory, DB-backed state, and revision loops
9. human review, integration polish, and end-to-end testing

If you are building from the prompts, complete one checkpoint at a time and verify each before moving forward.

## Developer Workflow

This repo uses Husky hooks, `lint-staged`, TypeScript checks, and Python checks. The easiest way to avoid the usual commit and push surprises is to run the full local verification command before you commit or push:

```bash
npm run verify
```

Recommended flow:

```bash
npm run verify
git add .
git commit -m "feat: short description"
git push
```

Why this helps:

- `git commit` runs staged-file checks only
- `git push` runs heavier checks through the pre-push hook
- CI can still be stricter on protected branches

So `npm run verify` is the main local “am I safe to push?” command.

## Expected Tooling

The architecture and prompts assume a setup centered on:

- Next.js with TypeScript on the application side
- FastAPI and `uv` on the Python side
- Ruff, mypy, and pytest for Python quality
- ESLint, Prettier, Vitest, Husky, and lint-staged for TypeScript quality
- Braintrust for observability and tracing
- MCP-based tool access for research capabilities

## Working Agreement for Contributors

When extending this project:

- treat `CLAUDE.md` as the architecture contract
- treat `claude_prompts.md` as the build sequence
- keep claims, notes log entries, and evaluation outputs strongly typed
- do not let memo generation drift away from provenance requirements
- prefer small checkpoint-sized changes over broad speculative refactors

## Current Status

This repository contains both planning artifacts and an in-progress implementation. Some parts reflect the target architecture before every module in that architecture is fully built.

That is intentional: the docs describe the system we are building toward, and the prompt sequence in `claude_prompts.md` is the operating plan for getting there.
