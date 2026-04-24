/**
 * Core research agent loop — powered by a configurable OpenAI-compatible LLM.
 *
 * Uses Groq by default, with optional fallback to OpenAI when Groq quota/rate
 * limits are exhausted. All tool handlers live in src/mcp/ and are routed
 * through the tool registry. Budget enforcement, Braintrust logging, and
 * recoverable provider fallback are built in.
 */

import Groq from 'groq-sdk';
import OpenAI from 'openai';
import { assembleSystemPrompt, assembleUserMessage } from './prompt-assembler';
import { LoopController } from './loop-controller';
import { logError, logToolCall, logWarn, startSpan } from '../observability/braintrust';
import { callTool, getToolDefinitions } from '../mcp/tool-registry';
import type { AgentConfig, ToolCallLog } from '../types/agent';
import type { NotesLogEntry } from '../types/claims';
import type { MemoInput, MemoOutput } from '../types/memo';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';

/** ms to wait after a transient 429 before retrying */
const RATE_LIMIT_WAIT_MS = 60_000;

// ---------------------------------------------------------------------------
// Groq client (lazy singleton)
// ---------------------------------------------------------------------------

let _groqClient: Groq | null = null;
let _openAiClient: OpenAI | null = null;

function getGroqClient(): Groq {
  if (_groqClient === null) {
    _groqClient = new Groq({ apiKey: process.env['GROQ_API_KEY'] });
  }
  return _groqClient;
}

function getOpenAiClient(): OpenAI {
  if (_openAiClient === null) {
    _openAiClient = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });
  }
  return _openAiClient;
}

type ResearchProvider = 'groq' | 'openai';

interface ProviderConfig {
  provider: ResearchProvider;
  model: string;
}

type ToolDefinition = ReturnType<typeof getToolDefinitions>[number];
type LlmMessage = Record<string, unknown>;

function getTrimmedEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value !== undefined && value.length > 0 ? value : undefined;
}

function resolveProviderConfig(): ProviderConfig {
  const requested = getTrimmedEnv('RESEARCH_LLM_PROVIDER')?.toLowerCase();
  const hasGroq = Boolean(process.env['GROQ_API_KEY']);
  const hasOpenAi = Boolean(process.env['OPENAI_API_KEY']);

  if (requested === 'groq') {
    if (!hasGroq) {
      throw new Error('RESEARCH_LLM_PROVIDER=groq but GROQ_API_KEY is not set.');
    }
    return {
      provider: 'groq',
      model: getTrimmedEnv('RESEARCH_GROQ_MODEL') ?? DEFAULT_GROQ_MODEL,
    };
  }

  if (requested === 'openai') {
    if (!hasOpenAi) {
      throw new Error('RESEARCH_LLM_PROVIDER=openai but OPENAI_API_KEY is not set.');
    }
    return {
      provider: 'openai',
      model: getTrimmedEnv('RESEARCH_OPENAI_MODEL') ?? DEFAULT_OPENAI_MODEL,
    };
  }

  if (hasGroq) {
    return {
      provider: 'groq',
      model: getTrimmedEnv('RESEARCH_GROQ_MODEL') ?? DEFAULT_GROQ_MODEL,
    };
  }

  if (hasOpenAi) {
    return {
      provider: 'openai',
      model: getTrimmedEnv('RESEARCH_OPENAI_MODEL') ?? DEFAULT_OPENAI_MODEL,
    };
  }

  throw new Error(
    'No research LLM credentials found. Set GROQ_API_KEY or OPENAI_API_KEY before running the pipeline.',
  );
}

function getFallbackProvider(current: ProviderConfig, error: unknown): ProviderConfig | null {
  const hasOpenAi = Boolean(process.env['OPENAI_API_KEY']);
  const hasGroq = Boolean(process.env['GROQ_API_KEY']);

  if (current.provider === 'groq' && hasOpenAi && isQuotaExhaustedError(error)) {
    return {
      provider: 'openai',
      model: getTrimmedEnv('RESEARCH_OPENAI_MODEL') ?? DEFAULT_OPENAI_MODEL,
    };
  }

  if (current.provider === 'openai' && hasGroq && isQuotaExhaustedError(error)) {
    return {
      provider: 'groq',
      model: getTrimmedEnv('RESEARCH_GROQ_MODEL') ?? DEFAULT_GROQ_MODEL,
    };
  }

  return null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isRateLimitError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes('429') || message.includes('rate limit');
}

