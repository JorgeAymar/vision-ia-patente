import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Next.js lee .env.local automáticamente, pero Vitest no — lo cargamos a mano
  // para que DATABASE_URL esté disponible en los tests de integración.
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);

  return {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    test: {
      environment: 'node',
    },
  };
});
