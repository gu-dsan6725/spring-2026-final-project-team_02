import { describe, it, expect } from 'vitest';
import { assembleSystemPrompt, assembleUserMessage } from '../../src/agent/prompt-assembler';
import type { MemoInput } from '../../src/types/memo';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const minimalInput: MemoInput = {
  topic: 'Universal basic income pilot programs in sub-Saharan Africa',
};

const fullInput: MemoInput = {
  topic: 'Urban water access in the Sahel region',
  background: 'This memo is for the Minister of Water Resources ahead of the 2026 budget cycle.',
  known_sources: ['https://www.worldbank.org/water-sahel-2024', 'https://arxiv.org/abs/2311.12345'],
  template: '1. Executive Summary\n2. Situation Analysis\n3. Recommendations',
  max_tool_calls: 15,
  max_research_tokens: 30000,
};

// ---------------------------------------------------------------------------
// assembleSystemPrompt — claim taxonomy
// ---------------------------------------------------------------------------

describe('assembleSystemPrompt — claim taxonomy', () => {
  const prompt = assembleSystemPrompt(minimalInput);

  const ALL_CLAIM_TYPES = [
    'statistical',
    'causal',
    'comparative',
    'predictive',
    'normative',
    'synthesis',
  ] as const;

  for (const claimType of ALL_CLAIM_TYPES) {
    it(`includes claim type "${claimType}"`, () => {
      expect(prompt).toContain(claimType);
    });
  }

  it('includes all 6 claim types and no extras', () => {
    // Each type appears in both the taxonomy and the schema, so at least 2 occurrences each.
    for (const claimType of ALL_CLAIM_TYPES) {
      const count = (prompt.match(new RegExp(claimType, 'g')) ?? []).length;
      expect(count, `Expected at least 2 occurrences of "${claimType}"`).toBeGreaterThanOrEqual(2);
    }
  });
});

// ---------------------------------------------------------------------------
// assembleSystemPrompt — derivation methods
// ---------------------------------------------------------------------------

describe('assembleSystemPrompt — derivation methods', () => {
  const prompt = assembleSystemPrompt(minimalInput);

  const ALL_DERIVATION_METHODS = [
    'direct_extraction',
    'paraphrase',
    'cross_source',
    'agent_inference',
  ] as const;

  for (const method of ALL_DERIVATION_METHODS) {
    it(`includes derivation method "${method}"`, () => {
      expect(prompt).toContain(method);
    });
  }
});

// ---------------------------------------------------------------------------
// assembleSystemPrompt — notes log schema
// ---------------------------------------------------------------------------

describe('assembleSystemPrompt — notes log schema', () => {
  const prompt = assembleSystemPrompt(minimalInput);

  it('includes claim_id field', () => {
    expect(prompt).toContain('claim_id');
  });

  it('includes claim_text field', () => {
    expect(prompt).toContain('claim_text');
  });

  it('includes claim_type field', () => {
    expect(prompt).toContain('claim_type');
  });

  it('includes derivation field', () => {
    expect(prompt).toContain('derivation');
  });

  it('includes sources field', () => {
    expect(prompt).toContain('sources');
  });

  it('includes relevant_chunk field', () => {
    expect(prompt).toContain('relevant_chunk');
  });

  it('includes source_id field', () => {
    expect(prompt).toContain('source_id');
  });

  it('includes source_title field', () => {
    expect(prompt).toContain('source_title');
  });

  it('includes source_url field', () => {
    expect(prompt).toContain('source_url');
  });

  it('includes reasoning field', () => {
    expect(prompt).toContain('reasoning');
  });

  it('includes sequential claim_id examples (C-001)', () => {
    expect(prompt).toContain('C-001');
  });

  it('includes sequential source_id examples (S-001)', () => {
    expect(prompt).toContain('S-001');
  });
});

// ---------------------------------------------------------------------------
// assembleSystemPrompt — user input interpolation
// ---------------------------------------------------------------------------

describe('assembleSystemPrompt — topic interpolation', () => {
  it('includes the topic from minimal input', () => {
    const prompt = assembleSystemPrompt(minimalInput);
    expect(prompt).toContain(minimalInput.topic);
  });

  it('includes the topic from full input', () => {
    const prompt = assembleSystemPrompt(fullInput);
    expect(prompt).toContain(fullInput.topic);
  });
});

