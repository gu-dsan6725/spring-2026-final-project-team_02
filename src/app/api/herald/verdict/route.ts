/**
 * POST /api/herald/verdict
 *
 * Submits a human verdict for a pending Tier 4 review entry.
 * Returns the updated entry and the resolved HeraldResult.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { submitHumanVerdict, getHumanReviewQueue } from '@/herald/tier4-human';
import type { HumanVerdictSubmission } from '@/herald/tier4-human';
import type { Verdict } from '@/types/herald';

interface VerdictRequest {
  claim_id: string;
  verdict: Verdict;
  notes: string;
  suggested_revision?: string;
  memo_id?: string;
}

const VALID_VERDICTS: Verdict[] = ['valid', 'invalid', 'uncertain'];

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: VerdictRequest;

  try {
    body = (await request.json()) as VerdictRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { claim_id, verdict, notes, suggested_revision, memo_id = 'current' } = body;

  if (typeof claim_id !== 'string' || claim_id.trim().length === 0) {
    return NextResponse.json({ error: 'claim_id is required' }, { status: 400 });
  }

  if (!VALID_VERDICTS.includes(verdict)) {
    return NextResponse.json(
      { error: `verdict must be one of: ${VALID_VERDICTS.join(', ')}` },
      { status: 400 },
    );
  }

  if (typeof notes !== 'string' || notes.trim().length === 0) {
    return NextResponse.json({ error: 'notes is required' }, { status: 400 });
  }

  try {
    const submission: HumanVerdictSubmission = {
      verdict,
      notes,
      ...(suggested_revision !== undefined && { suggested_revision }),
    };

    const result = submitHumanVerdict(claim_id, submission, memo_id);

    return NextResponse.json({
      entry: result.entry,
      resolved_herald_result: result.resolved_herald_result,
      updated_queue: getHumanReviewQueue(memo_id),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Not found errors are 404, not 500
    if (message.includes('No pending review entry found')) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
