const OLLAMA_URL = 'http://localhost:11434/api/generate';
// gemma4:31b-cloud anuncia capacidad "vision" (`ollama show`) pero devuelve 500
// para cualquier request con `images` (probado con una imagen de 1x1 real);
// kimi-k2.6:cloud sí procesa imágenes correctamente — confirmado end-to-end
// contra el recorte real de una patente durante la verificación manual.
const OLLAMA_MODEL = 'kimi-k2.6:cloud';
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
