import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getJobSummary, getOriginalVideoPath } from './jobs';
import { getPool } from './db';

describe('getJobSummary', () => {
  let videoId: string;
  let jobId: string;

  beforeEach(async () => {
    const pool = getPool();
    const videoRow = await pool.query(
      "insert into videos (filename, path) values ('test.mp4', '/tmp/test.mp4') returning id"
    );
    videoId = videoRow.rows[0].id;
    const jobRow = await pool.query(
      "insert into analysis_jobs (video_id, status) values ($1, 'completed') returning id",
      [videoId]
    );
    jobId = jobRow.rows[0].id;

    await pool.query(
      `insert into frame_detections
         (job_id, frame_number, time_s, bbox_x1, bbox_y1, bbox_x2, bbox_y2, has_helmet, has_glove)
       values
         ($1, 0, 0.0, 0, 0, 10, 10, true, false),
         ($1, 15, 0.5, 0, 0, 10, 10, false, false),
         ($1, 15, 0.5, 20, 20, 30, 30, true, true)`,
      [jobId]
    );
  });

  afterEach(async () => {
    await getPool().query('delete from videos where id = $1', [videoId]);
  });

  it('calcula el resumen agregado correctamente', async () => {
    const summary = await getJobSummary(jobId);
    expect(summary).not.toBeNull();
    expect(summary!.status).toBe('completed');
    expect(summary!.framesAnalyzed).toBe(2);
    expect(summary!.totalPersonDetections).toBe(3);
    expect(summary!.helmetCompliancePct).toBeCloseTo((2 / 3) * 100, 1);
    expect(summary!.gloveCompliancePct).toBeCloseTo((1 / 3) * 100, 1);
  });

  it('devuelve null si el job no existe', async () => {
    const summary = await getJobSummary('00000000-0000-0000-0000-000000000000');
    expect(summary).toBeNull();
  });

  it('incluye el nombre del archivo original en el resumen', async () => {
    const summary = await getJobSummary(jobId);
    expect(summary!.videoFilename).toBe('test.mp4');
  });
});

describe('getOriginalVideoPath', () => {
  let videoId: string;
  let jobId: string;

  beforeEach(async () => {
    const pool = getPool();
    const videoRow = await pool.query(
      "insert into videos (filename, path) values ('original.mp4', '/tmp/original.mp4') returning id"
    );
    videoId = videoRow.rows[0].id;
    const jobRow = await pool.query(
      "insert into analysis_jobs (video_id, status) values ($1, 'pending') returning id",
      [videoId]
    );
    jobId = jobRow.rows[0].id;
  });

  afterEach(async () => {
    await getPool().query('delete from videos where id = $1', [videoId]);
  });

  it('devuelve la ruta del video original del job', async () => {
    const path = await getOriginalVideoPath(jobId);
    expect(path).toBe('/tmp/original.mp4');
  });

  it('devuelve null si el job no existe', async () => {
    const path = await getOriginalVideoPath('00000000-0000-0000-0000-000000000000');
    expect(path).toBeNull();
  });
});
