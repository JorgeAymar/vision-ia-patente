# Reconocimiento de Patente Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `/patente` page in the existing Next.js app that recognizes a car's license plate from a fixed test photo in two independently-triggered steps: crop the plate zone with YOLOE, then read its text with Ollama's `gemma4:31b-cloud` vision model.

**Architecture:** Two pure-logic Python helpers feed a one-shot CLI script (`worker/detect_plate.py`) that Next.js invokes as a subprocess per click (no job queue, no persistent worker — this is stateless and processes one image at a time). Two Next.js API routes (`/api/plate/detect`, `/api/plate/ocr`) wrap that subprocess and a direct HTTP call to the local Ollama daemon, respectively. The page has two buttons — "Reconocer patente" and "Leer texto" — mirroring the 3 visible parts (original photo / cropped zone / extracted text) from the spec.

**Tech Stack:** Next.js 16 (App Router, TypeScript), Vitest, Python 3 (`worker/.venv`), Ultralytics YOLOE (`yoloe-11s-seg.pt`), OpenCV, pytest, Ollama HTTP API.

**Spec:** `docs/superpowers/specs/2026-07-27-reconocimiento-patente-design.md`

---

### Task 1: Pure geometry helpers (Python)

**Files:**
- Create: `worker/plate_geometry.py`
- Test: `worker/tests/test_plate_geometry.py`

- [ ] **Step 1: Write the failing tests**

```python
# worker/tests/test_plate_geometry.py
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from plate_geometry import select_best_detection, expand_bbox_with_margin


def test_select_best_detection_returns_none_when_no_boxes():
    assert select_best_detection([], []) is None


def test_select_best_detection_returns_highest_confidence_box():
    boxes = [(0, 0, 10, 10), (20, 20, 40, 40)]
    confidences = [0.3, 0.8]
    bbox, confidence = select_best_detection(boxes, confidences)
    assert bbox == (20, 20, 40, 40)
    assert confidence == 0.8


def test_expand_bbox_with_margin_adds_15_percent_each_side():
    bbox = (100, 100, 200, 140)  # ancho 100, alto 40
    result = expand_bbox_with_margin(bbox, image_width=1000, image_height=1000, margin_pct=0.15)
    assert result == (85.0, 94.0, 215.0, 146.0)


def test_expand_bbox_with_margin_clamps_to_image_bounds():
    bbox = (0, 0, 20, 20)
    result = expand_bbox_with_margin(bbox, image_width=1000, image_height=1000, margin_pct=0.5)
    assert result == (0, 0, 30.0, 30.0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && .venv/bin/python -m pytest tests/test_plate_geometry.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'plate_geometry'`

- [ ] **Step 3: Write the implementation**

```python
# worker/plate_geometry.py
"""Heurística pura para elegir la mejor detección de patente y calcular su recorte
con margen. No depende de YOLO ni de I/O — testeable sin correr el modelo real."""


def select_best_detection(boxes, confidences):
    """Devuelve (bbox, confidence) de la detección con mayor confianza, o None si
    no hay ninguna detección."""
    if not boxes:
        return None
    best_index = confidences.index(max(confidences))
    return boxes[best_index], confidences[best_index]


def expand_bbox_with_margin(bbox, image_width, image_height, margin_pct):
    """Expande un bbox (x1, y1, x2, y2) un margin_pct de su ancho/alto en cada lado,
    recortado a los límites de la imagen."""
    x1, y1, x2, y2 = bbox
    margin_x = (x2 - x1) * margin_pct
    margin_y = (y2 - y1) * margin_pct
    return (
        max(0, x1 - margin_x),
        max(0, y1 - margin_y),
        min(image_width, x2 + margin_x),
        min(image_height, y2 + margin_y),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && .venv/bin/python -m pytest tests/test_plate_geometry.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add worker/plate_geometry.py worker/tests/test_plate_geometry.py
git commit -m "feat(worker): add pure bbox selection/margin helpers for plate detection"
```

---

### Task 2: `detect_plate.py` CLI script

**Files:**
- Create: `worker/detect_plate.py`

This script has no unit tests of its own (it needs the real YOLOE model and a real
image — that's what Task 1's pure helpers already cover in isolation). It's verified with
a manual smoke-test run against `automovil.png` in Step 2.

- [ ] **Step 1: Write the script**

