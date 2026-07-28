import { writeFile } from 'fs/promises';
import path from 'path';

const IMAGE_PATH = path.join(process.cwd(), 'public', 'automovil.png');

export async function saveUploadedPlateImage(file: File): Promise<void> {
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(IMAGE_PATH, buffer);
}
