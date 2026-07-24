import { NextRequest, NextResponse } from 'next/server';
import { selectVideoFromLibrary } from '@/lib/videoLibrary';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const filename = body?.filename;

  if (typeof filename !== 'string' || filename.length === 0) {
    return NextResponse.json({ error: 'Falta el nombre del archivo' }, { status: 400 });
  }

  try {
    const { jobId } = await selectVideoFromLibrary(filename);
    return NextResponse.json({ jobId }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'No se pudo seleccionar el video' }, { status: 400 });
  }
}
