import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

/**
 * Kimlik okuma (modül 59): OCR dosyaları kendi kaynağımızdan (`/ocr/…`) gelir — CDN yok, görüntü ve dil verisi
 * üçüncü tarafa gitmez. Tarayıcı işlemcisine göre tek bir çekirdek seçer (relaxed SIMD → SIMD → düz); yalnız
 * LSTM çekirdekleri kopyalanır (okuyucu LSTM_ONLY çalışır). Dil verisi: tesseract'ın resmi İngilizce modeli
 * (best_int, MRZ'nin A–Z 0–9 < alfabesi için yeterli; sağlama haneleri doğrular).
 */
const OCR_FILES = {
  'worker.min.js': 'tesseract.js/dist/worker.min.js',
  'core/tesseract-core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
  'core/tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'core/tesseract-core-relaxedsimd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'lang/eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};
const CONTENT_TYPES = { '.js': 'application/javascript; charset=utf-8', '.gz': 'application/octet-stream' };

/** Çalışma alanında paket kökte (hoist) ya da ön yüzün kendi node_modules'ünde. */
function modulePath(relative) {
  for (const base of [resolve(import.meta.dirname, 'node_modules'), resolve(import.meta.dirname, '../../node_modules')]) {
    const path = resolve(base, relative);
    if (existsSync(path)) return path;
  }
  throw new Error(`OCR dosyası bulunamadı: ${relative} (npm install yapıldı mı?)`);
}

function ocrAssets() {
  return {
    name: 'hotelos-ocr-assets',
    configureServer(server) {
      server.middlewares.use('/ocr', (request, response, next) => {
        const name = (request.url ?? '').split('?')[0].replace(/^\//, '');
        const source = OCR_FILES[name];
        if (!source) return next();
        response.setHeader('Content-Type', CONTENT_TYPES[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream');
        response.setHeader('Cache-Control', 'public, max-age=86400');
        createReadStream(modulePath(source)).pipe(response);
      });
    },
    generateBundle() {
      for (const [name, source] of Object.entries(OCR_FILES)) {
        this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: readFileSync(modulePath(source)) });
      }
    },
  };
}

// .env kökte durur; Vite'a oradan okumasını söylüyoruz
export default defineConfig(({ mode }) => {
  const envDir = resolve(import.meta.dirname, '../..');
  const env = loadEnv(mode, envDir, 'VITE_');
  return {
    plugins: [react(), tailwindcss(), ocrAssets()],
    envDir,
    server: { port: 5173, strictPort: true },
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL ?? 'http://localhost:3000') },
  };
});
