import { describe, it, expect } from 'vitest';
import { isPngBuffer } from './plateImage';

describe('isPngBuffer', () => {
  it('devuelve true para un buffer con la firma PNG', () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(isPngBuffer(buffer)).toBe(true);
  });

  it('devuelve false para un buffer con firma JPEG', () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    expect(isPngBuffer(buffer)).toBe(false);
  });

  it('devuelve false para un buffer más corto que la firma PNG', () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e]);
    expect(isPngBuffer(buffer)).toBe(false);
  });
});
