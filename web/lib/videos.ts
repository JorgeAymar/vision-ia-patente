import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getPool } from './db';

const STORAGE_DIR = path.join(process.cwd(), '..', 'storage', 'videos');

export async function saveVideoAndCreateJob(
  file: File
): Promise<{ videoId: string; jobId: string }> {
  await mkdir(STORAGE_DIR, { recursive: true });

  const ext = path.extname(file.name) || '.mp4';
  const buffer = Buffer.from(await file.arrayBuffer());

  const pool = getPool();
  const videoResult = await pool.query(
    'insert into videos (filename, path) values ($1, $2) returning id',
    [file.name, 'placeholder']
  );
  const videoId: string = videoResult.rows[0].id;

  const filePath = path.join(STORAGE_DIR, `${videoId}${ext}`);
  await writeFile(filePath, buffer);
  await pool.query('update videos set path = $1 where id = $2', [filePath, videoId]);

  const jobResult = await pool.query(
    "insert into analysis_jobs (video_id, status) values ($1, 'pending') returning id",
    [videoId]
  );
  const jobId: string = jobResult.rows[0].id;

  return { videoId, jobId };
}