function isQuotaExhaustedError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('tokens per day') ||
    message.includes('quota') ||
    message.includes('insufficient_quota') ||
    message.includes('rate_limit_exceeded')
  );
}

function buildProviderFailureMessage(provider: ProviderConfig, error: unknown): string {
  const baseMessage = getErrorMessage(error);

  if (provider.provider === 'groq' && isQuotaExhaustedError(error)) {
    const hasOpenAi = Boolean(process.env['OPENAI_API_KEY']);
    const fallbackHint = hasOpenAi
      ? 'OPENAI_API_KEY is set, so the agent should automatically fall back if possible.'
      : 'Set OPENAI_API_KEY to enable automatic fallback, or wait for Groq quota reset.';
    return `Groq research model ${provider.model} hit a quota limit. ${fallbackHint} Original error: ${baseMessage}`;
  }

  if (provider.provider === 'openai' && isQuotaExhaustedError(error)) {
    const hasGroq = Boolean(process.env['GROQ_API_KEY']);
    const fallbackHint = hasGroq
      ? 'GROQ_API_KEY is set, so the agent should automatically fall back if possible.'
      : 'Set GROQ_API_KEY to enable automatic fallback, or wait for OpenAI quota reset.';
    return `OpenAI research model ${provider.model} hit a quota limit. ${fallbackHint} Original error: ${baseMessage}`;
  }

  return baseMessage;
}

// ---------------------------------------------------------------------------
// Message compression — strip failed/empty tool results before final synthesis
// ---------------------------------------------------------------------------

/**
 * Replaces failed or empty tool result messages with a compact stub before the
 * final synthesis pass. This removes 404s, 429s, and zero-result responses from
 * the model's context window so it focuses on evidence, not noise.
 *
 * Successful results are passed through untouched.
 * The assistant tool_call messages that preceded each failure are also removed
 * so the conversation structure stays valid (no dangling tool_call references).
 */
