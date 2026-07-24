# App de detección de EPP en video — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la ejecución manual de `ppe_detection.py` por una app web (Next.js + Postgres + worker Python con YOLOE) donde el usuario sube un video, la app lo analiza en segundo plano detectando personas/cascos/guantes, y muestra el resultado en un dashboard.

**Architecture:** Dos procesos (Next.js para UI/API, worker Python para detección) coordinados por una tabla de jobs en Postgres (sin broker de mensajería). El worker hace polling de jobs pendientes, corre YOLOE zero-shot sobre el video, y escribe los resultados clasificados por persona directamente en Postgres.

**Tech Stack:** Next.js 15 (App Router, TypeScript) · `pg` (node-postgres) · Vitest · Python 3.12 · `ultralytics` (YOLOE) · `psycopg2` · `pytest` · Postgres 16 en Docker.

**Desviación menor respecto al spec aprobado:** el spec original (`docs/superpowers/specs/2026-07-24-video-ppe-detection-app-design.md`) proponía una tabla `frame_detections` con una fila por cada detección cruda (persona/casco/guante) más un `person_group_id` para correlacionarlas. Al bajar esto a código, esa correlación ya la resuelve `classify_persons()` en Python antes de tocar la base — así que la tabla queda como **una fila por persona detectada por frame**, con `has_helmet`/`has_glove` como booleanos ya calculados. Mismo comportamiento observable, consulta de agregados mucho más simple (sin auto-joins). También se agrega `annotated_path` a `videos` para poder reproducir el video con las cajas dibujadas en el dashboard (esto estaba en el objetivo del spec pero no en el modelo de datos original).

---

## Task 1: Scaffolding del proyecto

**Files:**
- Create: `docker-compose.yml`
- Create: `db/schema.sql`
- Create: `worker/requirements.txt`
- Create: `.gitignore`
- Create: `web/` (via `create-next-app`)

- [ ] **Step 1: Crear `.gitignore`**

```gitignore
# Node / Next.js
web/node_modules/
web/.next/
web/.env.local

# Python
worker/__pycache__/
worker/.pytest_cache/
worker/.env
*.pyc

# Datos y modelos (no versionar binarios pesados)
storage/
*.pt
*.mp4
weights/
worker/mobileclip_blt.ts

# Postgres data
pgdata/
```

- [ ] **Step 2: Crear `db/schema.sql`**

```sql
create table videos (
    id uuid primary key default gen_random_uuid(),
    filename text not null,
    path text not null,
    annotated_path text,
    uploaded_at timestamptz not null default now(),
    duration_s real,
    width int,
    height int,
    fps real
);

create table analysis_jobs (
    id uuid primary key default gen_random_uuid(),
    video_id uuid not null references videos(id) on delete cascade,
    status text not null default 'pending'
        check (status in ('pending', 'processing', 'completed', 'failed')),
    created_at timestamptz not null default now(),
    started_at timestamptz,
    finished_at timestamptz,
    error_message text
);

create table frame_detections (
    id bigserial primary key,
    job_id uuid not null references analysis_jobs(id) on delete cascade,
    frame_number int not null,
    time_s real not null,
    bbox_x1 real not null,
    bbox_y1 real not null,
    bbox_x2 real not null,
    bbox_y2 real not null,
    has_helmet boolean not null,
    has_glove boolean not null
);

create index idx_frame_detections_job_id on frame_detections(job_id);
create index idx_analysis_jobs_status on analysis_jobs(status);
```

- [ ] **Step 3: Crear `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: vision
      POSTGRES_PASSWORD: vision
      POSTGRES_DB: vision_ia_security
    ports:
      - "5441:5432"  # 5432 ya está ocupado por otros contenedores locales de este Mac
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/schema.sql:/docker-entrypoint-initdb.d/schema.sql

volumes:
  pgdata:
```

- [ ] **Step 4: Levantar Postgres y verificar que el schema se aplicó**

