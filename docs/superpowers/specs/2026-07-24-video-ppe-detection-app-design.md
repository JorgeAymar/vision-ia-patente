# Diseño: App de detección de EPP en video (Next.js + Postgres + YOLOE)

**Fecha:** 2026-07-24
**Estado:** Aprobado, pendiente de plan de implementación

## Contexto

Hoy se descargó un video corto (YouTube Shorts, "Perforación de pozos de petróleo") y se
analizó con un script de Python (`ppe_detection.py`) usando YOLO-World zero-shot para
detectar personas, cascos y guantes, con resultado:

- 118 frames analizados (muestreo ~2 fps de un video de 59s / 1769 frames a 30fps)
- 197 detecciones de persona acumuladas
- Cumplimiento de casco: 55.3%
- Cumplimiento de guantes: 3.0% (probablemente subestimado — las manos son un objeto
  pequeño y de baja resolución para detección zero-shot en un short vertical de celular)

Este documento define una app web para reemplazar la ejecución manual del script por un
flujo de subir-video → analizar → ver resultados en un dashboard, respaldado por Postgres.

Este proyecto es **para pruebas/prototipo**, no para producción ni despliegue público. El
objetivo es validar el flujo completo (upload → detección → dashboard) rápido y con el
mínimo de infraestructura.

## Objetivo

Un usuario sube un video desde el navegador; la app lo analiza en segundo plano detectando
personas, cascos y guantes; el usuario ve en un dashboard cuántas personas aparecieron y
el % de cumplimiento de EPP, con el video anotado disponible para reproducir.

## Fuera de alcance (v1)

- Cámaras en vivo / streaming RTSP (solo video subido, procesamiento por lotes)
- Autenticación / multi-usuario (herramienta de un solo usuario, uso local)
- Despliegue en la nube (todo corre en localhost)
- Modelo de detección fine-tuned (se usa detección zero-shot; ver sección de Detección)
- Detección de vehículos/maquinaria u objetos genéricos de COCO

## Arquitectura

Dos procesos independientes que se coordinan a través de Postgres, sin broker de mensajería:

```
Next.js (Node)                          Worker (Python)
─────────────────                       ─────────────────
Usuario sube video                      Poll cada pocos segundos:
  → guarda en disco local                 "¿hay jobs pendientes?"
    (storage/videos/<uuid>.mp4)                ↓
  → inserta fila en `videos`              Marca job "processing"
  → inserta fila en `analysis_jobs`       Corre YOLOE (zero-shot,
    (status = pending)                    clases: person/helmet/glove)

Dashboard consulta Postgres              Inserta detecciones frame a
  → refresca estado del job                frame en `frame_detections`
  → cuando status=completed,              Marca job "completed"
    calcula agregados con SQL               (o "failed" + error_message)
    y los muestra
```

**Por qué Postgres como cola y no Redis/RabbitMQ:** para una herramienta local de un solo
usuario, un broker de mensajería es complejidad que no se paga sola. Una tabla
`analysis_jobs` con `status` (pending/processing/completed/failed) cubre el caso de uso
completo. Si esto creciera a multi-usuario con alto volumen, se migraría a un job queue
real — no antes.

**Por qué worker Python separado y no todo en Node:** la detección usa `ultralytics` +
`torch` (Python), y reutiliza directamente la lógica ya validada en `ppe_detection.py` de
hoy. Reescribir la inferencia en Node/ONNX es trabajo adicional sin beneficio para un
prototipo.

## Modelo de datos (Postgres)

```sql
videos
  id            uuid primary key
  filename      text
  path          text            -- ruta en disco local
  uploaded_at   timestamptz
  duration_s    real
  width         int
  height        int
  fps           real

analysis_jobs
  id            uuid primary key
  video_id      uuid references videos(id)
  status        text            -- pending | processing | completed | failed
  created_at    timestamptz
  started_at    timestamptz null
  finished_at   timestamptz null
  error_message text null

frame_detections
  id              bigserial primary key
  job_id          uuid references analysis_jobs(id)
  frame_number    int
  time_s          real
  object_class    text          -- person | helmet | glove
  confidence      real
  bbox_x1         real
  bbox_y1         real
  bbox_x2         real
  bbox_y2         real
  person_group_id int null      -- agrupa helmet/glove con la persona a la que pertenecen
                                 -- dentro del mismo frame (misma heurística de hoy:
                                 -- casco en región de cabeza, guante dentro de bbox persona)
```

Las estadísticas agregadas (conteo de personas, % cumplimiento casco/guantes) se calculan
con una consulta SQL sobre `frame_detections` en el momento de mostrarlas en el dashboard —
no se guarda una tabla resumen aparte, para evitar que quede desincronizada del detalle.

## Detección: YOLOE (zero-shot, base YOLO11)

Se usa **YOLOE**, el sucesor de YOLO-World incluido en `ultralytics` (ya instalado,
versión 8.4.104), construido sobre la arquitectura YOLO11. Permite definir clases por texto
libre ("person", "safety helmet", "safety gloves") sin reentrenar, igual que el enfoque
zero-shot ya validado hoy con YOLO-World, pero sobre el backbone más nuevo.

Mismo criterio de asociación persona↔EPP que en `ppe_detection.py`:
- **Casco:** el centro de una detección de casco cae dentro del 35% superior (región de
  cabeza) del bounding box de una persona.
- **Guantes:** el centro de una detección de guante cae dentro del bounding box completo
  de una persona.

Limitación conocida (heredada del prototipo de hoy): la detección de guantes es poco
confiable en video vertical de celular por el tamaño pequeño de las manos en el frame.
No se resuelve en v1 — queda documentado como mejora futura (modelo fine-tuned en dataset
de EPP de construcción).

## Flujo de procesamiento de video

1. Usuario sube un video desde la UI de Next.js (drag & drop).
2. Next.js guarda el archivo en `storage/videos/<uuid>.mp4`, inserta fila en `videos` y
   una fila en `analysis_jobs` con `status = pending`.
3. El worker Python (`worker.py`, loop de polling) detecta el job pendiente, lo marca
   `processing`, corre YOLOE muestreando frames (mismo muestreo de hoy: cada 15 frames,
   ~2 fps a 30fps de origen), e inserta una fila en `frame_detections` por cada detección
   de persona/casco/guante.
4. Al terminar, marca el job `completed` (o `failed` + `error_message` si algo falla).
5. El dashboard de Next.js consulta el estado del job (polling simple desde el cliente) y,
   una vez `completed`, corre la agregación SQL y muestra: total de personas detectadas,
   % cumplimiento casco, % cumplimiento guantes, y una línea de tiempo de personas por
   frame.

## Entorno de desarrollo (cómo se corre)

```bash
docker compose up -d              # Postgres local
cd worker && python worker.py     # loop de inferencia YOLOE (usa GPU Apple Silicon/MPS)
cd web && npm run dev             # Next.js en localhost:3000
```

## Plan de pruebas

El video ya descargado hoy ("Perforación de pozos de petróleo.mp4") es el primer caso de
prueba real: subirlo por la UI, confirmar que el job pasa por
pending → processing → completed, y verificar que el dashboard muestre números cercanos
a los del reporte de hoy (~55% casco, ~3% guantes, conteos de persona similares) como
señal de que el pipeline nuevo replica correctamente la lógica del script original.
