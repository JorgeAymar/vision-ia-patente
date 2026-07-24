import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { listAvailableVideos, selectVideoFromLibrary } from './videoLibrary';
import { getPool } from './db';

describe('listAvailableVideos', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'videolib-list-'));
    await writeFile(path.join(dir, 'a.mp4'), '');
    await writeFile(path.join(dir, 'B.MP4'), '');
    await writeFile(path.join(dir, 'notes.txt'), '');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lista solo archivos .mp4, sin distinguir mayúsculas, ordenados', async () => {
    const result = await listAvailableVideos(dir);
    expect(result).toEqual(['B.MP4', 'a.mp4']);
  });
});

describe('selectVideoFromLibrary', () => {
  let dir: string;
  let createdVideoId: string | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'videolib-select-'));
    await writeFile(path.join(dir, 'sample.mp4'), 'fake bytes');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  afterEach(async () => {
    if (createdVideoId) {
      await getPool().query('delete from videos where id = $1', [createdVideoId]);
      createdVideoId = undefined;
    }
  });

  it('crea una fila de video apuntando al archivo y un job pendiente', async () => {
    const { videoId, jobId } = await selectVideoFromLibrary('sample.mp4', dir);
    createdVideoId = videoId;

    const videoRow = await getPool().query('select filename, path from videos where id = $1', [videoId]);
    expect(videoRow.rows[0].filename).toBe('sample.mp4');
    expect(videoRow.rows[0].path).toBe(path.join(dir, 'sample.mp4'));

    const jobRow = await getPool().query(
      'select status, video_id from analysis_jobs where id = $1',
      [jobId]
    );
    expect(jobRow.rows[0].status).toBe('pending');
    expect(jobRow.rows[0].video_id).toBe(videoId);
  });

  it('rechaza un archivo que no termina en .mp4', async () => {
    await expect(selectVideoFromLibrary('evil.txt', dir)).rejects.toThrow();
  });

  it('ignora intentos de path traversal usando solo el basename', async () => {
    await expect(selectVideoFromLibrary('../../etc/passwd.mp4', dir)).rejects.toThrow();
  });
});
