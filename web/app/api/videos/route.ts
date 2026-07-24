import { NextRequest, NextResponse } from 'next/server';
import { saveVideoAndCreateJob } from '@/lib/videos';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('video');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Falta el archivo de video' }, { status: 400 });
  }

  const { jobId } = await saveVideoAndCreateJob(file);
  return NextResponse.json({ jobId }, { status: 201 });
}
