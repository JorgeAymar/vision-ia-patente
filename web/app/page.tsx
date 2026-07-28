'use client';

import { useRef, useState } from 'react';

type DetectResult =
  | { bbox: [number, number, number, number]; confidence: number; croppedImageBase64: string }
  | { error: string };

type OcrResult = { plateText: string } | { error: string };

const IMAGE_SRC = '/automovil.png';

// El servidor solo acepta bytes PNG genuinos (valida la firma del archivo), así
// que cualquier foto se redibuja en un canvas y se exporta como PNG real acá
// antes de subirla — así funciona con JPEG, WebP, etc. sin que el servidor la
// rechace ni quede un archivo mal etiquetado (bytes JPEG dentro de un .png).
async function convertToPngBlob(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo preparar el canvas');
  ctx.drawImage(bitmap, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('No se pudo convertir la imagen a PNG'));
    }, 'image/png');
  });
}

export default function PatentePage() {
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState<DetectResult | null>(null);
  const [reading, setReading] = useState(false);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [imageVersion, setImageVersion] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const crop =
    detectResult && !('error' in detectResult) ? detectResult : null;

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    try {
      const pngBlob = await convertToPngBlob(file);
      const formData = new FormData();
      formData.append('image', pngBlob, 'automovil.png');
      const response = await fetch('/api/plate/upload', { method: 'POST', body: formData });
      if (response.ok) {
        setImageVersion((v) => v + 1);
        setDetectResult(null);
        setOcrResult(null);
      } else {
        const data = await response.json();
        setUploadError(data?.error ?? 'No se pudo subir la imagen');
      }
    } catch {
      setUploadError('No se pudo subir la imagen');
    } finally {
      setUploading(false);
    }
  }

  async function handleDetect() {
    setDetecting(true);
    setDetectResult(null);
    setOcrResult(null);
    try {
      const response = await fetch('/api/plate/detect', { method: 'POST' });
      const data: DetectResult = await response.json();
      setDetectResult(data);
    } catch {
      setDetectResult({ error: 'No se pudo detectar la patente' });
    } finally {
      setDetecting(false);
    }
  }

  async function handleRead() {
    if (!crop) return;
    setReading(true);
    setOcrResult(null);
    try {
      const response = await fetch('/api/plate/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ croppedImageBase64: crop.croppedImageBase64 }),
      });
      const data: OcrResult = await response.json();
      setOcrResult(data);
    } catch {
      setOcrResult({ error: 'No se pudo leer el texto' });
    } finally {
      setReading(false);
    }
  }

  return (
    <main style={{ maxWidth: 1300, margin: '2rem auto', fontFamily: 'sans-serif', padding: '0 1rem' }}>
      <h1>Reconocimiento de patente</h1>
      <p>
        Detecta la zona de la patente en <code>automovil.png</code> y lee su texto, en dos
        pasos independientes.
      </p>

      <div style={{ display: 'flex', gap: '1rem', margin: '1.5rem 0' }}>
        <button
          onClick={handleDetect}
          disabled={detecting || reading}
          style={{
            fontSize: '1.1rem',
            padding: '0.9rem 1.6rem',
            fontWeight: 'bold',
            backgroundColor: crop ? '#22c55e' : undefined,
            color: crop ? 'white' : undefined,
            border: crop ? 'none' : undefined,
          }}
        >
          {detecting ? 'Reconociendo...' : 'Reconocer patente'}
        </button>

        <button
          onClick={handleRead}
          disabled={!crop || reading}
          style={{
            fontSize: '1.1rem',
            padding: '0.9rem 1.6rem',
            fontWeight: 'bold',
            backgroundColor: ocrResult && !('error' in ocrResult) ? '#22c55e' : undefined,
            color: ocrResult && !('error' in ocrResult) ? 'white' : undefined,
            border: ocrResult && !('error' in ocrResult) ? 'none' : undefined,
          }}
        >
          {reading ? 'Leyendo...' : 'Leer texto'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
        <section>
          <h2 style={{ marginBottom: '0.75rem' }}>1. Foto original</h2>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleUpload}
            style={{ display: 'none' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{ padding: '0.5rem 1rem', marginBottom: '0.75rem' }}
          >
            {uploading ? 'Cargando...' : 'Cargar imagen'}
          </button>
          {uploadError && <p style={{ color: 'red', margin: '0 0 0.75rem' }}>{uploadError}</p>}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${IMAGE_SRC}?v=${imageVersion}`}
            alt="Auto"
            style={{ maxHeight: 420, display: 'block' }}
          />
        </section>

        <section>
          <h2 style={{ marginBottom: '0.75rem' }}>2. Zona recortada</h2>
          {!detectResult && <p>Apretá &quot;Reconocer patente&quot; para generar el recorte.</p>}
          {detectResult && 'error' in detectResult && (
            <p style={{ color: 'red' }}>No se detectó una patente ({detectResult.error}).</p>
          )}
          {crop && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={`data:image/png;base64,${crop.croppedImageBase64}`}
              alt="Zona de la patente recortada"
              style={{ maxHeight: 420, display: 'block' }}
            />
          )}
        </section>

        <section>
          <h2 style={{ marginBottom: '0.75rem' }}>3. Texto extraído</h2>
          {!ocrResult && <p>—</p>}
          {ocrResult && 'plateText' in ocrResult && (
            <p style={{ fontFamily: 'monospace', fontSize: '1.5rem', fontWeight: 'bold' }}>
              {ocrResult.plateText}
            </p>
          )}
          {ocrResult && 'error' in ocrResult && (
            <p style={{ color: 'red' }}>{ocrResult.error}</p>
          )}
        </section>
      </div>
    </main>
  );
}