```python
# worker/detect_plate.py
import base64
import contextlib
import json
import sys

import cv2
from ultralytics import YOLOE

from plate_geometry import expand_bbox_with_margin, select_best_detection

CLASSES = ["license plate"]
CONF_THRESHOLD = 0.12
MARGIN_PCT = 0.15


def get_model():
    model = YOLOE("yoloe-11s-seg.pt")
    model.set_classes(CLASSES, model.get_text_pe(CLASSES))
    return model


def detect_plate(image_path):
    image = cv2.imread(image_path)
    if image is None:
        return {"error": "no_se_pudo_leer_la_imagen"}

    # ultralytics escribe su banner/progreso a stdout. Next.js parsea el stdout
    # de este script como JSON puro, así que redirigimos ese ruido a stderr
    # mientras carga el modelo y corre la inferencia.
    with contextlib.redirect_stdout(sys.stderr):
        model = get_model()
        results = model.predict(image, conf=CONF_THRESHOLD, verbose=False)[0]

    boxes = results.boxes.xyxy.tolist()
    confidences = results.boxes.conf.tolist()

    best = select_best_detection(boxes, confidences)
    if best is None:
        return {"error": "no_plate_detected"}

    bbox, confidence = best
    height, width = image.shape[:2]
    x1, y1, x2, y2 = expand_bbox_with_margin(bbox, width, height, MARGIN_PCT)
    cropped = image[int(y1):int(y2), int(x1):int(x2)]

    ok, buffer = cv2.imencode(".png", cropped)
    if not ok:
        return {"error": "no_se_pudo_recortar_la_imagen"}

    cropped_base64 = base64.b64encode(buffer).decode("ascii")
    return {
        "bbox": [x1, y1, x2, y2],
        "confidence": confidence,
        "croppedImageBase64": cropped_base64,
    }


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "uso: detect_plate.py <ruta_imagen>"}))
        sys.exit(1)

    print(json.dumps(detect_plate(sys.argv[1])))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Smoke-test it manually against the real test photo**

Run: `cd worker && .venv/bin/python detect_plate.py ../input/automovil.png | python3 -c "import json,sys; d=json.load(sys.stdin); print({k:v for k,v in d.items() if k != 'croppedImageBase64'}, 'base64 len:', len(d.get('croppedImageBase64','')))"`

(Note: `automovil.png` originally lived at the repo root when this plan was written; it has
since moved to `input/automovil.png` — use that path.)

Expected: prints either `{'bbox': [...], 'confidence': <0-1 float>} base64 len: <N>` (a
plate was found) or `{'error': 'no_plate_detected'} base64 len: 0`. Either is a valid
result at this stage — this just confirms the script runs end-to-end without crashing. If
`error: no_plate_detected`, note it; Task 9's manual verification revisits threshold/model
choice with real data as the spec calls for.

- [ ] **Step 3: Commit**

```bash
git add worker/detect_plate.py
git commit -m "feat(worker): add detect_plate.py CLI for one-shot plate detection"
```

---

### Task 3: Make the test photo servable by Next.js

**Files:**
- Create: `web/public/automovil.png` (copy of `input/automovil.png` — note: this file was
  originally at the repo root when the spec was written, but has since moved to `input/`;
  use `input/automovil.png` as the source, not the repo root)

- [ ] **Step 1: Copy the file**

Run: `cp input/automovil.png web/public/automovil.png`

- [ ] **Step 2: Verify it's there**

Run: `file web/public/automovil.png`
Expected: `web/public/automovil.png: PNG image data, 584 x 790, ...` (same file as the
`input/` copy)

- [ ] **Step 3: Commit**

```bash
git add web/public/automovil.png
git commit -m "feat(web): add car test photo as a servable static asset"
```

---

### Task 4: `detectPlateProcess.ts` — subprocess wrapper

**Files:**
- Create: `web/lib/detectPlateProcess.ts`
- Test: `web/lib/detectPlateProcess.test.ts`

Only `parseDetectPlateOutput` (pure, no I/O) gets unit tests — `detectPlate` itself spawns
a real Python process and is covered by Task 9's manual verification instead.

- [ ] **Step 1: Write the failing tests**

```typescript
// web/lib/detectPlateProcess.test.ts
import { describe, it, expect } from 'vitest';
import { parseDetectPlateOutput } from './detectPlateProcess';