Run: `docker compose up -d && sleep 3 && docker compose exec postgres psql -U vision -d vision_ia_security -c "\dt"`
Expected: lista con `videos`, `analysis_jobs`, `frame_detections`

- [ ] **Step 5: Crear `worker/requirements.txt`**

```
ultralytics
opencv-python
psycopg2-binary
pytest
```

- [ ] **Step 6: Crear entorno virtual e instalar dependencias del worker**

Run:
```bash
cd worker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```
Expected: instalación sin errores (ultralytics/torch/opencv ya están en caché de pip del sistema, debería ser rápido)

- [ ] **Step 7: Scaffolding de Next.js**

Run:
```bash
npx create-next-app@latest web --typescript --app --no-tailwind --eslint=false --src-dir=false --import-alias "@/*" --use-npm
cd web && npm install pg && npm install -D vitest @types/pg
```
Expected: carpeta `web/` con `package.json`, `app/`, etc.

- [ ] **Step 8: Configurar variables de entorno**

Crear `worker/.env`:
```
DATABASE_URL=postgresql://vision:vision@localhost:5441/vision_ia_security
```

Crear `web/.env.local`:
```
DATABASE_URL=postgresql://vision:vision@localhost:5441/vision_ia_security
```

- [ ] **Step 9: Commit**

```bash
git add docker-compose.yml db/schema.sql worker/requirements.txt .gitignore web/package.json web/package-lock.json web/tsconfig.json web/app web/next.config.ts web/next-env.d.ts
git commit -m "chore: scaffold Next.js app, Postgres schema, and worker skeleton"
```

---

## Task 2: Heurística de clasificación persona↔EPP (worker, TDD)

**Files:**
- Create: `worker/detector.py`
- Test: `worker/tests/test_detector.py`

- [ ] **Step 1: Escribir los tests (fallarán porque `detector.py` no existe)**

`worker/tests/test_detector.py`:
```python
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from detector import box_center_inside, head_region, classify_persons


def test_box_center_inside_true_when_center_within_outer():
    inner = (10, 10, 20, 20)  # centro (15, 15)
    outer = (0, 0, 30, 30)
    assert box_center_inside(inner, outer) is True


def test_box_center_inside_false_when_center_outside():
    inner = (100, 100, 120, 120)
    outer = (0, 0, 30, 30)
    assert box_center_inside(inner, outer) is False


def test_head_region_is_top_35_percent_of_person_box():
    person = (0, 0, 100, 200)  # altura 200
    assert head_region(person) == (0, 0, 100, 70.0)


def test_classify_persons_detects_helmet_in_head_region():
    persons = [(0, 0, 100, 200)]
    helmets = [(10, 5, 90, 40)]  # centro (50, 22.5) -> dentro de cabeza (0,0,100,70)
    gloves = []
    result = classify_persons(persons, helmets, gloves)
    assert result == [{"bbox": (0, 0, 100, 200), "has_helmet": True, "has_glove": False}]


def test_classify_persons_ignores_helmet_outside_head_region():
    persons = [(0, 0, 100, 200)]
    helmets = [(10, 150, 90, 190)]  # centro (50, 170) -> fuera de cabeza
    gloves = []
    result = classify_persons(persons, helmets, gloves)
    assert result == [{"bbox": (0, 0, 100, 200), "has_helmet": False, "has_glove": False}]


def test_classify_persons_detects_glove_anywhere_in_person_box():
    persons = [(0, 0, 100, 200)]
    helmets = []
    gloves = [(40, 160, 60, 190)]  # centro (50, 175) -> dentro de la persona
    result = classify_persons(persons, helmets, gloves)
    assert result == [{"bbox": (0, 0, 100, 200), "has_helmet": False, "has_glove": True}]


def test_classify_persons_handles_multiple_people_independently():
    persons = [(0, 0, 100, 200), (200, 0, 300, 200)]
    helmets = [(10, 5, 90, 40)]       # solo cae en la primera persona
    gloves = [(240, 160, 260, 190)]   # solo cae en la segunda persona
    result = classify_persons(persons, helmets, gloves)
    assert result[0] == {"bbox": (0, 0, 100, 200), "has_helmet": True, "has_glove": False}
    assert result[1] == {"bbox": (200, 0, 300, 200), "has_helmet": False, "has_glove": True}
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `cd worker && source .venv/bin/activate && pytest tests/test_detector.py -v`
Expected: `ModuleNotFoundError: No module named 'detector'`

- [ ] **Step 3: Implementar `worker/detector.py`**

```python
"""Heurística pura para asociar cascos/guantes detectados con cada persona en un frame.

No depende de YOLO ni de I/O — recibe listas de bounding boxes (x1, y1, x2, y2)
y devuelve la clasificación por persona. Esto es lo que hace testeable la lógica
sin necesitar correr el modelo real en cada test.
"""


