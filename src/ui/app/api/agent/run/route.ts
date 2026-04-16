/**
 * POST /api/agent/run
 *
 * Runs the research agent and returns a MemoOutput.
 * Accepts a MemoInput JSON body.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { runResearchAgent } from '@/agent/research-agent';
import type { MemoInput } from '@/types/memo';
import { DEFAULT_AGENT_CONFIG } from '@/types/agent';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let input: MemoInput;

  try {
    input = (await request.json()) as MemoInput;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!input.topic || input.topic.trim().length === 0) {
    return NextResponse.json({ error: 'topic is required' }, { status: 400 });
  }

  try {
    const memo = await runResearchAgent(input, DEFAULT_AGENT_CONFIG);
    return NextResponse.json(memo);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
