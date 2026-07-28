# Diseño: Reconocimiento de patente de auto (Next.js + YOLOE + Ollama)

**Fecha:** 2026-07-27
**Estado:** Aprobado, pendiente de plan de implementación

## Contexto

La app ya tenía un flujo de video para detección de EPP (`web/` + `worker/`, Next.js +
Postgres + worker Python con YOLOE) viviendo en la ruta raíz (`/`). Esta es una
funcionalidad nueva: una página que, a partir de una foto de auto, reconoce (lee) el texto
de la patente en 3 pasos visibles en una misma pantalla.

**Decisión (revisada durante la implementación):** el detector de patentes pasa a vivir en
la ruta raíz (`/`), reemplazando ahí a la app de EPP — el usuario confirmó que quiere que
`localhost:3000` muestre directamente el detector de patentes. La app de EPP no se borra:
se mueve a `/epp` (ruta separada), para no perder ese trabajo ya probado. Esto ya se
implementó (`web/app/page.tsx` → `web/app/epp/page.tsx`, más el ajuste del e2e de Playwright
y del redirect legacy de `/jobs/[id]`).

## Objetivo

Una página en `/` (raíz) con 3 partes y **2 botones independientes**, uno por acción (no un
único "Analizar" que corre todo el pipeline de una):

1. **Foto original** del auto — siempre visible, sin botón.
2. **Zona de la patente recortada** — botón "Reconocer patente" que detecta la zona con
   YOLOE y genera una imagen nueva (el recorte), que se muestra en esta sección.
3. **Texto de la patente** — botón "Leer texto", al lado del anterior, que toma la imagen
   recortada de la parte 2 y la manda a Ollama para extraer el texto. Deshabilitado hasta
   que la parte 2 haya generado un recorte.

## Fuera de alcance (v1)

- Subir una foto propia (se usa `automovil.png`, ya presente en el repo, como imagen fija).
- Persistencia en Postgres / historial de análisis (stateless: cada click corre el
  pipeline completo y solo se muestra en pantalla).
- Comparar la patente leída contra una lista de patentes conocidas/autorizadas (es
  reconocimiento de texto — OCR — no control de acceso).
- Múltiples patentes en una misma foto (se toma la detección de mayor confianza).
- Cámara en vivo / video.
- Borrar la app de EPP (se conserva funcional en `/epp`).

## Arquitectura

Sin cola de jobs ni worker en background — a diferencia de la app de EPP, esto es una sola
imagen y no necesita procesamiento asíncrono:

```
Browser (/)

  → click "Reconocer patente"  (parte 2)
  → POST /api/plate/detect
       Next.js invoca un subproceso: `python worker/detect_plate.py <ruta imagen>`
         - carga YOLOE (yoloe-11s-seg.pt, ya usado en la app de EPP), clase de texto
           "license plate", umbral de confianza inicial 0.12 (mismo valor que
           `CONF_THRESHOLD` en `worker/model.py` — punto de partida, se ajusta con el
           resultado real sobre `automovil.png`)
         - toma la detección de mayor confianza
         - recorta el bbox con 15% de margen en cada lado (para no cortar el borde de la
           patente) y devuelve por stdout:
           { bbox: [x1,y1,x2,y2], confidence, croppedImageBase64 }
         - si no hay ninguna detección, devuelve { error: "no_plate_detected" }
  → Next.js responde al browser: { bbox, confidence, croppedImageBase64 } | { error }
  → la UI pinta la parte 2 con la imagen recortada (croppedImageBase64)

  → click "Leer texto"  (parte 3, habilitado solo si la parte 2 generó un recorte)
  → POST /api/plate/ocr  con body { croppedImageBase64 }
       Next.js llama a Ollama:
         POST http://localhost:11434/api/generate
         { model: "gemma4:31b-cloud", images: [croppedImageBase64], prompt: ... }
         pidiendo únicamente el texto de la patente.
  → Next.js responde al browser: { plateText } | { error }
  → la UI pinta la parte 3 con el texto leído
```

**Por qué subproceso bajo demanda y no un worker persistente (como en la app de EPP):**
al ser stateless y de una sola imagen por click manual, no hay jobs que encolar. Correr
YOLOE en un subproceso por request es más simple que mantener otro proceso corriendo — el
costo (~1-3s de carga del modelo por click) es aceptable para una demo de un solo click. Si
en la práctica se siente lento, se puede migrar a un servicio Python persistente (FastAPI)
que mantenga el modelo cargado; no se hace ahora porque no hay evidencia de que haga falta.

