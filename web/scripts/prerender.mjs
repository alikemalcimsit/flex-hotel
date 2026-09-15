#!/usr/bin/env node
/**
 * Statik ön işleme (prerender).
 *
 * `vite build` istemci paketini, `vite build --ssr` sunucu girişini üretir.
 * Bu script ikisini birleştirip HER ADRES için ayrı bir HTML dosyası yazar:
 *
 *   /                        -> dist/index.html
 *   /ekip/ahmet-yusuf-demir  -> dist/ekip/ahmet-yusuf-demir/index.html
 *
 * Böylece arama motorları ve JS çalıştırmayan istemciler her sayfayı eksiksiz
 * görür, ilk boyama JS indirilmesini beklemez. Her dosyaya o sayfaya ait
 * başlık, açıklama, canonical ve şema etiketleri de gömülür — tüm sayfaların
 * aynı başlığı paylaşması SEO'da en sık yapılan hatalardan biridir.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(SCRIPT_DIR, '..')
const DIST = resolve(PACKAGE_ROOT, 'dist')
const TEMPLATE_PATH = join(DIST, 'index.html')
const SSR_ENTRY_PATH = resolve(PACKAGE_ROOT, 'dist-ssr/entry-server.js')

const ROOT_PLACEHOLDER = '<div id="root"></div>'
const HEAD_PLACEHOLDER = '<!--app-head-->'

function fail(message) {
  console.error(`prerender: ${message}`)
  process.exit(1)
}

if (!existsSync(TEMPLATE_PATH)) fail('dist/index.html yok — önce "vite build" çalışmalı')
if (!existsSync(SSR_ENTRY_PATH))
  fail('dist-ssr/entry-server.js yok — önce "vite build --ssr" çalışmalı')

const template = readFileSync(TEMPLATE_PATH, 'utf8')
if (!template.includes(ROOT_PLACEHOLDER)) fail(`index.html içinde "${ROOT_PLACEHOLDER}" bulunamadı`)
if (!template.includes(HEAD_PLACEHOLDER)) fail(`index.html içinde "${HEAD_PLACEHOLDER}" bulunamadı`)

const { render, ROUTES } = await import(pathToFileURL(SSR_ENTRY_PATH).href)

for (const route of ROUTES) {
  const { html, head } = render(route)
  if (!html) fail(`render("${route}") boş HTML döndürdü`)

  const page = template
    .replace(HEAD_PLACEHOLDER, head)
    .replace(ROOT_PLACEHOLDER, `<div id="root">${html}</div>`)

  const outPath = route === '/' ? TEMPLATE_PATH : join(DIST, route, 'index.html')
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, page)

  const relative = outPath.slice(DIST.length + 1)
  console.log(`prerender: ${route.padEnd(26)} -> dist/${relative} (+${html.length} karakter)`)
}

/*
 * Sitemap prerender edilen adreslerden ÜRETİLİR, elle tutulmaz.
 *
 * Elle tutulan liste er geç rotalardan ayrışır: yeni bir sektör sayfası
 * eklendiğinde sitemap'i güncellemeyi unutmak, o sayfanın arama motoruna hiç
 * bildirilmemesi demek. Tek kaynak `ROUTES`.
 */
const SITE = 'https://flexai.tr'
const CHANGE_FREQUENCY = { '/': 'monthly' }
const PRIORITY = { '/': '1.0' }

const urls = ROUTES.map((route) => {
  const location = `${SITE}${route === '/' ? '/' : route}`
  const changefreq = CHANGE_FREQUENCY[route] ?? 'yearly'
  const priority = PRIORITY[route] ?? (route.startsWith('/cozumler/') ? '0.8' : '0.6')
  return `  <url>\n    <loc>${location}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`
}).join('\n')

writeFileSync(
  join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
)
console.log(`sitemap:   ${ROUTES.length} adres -> dist/sitemap.xml`)
