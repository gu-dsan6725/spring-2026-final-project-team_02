/**
 * Core research agent loop.
 *
 * Calls the Anthropic API with tool use, handles the agentic loop
 * (tool_use → execute → tool_result → repeat), enforces the research budget,
 * and parses the final structured output into a MemoOutput.
 *
 * Tool handlers for arxiv_search, worldbank_data, and read_uploaded_file are
 * mock implementations that return realistic sample data. Real MCP integration
 * is wired in Checkpoint 5.
 */

import Anthropic from '@anthropic-ai/sdk';
import { assembleSystemPrompt, assembleUserMessage } from './prompt-assembler';
import { LoopController } from './loop-controller';
import { logError, logToolCall, logWarn, startSpan } from '../observability/braintrust';
import type { AgentConfig, ToolCallLog } from '../types/agent';
import type { NotesLogEntry } from '../types/claims';
import type { MemoInput, MemoOutput } from '../types/memo';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL = 'claude-sonnet-4-6';
const TOOL_TIMEOUT_MS = 30_000;
const MAX_TOOL_RETRIES = 3;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const CUSTOM_TOOLS: Anthropic.Tool[] = [
  {
    name: 'arxiv_search',
    description:
      'Search the arXiv preprint server for academic papers relevant to a policy topic. ' +
      'Returns paper titles, abstracts, authors, and URLs.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string, e.g. "universal basic income Sub-Saharan Africa"',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (1–10). Defaults to 5.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'worldbank_data',
    description:
      'Retrieve development indicator data from the World Bank Open Data API. ' +
      'Returns time-series data points for a country and indicator.',
    input_schema: {
      type: 'object',
      properties: {
        indicator: {
          type: 'string',
          description:
            'World Bank indicator code, e.g. "SH.STA.MMRT" for maternal mortality ratio.',
        },
        country: {
          type: 'string',
          description: 'ISO 3166-1 alpha-2 or alpha-3 country code, e.g. "TCD" for Chad.',
        },
        date_range: {
          type: 'string',
          description: 'Year range in the format "YYYY:YYYY", e.g. "2015:2022".',
        },
      },
      required: ['indicator', 'country'],
    },
  },
  {
    name: 'read_uploaded_file',
    description:
      'Read the text content of a user-uploaded file (PDF, DOCX, or TXT). ' +
      'Returns the extracted plain text.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the uploaded file.',
        },
      },
      required: ['file_path'],
    },
  },
];

// ---------------------------------------------------------------------------
// Mock tool handlers
// ---------------------------------------------------------------------------

interface ArxivInput {
  query: string;
  max_results?: number;
}

interface WorldBankInput {
  indicator: string;
  country: string;
  date_range?: string;
}

interface ReadFileInput {
  file_path: string;
}

function handleArxivSearch(input: ArxivInput): string {
  const maxResults = input.max_results ?? 5;
  const papers = Array.from({ length: Math.min(maxResults, 3) }, (_, i) => ({
    title: `${input.query} — Evidence from a Randomised Controlled Trial (Paper ${String(i + 1)})`,
    authors: ['Smith, J.', 'Okonkwo, A.', 'Dlamini, S.'],
    abstract:
      `This study examines the impact of ${input.query} on household welfare outcomes in ` +
      `Sub-Saharan Africa. Using a randomised controlled trial across three countries, we find ` +
      `statistically significant improvements in food security (effect size 0.42 SD, p<0.01) ` +
      `and school enrollment (+8.2 percentage points). Cash transfer programs showed stronger ` +
      `effects than in-kind transfers across all primary outcomes.`,
    url: `https://arxiv.org/abs/2311.${String(10000 + i * 1234)}`,
    published: `202${String(3 + i)}-0${String(1 + i)}-15`,
  }));
  return JSON.stringify({ results: papers, total_found: papers.length });
}

