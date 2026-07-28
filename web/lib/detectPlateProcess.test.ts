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
