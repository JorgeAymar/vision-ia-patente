import { NextResponse } from 'next/server';
import { getLatestJobId } from '@/lib/jobs';

export async function GET() {
  const jobId = await getLatestJobId();
  return NextResponse.json({ jobId });
}
