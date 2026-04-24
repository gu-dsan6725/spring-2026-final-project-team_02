import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });

const tool: Anthropic.Tool = {
  name: 'submit_verdict',
  description: 'Submit verdict',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['valid', 'invalid'] },
      confidence: { type: 'number' },
      reasoning: { type: 'string' },
    },
    required: ['verdict', 'confidence', 'reasoning'],
  },
};

async function main() {
  const res = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 256,
    temperature: 0.2,
    system: 'You are a claim verifier.',
    tools: [tool],
    tool_choice: { type: 'tool', name: 'submit_verdict' },
    messages: [{ role: 'user', content: 'Claim: "SNAP serves 42 million Americans." Source: "The program serves approximately 42 million people." Call submit_verdict.' }],
  });
  const tu = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  console.log('Verdict:', JSON.stringify(tu?.input));
  console.log('Tokens:', res.usage);
}
main().catch(e => { console.error(e); process.exit(1); });
