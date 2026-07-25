import { readdir, stat } from 'fs/promises';
import path from 'path';
import { getPool } from './db';

const PROJECT_ROOT = path.join(process.cwd(), '..');
const INPUT_DIR = path.join(PROJECT_ROOT, 'input');

export async function listAvailableVideos(dir: string = INPUT_DIR): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return []; // la carpeta de entrada todavía no existe
  }
  return entries.filter((name) => name.toLowerCase().endsWith('.mp4')).sort();
}

export async function resolveInputVideoPath(
  filename: string,
  baseDir: string = INPUT_DIR
): Promise<string> {
  const safeName = path.basename(filename);
  if (!safeName.toLowerCase().endsWith('.mp4')) {
    throw new Error('Solo se pueden seleccionar archivos .mp4');
  }

  const filePath = path.join(baseDir, safeName);
  await stat(filePath); // lanza si el archivo no existe
  return filePath;
}

export async function selectVideoFromLibrary(
  filename: string,
  baseDir: string = INPUT_DIR
): Promise<{ videoId: string; jobId: string }> {
  const filePath = await resolveInputVideoPath(filename, baseDir);
  const safeName = path.basename(filePath);

  const pool = getPool();
  const videoResult = await pool.query(
    'insert into videos (filename, path) values ($1, $2) returning id',
    [safeName, filePath]
  );
  const videoId: string = videoResult.rows[0].id;

  const jobResult = await pool.query(
    "insert into analysis_jobs (video_id, status) values ($1, 'pending') returning id",
    [videoId]
  );
  const jobId: string = jobResult.rows[0].id;

  return { videoId, jobId };
}
