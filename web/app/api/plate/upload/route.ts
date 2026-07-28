import { NextRequest, NextResponse } from 'next/server';
import { saveUploadedPlateImage } from '@/lib/plateImage';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('image');

  if (!(file instanceof File) || !file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'Falta una imagen válida' }, { status: 400 });
  }

  await saveUploadedPlateImage(file);
  return NextResponse.json({ ok: true });
}
