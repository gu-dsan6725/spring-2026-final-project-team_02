/**
 * Core research agent loop — powered by Groq (Llama 3.3 70B).
 *
 * Uses the Groq SDK (OpenAI-compatible interface) with function calling.
 * All tool handlers live in src/mcp/ and are routed through the tool registry.
 * Budget enforcement, Braintrust logging, and rate-limit retry are built in.
 */

import Groq from 'groq-sdk';
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

const MODEL = 'llama-3.3-70b-versatile';

/** ms to wait after a 429 before retrying */
const RATE_LIMIT_WAIT_MS = 60_000;

// ---------------------------------------------------------------------------
// Groq client (lazy singleton)
// ---------------------------------------------------------------------------

let _groqClient: Groq | null = null;

function getGroqClient(): Groq {
  if (_groqClient === null) {
    _groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groqClient;
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

  const lastBrace = fenceStripped.lastIndexOf('}');
  if (lastBrace === -1) {
    throw new Error('Agent output does not contain a JSON object');
  }

  // The model often outputs a research plan JSON first, then the final memo JSON in the same
  // message. Anchor on the last {"memo" occurrence so we always pick the memo object, not the
  // research plan or any earlier embedded JSON.
  const memoAnchorMatch = /\{\s*"memo"\s*:/g;
  let memoStart = -1;
  let m: RegExpExecArray | null;
  while ((m = memoAnchorMatch.exec(fenceStripped)) !== null) {
    memoStart = m.index;
  }

  const firstBrace = memoStart !== -1 ? memoStart : fenceStripped.indexOf('{');
  if (firstBrace === -1) {
    throw new Error('Agent output does not contain a JSON object');
  }

  const jsonStr = fenceStripped.slice(firstBrace, lastBrace + 1);
  let parsed: RawAgentOutput;
  try {
    parsed = JSON.parse(jsonStr) as RawAgentOutput;
  } catch {
    throw new Error(
      'The agent stopped before producing a complete memo. ' +
        'Please try again — the model may have run out of budget before writing the final output.',
    );
  }

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

  // Parse notes log
  const rawNotesLog = parsed.notes_log;
  const notesLog: NotesLogEntry[] = Array.isArray(rawNotesLog)
    ? (rawNotesLog as NotesLogEntry[])
    : [];

  return { memoMarkdown: memoMarkdown.trim(), notesLog };
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

type GroqMessage = Groq.Chat.Completions.ChatCompletionMessageParam;

async function callGroqWithRateLimitRetry(
  messages: GroqMessage[],
  tools: ReturnType<typeof getToolDefinitions>,
  toolChoice: 'auto' | 'required' = 'auto',
): Promise<Groq.Chat.Completions.ChatCompletion> {
  const groq = getGroqClient();

  try {
    return await groq.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      tool_choice: toolChoice,
      max_tokens: 8000,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    // Groq rate limit — distinguish TPD (daily) from TPM (per-minute).
    const isRateLimit = msg.includes('429') || msg.toLowerCase().includes('rate limit');
    if (isRateLimit) {
      const isDailyLimit = msg.includes('per day') || msg.includes('TPD');
      if (isDailyLimit) {
        const retryIn = /try again in ([^\\.,"]+)/i.exec(msg)?.[1] ?? 'several hours';
        throw new Error(`Groq daily token limit exhausted. Try again in ${retryIn}.`);
      }
      // TPM (per-minute): wait 60s and retry once
      logWarn('groq:rate_limit:waiting', { wait_ms: RATE_LIMIT_WAIT_MS });
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WAIT_MS));
      return groq.chat.completions.create({
        model: MODEL,
        messages,
        tools,
        tool_choice: toolChoice,
        max_tokens: 8000,
      });
    }

    // Groq tool_use_failed (400): surface as a typed error so the main loop can inject a
    // recovery message into conversation history and retry — simple retry here causes the
    // model to write the research plan as prose and stop instead of making tool calls.
    const isToolUseFailed = msg.includes('tool_use_failed') || msg.includes('failed_generation');
    if (isToolUseFailed) {
      throw Object.assign(new Error('tool_use_failed'), { isToolUseFailed: true });
    }

    // Groq 413: request too large for TPM limit — not retryable, surface a clear message.
    if (msg.includes('413') || msg.includes('Request too large')) {
      throw new Error(
        `Groq request exceeded token limit (${msg.match(/Requested (\d+)/)?.[1] ?? '?'} tokens). ` +
          'Tool results have been truncated — if this persists, reduce max_results per tool call.',
      );
    }

    throw error;
  }
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

  // Build research plan and append to user message so the agent follows it.
  const plan = controller.buildResearchPlan(input.topic);
  const planLines = plan.planned_queries
    .map((q, i) => `${String(i + 1)}. ${q.tool} — "${q.query}" [${q.expected_claim_types.join(', ')}]`)
    .join('\n');
  const planSection =
    `\n\nResearch Plan — follow this tool sequence in order. ` +
    `If a tool returns an error, skip it and move to the next step. Do NOT retry a failed tool.\n\n` +
    planLines +
    `\n\nBudget: ${String(plan.budget.max_tool_calls)} tool calls total. ` +
    `Use max_results: 3 for all search tools to conserve token budget.\n\n` +
    `IMPORTANT: Do NOT output the research plan JSON in your final response. ` +
    `Your final response must be a single JSON object with ONLY "memo" and "notes_log" fields.`;

  // Groq uses OpenAI-style message format: system prompt as first message
  const messages: GroqMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage + planSection },
  ];

  const tools = getToolDefinitions();
  const maxIterations = (input.max_tool_calls ?? config.max_tool_calls) + 5;

  try {
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const iterSpan = startSpan(`agent_iteration_${String(iteration)}`);

      // Inject budget-exceeded instruction when limit is hit
      if (controller.isBudgetExceeded()) {
        logWarn('budget:exceeded', { ...controller.getState() });
        messages.push({ role: 'user', content: controller.buildBudgetExceededMessage() });
      }

      let response: Groq.Chat.Completions.ChatCompletion;
      try {
        // Force tool use until at least one tool call has been made — prevents the model
        // from writing its research plan as prose and stopping without doing any research.
        const toolChoice = controller.getState().toolCallsUsed === 0 ? 'required' : 'auto';
        response = await callGroqWithRateLimitRetry(messages, tools, toolChoice);
      } catch (callError) {
        const isToolUseFailed =
          callError instanceof Error &&
          (callError as Error & { isToolUseFailed?: boolean }).isToolUseFailed === true;
        if (isToolUseFailed) {
          logWarn('groq:tool_use_failed:recovery', { iteration });
          messages.push({
            role: 'user',
            content:
              'Your previous response had a tool call formatting error. ' +
              'Please continue your research plan — make a tool call now to begin researching.',
          });
          iterSpan.end({ outcome: 'tool_use_failed_recovery' });
          continue;
        }
        throw callError;
      }
      const choice = response.choices[0];
      // choices is always non-empty per the Groq SDK contract
      const { message, finish_reason: finishReason } = choice;

      // Approximate token tracking (Groq returns usage)
      const tokensUsed =
        (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0);
      controller.recordTokens(tokensUsed);

      iterSpan.log({ finish_reason: finishReason, tokens: tokensUsed });

      // Append assistant message to history
      messages.push({
        role: 'assistant',
        content: message.content ?? '',
        // tool_calls must be included if present so Groq can match tool results
        ...(message.tool_calls !== undefined && message.tool_calls.length > 0
          ? { tool_calls: message.tool_calls }
          : {}),
      });

      if (finishReason === 'stop') {
        iterSpan.end({ outcome: 'stop' });
        break;
      }

      if (finishReason === 'tool_calls') {
        const toolCalls = message.tool_calls ?? [];
        const failedToolNames: string[] = [];

        for (const toolCall of toolCalls) {
          const toolName = toolCall.function.name;
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
          const resultStr = JSON.stringify(result);

          logToolCall(toolName, parsedInput, resultStr, latencyMs);
          toolSpan.end({ latency_ms: latencyMs });

          controller.recordToolCall(0); // tokens already tracked above

          if ('error' in result) {
            failedToolNames.push(toolName);
          }

          toolCallLogs.push({
            tool_name: toolName,
            query: toolCall.function.arguments,
            raw_response: resultStr,
            extracted_claims: [],
            latency_ms: latencyMs,
            timestamp: new Date().toISOString(),
          });

          // Truncate tool results to ~2000 chars to stay within Groq's TPM limits.
          const truncated =
            resultStr.length > 2000 ? resultStr.slice(0, 2000) + '… [truncated]' : resultStr;

          // Append tool result message
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: truncated,
          });

          if (controller.isBudgetExceeded()) {
            break;
          }
        }

        // Nudge the model past any tools that errored — prevents it from retrying the same call.
        if (failedToolNames.length > 0) {
          messages.push({
            role: 'user',
            content:
              `${failedToolNames.join(', ')} returned an error. ` +
              `Do not retry ${failedToolNames.length === 1 ? 'it' : 'them'} — ` +
              `proceed to the next tool in your research plan.`,
          });
        }

        iterSpan.end({ outcome: 'tool_calls_sent', count: toolCalls.length });
        continue;
      }

      // length, content_filter, or unexpected — stop
      iterSpan.end({ outcome: `stop_reason:${finishReason}` });
      break;
    }

    // Extract final assistant text
    let finalText = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.length > 0) {
        finalText = msg.content;
        break;
      }
    }

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
