import { NextResponse } from 'next/server';
import path from 'path';
import { detectPlate } from '@/lib/detectPlateProcess';

const IMAGE_PATH = path.join(process.cwd(), 'public', 'automovil.png');

export async function POST() {
  try {
    const result = await detectPlate(IMAGE_PATH);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'no_se_pudo_correr_la_deteccion' }, { status: 500 });
  }
}