def box_center_inside(inner_box, outer_box):
    x1, y1, x2, y2 = inner_box
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    ox1, oy1, ox2, oy2 = outer_box
    return ox1 <= cx <= ox2 and oy1 <= cy <= oy2


def head_region(person_box):
    """Región de cabeza = 35% superior del bounding box de la persona."""
    x1, y1, x2, y2 = person_box
    h = y2 - y1
    return (x1, y1, x2, y1 + h * 0.35)


def classify_persons(persons, helmets, gloves):
    """Para cada persona, determina si tiene casco (en zona de cabeza) y/o
    guantes (en cualquier parte de su bounding box)."""
    results = []
    for p_box in persons:
        hr = head_region(p_box)
        has_helmet = any(box_center_inside(h_box, hr) for h_box in helmets)
        has_glove = any(box_center_inside(g_box, p_box) for g_box in gloves)
        results.append({
            "bbox": p_box,
            "has_helmet": has_helmet,
            "has_glove": has_glove,
        })
    return results
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `pytest tests/test_detector.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add worker/detector.py worker/tests/test_detector.py
git commit -m "feat(worker): add person/helmet/glove classification heuristic with tests"
```

---

## Task 3: Capa de acceso a datos del worker (TDD, integración contra Postgres local)

**Files:**
- Create: `worker/db.py`
- Test: `worker/tests/test_db.py`

- [ ] **Step 1: Escribir los tests de integración**

`worker/tests/test_db.py`:
```python
import os
import sys
import uuid
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("DATABASE_URL", "postgresql://vision:vision@localhost:5441/vision_ia_security")

import db


@pytest.fixture
def conn():
    connection = db.get_connection()
    yield connection
    connection.close()


@pytest.fixture
def sample_video_and_job(conn):
    video_id = str(uuid.uuid4())
    with conn.cursor() as cur:
        cur.execute(
            "insert into videos (id, filename, path) values (%s, %s, %s)",
            (video_id, "test.mp4", "/tmp/test.mp4"),
        )
        cur.execute(
            "insert into analysis_jobs (video_id, status) values (%s, 'pending') returning id",
            (video_id,),
        )
        job_id = cur.fetchone()[0]
    conn.commit()
    yield str(job_id)
    with conn.cursor() as cur:
        cur.execute("delete from videos where id = %s", (video_id,))  # cascada borra job + detections
    conn.commit()


def test_get_pending_job_returns_the_pending_job(conn, sample_video_and_job):
    job_id = sample_video_and_job
    result = db.get_pending_job(conn)
    assert str(result["job_id"]) == job_id


def test_mark_job_processing_updates_status(conn, sample_video_and_job):
    job_id = sample_video_and_job
    db.mark_job_processing(conn, job_id)
    with conn.cursor() as cur:
        cur.execute("select status, started_at from analysis_jobs where id = %s", (job_id,))
        status, started_at = cur.fetchone()
    assert status == "processing"
    assert started_at is not None


def test_mark_job_completed_updates_status(conn, sample_video_and_job):
    job_id = sample_video_and_job
    db.mark_job_completed(conn, job_id)
    with conn.cursor() as cur:
        cur.execute("select status, finished_at from analysis_jobs where id = %s", (job_id,))
        status, finished_at = cur.fetchone()
    assert status == "completed"
    assert finished_at is not None


def test_mark_job_failed_stores_error_message(conn, sample_video_and_job):
    job_id = sample_video_and_job
    db.mark_job_failed(conn, job_id, "boom")
    with conn.cursor() as cur:
        cur.execute("select status, error_message from analysis_jobs where id = %s", (job_id,))
        status, error_message = cur.fetchone()
    assert status == "failed"
    assert error_message == "boom"


def test_insert_frame_person_stores_bbox_and_flags(conn, sample_video_and_job):
    job_id = sample_video_and_job
    db.insert_frame_person(
        conn, job_id, frame_number=15, time_s=0.5,
        bbox=(1.0, 2.0, 3.0, 4.0), has_helmet=True, has_glove=False,
    )
    with conn.cursor() as cur:
        cur.execute(
            "select bbox_x1, bbox_y2, has_helmet, has_glove from frame_detections where job_id = %s",
            (job_id,),
        )
        bbox_x1, bbox_y2, has_helmet, has_glove = cur.fetchone()
    assert bbox_x1 == pytest.approx(1.0)
    assert bbox_y2 == pytest.approx(4.0)
    assert has_helmet is True
    assert has_glove is False
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `pytest tests/test_db.py -v`
Expected: `ModuleNotFoundError: No module named 'db'`

- [ ] **Step 3: Implementar `worker/db.py`**

```python
import os
import psycopg2
import psycopg2.extras


