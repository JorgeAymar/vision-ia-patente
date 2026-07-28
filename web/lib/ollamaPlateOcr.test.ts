import { describe, it, expect } from 'vitest';
import { buildOllamaRequestBody, extractPlateTextFromOllamaResponse } from './ollamaPlateOcr';

describe('buildOllamaRequestBody', () => {
  it('incluye la imagen, el modelo, y pide una respuesta no-streaming', () => {
    const body = buildOllamaRequestBody('BASE64DATA');
    expect(body.images).toEqual(['BASE64DATA']);
    expect(body.stream).toBe(false);
    expect(body.model).toBe('kimi-k2.6:cloud');
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