describe('parseDetectPlateOutput', () => {
  it('parsea una detección exitosa', () => {
    const stdout = JSON.stringify({ bbox: [1, 2, 3, 4], confidence: 0.5, croppedImageBase64: 'abc' });
    expect(parseDetectPlateOutput(stdout)).toEqual({
      bbox: [1, 2, 3, 4],
      confidence: 0.5,
      croppedImageBase64: 'abc',
    });
  });

  it('parsea un error de no_plate_detected', () => {
    const stdout = JSON.stringify({ error: 'no_plate_detected' });
    expect(parseDetectPlateOutput(stdout)).toEqual({ error: 'no_plate_detected' });
  });

  it('lanza un error si el JSON no tiene la forma esperada', () => {
    expect(() => parseDetectPlateOutput(JSON.stringify({ foo: 'bar' }))).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/detectPlateProcess.test.ts`
Expected: FAIL — `Failed to resolve import "./detectPlateProcess"`

- [ ] **Step 3: Write the implementation**

```typescript
// web/lib/detectPlateProcess.ts
import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const WORKER_DIR = path.join(process.cwd(), '..', 'worker');
const PYTHON_BIN = path.join(WORKER_DIR, '.venv', 'bin', 'python3');
const SCRIPT_PATH = path.join(WORKER_DIR, 'detect_plate.py');

export type DetectPlateSuccess = {
  bbox: [number, number, number, number];
  confidence: number;
  croppedImageBase64: string;
};

export type DetectPlateResult = DetectPlateSuccess | { error: string };

export function parseDetectPlateOutput(stdout: string): DetectPlateResult {
  const parsed = JSON.parse(stdout);

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Salida inesperada de detect_plate.py');
  }

  if ('error' in parsed) {
    return { error: String(parsed.error) };
  }

  if (
    !Array.isArray(parsed.bbox) ||
    parsed.bbox.length !== 4 ||
    typeof parsed.confidence !== 'number' ||
    typeof parsed.croppedImageBase64 !== 'string'
  ) {
    throw new Error('Salida de detect_plate.py con forma inválida');
  }

  return {
    bbox: parsed.bbox as [number, number, number, number],
    confidence: parsed.confidence,
    croppedImageBase64: parsed.croppedImageBase64,
  };
}

export async function detectPlate(imagePath: string): Promise<DetectPlateResult> {
  const { stdout } = await execFileAsync(PYTHON_BIN, [SCRIPT_PATH, imagePath], {
    cwd: WORKER_DIR,
    maxBuffer: 20 * 1024 * 1024,
  });
  return parseDetectPlateOutput(stdout);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/detectPlateProcess.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add web/lib/detectPlateProcess.ts web/lib/detectPlateProcess.test.ts
git commit -m "feat(web): add detectPlate subprocess wrapper for the Python plate detector"
```

---

### Task 5: `ollamaPlateOcr.ts` — Ollama OCR call

**Files:**
- Create: `web/lib/ollamaPlateOcr.ts`
- Test: `web/lib/ollamaPlateOcr.test.ts`

Only the pure request-builder and response-parser get unit tests — `requestPlateText`
itself does a real `fetch` to the local Ollama daemon and is covered by Task 9.

- [ ] **Step 1: Write the failing tests**

```typescript
// web/lib/ollamaPlateOcr.test.ts
import { describe, it, expect } from 'vitest';
import { buildOllamaRequestBody, extractPlateTextFromOllamaResponse } from './ollamaPlateOcr';

describe('buildOllamaRequestBody', () => {
  it('incluye la imagen, el modelo, y pide una respuesta no-streaming', () => {
    const body = buildOllamaRequestBody('BASE64DATA');
    expect(body.images).toEqual(['BASE64DATA']);
    expect(body.stream).toBe(false);
    expect(body.model).toBe('gemma4:31b-cloud');
  });
});

describe('extractPlateTextFromOllamaResponse', () => {
  it('devuelve el texto recortado del campo response', () => {
    const text = extractPlateTextFromOllamaResponse({ response: '  AB123CD  \n' });
    expect(text).toBe('AB123CD');
  });

  it('lanza un error si falta el campo response', () => {
    expect(() => extractPlateTextFromOllamaResponse({})).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/ollamaPlateOcr.test.ts`
Expected: FAIL — `Failed to resolve import "./ollamaPlateOcr"`

- [ ] **Step 3: Write the implementation**

```typescript
// web/lib/ollamaPlateOcr.ts
const OLLAMA_URL = 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = 'gemma4:31b-cloud';
const OCR_PROMPT =
  'Esta imagen es el recorte de la patente de un auto. Respondé ÚNICAMENTE con el texto/números de la patente, sin explicación ni puntuación adicional. Si no se puede leer con certeza, respondé exactamente: ILEGIBLE';

export function buildOllamaRequestBody(imageBase64: string) {
  return {
    model: OLLAMA_MODEL,
    prompt: OCR_PROMPT,
    images: [imageBase64],
    stream: false,
  };
}

export function extractPlateTextFromOllamaResponse(json: unknown): string {
  if (
    typeof json !== 'object' ||
    json === null ||
    !('response' in json) ||
    typeof (json as { response: unknown }).response !== 'string'
  ) {
    throw new Error('Respuesta de Ollama sin campo "response"');
  }
  return (json as { response: string }).response.trim();
}

export async function requestPlateText(imageBase64: string): Promise<string> {
  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildOllamaRequestBody(imageBase64)),
  });

  if (!response.ok) {
    throw new Error(`Ollama respondió con estado ${response.status}`);
  }

  return extractPlateTextFromOllamaResponse(await response.json());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/ollamaPlateOcr.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add web/lib/ollamaPlateOcr.ts web/lib/ollamaPlateOcr.test.ts
git commit -m "feat(web): add Ollama vision OCR call for reading plate text"
```

---

### Task 6: API route `/api/plate/detect`

**Files:**
- Create: `web/app/api/plate/detect/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// web/app/api/plate/detect/route.ts
import { NextResponse } from 'next/server';
import path from 'path';
import { detectPlate } from '@/lib/detectPlateProcess';

const IMAGE_PATH = path.join(process.cwd(), 'public', 'automovil.png');

export async function POST() {
  try {
    const result = await detectPlate(IMAGE_PATH);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'no_se_pudo_correr_la_deteccion' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Smoke-test with the dev server running**

Run: `curl -s -X POST http://localhost:3000/api/plate/detect | python3 -m json.tool`
(requires `npm run dev` running in `web/` — see Task 9 if it's not already up)
Expected: JSON body with either `bbox`/`confidence`/`croppedImageBase64`, or
`{"error": "no_plate_detected"}` — not a 500 or a stack trace.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/plate/detect/route.ts
git commit -m "feat(web): add POST /api/plate/detect route"
```

---

### Task 7: API route `/api/plate/ocr`

**Files:**
- Create: `web/app/api/plate/ocr/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// web/app/api/plate/ocr/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requestPlateText } from '@/lib/ollamaPlateOcr';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const croppedImageBase64 = body?.croppedImageBase64;

  if (typeof croppedImageBase64 !== 'string' || croppedImageBase64.length === 0) {
    return NextResponse.json({ error: 'Falta croppedImageBase64' }, { status: 400 });
  }

  try {
    const plateText = await requestPlateText(croppedImageBase64);
    return NextResponse.json({ plateText });
  } catch {
    return NextResponse.json({ error: 'no_se_pudo_leer_el_texto' }, { status: 502 });
  }
}
```

- [ ] **Step 2: Smoke-test with the dev server running**

Run:
```bash
curl -s -X POST http://localhost:3000/api/plate/ocr \
  -H 'Content-Type: application/json' \
  -d '{"croppedImageBase64": ""}'
```
Expected: `{"error":"Falta croppedImageBase64"}` with HTTP 400 (empty string is rejected).
The success path (a real cropped image) is covered by Task 9's full manual run.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/plate/ocr/route.ts
git commit -m "feat(web): add POST /api/plate/ocr route"
```

---

### Task 8: `/patente` page — 3 parts, 2 buttons

**Files:**
- Create: `web/app/patente/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// web/app/patente/page.tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add web/app/patente/page.tsx
git commit -m "feat(web): add /patente page with detect and OCR buttons"
```

---

### Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full web test suite and lint**

Run: `cd web && npm run lint && npm test`
Expected: lint passes with no errors, all vitest tests pass (including the pre-existing
ones — this task must not break `videos.test.ts` / `jobs.test.ts` / `videoLibrary.test.ts`).

- [ ] **Step 2: Run the full worker test suite**

Run: `cd worker && .venv/bin/python -m pytest tests/ -v`
Expected: all tests pass, including the new `test_plate_geometry.py` and the pre-existing
`test_detector.py` / `test_db.py` / `test_model_smoke.py`.

- [ ] **Step 3: Confirm the dev server is running**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/patente`
Expected: `200`. If not running, start it: `cd web && npm run dev` (background).

- [ ] **Step 4: Drive the page in a real browser**

Open `http://localhost:3000/patente`, click "Reconocer patente", wait for the crop to
appear in part 2, then click "Leer texto" and wait for part 3. Take a screenshot after each
click.

Expected: part 2 shows a cropped image that visibly contains the car's license plate; part
3 shows text that matches the plate visible in the original photo (part 1). If part 2
shows "no se detectó una patente", that's a real finding, not a plan failure — per the
spec, the next move is comparing `yoloe-11s-seg.pt` against `yoloe-26s-seg.pt` (already
downloaded in `worker/`) or a dedicated ANPR model for the `"license plate"` class, tuning
`CONF_THRESHOLD` in `worker/detect_plate.py` first since that's the cheapest change to try.

- [ ] **Step 5: Commit any fixes found during verification**

If Steps 1-4 required code changes (e.g. a confidence threshold tweak), commit them:

```bash
git add -A
git commit -m "fix: tune plate detection based on manual verification against automovil.png"
```
