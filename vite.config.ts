import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Как в шаблоне Tauri: постоянный порт, папка src-tauri не отслеживается.
const host = process.env.TAURI_DEV_HOST;
// Версия для окна настроек (её просит шаблон issue) — из package.json, без лишних прав Tauri.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: { target: 'es2022' },
  define: { __APP_VERSION__: JSON.stringify(version) },
});