function handleWorldBankData(input: WorldBankInput): string {
  const dateRange = input.date_range ?? '2015:2022';
  const parts = dateRange.split(':');
  const startYear = parseInt(parts[0] ?? '2015', 10);
  const endYear = parseInt(parts[1] ?? '2022', 10);

  const dataPoints = [];
  for (let year = startYear; year <= endYear; year++) {
    dataPoints.push({
      year: String(year),
      value: Math.round(500 + Math.random() * 800),
      country: input.country,
      indicator: input.indicator,
    });
  }

  return JSON.stringify({
    indicator: input.indicator,
    country: input.country,
    unit: 'per 100,000 live births',
    source: 'World Bank Open Data',
    data: dataPoints,
    url: `https://data.worldbank.org/indicator/${input.indicator}?locations=${input.country}`,
  });
}

function handleReadUploadedFile(input: ReadFileInput): string {
  // Mock: return a plausible excerpt for any path
  return JSON.stringify({
    file_path: input.file_path,
    content:
      `Policy Brief on ${input.file_path.split('/').pop() ?? 'the topic'}\n\n` +
      `This document presents evidence from longitudinal surveys conducted in 2019–2023. ` +
      `Key findings indicate that targeted social transfers reduce multidimensional poverty ` +
      `by 18–24% over five years. Conditional cash transfer programmes contingent on school ` +
      `attendance increased enrollment by 9.1 percentage points (95% CI: 6.8–11.4). ` +
      `Recommendations include scaling pilot programmes to national level by 2027, with ` +
      `estimated annual fiscal cost of 0.8% of GDP.`,
    word_count: 87,
  });
}

// ---------------------------------------------------------------------------
// Tool executor with retry and timeout
// ---------------------------------------------------------------------------

