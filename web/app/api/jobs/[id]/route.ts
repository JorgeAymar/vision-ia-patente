import { NextRequest, NextResponse } from 'next/server';
import { getJobSummary } from '@/lib/jobs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const summary = await getJobSummary(id);

  if (!summary) {
    return NextResponse.json({ error: 'Job no encontrado' }, { status: 404 });
  }

  return NextResponse.json(summary);
}
