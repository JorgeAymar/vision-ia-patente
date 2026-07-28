'use client';

import { useRef, useState } from 'react';
import styles from './page.module.css';

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

  const readDone = ocrResult && !('error' in ocrResult);

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.eyebrow}>
          <span className={styles.eyebrowDot} />
          Sistema de visión · ANPR
        </div>
        <h1 className={styles.title}>Reconocimiento de Patente</h1>
        <p className={styles.subtitle}>
          Detecta la zona de la patente en <code>automovil.png</code> y lee su texto, en dos
          pasos independientes.
        </p>

        <div className={styles.controls}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleUpload}
            className={styles.hiddenInput}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={styles.btnGhost}
          >
            {uploading ? 'Cargando…' : 'Cargar imagen'}
          </button>

          <div className={styles.divider} />

          <button
            onClick={handleDetect}
            disabled={detecting || reading}
            className={crop ? styles.btnPrimaryActive : styles.btnPrimary}
          >
            {detecting ? 'Reconociendo…' : 'Reconocer patente'}
          </button>

          <button
            onClick={handleRead}
            disabled={!crop || reading}
            className={readDone ? styles.btnPrimaryActive : styles.btnPrimary}
          >
            {reading ? 'Leyendo…' : 'Leer texto'}
          </button>
        </div>
        {uploadError && <p className={styles.errorText}>{uploadError}</p>}

        <div className={styles.panels}>
          <section className={styles.panel} style={{ animationDelay: '0.16s' }}>
            <div className={styles.panelHeader}>
              <span className={styles.panelLabel}>
                <span className={styles.panelIndex}>01</span> Entrada
              </span>
            </div>
            <div className={styles.frame}>
              <span className={`${styles.corner} ${styles.cornerTL}`} />
              <span className={`${styles.corner} ${styles.cornerTR}`} />
              <span className={`${styles.corner} ${styles.cornerBL}`} />
              <span className={`${styles.corner} ${styles.cornerBR}`} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${IMAGE_SRC}?v=${imageVersion}`}
                alt="Auto"
                className={styles.frameImage}
              />
            </div>
          </section>

          <section className={styles.panel} style={{ animationDelay: '0.22s' }}>
            <div className={styles.panelHeader}>
              <span className={styles.panelLabel}>
                <span className={styles.panelIndex}>02</span> Recorte
              </span>
              {crop && (
                <span className={styles.panelMeta}>
                  conf. {(crop.confidence * 100).toFixed(1)}%
                </span>
              )}
            </div>
            <div className={styles.frame}>
              <span className={`${styles.corner} ${styles.cornerTL}`} />
              <span className={`${styles.corner} ${styles.cornerTR}`} />
              <span className={`${styles.corner} ${styles.cornerBL}`} />
              <span className={`${styles.corner} ${styles.cornerBR}`} />
              {detecting && (
                <div className={styles.scanOverlay}>
                  <div className={styles.scanLine} />
                </div>
              )}
              {!detectResult && !detecting && (
                <p className={styles.placeholder}>
                  Apretá <kbd>Reconocer patente</kbd> para generar el recorte.
                </p>
              )}
              {detectResult && 'error' in detectResult && (
                <p className={styles.errorState}>
                  No se detectó una patente ({detectResult.error}).
                </p>
              )}
              {crop && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`data:image/png;base64,${crop.croppedImageBase64}`}
                  alt="Zona de la patente recortada"
                  className={styles.frameImage}
                />
              )}
            </div>
          </section>

          <section className={styles.panel} style={{ animationDelay: '0.28s' }}>
            <div className={styles.panelHeader}>
              <span className={styles.panelLabel}>
                <span className={styles.panelIndex}>03</span> Lectura
              </span>
            </div>
            <div className={styles.frame}>
              <span className={`${styles.corner} ${styles.cornerTL}`} />
              <span className={`${styles.corner} ${styles.cornerTR}`} />
              <span className={`${styles.corner} ${styles.cornerBL}`} />
              <span className={`${styles.corner} ${styles.cornerBR}`} />
              {reading && (
                <div className={styles.scanOverlay}>
                  <div className={styles.scanLine} />
                </div>
              )}
              {!ocrResult && !reading && <p className={styles.placeholder}>—</p>}
              {ocrResult && 'plateText' in ocrResult && (
                <p className={styles.plateReadout}>{ocrResult.plateText}</p>
              )}
              {ocrResult && 'error' in ocrResult && (
                <p className={styles.errorState}>{ocrResult.error}</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
