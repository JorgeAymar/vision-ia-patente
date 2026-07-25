import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { resolveInputVideoPath } from '@/lib/videoLibrary';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  try {
    const filePath = await resolveInputVideoPath(decodeURIComponent(filename));
    const buffer = await readFile(filePath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: { 'Content-Type': 'video/mp4' },
    });
  } catch {
    return NextResponse.json({ error: 'Video no encontrado' }, { status: 404 });
  }
}
