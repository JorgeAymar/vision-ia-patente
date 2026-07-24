import { test, expect } from '@playwright/test';

test.describe('Página principal', () => {
  test('lista videos disponibles sin errores de consola', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Detección de EPP en video' })).toBeVisible();
    await expect(page.getByText('Perforación de pozos de petróleo.mp4')).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('no muestra el warning de hidratación de React (extensión Kapture)', async ({ page }) => {
    const consoleMessages: string[] = [];
    page.on('console', (msg) => consoleMessages.push(msg.text()));

    await page.goto('/');
    await page.waitForTimeout(1000);

    const hydrationWarning = consoleMessages.find((m) => m.toLowerCase().includes('hydrat'));
    expect(hydrationWarning).toBeUndefined();
  });
});

test.describe('Selección de video y layout de resultados', () => {
  test('seleccionar un video crea un job, y el job muestra entrada a la izquierda y resultado+estadísticas a la derecha', async ({ page }) => {
    await page.goto('/');

    await page
      .locator('li', { hasText: 'Perforación de pozos de petróleo.mp4' })
      .getByRole('button', { name: 'Analizar' })
      .click();

    await page.waitForURL(/\/jobs\/[0-9a-f-]+/);

    const left = page.getByRole('heading', { name: 'Video original' });
    const right = page.getByRole('heading', { name: 'Resultado del análisis' });
    await expect(left).toBeVisible();
    await expect(right).toBeVisible();

    // izquierda = entrada, a la izquierda de la derecha = resultado
    const leftBox = await left.boundingBox();
    const rightBox = await right.boundingBox();
    expect(leftBox!.x).toBeLessThan(rightBox!.x);

    // el video de la izquierda es el original (input), sin anotar
    const originalVideoSrc = await page.locator('video').first().getAttribute('src');
    expect(originalVideoSrc).toContain('/api/videos/original/');

    // esperar a que el worker termine de procesar (ya corre en background)
    await expect(page.locator('p', { hasText: 'Estado:' })).toContainText('completed', {
      timeout: 60_000,
    });

    // estadísticas visibles en la columna derecha
    await expect(page.getByText(/Cumplimiento de casco/)).toBeVisible();
    await expect(page.getByText(/Cumplimiento de guantes/)).toBeVisible();

    // el video de la derecha es el resultado (salida anotada)
    const videos = page.locator('video');
    await expect(videos).toHaveCount(2);
    const annotatedVideoSrc = await videos.nth(1).getAttribute('src');
    expect(annotatedVideoSrc).toContain('/api/videos/annotated/');
  });
});
