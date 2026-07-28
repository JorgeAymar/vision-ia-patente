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
