import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

// .env kökte durur; Vite'a oradan okumasını söylüyoruz
export default defineConfig(({ mode }) => {
  const envDir = resolve(import.meta.dirname, '../..');
  const env = loadEnv(mode, envDir, 'VITE_');
  return {
    plugins: [react(), tailwindcss()],
    envDir,
    server: { port: 5173, strictPort: true },
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL ?? 'http://localhost:3000') },
  };
});
