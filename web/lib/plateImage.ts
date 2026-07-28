import { writeFile } from 'fs/promises';
import path from 'path';

const IMAGE_PATH = path.join(process.cwd(), 'public', 'automovil.png');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPngBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= PNG_SIGNATURE.length &&
    buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  );
}

export async function saveUploadedPlateImage(file: File): Promise<void> {
  const buffer = Buffer.from(await file.arrayBuffer());

  if (!isPngBuffer(buffer)) {
    throw new Error('El archivo no es un PNG válido');
  }

  await writeFile(IMAGE_PATH, buffer);
}
