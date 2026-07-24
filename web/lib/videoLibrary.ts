import { readdir, stat } from 'fs/promises';
import path from 'path';
import { getPool } from './db';

const PROJECT_ROOT = path.join(process.cwd(), '..');

export async function listAvailableVideos(dir: string = PROJECT_ROOT): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((name) => name.toLowerCase().endsWith('.mp4')).sort();
}

export async function selectVideoFromLibrary(
  filename: string,
  baseDir: string = PROJECT_ROOT
): Promise<{ videoId: string; jobId: string }> {
  const safeName = path.basename(filename);
  if (!safeName.toLowerCase().endsWith('.mp4')) {
    throw new Error('Solo se pueden seleccionar archivos .mp4');
  }

  const filePath = path.join(baseDir, safeName);
  await stat(filePath); // lanza si el archivo no existe

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
