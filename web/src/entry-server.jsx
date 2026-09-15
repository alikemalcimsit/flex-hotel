import { renderToString } from 'react-dom/server'
// react-router v7'de paketler birleşti: 'react-router-dom/server' alt yolu
// kaldırıldı, StaticRouter doğrudan 'react-router-dom' üzerinden geliyor
// (paket içeride `export * from "react-router"` yapıyor).
import { StaticRouter } from 'react-router-dom'
import App from './App.jsx'
import { buildHead, renderHeadTags } from './lib/seo.js'
import { PEOPLE } from './data/people.js'
import { VERTICALS } from './data/verticals.js'

/** Prerender edilecek adresler — ekip sayfası yalnızca CV'si olanlar için. */
export const ROUTES = [
  '/',
  ...VERTICALS.map((vertical) => `/cozumler/${vertical.slug}`),
  ...PEOPLE.filter((p) => p.hasPage).map((p) => `/ekip/${p.slug}`),
]

/**
 * Build zamanında çağrılır; verilen adresin statik HTML'ini ve
 * o adrese ait <head> etiketlerini üretir.
 *
 * @param {string} url
 * @returns {{html: string, head: string}}
 */
export function render(url) {
  const html = renderToString(
    <StaticRouter location={url}>
      <App />
    </StaticRouter>
  )
  return { html, head: renderHeadTags(buildHead(url)) }
}
