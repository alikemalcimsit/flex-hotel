import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

/**
 * Misafir uygulaması (modül 53): personel panelinden ayrı, küçük bir React uygulaması. `/misafir/` altında yayınlanır
 * ve panelin `dist/` klasörünün içine (`dist/misafir/`) derlenir: yayın adımı değişmez (dist'in tamamı kopyalanır).
 * Personel kodu misafirin telefonuna inmez.
 */
export default defineConfig(({ mode }) => {
  const envDir = resolve(import.meta.dirname, '../..');
  const env = loadEnv(mode, envDir, 'VITE_');
  return {
    root: resolve(import.meta.dirname, 'guest'),
    base: '/misafir/',
    plugins: [react(), tailwindcss()],
    envDir,
    publicDir: false,
    server: { port: 5176, strictPort: true },
    build: { outDir: resolve(import.meta.dirname, 'dist/misafir'), emptyOutDir: true },
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL ?? 'http://localhost:3000') },
  };
});
