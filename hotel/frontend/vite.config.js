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
const CONTENT_TYPES = { '.js': 'application/javascript; charset=utf-8', '.gz': 'application/octet-stream', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.png': 'image/png' };

/** Çalışma alanında paket kökte (hoist) ya da ön yüzün kendi node_modules'ünde. */
function modulePath(relative) {
  for (const base of [resolve(import.meta.dirname, 'node_modules'), resolve(import.meta.dirname, '../../node_modules')]) {
    const path = resolve(base, relative);
    if (existsSync(path)) return path;
  }
  throw new Error(`Paket dosyası bulunamadı: ${relative} (npm install yapıldı mı?)`);
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

/**
 * Açık API dokümanı (modül 61): Swagger UI kendi kaynağımızdan (`/api-docs/`), CDN yok. Spesifikasyon sunucudan
 * (`<API>/v1/openapi.json`, koddaki şemalardan üretilir). Anahtar tarayıcıda saklanmaz (`persistAuthorization: false`):
 * "Dene" ile girilen anahtar sekme kapanınca gider.
 */
const API_DOCS_FILES = {
  'swagger-ui.css': 'swagger-ui-dist/swagger-ui.css',
  'swagger-ui-bundle.js': 'swagger-ui-dist/swagger-ui-bundle.js',
  'favicon-32x32.png': 'swagger-ui-dist/favicon-32x32.png',
};

const apiDocsIndex = () => `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>FlexHotel açık API</title>
    <link rel="icon" type="image/png" href="./favicon-32x32.png" />
    <link rel="stylesheet" href="./swagger-ui.css" />
    <style>body { margin: 0; background: #fafafa; } .topbar { display: none; } .swagger-ui .info { margin: 32px 0 16px; }</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="./swagger-ui-bundle.js"></script>
    <script src="./init.js"></script>
  </body>
</html>
`;

/** @param {string} apiUrl */
const apiDocsInit = (apiUrl) => `window.ui = SwaggerUIBundle({
  url: ${JSON.stringify(`${apiUrl.replace(/\/$/, '')}/v1/openapi.json`)},
  dom_id: '#swagger-ui',
  deepLinking: true,
  docExpansion: 'list',
  defaultModelsExpandDepth: 0,
  persistAuthorization: false,
  tryItOutEnabled: false,
  displayRequestDuration: true,
});
`;

/** @param {string} apiUrl */
function apiDocsAssets(apiUrl) {
  return {
    name: 'hotelos-api-docs',
    configureServer(server) {
      server.middlewares.use('/api-docs', (request, response, next) => {
        const name = (request.url ?? '').split('?')[0].replace(/^\//, '') || 'index.html';
        const generated = name === 'index.html' ? apiDocsIndex() : name === 'init.js' ? apiDocsInit(apiUrl) : null;
        const source = API_DOCS_FILES[name];
        if (!generated && !source) return next();
        response.setHeader('Content-Type', CONTENT_TYPES[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream');
        if (generated) return response.end(generated);
        response.setHeader('Cache-Control', 'public, max-age=86400');
        createReadStream(modulePath(source)).pipe(response);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'api-docs/index.html', source: apiDocsIndex() });
      this.emitFile({ type: 'asset', fileName: 'api-docs/init.js', source: apiDocsInit(apiUrl) });
      for (const [name, source] of Object.entries(API_DOCS_FILES)) {
        this.emitFile({ type: 'asset', fileName: `api-docs/${name}`, source: readFileSync(modulePath(source)) });
      }
    },
  };
}

// .env kökte durur; Vite'a oradan okumasını söylüyoruz
export default defineConfig(({ mode }) => {
  const envDir = resolve(import.meta.dirname, '../..');
  const env = loadEnv(mode, envDir, 'VITE_');
  const apiUrl = env.VITE_API_URL ?? 'http://localhost:3000';
  return {
    plugins: [react(), tailwindcss(), ocrAssets(), apiDocsAssets(apiUrl)],
    envDir,
    server: { port: 5173, strictPort: true },
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl) },
  };
});