def get_connection():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def get_pending_job(conn):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "select aj.id as job_id, v.path as video_path "
            "from analysis_jobs aj join videos v on v.id = aj.video_id "
            "where aj.status = 'pending' order by aj.created_at asc limit 1"
        )
        return cur.fetchone()


def mark_job_processing(conn, job_id):
    with conn.cursor() as cur:
        cur.execute(
            "update analysis_jobs set status = 'processing', started_at = now() where id = %s",
            (job_id,),
        )
    conn.commit()


def mark_job_completed(conn, job_id, annotated_path=None):
    with conn.cursor() as cur:
        cur.execute(
            "update analysis_jobs set status = 'completed', finished_at = now() where id = %s",
            (job_id,),
        )
        if annotated_path:
            cur.execute(
                "update videos set annotated_path = %s "
                "where id = (select video_id from analysis_jobs where id = %s)",
                (annotated_path, job_id),
            )
    conn.commit()


def mark_job_failed(conn, job_id, error_message):
    with conn.cursor() as cur:
        cur.execute(
            "update analysis_jobs set status = 'failed', finished_at = now(), error_message = %s "
            "where id = %s",
            (error_message, job_id),
        )
    conn.commit()


def insert_frame_person(conn, job_id, frame_number, time_s, bbox, has_helmet, has_glove):
    x1, y1, x2, y2 = bbox
    with conn.cursor() as cur:
        cur.execute(
            "insert into frame_detections "
            "(job_id, frame_number, time_s, bbox_x1, bbox_y1, bbox_x2, bbox_y2, has_helmet, has_glove) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (job_id, frame_number, time_s, x1, y1, x2, y2, has_helmet, has_glove),
        )
    conn.commit()
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Requisito: `docker compose up -d` debe estar corriendo (Task 1).

Run: `pytest tests/test_db.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add worker/db.py worker/tests/test_db.py
git commit -m "feat(worker): add Postgres data access layer with integration tests"
```

---

## Task 4: Wrapper de YOLOE + loop de polling del worker

**Files:**
- Create: `worker/model.py`
- Create: `worker/worker.py`
- Test: `worker/tests/test_model_smoke.py`

- [ ] **Step 1: Implementar `worker/model.py`**

API de YOLOE verificada manualmente antes de escribir este plan (`YOLOE(model)`, `set_classes(classes, embeddings)`, `get_text_pe(texts)`):

