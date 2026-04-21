import { type NextRequest, NextResponse } from 'next/server';
import { getRunProgress } from '@/agent/progress-store';

export function GET(request: NextRequest): NextResponse {
  const runId = request.nextUrl.searchParams.get('run_id') ?? '';

  if (runId.length === 0) {
    return NextResponse.json({ error: 'run_id is required' }, { status: 400 });
  }

  const snapshot = getRunProgress(runId);
  if (snapshot === null) {
    return NextResponse.json({ error: 'run not found' }, { status: 404 });
  }

  return NextResponse.json(snapshot);
}