**Por qué YOLOE zero-shot y no un modelo ANPR dedicado:** reusa el mismo peso ya validado
en este repo (`yoloe-11s-seg.pt`) sin agregar una dependencia nueva. Si el recall en la
prueba real con `automovil.png` es malo, se compara contra YOLO26 (`yoloe-26s-seg.pt`, ya
descargado) o un modelo ANPR dedicado — no se decide de antemano sin datos. (Nota: YOLO26
ya se descartó para la clase "safety helmet" en la app de EPP porque nunca cruzaba el
umbral de confianza; ese resultado es de una clase distinta y no se traslada
automáticamente a "license plate" — se vuelve a evaluar acá si hace falta.)

**Por qué la llamada a Ollama va directo desde Next.js y no pasa por Python:** el modelo
`gemma4:31b-cloud` corre en la nube de Ollama pero se llama a través del daemon local
(`localhost:11434`), que expone una API HTTP estándar con soporte de `images` en base64.
No hay necesidad de Python para esta parte — `fetch` nativo de Next.js alcanza.

## UI — 3 partes y 2 botones en una sola página

- **Parte 1 — Foto original:** `automovil.png` servido como asset estático
  (`web/public/automovil.png`), visible siempre, sin botón ni espera.
- **Parte 2 — Zona recortada:** botón **"Reconocer patente"**. Al apretarlo, llama a
  `/api/plate/detect` y muestra la imagen recortada que devuelve (`croppedImageBase64`,
  renderizada como `data:image/...;base64,...`) — es una imagen nueva generada por el
  recorte, no un overlay sobre el original.
- **Parte 3 — Texto extraído:** botón **"Leer texto"**, ubicado al lado del botón de la
  parte 2. Deshabilitado hasta que la parte 2 tenga un recorte válido (sin error). Al
  apretarlo, llama a `/api/plate/ocr` con ese recorte y muestra el `plateText` devuelto.

Los dos botones viven juntos en una barra de acciones, uno al lado del otro. Antes de
apretar cada botón, su parte correspondiente queda vacía/placeholder — mismo patrón que
"no mostrar resultado hasta que se aprieta el botón" ya usado en la app de EPP.

## Manejo de errores

Casos reales para una sola imagen fija (sin sobre-diseñar para casos que no van a pasar):

- **YOLOE no detecta ninguna patente:** `/api/plate/detect` responde 200 con
  `{ error: "no_plate_detected" }`; la UI muestra "no se detectó una patente" en la parte 2
  y el botón "Leer texto" queda deshabilitado (no hay recorte que mandar a Ollama).
- **Ollama no responde** (servicio no corriendo, o modelo cloud sin autenticación):
  `/api/plate/ocr` responde con `{ error }`; la UI muestra ese error en la parte 3, sin
  afectar el recorte ya mostrado en la parte 2 (no hace falta repetir la detección).

## Testing

- Tests unitarios puros (sin red) en `web/lib`, siguiendo el patrón ya existente de
  `web/lib/*.test.ts` con Vitest: parseo de la salida de `detect_plate.py` (éxito, error,
  JSON con forma inválida) y armado/parseo de la request-response con Ollama (body con la
  imagen y `stream: false`, extracción de `plateText` desde la respuesta).
- Tests unitarios puros en `worker/tests` (pytest, sin cargar el modelo real), siguiendo el
  patrón de `worker/tests/test_detector.py`: selección de la detección de mayor confianza y
  cálculo del bbox expandido con margen.
- Criterio de aceptación manual: desde la UI, apretar "Reconocer patente" contra
  `automovil.png` y confirmar que el recorte muestra la patente real; luego apretar "Leer
  texto" y confirmar que el texto coincide con la patente visible en la foto — igual que el
  plan de pruebas de la app de EPP (correrlo y verificar que el resultado tenga sentido), no
  un test automatizado end-to-end porque depende de red y de modelos externos (Ollama
  cloud).

## Entorno de desarrollo (cómo se corre)

```bash
cd web && npm run dev     # Next.js en localhost:3000 — detector de patentes en '/'
# la app de EPP (video) sigue disponible en localhost:3000/epp
# Ollama debe estar corriendo localmente (ya lo está) con acceso a gemma4:31b-cloud
```

No hace falta `docker compose up` (Postgres) ni el worker en loop para esta funcionalidad,
ya que es stateless y no encola jobs.
