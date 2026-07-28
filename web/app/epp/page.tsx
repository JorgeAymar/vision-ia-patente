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
  framesWithHelmet: number;
  framesWithGlove: number;
  helmetDetectedAtLeastOnce: boolean;
  gloveDetectedAtLeastOnce: boolean;
  annotatedPath: string | null;
  videoFilename: string;
};

const videoStyle: React.CSSProperties = {
  maxHeight: 480,
  width: 'auto',
  maxWidth: '100%',
  display: 'block',
  flexShrink: 0,
};

export default function Home() {
  const [videos, setVideos] = useState<string[] | null>(null);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [summary, setSummary] = useState<JobSummary | null>(null);

  useEffect(() => {
    fetch('/api/videos/library')
      .then((res) => res.json())
      .then((data) => {
        setVideos(data.videos);
        if (data.videos?.length > 0) setSelectedFilename(data.videos[0]);
      })
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

  async function handleAnalyze() {
    if (!selectedFilename) return;
    setError(null);
    setAnalyzing(true);
    setSummary(null);
    try {
      const response = await fetch('/api/videos/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: selectedFilename }),
      });
      if (!response.ok) throw new Error('Error al seleccionar el video');
      const { jobId } = await response.json();
      setActiveJobId(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <main style={{ maxWidth: 1300, margin: '2rem auto', fontFamily: 'sans-serif', padding: '0 1rem' }}>
      <h1>Detección de EPP en video</h1>
      <p>Elige un video de la carpeta <code>input/</code> para detectar personas, cascos y guantes.</p>

      {videos === null && !error && <p>Cargando lista de videos...</p>}
      {videos !== null && videos.length === 0 && (
        <p>No hay archivos .mp4 en la carpeta <code>input/</code>.</p>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: '1rem 0 0' }}>
        {videos?.map((filename) => (
          <li key={filename} style={{ padding: '6px 0' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input
                type="radio"
                name="video"
                checked={selectedFilename === filename}
                onChange={() => setSelectedFilename(filename)}
              />
              {filename}
            </label>
          </li>
        ))}
      </ul>

      {error && <p style={{ color: 'red', marginTop: '1rem' }}>{error}</p>}

      <div
        style={{
          display: 'flex',
          gap: '2rem',
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'flex-start',
          marginTop: '2.5rem',
        }}
      >
        <section style={{ flex: '0 1 auto' }}>
          <h2 style={{ marginBottom: '0.75rem' }}>Video original</h2>
          {selectedFilename && (
            <video
              controls
              style={videoStyle}
              src={`/api/videos/input/${encodeURIComponent(selectedFilename)}`}
            />
          )}
        </section>

        <div style={{ display: 'flex', alignItems: 'center', alignSelf: 'center' }}>
          <button
            onClick={handleAnalyze}
            disabled={!selectedFilename || analyzing}
            style={{
              fontSize: '1.3rem',
              padding: '1rem 2rem',
              fontWeight: 'bold',
              backgroundColor: activeJobId ? '#22c55e' : undefined,
              color: activeJobId ? 'white' : undefined,
              border: activeJobId ? 'none' : undefined,
            }}
          >
            {analyzing ? 'Analizando...' : 'Analizar'}
          </button>
        </div>

        <section style={{ flex: '0 1 auto' }}>
          <h2 style={{ marginBottom: '0.75rem' }}>Resultado del análisis</h2>

          {summary && summary.status !== 'completed' && (
            <>
              <p style={{ margin: '0 0 0.5rem' }}>
                Estado: <strong>{summary.status}</strong>
              </p>
              {summary.status === 'failed' && (
                <p style={{ color: 'red', margin: 0 }}>{summary.errorMessage}</p>
              )}
              {(summary.status === 'pending' || summary.status === 'processing') && (
                <p style={{ margin: 0 }}>Procesando video, esto puede tardar unos minutos...</p>
              )}
            </>
          )}

          {summary && summary.status === 'completed' && (
            <div style={{ display: 'flex', gap: '1.5rem' }}>
              {summary.annotatedPath && (
                <video controls style={videoStyle} src={`/api/videos/annotated/${summary.jobId}`} />
              )}
              <ul style={{ margin: 0, flex: '0 1 320px', minWidth: 0, lineHeight: 1.6 }}>
                <li>
                  Estado: <strong>{summary.status}</strong>
                </li>
                <li>Frames analizados: {summary.framesAnalyzed}</li>
                <li>Personas detectadas (acumulado): {summary.totalPersonDetections}</li>
                <li>Cumplimiento de casco: {summary.helmetCompliancePct?.toFixed(1)}%</li>
                <li>Cumplimiento de guantes: {summary.gloveCompliancePct?.toFixed(1)}%</li>
                <li>
                  {summary.helmetDetectedAtLeastOnce ? '✅' : '❌'} Casco:{' '}
                  {summary.helmetDetectedAtLeastOnce ? 'SÍ' : 'NO'} detectado (
                  {summary.framesWithHelmet}/{summary.totalPersonDetections})
                </li>
                <li>
                  {summary.gloveDetectedAtLeastOnce ? '✅' : '❌'} Guantes:{' '}
                  {summary.gloveDetectedAtLeastOnce ? 'SÍ' : 'NO'} detectado (
                  {summary.framesWithGlove}/{summary.totalPersonDetections})
                </li>
              </ul>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
