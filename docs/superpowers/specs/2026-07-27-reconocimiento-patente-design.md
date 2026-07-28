# Diseño: Reconocimiento de patente de auto (Next.js + YOLOE + Ollama)

**Fecha:** 2026-07-27
**Estado:** Aprobado, pendiente de plan de implementación

## Contexto

La app ya tiene un flujo de video para detección de EPP (`web/` + `worker/`, Next.js +
Postgres + worker Python con YOLOE). Esta es una funcionalidad **nueva y separada**: una
página que, a partir de una foto de auto, reconoce (lee) el texto de la patente en 3 pasos
visibles en una misma pantalla.

No reemplaza ni modifica la app de EPP existente — coexisten como rutas distintas dentro
del mismo proyecto Next.js.

## Objetivo

Una página `/patente` con 3 partes:

1. **Foto original** del auto.
2. **Zona de la patente** detectada sobre esa foto.
3. **Texto de la patente** extraído de esa zona.

El usuario aprieta "Analizar" y ve las 3 partes completarse con el resultado real del
pipeline.

## Fuera de alcance (v1)

- Subir una foto propia (se usa `automovil.png`, ya presente en el repo, como imagen fija).
- Persistencia en Postgres / historial de análisis (stateless: cada click corre el
  pipeline completo y solo se muestra en pantalla).
- Comparar la patente leída contra una lista de patentes conocidas/autorizadas (es
  reconocimiento de texto — OCR — no control de acceso).
- Múltiples patentes en una misma foto (se toma la detección de mayor confianza).
- Cámara en vivo / video.
- Reemplazar o tocar la app de EPP existente.

## Arquitectura

Sin cola de jobs ni worker en background — a diferencia de la app de EPP, esto es una sola
imagen y no necesita procesamiento asíncrono:

```
Browser (/patente)
  → click "Analizar"
  → POST /api/plate/analyze
       1. Next.js invoca un subproceso: `python worker/detect_plate.py <ruta imagen>`
            - carga YOLOE (yoloe-11s-seg.pt, ya usado en la app de EPP), clase de texto
              "license plate", umbral de confianza inicial 0.12 (mismo valor que
              `CONF_THRESHOLD` en `worker/model.py` — punto de partida, se ajusta con el
              resultado real sobre `automovil.png`)
            - toma la detección de mayor confianza
            - recorta el bbox con 15% de margen en cada lado (para no cortar el borde de
              la patente) y devuelve por stdout:
              { bbox: [x1,y1,x2,y2], confidence, croppedImageBase64 }
            - si no hay ninguna detección, devuelve { error: "no_plate_detected" }
       2. Si hubo detección, Next.js llama a Ollama:
            POST http://localhost:11434/api/generate
            { model: "gemma4:31b-cloud", images: [croppedImageBase64], prompt: ... }
            pidiendo únicamente el texto de la patente.
       3. Next.js responde al browser:
            { bbox, croppedImageBase64, plateText } | { error }
  → la UI pinta las 3 partes con ese resultado
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

## UI — 3 partes en una sola página

- **Parte 1 — Foto original:** `automovil.png` servido como asset estático
  (`web/public/automovil.png`), visible siempre, sin esperar el análisis (mismo criterio
  que la app de EPP: mostrar el original apenas está disponible).
- **Parte 2 — Zona detectada:** la foto original con el bbox de la patente dibujado
  encima (overlay posicionado en % sobre la imagen a partir de `bbox` y las dimensiones
  naturales de la imagen — sin canvas).
- **Parte 3 — Texto extraído:** el texto de `plateText` en un bloque simple tipo
  resultado.

Antes de apretar "Analizar", las partes 2 y 3 quedan vacías/placeholder — mismo patrón que
"no mostrar resultado hasta que se aprieta Analizar" ya usado en la app de EPP.

## Manejo de errores

Casos reales para una sola imagen fija (sin sobre-diseñar para casos que no van a pasar):

- **YOLOE no detecta ninguna patente:** el API route responde 200 con
  `{ error: "no_plate_detected" }`; la UI muestra "no se detectó una patente" en la parte 2
  y no llama a Ollama.
- **Ollama no responde** (servicio no corriendo, o modelo cloud sin autenticación): error
  controlado; la UI sigue mostrando el bbox de la parte 2, y en la parte 3 un mensaje de
  error explícito (no un spinner infinito).

## Testing

- Test unitario puro (sin red) en `web/lib` para la conversión bbox → porcentajes de
  overlay, siguiendo el patrón ya existente de `web/lib/*.test.ts` con Vitest.
- Criterio de aceptación manual: correr el pipeline completo contra `automovil.png` desde
  la UI y confirmar que el bbox cae sobre la patente real y que el texto leído coincide con
  la patente visible en la foto — igual que el plan de pruebas de la app de EPP (correrlo y
  verificar que el resultado tenga sentido), no un test automatizado end-to-end porque
  depende de red y de modelos externos (Ollama cloud).

## Entorno de desarrollo (cómo se corre)

```bash
cd web && npm run dev     # Next.js en localhost:3000 — /patente
# Ollama debe estar corriendo localmente (ya lo está) con acceso a gemma4:31b-cloud
```

No hace falta `docker compose up` (Postgres) ni el worker en loop para esta funcionalidad,
ya que es stateless y no encola jobs.
