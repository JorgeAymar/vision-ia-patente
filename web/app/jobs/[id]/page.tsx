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
  videoFilename: string;
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
    <main style={{ maxWidth: 1100, margin: '2rem auto', fontFamily: 'sans-serif', padding: '0 1rem' }}>
      <h1>{summary.videoFilename}</h1>

      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
        <section style={{ flex: 1, minWidth: 320 }}>
          <h2>Video original</h2>
          <video
            controls
            width="100%"
            src={`/api/videos/original/${summary.jobId}`}
          />
        </section>

        <section style={{ flex: 1, minWidth: 320 }}>
          <h2>Resultado del análisis</h2>
          <p>Estado: <strong>{summary.status}</strong></p>

          {summary.status === 'failed' && <p style={{ color: 'red' }}>{summary.errorMessage}</p>}

          {(summary.status === 'pending' || summary.status === 'processing') && (
            <p>Procesando video, esto puede tardar unos minutos...</p>
          )}

          {summary.status === 'completed' && (
            <>
              <ul>
                <li>Frames analizados: {summary.framesAnalyzed}</li>
                <li>Personas detectadas (acumulado): {summary.totalPersonDetections}</li>
                <li>Cumplimiento de casco: {summary.helmetCompliancePct?.toFixed(1)}%</li>
                <li>Cumplimiento de guantes: {summary.gloveCompliancePct?.toFixed(1)}%</li>
              </ul>
              {summary.annotatedPath && (
                <video
                  controls
                  width="100%"
                  src={`/api/videos/annotated/${summary.jobId}`}
                />
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
