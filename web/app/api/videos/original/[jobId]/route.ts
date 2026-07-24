import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { getOriginalVideoPath } from '@/lib/jobs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const videoPath = await getOriginalVideoPath(jobId);

  if (!videoPath) {
    return NextResponse.json({ error: 'Video original no disponible' }, { status: 404 });
  }

  const buffer = await readFile(videoPath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'video/mp4' },
  });
}
