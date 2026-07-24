import { describe, it, expect, afterEach } from 'vitest';
import { saveVideoAndCreateJob } from './videos';
import { getPool } from './db';

describe('saveVideoAndCreateJob', () => {
  let createdVideoId: string | undefined;

  afterEach(async () => {
    if (createdVideoId) {
      await getPool().query('delete from videos where id = $1', [createdVideoId]);
    }
  });

  it('guarda el video y crea un job en estado pending', async () => {
    const file = new File([Buffer.from('fake video bytes')], 'test.mp4', { type: 'video/mp4' });
    const { videoId, jobId } = await saveVideoAndCreateJob(file);
    createdVideoId = videoId;

    const videoRow = await getPool().query('select filename from videos where id = $1', [videoId]);
    expect(videoRow.rows[0].filename).toBe('test.mp4');

    const jobRow = await getPool().query(
      'select status, video_id from analysis_jobs where id = $1',
      [jobId]
    );
    expect(jobRow.rows[0].status).toBe('pending');
    expect(jobRow.rows[0].video_id).toBe(videoId);
  });
});
