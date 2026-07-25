'use client';

import { useEffect, useState } from 'react';

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

export default function Home() {
  const [videos, setVideos] = useState<string[] | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [summary, setSummary] = useState<JobSummary | null>(null);

  useEffect(() => {
    fetch('/api/videos/library')
      .then((res) => res.json())
      .then((data) => setVideos(data.videos))
      .catch(() => setError('No se pudo leer la lista de videos'));
  }, []);

  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;

    async function poll() {
      const response = await fetch(`/api/jobs/${activeJobId}`);
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
  }, [activeJobId]);

  async function handleSelect(filename: string) {
    setError(null);
    setSelecting(filename);
    setSummary(null);
    try {
      const response = await fetch('/api/videos/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      if (!response.ok) throw new Error('Error al seleccionar el video');
      const { jobId } = await response.json();
      setActiveJobId(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setSelecting(null);
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: '2rem auto', fontFamily: 'sans-serif', padding: '0 1rem' }}>
      <h1>Detección de EPP en video</h1>
      <p>Elige un video de la carpeta <code>input/</code> para detectar personas, cascos y guantes.</p>

      {videos === null && !error && <p>Cargando lista de videos...</p>}
      {videos !== null && videos.length === 0 && (
        <p>No hay archivos .mp4 en la carpeta <code>input/</code>.</p>
      )}

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {videos?.map((filename) => (
          <li
            key={filename}
            style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}
          >
            <span>{filename}</span>
            <button onClick={() => handleSelect(filename)} disabled={selecting !== null}>
              {selecting === filename ? 'Analizando...' : 'Analizar'}
            </button>
          </li>
        ))}
      </ul>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {summary && (
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginTop: '2rem' }}>
          <section style={{ flex: 1, minWidth: 320 }}>
            <h2>Video original</h2>
            <video controls width="100%" src={`/api/videos/original/${summary.jobId}`} />
          </section>

          <section style={{ flex: 1, minWidth: 320 }}>
            <h2>Resultado del análisis</h2>
            <p>
              Estado: <strong>{summary.status}</strong>
            </p>

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
                  <video controls width="100%" src={`/api/videos/annotated/${summary.jobId}`} />
                )}
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
