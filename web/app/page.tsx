'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const fileInput = form.elements.namedItem('video') as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) {
      setError('Selecciona un video primero.');
      return;
    }

    const formData = new FormData();
    formData.append('video', file);

    setUploading(true);
    try {
      const response = await fetch('/api/videos', { method: 'POST', body: formData });
      if (!response.ok) throw new Error('Error al subir el video');
      const { jobId } = await response.json();
      router.push(`/jobs/${jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setUploading(false);
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: '4rem auto', fontFamily: 'sans-serif' }}>
      <h1>Detección de EPP en video</h1>
      <p>Sube un video para detectar personas, cascos y guantes.</p>
      <form onSubmit={handleSubmit}>
        <input type="file" name="video" accept="video/mp4" required />
        <button type="submit" disabled={uploading} style={{ marginLeft: 8 }}>
          {uploading ? 'Subiendo...' : 'Analizar'}
        </button>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </main>
  );
}