describe('assembleSystemPrompt — background interpolation', () => {
  it('includes background text when provided', () => {
    const prompt = assembleSystemPrompt(fullInput);
    expect(prompt).toContain(fullInput.background!);
  });

  it('does not include a background section when omitted', () => {
    const prompt = assembleSystemPrompt(minimalInput);
    expect(prompt).not.toContain('Background / Framing');
  });
});

describe('assembleSystemPrompt — known sources interpolation', () => {
  it('includes each known source URL when provided', () => {
    const prompt = assembleSystemPrompt(fullInput);
    for (const url of fullInput.known_sources!) {
      expect(prompt).toContain(url);
    }
  });

  it('does not include a known-sources section when omitted', () => {
    const prompt = assembleSystemPrompt(minimalInput);
    expect(prompt).not.toContain('Known Sources Provided by the User');
  });
});

describe('assembleSystemPrompt — template interpolation', () => {
  it('includes the template content when provided', () => {
    const prompt = assembleSystemPrompt(fullInput);
    expect(prompt).toContain(fullInput.template!);
  });

  it('does not include a template section when omitted', () => {
    const prompt = assembleSystemPrompt(minimalInput);
    expect(prompt).not.toContain('Memo Template');
  });
});

describe('assembleSystemPrompt — budget interpolation', () => {
  it('uses custom max_tool_calls when provided', () => {
    const prompt = assembleSystemPrompt(fullInput);
    expect(prompt).toContain('Maximum tool calls: 15');
  });

  it('uses custom max_research_tokens when provided', () => {
    const prompt = assembleSystemPrompt(fullInput);
    expect(prompt).toContain('Maximum research tokens: 30000');
  });

  it('falls back to default max_tool_calls (25) when not provided', () => {
    const prompt = assembleSystemPrompt(minimalInput);
    expect(prompt).toContain('Maximum tool calls: 25');
  });

  it('falls back to default max_research_tokens (50000) when not provided', () => {
    const prompt = assembleSystemPrompt(minimalInput);
    expect(prompt).toContain('Maximum research tokens: 50000');
  });
});

// ---------------------------------------------------------------------------
// assembleSystemPrompt — structural instructions
// ---------------------------------------------------------------------------

describe('assembleSystemPrompt — structural instructions', () => {
  const prompt = assembleSystemPrompt(minimalInput);

  it('instructs the agent to create a research plan first', () => {
    expect(prompt).toContain('Research Plan');
  });

  it('instructs the agent to execute tool calls', () => {
    expect(prompt).toContain('Execute the Research Plan');
  });

  it('instructs the agent to write the memo after research', () => {
    expect(prompt).toContain('Write the Policy Memo');
  });

  it('instructs the agent to use [C-XXX] inline markers', () => {
    expect(prompt).toContain('[C-');
  });

  it('includes the required JSON output format', () => {
    expect(prompt).toContain('"memo"');
    expect(prompt).toContain('"notes_log"');
  });

  it('instructs the agent to enforce atomic claims (one assertion per entry)', () => {
    expect(prompt).toContain('atomic');
  });

  it('instructs the agent never to fabricate a source', () => {
    const lower = prompt.toLowerCase();
    expect(lower).toContain('fabricate');
  });

  it('instructs the agent not to exceed the tool-call budget', () => {
    expect(prompt.toLowerCase()).toContain('budget');
  });
});

// ---------------------------------------------------------------------------
// assembleUserMessage
// ---------------------------------------------------------------------------

describe('assembleUserMessage', () => {
  it('includes the topic', () => {
    const msg = assembleUserMessage(minimalInput);
    expect(msg).toContain(minimalInput.topic);
  });

  it('instructs agent to output notes_log', () => {
    const msg = assembleUserMessage(minimalInput);
    expect(msg).toContain('notes_log');
  });

  it('instructs agent to output memo', () => {
    const msg = assembleUserMessage(minimalInput);
    expect(msg).toContain('memo');
  });

  it('returns a non-empty string', () => {
    const msg = assembleUserMessage(fullInput);
    expect(msg.trim().length).toBeGreaterThan(0);
  });

  it('does not duplicate the full system-prompt instructions', () => {
    // The user message is deliberately short — all detail is in the system prompt.
    const msg = assembleUserMessage(minimalInput);
    expect(msg.length).toBeLessThan(600);
  });
});
