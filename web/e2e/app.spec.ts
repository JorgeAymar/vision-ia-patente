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
  test('seleccionar un video muestra el resultado en la misma pantalla (sin navegar a otra URL)', async ({ page }) => {
    await page.goto('/');

    await page
      .locator('li', { hasText: 'Perforación de pozos de petróleo.mp4' })
      .getByRole('button', { name: 'Analizar' })
      .click();

    const left = page.getByRole('heading', { name: 'Video original' });
    const right = page.getByRole('heading', { name: 'Resultado del análisis' });
    await expect(left).toBeVisible();
    await expect(right).toBeVisible();

    // seguimos en la misma pantalla, no navegamos a otra URL
    expect(page.url()).toBe('http://localhost:3000/');
    // la lista de videos sigue visible junto con el resultado
    await expect(page.getByText('Perforación de pozos de petróleo.mp4')).toBeVisible();

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

    // ambos videos deben ser realmente reproducibles por el navegador, no solo
    // "cargar" un <video> con un src roto (ej. un codec que Chrome no decodifica)
    for (const video of [videos.first(), videos.nth(1)]) {
      await expect
        .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(2); // HAVE_CURRENT_DATA: ya se conoce duración y hay un frame decodificado
      const duration = await video.evaluate((el: HTMLVideoElement) => el.duration);
      expect(duration).toBeGreaterThan(0);
    }
  });
});