async function executeToolWithRetry(
  toolName: string,
  toolInput: unknown,
  span: ReturnType<typeof startSpan>,
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_TOOL_RETRIES; attempt++) {
    const callStart = Date.now();

    try {
      const resultPromise = ((): Promise<string> => {
        switch (toolName) {
          case 'arxiv_search':
            return Promise.resolve(handleArxivSearch(toolInput as ArxivInput));
          case 'worldbank_data':
            return Promise.resolve(handleWorldBankData(toolInput as WorldBankInput));
          case 'read_uploaded_file':
            return Promise.resolve(handleReadUploadedFile(toolInput as ReadFileInput));
          default:
            return Promise.resolve(JSON.stringify({ error: `Unknown tool: ${toolName}` }));
        }
      })();

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Tool ${toolName} timed out after ${String(TOOL_TIMEOUT_MS)}ms`));
        }, TOOL_TIMEOUT_MS);
      });

      const result = await Promise.race([resultPromise, timeoutPromise]);
      const latencyMs = Date.now() - callStart;

      logToolCall(toolName, toolInput as Record<string, unknown>, result, latencyMs);
      span.log({ tool: toolName, attempt, latency_ms: latencyMs, status: 'success' });

      return result;
    } catch (error) {
      lastError = error;
      const latencyMs = Date.now() - callStart;
      logError(`tool:${toolName}:attempt:${String(attempt)}`, error, { latency_ms: latencyMs });

      if (attempt < MAX_TOOL_RETRIES) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }

  const errorMsg = lastError instanceof Error ? lastError.message : String(lastError);
  logWarn(`tool:${toolName}:all_retries_failed`, { error: errorMsg });
  return JSON.stringify({
    error: `Tool ${toolName} failed after ${String(MAX_TOOL_RETRIES)} retries: ${errorMsg}`,
    source_unavailable: true,
  });
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

  // JSON.parse returns unknown; the cast above ensures we can index into it.
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
    // Fallback: treat the entire text as markdown
    memoMarkdown = rawText;
  }

  // Parse notes log
  const rawNotesLog = parsed.notes_log;
  let notesLog: NotesLogEntry[] = [];

  if (Array.isArray(rawNotesLog)) {
    notesLog = rawNotesLog as NotesLogEntry[];
  }

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
  // Extract all [C-XXX] markers from the memo
  const memoClaimIds = new Set<string>();
  const markerRegex = /\[C-\d{3,}\]/g;
  let match: RegExpExecArray | null;
  while ((match = markerRegex.exec(memoMarkdown)) !== null) {
    // Strip brackets: [C-001] → C-001
    memoClaimIds.add(match[0].slice(1, -1));
  }

  const logIds = new Set(notesLog.map((e) => e.claim_id));

  // Claims in memo but not in notes log
  const orphanedClaimIds = [...memoClaimIds].filter((id) => !logIds.has(id));

  // Notes log entries never referenced in the memo
  const unreferencedLogIds = [...logIds].filter((id) => !memoClaimIds.has(id));

  return { orphanedClaimIds, unreferencedLogIds };
}

// ---------------------------------------------------------------------------
// Main agent function
// ---------------------------------------------------------------------------

export async function runResearchAgent(input: MemoInput, config: AgentConfig): Promise<MemoOutput> {
  const agentSpan = startSpan('research_agent', { topic: input.topic });
  const controller = new LoopController(config);
  const toolCallLogs: ToolCallLog[] = [];

  const client = new Anthropic();

  const systemPrompt = assembleSystemPrompt(input);
  const userMessage = assembleUserMessage(input);

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];

  const allTools: Anthropic.Messages.ToolUnion[] = [
    { type: 'web_search_20250305', name: 'web_search' },
    ...CUSTOM_TOOLS,
  ];

  let iterationCount = 0;
  const MAX_ITERATIONS = config.max_tool_calls + 5; // Safety ceiling

  try {
    while (iterationCount < MAX_ITERATIONS) {
      iterationCount++;
      const iterSpan = startSpan(`agent_iteration_${String(iterationCount)}`);

      // If budget is exceeded, inject a stop instruction as a user message
      if (controller.isBudgetExceeded()) {
        const budgetState = controller.getState();
        logWarn('budget:exceeded', { ...budgetState });
        messages.push({
          role: 'user',
          content: controller.buildBudgetExceededMessage(),
        });
      }

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 8096,
        system: systemPrompt,
        tools: allTools,
        messages,
      });

      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      controller.recordTokens(inputTokens + outputTokens);

      iterSpan.log({
        stop_reason: response.stop_reason,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      });

      // Append the full assistant content to messages (preserves tool_use blocks)
      messages.push({ role: 'assistant', content: response.content });

      // Terminal: agent finished naturally
      if (response.stop_reason === 'end_turn') {
        iterSpan.end({ outcome: 'end_turn' });
        break;
      }

      // Process tool calls
      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolBlock of toolUseBlocks) {
          const toolSpan = startSpan(`tool:${toolBlock.name}`, { tool_use_id: toolBlock.id });
          const callStart = Date.now();

          const result = await executeToolWithRetry(toolBlock.name, toolBlock.input, toolSpan);
          const latencyMs = Date.now() - callStart;

          const budgetStatus = controller.recordToolCall(0); // tokens already tracked above

          toolCallLogs.push({
            tool_name: toolBlock.name,
            query: JSON.stringify(toolBlock.input),
            raw_response: result,
            extracted_claims: [],
            latency_ms: latencyMs,
            timestamp: new Date().toISOString(),
          });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: result,
          });

          toolSpan.end({ budget_status: budgetStatus, latency_ms: latencyMs });

          if (controller.isBudgetExceeded()) {
            // Add remaining tool results as errors so the API stays valid,
            // then break out of the tool processing loop
            for (const remaining of toolUseBlocks.slice(toolUseBlocks.indexOf(toolBlock) + 1)) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: remaining.id,
                content: JSON.stringify({ error: 'Skipped — research budget exceeded.' }),
                is_error: true,
              });
            }
            break;
          }
        }

        messages.push({ role: 'user', content: toolResults });
        iterSpan.end({ outcome: 'tool_results_sent', tool_count: toolResults.length });
        continue;
      }

      // Any other stop reason: break and parse what we have
      iterSpan.end({ outcome: `stop_reason:${String(response.stop_reason)}` });
      break;
    }

    // Extract the final text response
    const lastAssistantMsg = messages.findLast((m) => m.role === 'assistant');
    let finalText = '';

    if (lastAssistantMsg !== undefined) {
      const content = lastAssistantMsg.content;
      if (typeof content === 'string') {
        finalText = content;
      } else if (Array.isArray(content)) {
        finalText = content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
      }
    }

    // Parse structured output
    const { memoMarkdown, notesLog } = parseAgentOutput(finalText);

    // Completeness check
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
