import { getPool } from './db';

export type JobSummary = {
  jobId: string;
  status: string;
  errorMessage: string | null;
  framesAnalyzed: number;
  totalPersonDetections: number;
  helmetCompliancePct: number | null;
  gloveCompliancePct: number | null;
  annotatedPath: string | null;
};

export async function getJobSummary(jobId: string): Promise<JobSummary | null> {
  const pool = getPool();

  const jobResult = await pool.query(
    `select aj.status, aj.error_message, v.annotated_path
     from analysis_jobs aj
     join videos v on v.id = aj.video_id
     where aj.id = $1`,
    [jobId]
  );
  if (jobResult.rows.length === 0) return null;
  const { status, error_message, annotated_path } = jobResult.rows[0];

  const statsResult = await pool.query(
    `select
       count(distinct frame_number)::int as frames_analyzed,
       count(*)::int as total_person_detections,
       count(*) filter (where has_helmet)::int as with_helmet,
       count(*) filter (where has_glove)::int as with_glove
     from frame_detections
     where job_id = $1`,
    [jobId]
  );
  const { frames_analyzed, total_person_detections, with_helmet, with_glove } = statsResult.rows[0];

  return {
    jobId,
    status,
    errorMessage: error_message,
    annotatedPath: annotated_path,
    framesAnalyzed: frames_analyzed,
    totalPersonDetections: total_person_detections,
    helmetCompliancePct:
      total_person_detections > 0 ? (with_helmet / total_person_detections) * 100 : null,
    gloveCompliancePct:
      total_person_detections > 0 ? (with_glove / total_person_detections) * 100 : null,
  };
}
