'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type JobSummary = {
  jobId: string;
  status: string;
  errorMessage: string | null;
  framesAnalyzed: number;
  totalPersonDetections: number;
  helmetCompliancePct: number | null;
  gloveCompliancePct: number | null;
  annotatedPath: string | null;
};

export default function JobPage() {
  const params = useParams<{ id: string }>();
  const [summary, setSummary] = useState<JobSummary | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const response = await fetch(`/api/jobs/${params.id}`);
      if (!response.ok) return;
      const data: JobSummary = await response.json();
      if (cancelled) return;
      setSummary(data);
      if (data.status === 'pending' || data.status === 'processing') {
        setTimeout(poll, 3000);
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (!summary) return <main style={{ padding: '2rem' }}>Cargando...</main>;

  return (
    <main style={{ maxWidth: 640, margin: '2rem auto', fontFamily: 'sans-serif' }}>
      <h1>Resultado del análisis</h1>
      <p>Estado: <strong>{summary.status}</strong></p>

      {summary.status === 'failed' && <p style={{ color: 'red' }}>{summary.errorMessage}</p>}

      {summary.status === 'completed' && (
        <>
          <ul>
            <li>Frames analizados: {summary.framesAnalyzed}</li>
            <li>Personas detectadas (acumulado): {summary.totalPersonDetections}</li>
            <li>Cumplimiento de casco: {summary.helmetCompliancePct?.toFixed(1)}%</li>
            <li>Cumplimiento de guantes: {summary.gloveCompliancePct?.toFixed(1)}%</li>
          </ul>
          {summary.annotatedPath && (
            <video controls width="360" src={`/api/videos/annotated/${summary.jobId}`} />
          )}
        </>
      )}
    </main>
  );
}