```python
import cv2
from ultralytics import YOLOE

CLASSES = ["person", "safety helmet", "safety gloves"]
CLASS_MAP = {
    "person": "person",
    "safety helmet": "helmet",
    "safety gloves": "glove",
}
CONF_THRESHOLD = 0.12
SAMPLE_EVERY_N_FRAMES = 15  # ~2 fps a 30fps de origen

_model = None


def get_model():
    global _model
    if _model is None:
        _model = YOLOE("yoloe-11s-seg.pt")
        _model.set_classes(CLASSES, _model.get_text_pe(CLASSES))
    return _model


def detect_sampled_frames(video_path, sample_every=SAMPLE_EVERY_N_FRAMES):
    """Recorre el video, corre YOLOE cada `sample_every` frames, y devuelve
    una lista de dicts: {frame_number, time_s, persons, helmets, gloves}
    donde persons/helmets/gloves son listas de bboxes (x1, y1, x2, y2)."""
    model = get_model()
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"No se pudo abrir el video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    frame_idx = 0
    out = []

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % sample_every == 0:
            results = model.predict(frame, conf=CONF_THRESHOLD, verbose=False)[0]
            persons, helmets, gloves = [], [], []
            for box, cls_id, conf in zip(
                results.boxes.xyxy.tolist(),
                results.boxes.cls.tolist(),
                results.boxes.conf.tolist(),
            ):
                raw_name = results.names[int(cls_id)]
                mapped = CLASS_MAP.get(raw_name)
                if mapped == "person":
                    persons.append(tuple(box))
                elif mapped == "helmet":
                    helmets.append(tuple(box))
                elif mapped == "glove":
                    gloves.append(tuple(box))

            out.append({
                "frame_number": frame_idx,
                "time_s": frame_idx / fps,
                "frame": frame,
                "persons": persons,
                "helmets": helmets,
                "gloves": gloves,
            })

        frame_idx += 1

    cap.release()
    return out
```

- [ ] **Step 2: Smoke test — confirmar que el modelo carga y corre sobre un frame sintético**

`worker/tests/test_model_smoke.py`:
```python
import os
import sys
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from model import get_model, CLASSES


def test_model_loads_and_predicts_without_error():
    model = get_model()
    frame = (np.random.rand(480, 640, 3) * 255).astype("uint8")
    results = model.predict(frame, conf=0.1, verbose=False)[0]
    assert set(results.names.values()) == set(CLASSES)
```

Run: `pytest tests/test_model_smoke.py -v -s`
Expected: 1 passed (la primera vez tarda por la descarga de pesos ~600MB; corridas siguientes son rápidas porque quedan cacheados)

- [ ] **Step 3: Implementar `worker/worker.py` (loop principal)**

```python
import os
import time
import traceback

import cv2

import db
import model as model_module
from detector import classify_persons

POLL_INTERVAL_SECONDS = 5
# Absoluto y basado en la ubicación de este archivo, no en el cwd del proceso que lo lanza
# (evita que la ruta se rompa si algún día se invoca el worker desde otro directorio).
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage", "annotated")


def process_job(conn, job):
    job_id = job["job_id"]
    video_path = job["video_path"]

    db.mark_job_processing(conn, job_id)

    os.makedirs(STORAGE_DIR, exist_ok=True)
    annotated_path = os.path.join(STORAGE_DIR, f"{job_id}.mp4")

    sampled = model_module.detect_sampled_frames(video_path)

    writer = None
    for entry in sampled:
        frame = entry["frame"]
        people = classify_persons(entry["persons"], entry["helmets"], entry["gloves"])

        if writer is None:
            h, w = frame.shape[:2]
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(annotated_path, fourcc, 2, (w, h))

        for person in people:
            x1, y1, x2, y2 = map(int, person["bbox"])
            color = (0, 200, 0) if person["has_helmet"] else (0, 0, 255)
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            db.insert_frame_person(
                conn, job_id,
                frame_number=entry["frame_number"],
                time_s=entry["time_s"],
                bbox=person["bbox"],
                has_helmet=person["has_helmet"],
                has_glove=person["has_glove"],
            )

        writer.write(frame)

    if writer is not None:
        writer.release()

    db.mark_job_completed(conn, job_id, annotated_path=annotated_path)
    print(f"[worker] job {job_id} completado ({len(sampled)} frames analizados)")


def main():
    conn = db.get_connection()
    print("[worker] esperando jobs...")
    while True:
        job = db.get_pending_job(conn)
        if job is None:
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        try:
            process_job(conn, job)
        except Exception as exc:
            traceback.print_exc()
            db.mark_job_failed(conn, job["job_id"], str(exc))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Commit**

```bash
git add worker/model.py worker/worker.py worker/tests/test_model_smoke.py
git commit -m "feat(worker): add YOLOE detection wrapper and polling worker loop"
```

---

## Task 5: Cliente Postgres + subida de video (Next.js, TDD)

**Files:**
- Create: `web/lib/db.ts`
- Create: `web/lib/videos.ts`
- Create: `web/app/api/videos/route.ts`
- Test: `web/lib/videos.test.ts`

- [ ] **Step 1: Implementar `web/lib/db.ts`**

```typescript
import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}
```

- [ ] **Step 2: Escribir el test de `saveVideoAndCreateJob` (fallará, no existe todavía)**

`web/lib/videos.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { saveVideoAndCreateJob } from './videos';
import { getPool } from './db';