function compressToolResults(messages: LlmMessage[]): LlmMessage[] {
  // First pass: identify tool_call_ids whose results were failures or empty,
  // and map each id to the tool name so we can produce a useful stub.
  const failedIds = new Map<string, string>(); // id → tool_name

  // Build a map of tool_call id → function name from assistant messages
  const idToName = new Map<string, string>();
  for (const msg of messages) {
    if (msg['role'] !== 'assistant' || !Array.isArray(msg['tool_calls'])) continue;
    for (const tc of msg['tool_calls'] as LlmMessage[]) {
      const id = typeof tc['id'] === 'string' ? tc['id'] : '';
      const fn = tc['function'] as Record<string, unknown> | undefined;
      const name = typeof fn?.['name'] === 'string' ? fn['name'] : 'unknown_tool';
      if (id.length > 0) idToName.set(id, name);
    }
  }

  for (const msg of messages) {
    if (msg['role'] !== 'tool') continue;
    const id = typeof msg['tool_call_id'] === 'string' ? msg['tool_call_id'] : '';
    const content = typeof msg['content'] === 'string' ? msg['content'] : '';
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      // unparseable — keep as-is
    }
    if (parsed === null) continue;

    const isError = typeof parsed['error'] === 'string';
    const isEmptyResults =
      Array.isArray(parsed['results']) && (parsed['results'] as unknown[]).length === 0;
    const isEmptyData = Array.isArray(parsed['data']) && (parsed['data'] as unknown[]).length === 0;

    if ((isError || isEmptyResults || isEmptyData) && id.length > 0) {
      failedIds.set(id, idToName.get(id) ?? 'unknown_tool');
    }
  }

  if (failedIds.size === 0) return messages;

  // Second pass: replace failed tool results with a short stub so the agent
  // retains signal about what it tried (and can pivot to other tools), but
  // the full error/empty payload doesn't consume context.
  const out: LlmMessage[] = [];

  for (const msg of messages) {
    if (msg['role'] === 'tool') {
      const id = typeof msg['tool_call_id'] === 'string' ? msg['tool_call_id'] : '';
      if (failedIds.has(id)) {
        const toolName = failedIds.get(id) ?? 'tool';
        out.push({
          role: 'tool',
          tool_call_id: id,
          content: JSON.stringify({
            status: 'no_results',
            tool: toolName,
            note: 'This call returned no useful data. Try a different tool or search query.',
          }),
        });
        continue;
      }
      out.push(msg);
      continue;
    }

    // Keep all assistant messages intact (including their tool_calls array) so
    // the conversation structure remains valid — we only swap the result stubs.
    out.push(msg);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Output parser
// ---------------------------------------------------------------------------

interface RawMemoSection {
  title?: unknown;
  content?: unknown;
  claim_ids?: unknown;
}

interface RawMemo {
  title?: unknown;
  sections?: unknown;
}

interface RawAgentOutput {
  memo?: RawMemo;
  notes_log?: unknown;
}

function parseAgentOutput(rawText: string): { memoMarkdown: string; notesLog: NotesLogEntry[] } {
  // Strip markdown code fences if the model wrapped the JSON
  const fenceStripped = rawText
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  // Find the outermost JSON object
  const firstBrace = fenceStripped.indexOf('{');
  const lastBrace = fenceStripped.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('Agent output does not contain a JSON object');
  }

  const jsonStr = fenceStripped.slice(firstBrace, lastBrace + 1);
  const parsed = JSON.parse(jsonStr) as RawAgentOutput;

  // Build memo markdown from the structured memo object
  const rawMemo = parsed.memo;
  let memoMarkdown = '';

  if (rawMemo !== undefined && typeof rawMemo === 'object') {
    const title = typeof rawMemo.title === 'string' ? rawMemo.title : 'Policy Memo';
    memoMarkdown += `# ${title}\n\n`;

    if (Array.isArray(rawMemo.sections)) {
      for (const section of rawMemo.sections as RawMemoSection[]) {
        if (typeof section.title === 'string') {
          memoMarkdown += `## ${section.title}\n\n`;
        }
        if (typeof section.content === 'string') {
          memoMarkdown += `${section.content}\n\n`;
        }
      }
    }
  } else {
    memoMarkdown = rawText;
  }

  // Parse notes log and normalise any hallucinated claim types
  const VALID_CLAIM_TYPES = new Set([
    'statistical',
    'causal',
    'comparative',
    'predictive',
    'normative',
    'synthesis',
  ]);
  const CLAIM_TYPE_ALIASES: Record<string, string> = {
    conditional: 'predictive',
    hypothetical: 'predictive',
    correlational: 'causal',
    descriptive: 'statistical',
    evaluative: 'normative',
    prescriptive: 'normative',
    inferential: 'synthesis',
    analytical: 'synthesis',
  };

  const rawNotesLog = parsed.notes_log;
  const notesLog: NotesLogEntry[] = Array.isArray(rawNotesLog)
    ? (rawNotesLog as NotesLogEntry[]).map((entry) => {
        const rawType = typeof entry.claim_type === 'string' ? entry.claim_type.toLowerCase() : '';
        if (!VALID_CLAIM_TYPES.has(rawType)) {
          const mapped = CLAIM_TYPE_ALIASES[rawType] ?? 'synthesis';
          logWarn('output_parser:unknown_claim_type_normalized', {
            claim_id: entry.claim_id,
            original_type: entry.claim_type,
            normalized_to: mapped,
          });
          return { ...entry, claim_type: mapped } as NotesLogEntry;
        }
        return entry;
      })
    : [];

  // Strip duplicate [C-XXX] markers — keep only the first occurrence of each claim_id.
  // The agent sometimes repeats markers across sentences; only the first use is meaningful.
  const seenClaimIds = new Set<string>();
  const dedupedMarkdown = memoMarkdown.trim().replace(/\[C-\d{3,}\]/g, (marker) => {
    if (seenClaimIds.has(marker)) return '';
    seenClaimIds.add(marker);
    return marker;
  });

  return { memoMarkdown: dedupedMarkdown, notesLog };
}

// ---------------------------------------------------------------------------
// Completeness check
// ---------------------------------------------------------------------------

interface CompletenessResult {
  orphanedClaimIds: string[];
  unreferencedLogIds: string[];
}

