'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [videos, setVideos] = useState<string[] | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/videos/library')
      .then((res) => res.json())
      .then((data) => setVideos(data.videos))
      .catch(() => setError('No se pudo leer la lista de videos'));
  }, []);

  async function handleSelect(filename: string) {
    setError(null);
    setSelecting(filename);
    try {
      const response = await fetch('/api/videos/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      if (!response.ok) throw new Error('Error al seleccionar el video');
      const { jobId } = await response.json();
      router.push(`/jobs/${jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
      setSelecting(null);
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: '4rem auto', fontFamily: 'sans-serif' }}>
      <h1>Detección de EPP en video</h1>
      <p>Elige un video de la carpeta del proyecto para detectar personas, cascos y guantes.</p>

      {videos === null && !error && <p>Cargando lista de videos...</p>}
      {videos !== null && videos.length === 0 && (
        <p>No hay archivos .mp4 en la carpeta del proyecto.</p>
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
    </main>
  );
}