describe('saveVideoAndCreateJob', () => {
  let createdVideoId: string | undefined;

  afterEach(async () => {
    if (createdVideoId) {
      await getPool().query('delete from videos where id = $1', [createdVideoId]);
    }
  });

  it('guarda el video y crea un job en estado pending', async () => {
    const file = new File([Buffer.from('fake video bytes')], 'test.mp4', { type: 'video/mp4' });
    const { videoId, jobId } = await saveVideoAndCreateJob(file);
    createdVideoId = videoId;

    const videoRow = await getPool().query('select filename from videos where id = $1', [videoId]);
    expect(videoRow.rows[0].filename).toBe('test.mp4');

    const jobRow = await getPool().query(
      'select status, video_id from analysis_jobs where id = $1',
      [jobId]
    );
    expect(jobRow.rows[0].status).toBe('pending');
    expect(jobRow.rows[0].video_id).toBe(videoId);
  });
});
```

- [ ] **Step 3: Correr el test y confirmar que falla**

Run: `cd web && npx vitest run lib/videos.test.ts`
Expected: error de import, `videos.ts` no existe

- [ ] **Step 4: Implementar `web/lib/videos.ts`**

```typescript
import { randomUUID } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getPool } from './db';

const STORAGE_DIR = path.join(process.cwd(), '..', 'storage', 'videos');

export async function saveVideoAndCreateJob(
  file: File
): Promise<{ videoId: string; jobId: string }> {
  await mkdir(STORAGE_DIR, { recursive: true });

  const ext = path.extname(file.name) || '.mp4';
  const buffer = Buffer.from(await file.arrayBuffer());

  const pool = getPool();
  const videoResult = await pool.query(
    'insert into videos (filename, path) values ($1, $2) returning id',
    [file.name, 'placeholder']
  );
  const videoId: string = videoResult.rows[0].id;

  const filePath = path.join(STORAGE_DIR, `${videoId}${ext}`);
  await writeFile(filePath, buffer);
  await pool.query('update videos set path = $1 where id = $2', [filePath, videoId]);

  const jobResult = await pool.query(
    "insert into analysis_jobs (video_id, status) values ($1, 'pending') returning id",
    [videoId]
  );
  const jobId: string = jobResult.rows[0].id;

  return { videoId, jobId };
}
```

- [ ] **Step 5: Correr el test y confirmar que pasa**

Requisito: `docker compose up -d` corriendo, `web/.env.local` con `DATABASE_URL`.

Run: `npx vitest run lib/videos.test.ts`
Expected: 1 passed

- [ ] **Step 6: Implementar la ruta de API `web/app/api/videos/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { saveVideoAndCreateJob } from '@/lib/videos';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('video');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Falta el archivo de video' }, { status: 400 });
  }

  const { jobId } = await saveVideoAndCreateJob(file);
  return NextResponse.json({ jobId }, { status: 201 });
}
```

- [ ] **Step 7: Commit**

```bash
git add web/lib/db.ts web/lib/videos.ts web/lib/videos.test.ts web/app/api/videos/route.ts
git commit -m "feat(web): add video upload endpoint backed by Postgres"
```

---

## Task 6: Estado del job y agregación de resultados (Next.js, TDD)

**Files:**
- Create: `web/lib/jobs.ts`
- Create: `web/app/api/jobs/[id]/route.ts`
- Test: `web/lib/jobs.test.ts`

- [ ] **Step 1: Escribir el test de `getJobSummary` (fallará, no existe todavía)**

`web/lib/jobs.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getJobSummary } from './jobs';
import { getPool } from './db';

