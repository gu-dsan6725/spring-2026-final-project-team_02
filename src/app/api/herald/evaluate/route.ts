/**
 * POST /api/herald/evaluate
 *
 * Runs HERALD evaluation + feedback loop on selected claims.
 * Returns results, revision states, and the human review queue.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { evaluateClaim } from '@/herald/router';
import { reviseClaimsFromHerald } from '@/herald/feedback-loop';
import { submitForHumanReview, getHumanReviewQueue, clearQueue } from '@/herald/tier4-human';
import type { NotesLogEntry } from '@/types/claims';
import type { HeraldResult } from '@/types/herald';
import { DEFAULT_AGENT_CONFIG } from '@/types/agent';

interface EvaluateRequest {
  claim_ids: string[];
  notes_log: NotesLogEntry[];
  memo_markdown: string;
  memo_id?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: EvaluateRequest;

  try {
    body = (await request.json()) as EvaluateRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { claim_ids, notes_log, memo_markdown, memo_id = 'current' } = body;

  if (!Array.isArray(claim_ids) || claim_ids.length === 0) {
    return NextResponse.json({ error: 'claim_ids must be a non-empty array' }, { status: 400 });
  }

  // Filter notes log to selected claims
  const selectedNotes = notes_log.filter((e) => claim_ids.includes(e.claim_id));

  try {
    // Phase 1: Evaluate each claim through HERALD tiers
    const heraldResults: HeraldResult[] = await Promise.all(
      selectedNotes.map((claim) => evaluateClaim(claim)),
    );

    // Phase 2: Run feedback loop on invalid claims
    const revisedOutput = await reviseClaimsFromHerald(
      {
        memo_markdown,
        notes_log: selectedNotes,
        metadata: {
          generation_timestamp: new Date().toISOString(),
          token_usage: 0,
          tool_calls_count: 0,
        },
      },
      heraldResults,
      DEFAULT_AGENT_CONFIG,
    );

    // Phase 3: Submit unresolved claims to human review queue
    clearQueue();
    for (const claimId of revisedOutput.requires_human_intervention) {
      const notesEntry = revisedOutput.notes_log.find((e) => e.claim_id === claimId);
      const heraldResult = heraldResults.find((r) => r.claim_id === claimId);
      if (notesEntry === undefined || heraldResult === undefined) continue;

      const previousTiers = [
        heraldResult.tier_details.tier_1,
        heraldResult.tier_details.tier_2,
        heraldResult.tier_details.tier_3,
      ].filter((t): t is NonNullable<typeof t> => t !== null);

      submitForHumanReview(notesEntry, previousTiers, memo_id);
    }

    return NextResponse.json({
      results: heraldResults,
      revision_states: revisedOutput.revision_states,
      requires_human_intervention: revisedOutput.requires_human_intervention,
      human_queue: getHumanReviewQueue(memo_id),
      updated_memo_markdown: revisedOutput.memo_markdown,
      updated_notes_log: revisedOutput.notes_log,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
