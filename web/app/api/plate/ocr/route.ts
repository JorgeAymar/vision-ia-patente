import { NextRequest, NextResponse } from 'next/server';
import { requestPlateText } from '@/lib/ollamaPlateOcr';

export async function POST(request: NextRequest) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const croppedImageBase64 = body?.croppedImageBase64;

  if (typeof croppedImageBase64 !== 'string' || croppedImageBase64.length === 0) {
    return NextResponse.json({ error: 'Falta croppedImageBase64' }, { status: 400 });
  }

  try {
    const plateText = await requestPlateText(croppedImageBase64);
    return NextResponse.json({ plateText });
  } catch {
    return NextResponse.json({ error: 'no_se_pudo_leer_el_texto' }, { status: 502 });
  }
}
