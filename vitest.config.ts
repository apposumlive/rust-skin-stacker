import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// vite.config.ts тестами не читается: версию для окна настроек подставляем и здесь.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Стили тестам нужны как текст (styles.test.ts, импорт с ?raw): без этого Vitest отдаёт пустую строку.
    css: { include: [/src\/styles\/.+\.css/] },
  },
});
