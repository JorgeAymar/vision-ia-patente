import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getJobSummary, getOriginalVideoPath, getLatestJobId } from './jobs';
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

  it('el veredicto es true si el EPP se detectó en AL MENOS UNA detección', async () => {
    const summary = await getJobSummary(jobId);
    // fixture: 2/3 con casco, 1/3 con guantes -> ambos se detectaron alguna vez
    expect(summary!.framesWithHelmet).toBe(2);
    expect(summary!.framesWithGlove).toBe(1);
    expect(summary!.helmetDetectedAtLeastOnce).toBe(true);
    expect(summary!.gloveDetectedAtLeastOnce).toBe(true);
  });
});

describe('getJobSummary — veredicto "nunca detectado"', () => {
  let videoId: string;
  let jobId: string;

  beforeEach(async () => {
    const pool = getPool();
    const videoRow = await pool.query(
      "insert into videos (filename, path) values ('never.mp4', '/tmp/never.mp4') returning id"
    );
    videoId = videoRow.rows[0].id;
    const jobRow = await pool.query(
      "insert into analysis_jobs (video_id, status) values ($1, 'completed') returning id",
      [videoId]
    );
    jobId = jobRow.rows[0].id;

    // casco presente en las 2 detecciones, guantes en ninguna
    await pool.query(
      `insert into frame_detections
         (job_id, frame_number, time_s, bbox_x1, bbox_y1, bbox_x2, bbox_y2, has_helmet, has_glove)
       values
         ($1, 0, 0.0, 0, 0, 10, 10, true, false),
         ($1, 15, 0.5, 0, 0, 10, 10, true, false)`,
      [jobId]
    );
  });

  afterEach(async () => {
    await getPool().query('delete from videos where id = $1', [videoId]);
  });

  it('marca el veredicto como false solo para el EPP que nunca se detectó', async () => {
    const summary = await getJobSummary(jobId);
    expect(summary!.helmetDetectedAtLeastOnce).toBe(true);
    expect(summary!.gloveDetectedAtLeastOnce).toBe(false);
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

describe('getLatestJobId', () => {
  let videoId: string;
  let jobId: string;

  beforeEach(async () => {
    const pool = getPool();
    const videoRow = await pool.query(
      "insert into videos (filename, path) values ('latest.mp4', '/tmp/latest.mp4') returning id"
    );
    videoId = videoRow.rows[0].id;
    // created_at en el futuro para garantizar que es "el más reciente" sin
    // depender de que no haya otros jobs insertándose al mismo tiempo.
    const jobRow = await pool.query(
      "insert into analysis_jobs (video_id, status, created_at) values ($1, 'completed', now() + interval '1 hour') returning id",
      [videoId]
    );
    jobId = jobRow.rows[0].id;
  });

  afterEach(async () => {
    await getPool().query('delete from videos where id = $1', [videoId]);
  });

  it('devuelve el id del job más reciente', async () => {
    const latestId = await getLatestJobId();
    expect(latestId).toBe(jobId);
  });
});