function checkCompleteness(memoMarkdown: string, notesLog: NotesLogEntry[]): CompletenessResult {
  const memoClaimIds = new Set<string>();
  const markerRegex = /\[C-\d{3,}\]/g;
  let match: RegExpExecArray | null;
  while ((match = markerRegex.exec(memoMarkdown)) !== null) {
    memoClaimIds.add(match[0].slice(1, -1));
  }

  const logIds = new Set(notesLog.map((e) => e.claim_id));
  const orphanedClaimIds = [...memoClaimIds].filter((id) => !logIds.has(id));
  const unreferencedLogIds = [...logIds].filter((id) => !memoClaimIds.has(id));

  return { orphanedClaimIds, unreferencedLogIds };
}

// ---------------------------------------------------------------------------
// Groq API call with rate-limit retry
// ---------------------------------------------------------------------------

interface LlmChatCompletion {
  choices: Array<{
    message: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

interface CompletionOptions {
  toolsEnabled?: boolean;
}

function buildSkippedToolResult(toolName: string, reason: string): Record<string, string> {
  return {
    error: 'Tool call skipped',
    tool: toolName,
    reason,
  };
}

async function createCompletion(
  provider: ProviderConfig,
  messages: LlmMessage[],
  tools: ToolDefinition[],
  options: CompletionOptions = {},
): Promise<LlmChatCompletion> {
  const { toolsEnabled = true } = options;
  // Use large output token limits to avoid truncating the final JSON memo.
  const maxTokens = provider.provider === 'openai' ? 16384 : 8192;

  const request: Record<string, unknown> = {
    model: provider.model,
    messages,
    max_tokens: maxTokens,
  };

  if (toolsEnabled) {
    request['tools'] = tools;
    request['tool_choice'] = 'auto';
  }

  if (provider.provider === 'groq') {
    return (await getGroqClient().chat.completions.create(
      request as unknown as Parameters<Groq['chat']['completions']['create']>[0],
    )) as LlmChatCompletion;
  }

  return (await getOpenAiClient().chat.completions.create(
    request as unknown as Parameters<OpenAI['chat']['completions']['create']>[0],
  )) as LlmChatCompletion;
}

async function callLlmWithRetryAndFallback(
  messages: LlmMessage[],
  tools: ToolDefinition[],
  options: CompletionOptions = {},
): Promise<LlmChatCompletion> {
  const primary = resolveProviderConfig();

  try {
    return await createCompletion(primary, messages, tools, options);
  } catch (error) {
    if (isToolUseFailedError(error) && options.toolsEnabled !== false) {
      logWarn('research_agent:tool_use_failed_retry_without_tools', {
        model: primary.model,
        reason: getErrorMessage(error),
      });
      return createCompletion(primary, messages, tools, { ...options, toolsEnabled: false });
    }

    if (isRateLimitError(error) && !isQuotaExhaustedError(error)) {
      logWarn(`${primary.provider}:rate_limit:waiting`, {
        model: primary.model,
        wait_ms: RATE_LIMIT_WAIT_MS,
      });
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WAIT_MS));
      return createCompletion(primary, messages, tools, options);
    }

    const fallback = getFallbackProvider(primary, error);
    if (fallback !== null) {
      logWarn('research_agent:provider_fallback', {
        from_provider: primary.provider,
        from_model: primary.model,
        to_provider: fallback.provider,
        to_model: fallback.model,
        reason: getErrorMessage(error),
      });
      return createCompletion(fallback, messages, tools, options);
    }

    throw new Error(buildProviderFailureMessage(primary, error));
  }
}

function isToolUseFailedError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes('tool_use_failed') || message.includes('failed to call a function');
}

// ---------------------------------------------------------------------------
// Main agent function
// ---------------------------------------------------------------------------