describe('getJobSummary', () => {
  let videoId: string;
  let jobId: string;

  beforeEach(async () => {
    const pool = getPool();
    const videoRow = await pool.query(
      "insert into videos (filename, path) values ('test.mp4', '/tmp/test.mp4') returning id"
    );
    videoId = videoRow.rows[0].id;
    const jobRow = await pool.query(
      "insert into analysis_jobs (video_id, status) values ($1, 'completed') returning id",
      [videoId]
    );
    jobId = jobRow.rows[0].id;

    await pool.query(
      `insert into frame_detections
         (job_id, frame_number, time_s, bbox_x1, bbox_y1, bbox_x2, bbox_y2, has_helmet, has_glove)
       values
         ($1, 0, 0.0, 0, 0, 10, 10, true, false),
         ($1, 15, 0.5, 0, 0, 10, 10, false, false),
         ($1, 15, 0.5, 20, 20, 30, 30, true, true)`,
      [jobId]
    );
  });

  afterEach(async () => {
    await getPool().query('delete from videos where id = $1', [videoId]);
  });

  it('calcula el resumen agregado correctamente', async () => {
    const summary = await getJobSummary(jobId);
    expect(summary).not.toBeNull();
    expect(summary!.status).toBe('completed');
    expect(summary!.framesAnalyzed).toBe(2);
    expect(summary!.totalPersonDetections).toBe(3);
    expect(summary!.helmetCompliancePct).toBeCloseTo((2 / 3) * 100, 1);
    expect(summary!.gloveCompliancePct).toBeCloseTo((1 / 3) * 100, 1);
  });

  it('devuelve null si el job no existe', async () => {
    const summary = await getJobSummary('00000000-0000-0000-0000-000000000000');
    expect(summary).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `npx vitest run lib/jobs.test.ts`
Expected: error de import, `jobs.ts` no existe

- [ ] **Step 3: Implementar `web/lib/jobs.ts`**

```typescript
import { getPool } from './db';

export type JobSummary = {
  jobId: string;
  status: string;
  errorMessage: string | null;
  framesAnalyzed: number;
  totalPersonDetections: number;
  helmetCompliancePct: number | null;
  gloveCompliancePct: number | null;
  annotatedPath: string | null;
};

export async function getJobSummary(jobId: string): Promise<JobSummary | null> {
  const pool = getPool();

  const jobResult = await pool.query(
    `select aj.status, aj.error_message, v.annotated_path
     from analysis_jobs aj
     join videos v on v.id = aj.video_id
     where aj.id = $1`,
    [jobId]
  );
  if (jobResult.rows.length === 0) return null;
  const { status, error_message, annotated_path } = jobResult.rows[0];

  const statsResult = await pool.query(
    `select
       count(distinct frame_number)::int as frames_analyzed,
       count(*)::int as total_person_detections,
       count(*) filter (where has_helmet)::int as with_helmet,
       count(*) filter (where has_glove)::int as with_glove
     from frame_detections
     where job_id = $1`,
    [jobId]
  );
  const { frames_analyzed, total_person_detections, with_helmet, with_glove } = statsResult.rows[0];

  return {
    jobId,
    status,
    errorMessage: error_message,
    annotatedPath: annotated_path,
    framesAnalyzed: frames_analyzed,
    totalPersonDetections: total_person_detections,
    helmetCompliancePct:
      total_person_detections > 0 ? (with_helmet / total_person_detections) * 100 : null,
    gloveCompliancePct:
      total_person_detections > 0 ? (with_glove / total_person_detections) * 100 : null,
  };
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `npx vitest run lib/jobs.test.ts`
Expected: 2 passed

- [ ] **Step 5: Implementar la ruta de API `web/app/api/jobs/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getJobSummary } from '@/lib/jobs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const summary = await getJobSummary(id);

  if (!summary) {
    return NextResponse.json({ error: 'Job no encontrado' }, { status: 404 });
  }

  return NextResponse.json(summary);
}
```

- [ ] **Step 6: Commit**

```bash
git add web/lib/jobs.ts web/lib/jobs.test.ts web/app/api/jobs
git commit -m "feat(web): add job summary aggregation endpoint"
```

---

## Task 7: Página de subida de video (UI)

**Files:**
- Modify: `web/app/page.tsx`

- [ ] **Step 1: Reemplazar `web/app/page.tsx`**

```tsx
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
```

- [ ] **Step 2: Verificación manual**

Run: `npm run dev` (dentro de `web/`), abrir `http://localhost:3000`
Expected: formulario visible, sin errores en consola

- [ ] **Step 3: Commit**

```bash
git add web/app/page.tsx
git commit -m "feat(web): add video upload page"
```

---

## Task 8: Dashboard de resultados por job (UI)

**Files:**
- Create: `web/app/jobs/[id]/page.tsx`

- [ ] **Step 1: Crear `web/app/jobs/[id]/page.tsx`**

```tsx
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
```

- [ ] **Step 2: Crear la ruta que sirve el video anotado: `web/app/api/videos/annotated/[jobId]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { getJobSummary } from '@/lib/jobs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const summary = await getJobSummary(jobId);

  if (!summary?.annotatedPath) {
    return NextResponse.json({ error: 'Video anotado no disponible' }, { status: 404 });
  }

  const buffer = await readFile(summary.annotatedPath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'video/mp4' },
  });
}
```

- [ ] **Step 3: Verificación manual**

Con un `jobId` de prueba insertado a mano en la base (o subiendo un video real), visitar `http://localhost:3000/jobs/<id>` y confirmar que el estado se actualiza solo mientras el worker procesa.

- [ ] **Step 4: Commit**

```bash
git add web/app/jobs web/app/api/videos
git commit -m "feat(web): add job results dashboard with annotated video playback"
```

---

## Task 9: Prueba end-to-end con el video real

**Files:** Ninguno (verificación manual, no produce código nuevo)

- [ ] **Step 1: Levantar todo el stack**

```bash
docker compose up -d
cd worker && source .venv/bin/activate && python worker.py &
cd web && npm run dev
```

- [ ] **Step 2: Subir el video ya descargado**

Abrir `http://localhost:3000`, subir `Perforación de pozos de petróleo.mp4` (está en la raíz del proyecto).

- [ ] **Step 3: Verificar que el job progresa**

En la página `/jobs/<id>`, confirmar que el estado pasa de `pending` → `processing` → `completed` (el worker hace print de progreso en su terminal).

- [ ] **Step 4: Comparar contra el resultado de referencia**

El reporte generado hoy con `ppe_detection.py` dio ~55% de cumplimiento de casco y ~3% de guantes sobre este mismo video. Los números del dashboard no van a ser idénticos (YOLOE ≠ YOLO-World), pero deberían estar en el mismo orden de magnitud. Si el casco da <20% o >90%, algo está mal en la clasificación — revisar `classify_persons` y los umbrales de confianza en `model.py`.

- [ ] **Step 5: Commit final (si hubo ajustes)**

```bash
git add -A
git commit -m "chore: verify end-to-end flow with reference video"
```
