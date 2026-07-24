import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { getJobSummary } from '@/lib/jobs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const summary = await getJobSummary(jobId);

  if (!summary?.annotatedPath) {
    return NextResponse.json({ error: 'Video anotado no disponible' }, { status: 404 });
  }

  const buffer = await readFile(summary.annotatedPath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'video/mp4' },
  });
}