export async function runResearchAgent(input: MemoInput, config: AgentConfig): Promise<MemoOutput> {
  const agentSpan = startSpan('research_agent', { topic: input.topic });
  const controller = new LoopController(config);
  const toolCallLogs: ToolCallLog[] = [];

  const systemPrompt = assembleSystemPrompt(input);
  const userMessage = assembleUserMessage(input);

  // Groq uses OpenAI-style message format: system prompt as first message
  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const tools = getToolDefinitions();
  const maxIterations = (input.max_tool_calls ?? config.max_tool_calls) + 5;
  const calledTools = new Set<string>();

  // US-domestic priority tools that should fire before the agent wraps up
  const PRIORITY_TOOLS_US = [
    'govinfo_search',
    'fred_data',
    'govreport_search',
    'arxiv_search',
    'semantic_scholar_search',
  ];
  const PRIORITY_TOOLS_INTL = [
    'worldbank_data',
    'arxiv_search',
    'semantic_scholar_search',
    'govreport_search',
  ];

  try {
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const iterSpan = startSpan(`agent_iteration_${String(iteration)}`);

      // Inject budget-exceeded instruction when limit is hit
      if (controller.isBudgetExceeded()) {
        logWarn('budget:exceeded', { ...controller.getState() });
        messages.push({ role: 'user', content: controller.buildBudgetExceededMessage() });
      }

      const response = await callLlmWithRetryAndFallback(messages, tools);
      const choice = response.choices[0];
      // choices is always non-empty per the Groq SDK contract
      const { message, finish_reason: finishReason } = choice;

      // Approximate token tracking (Groq returns usage)
      const tokensUsed =
        (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0);
      controller.recordTokens(tokensUsed);

      iterSpan.log({ finish_reason: finishReason, tokens: tokensUsed });

      // Separate known tool calls from unknown ones (e.g. model hallucinating a notes-log entry
      // as a function call). Unknown tool calls must NOT be appended to message history —
      // Groq rejects subsequent requests that reference function names not in the tool registry.
      const knownToolNames = new Set(tools.map((t) => t.function.name));
      const rawToolCalls = message.tool_calls ?? [];
      const validToolCalls = rawToolCalls.filter((tc) => knownToolNames.has(tc.function.name));
      const unknownToolCalls = rawToolCalls.filter((tc) => !knownToolNames.has(tc.function.name));

      if (unknownToolCalls.length > 0) {
        logWarn('research_agent:unknown_tool_calls', {
          names: unknownToolCalls.map((tc) => tc.function.name),
          count: unknownToolCalls.length,
        });
      }

      // Append assistant message to history — only include validated tool_calls
      messages.push({
        role: 'assistant',
        content: message.content ?? '',
        ...(validToolCalls.length > 0 ? { tool_calls: validToolCalls } : {}),
      });

      // If the model only made unknown tool calls, treat this turn as a stop so the loop
      // doesn't stall waiting for tool results that will never arrive.
      const effectiveFinishReason =
        finishReason === 'tool_calls' && validToolCalls.length === 0 ? 'stop' : finishReason;

      if (effectiveFinishReason === 'stop') {
        // Quality gate: if the agent stops early without having used key research tools,
        // push it to continue — but only once per session.
        if (!controller.isBudgetExceeded() && !controller.hasUsedExtraRound) {
          const topicLower =
            input.topic.toLowerCase() + ' ' + (input.background ?? '').toLowerCase();
          const isUsDomestic =
            /section 8|housing voucher|federal|hud|gao|crs|fred|us |u\.s\./i.test(topicLower);
          const priorityTools = isUsDomestic ? PRIORITY_TOOLS_US : PRIORITY_TOOLS_INTL;
          const unusedPriorityTools = priorityTools.filter((t) => !calledTools.has(t));
          const toolCallsLeft = config.max_tool_calls - controller.getState().toolCallsUsed;

          if (unusedPriorityTools.length > 0 && toolCallsLeft >= 5 && calledTools.size > 0) {
            logWarn('quality_gate:early_stop_with_unused_tools', {
              called_tools: [...calledTools],
              unused_priority_tools: unusedPriorityTools,
              tool_calls_left: toolCallsLeft,
            });
            // Mark extra round used so we don't loop forever
            controller.checkQualityGate([]); // triggers extraRoundTriggered flag via side effect
            messages.push({
              role: 'user',
              content:
                `You stopped research early. You still have ${String(toolCallsLeft)} tool calls remaining ` +
                `and have NOT yet used these important research tools: ${unusedPriorityTools.join(', ')}. ` +
                `You MUST continue researching. Call each of these tools now to find additional ` +
                `statistical data, policy analysis, and evidence before writing the memo. ` +
                `Do NOT write the memo yet.`,
            });
            iterSpan.end({ outcome: 'quality_gate_continue', unused_tools: unusedPriorityTools });
            continue;
          }
        }
        iterSpan.end({ outcome: 'stop' });
        break;
      }

      if (effectiveFinishReason === 'tool_calls') {
        const toolCalls = validToolCalls;

        for (const toolCall of toolCalls) {
          const toolName = toolCall.function.name;
          let resultStr = '';

          if (controller.isBudgetExceeded()) {
            resultStr = JSON.stringify(
              buildSkippedToolResult(
                toolName,
                'Research budget exceeded before this tool call could run. Synthesize from the evidence already collected.',
              ),
            );
          } else {
            const callStart = Date.now();
            let parsedInput: Record<string, unknown> = {};

            try {
              parsedInput = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
            } catch {
              // malformed JSON — pass empty input, tool will return an error
            }

            const toolSpan = startSpan(`tool:${toolName}`, { tool_call_id: toolCall.id });
            const result = await callTool(toolName, parsedInput);
            const latencyMs = Date.now() - callStart;
            resultStr = JSON.stringify(result);

            logToolCall(toolName, parsedInput, resultStr, latencyMs);
            toolSpan.end({ latency_ms: latencyMs });
            calledTools.add(toolName);

            controller.recordToolCall(0); // tokens already tracked above

            toolCallLogs.push({
              tool_name: toolName,
              query: toolCall.function.arguments,
              raw_response: resultStr,
              extracted_claims: [],
              latency_ms: latencyMs,
              timestamp: new Date().toISOString(),
            });
          }

          // Append tool result message
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: resultStr,
          });
        }

        iterSpan.end({ outcome: 'tool_calls_sent', count: toolCalls.length });
        continue;
      }

      // length, content_filter, or unexpected — stop
      iterSpan.end({ outcome: `stop_reason:${finishReason ?? 'unknown'}` });
      break;
    }

    // Final synthesis pass: disable tool calling so the provider does not try to
    // reinterpret the memo JSON as a function call during structured output.
    const finalMessages = [
      ...compressToolResults(messages),
      {
        role: 'user',
        content:
          'Research is complete. Do not call any tools. ' +
          'Now write the full policy memo. Each section must be substantive and detailed — ' +
          'the memo prose (excluding the notes_log) must be at least 1200 words total. ' +
          'Every section (Executive Summary, Problem and Context, Options and Analysis, Recommendation, Conclusion) ' +
          'must contain multiple paragraphs with inline [C-XXX] citation markers. ' +
          'Do not summarize or abbreviate — write the complete, professional-quality memo. ' +
          'Then return a single JSON object with keys "memo" and "notes_log". Ensure the JSON is complete and valid.',
      },
    ];
    const finalResponse = await callLlmWithRetryAndFallback(finalMessages, tools, {
      toolsEnabled: false,
    });
    const finalText = finalResponse.choices[0]?.message?.content ?? '';

    const { memoMarkdown, notesLog } = parseAgentOutput(finalText);
    const { orphanedClaimIds, unreferencedLogIds } = checkCompleteness(memoMarkdown, notesLog);

    if (orphanedClaimIds.length > 0) {
      logWarn('completeness:orphaned_claims', { orphaned: orphanedClaimIds });
    }
    if (unreferencedLogIds.length > 0) {
      logWarn('completeness:unreferenced_log_entries', { unreferenced: unreferencedLogIds });
    }

    const state = controller.getState();

    agentSpan.end({
      tool_calls_used: state.toolCallsUsed,
      tokens_used: state.tokensUsed,
      notes_log_count: notesLog.length,
      orphaned_claims: orphanedClaimIds.length,
      tool_call_logs: toolCallLogs.length,
    });

    return {
      memo_markdown: memoMarkdown,
      notes_log: notesLog,
      metadata: {
        generation_timestamp: new Date().toISOString(),
        token_usage: state.tokensUsed,
        tool_calls_count: state.toolCallsUsed,
      },
    };
  } catch (error) {
    logError('research_agent:fatal', error, { topic: input.topic });
    agentSpan.end({ error: true });
    throw error;
  }
}
