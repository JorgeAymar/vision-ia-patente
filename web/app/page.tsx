'use client';

import { useState } from 'react';

type DetectResult =
  | { bbox: [number, number, number, number]; confidence: number; croppedImageBase64: string }
  | { error: string };

type OcrResult = { plateText: string } | { error: string };

const IMAGE_SRC = '/automovil.png';

export default function PatentePage() {
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState<DetectResult | null>(null);
  const [reading, setReading] = useState(false);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);

  const crop =
    detectResult && !('error' in detectResult) ? detectResult : null;

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
          disabled={detecting}
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={IMAGE_SRC} alt="Auto" style={{ maxHeight: 420, display: 'block' }} />
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
