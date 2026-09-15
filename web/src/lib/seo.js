/**
 * Sayfa başına SEO etiketleri — saf, yan etkisiz.
 *
 * Aynı fonksiyon iki yerde kullanılır:
 * - Build sırasında (`scripts/prerender.mjs`) her adres için etiketler
 *   doğrudan HTML'in `<head>`'ine yazılır; arama motoru JS beklemeden görür.
 * - Tarayıcıda, sayfalar arası geçişte başlık ve açıklama güncellenir.
 *
 * Ortak etiketler (font, favicon, site adı, Organization şeması) index.html
 * içinde sabit durur; burada yalnızca adrese göre DEĞİŞENLER üretilir.
 */

import { COMPANY } from '../data/content.js'
import { findPerson } from '../data/people.js'
import { findVertical } from '../data/verticals.js'

const SITE = COMPANY.url
const OG_IMAGE = `${SITE}/og.png`

const HOME = {
  title: 'FlexAI — Sektöre Özel Yapay Zekâ Destekli İş Yazılımları',
  description:
    'FlexAI, işletmelere sektöre özel yapay zekâ destekli iş yazılımları kuruyor: otel, klinik, diş hekimliği, emlak, spor salonu, güzellik, hukuk ve eğitim. İlk kurduğumuz sistem FlexHotel bugün çalışıyor.',
  path: '/',
  image: OG_IMAGE,
}

/**
 * Sektör çözümü sayfası.
 *
 * Her dikeyin ayrı adres ve ayrı başlık alması bu yapının asıl kazancı:
 * "diş hekimi randevu yazılımı" arayan biriyle "otel yönetim sistemi" arayan
 * biri aynı sayfaya değil, kendi sayfasına düşüyor.
 */
function verticalHead(slug) {
  const vertical = findVertical(slug)
  if (!vertical) return null

  return {
    title: `${vertical.name} — ${vertical.industry} Yazılımı | FlexAI`,
    description: `${vertical.name}: ${vertical.tagline} ${vertical.industry.toLowerCase()} işletmeleri için sektöre özel kurulum.`,
    path: `/cozumler/${vertical.slug}`,
    image: OG_IMAGE,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: vertical.name,
      serviceType: `${vertical.industry} yazılımı`,
      description: vertical.summary,
      url: `${SITE}/cozumler/${vertical.slug}`,
      areaServed: COMPANY.location,
      provider: { '@type': 'Organization', name: COMPANY.name, url: SITE },
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: `${vertical.name} yetenekleri`,
        itemListElement: vertical.capabilities.map((capability) => ({
          '@type': 'Offer',
          itemOffered: { '@type': 'Service', name: capability },
        })),
      },
    },
  }
}

/** @param {string} pathname @returns {{title: string, description: string, path: string, image: string, jsonLd?: object}} */
export function buildHead(pathname) {
  const route = pathname || '/'

  const vertical = /^\/cozumler\/([a-z0-9-]+)\/?$/.exec(route)
  if (vertical) return verticalHead(vertical[1]) ?? HOME

  const match = /^\/ekip\/([a-z0-9-]+)\/?$/.exec(route)
  if (!match) return HOME

  const person = findPerson(match[1])
  if (!person || !person.hasPage) return HOME

  return {
    title: `${person.name} — ${person.role} | FlexAI`,
    description: `${person.name}, FlexAI ${person.role.toLowerCase()}. ${person.headline}.`,
    path: `/ekip/${person.slug}`,
    image: `${SITE}/ekip/${person.photo}.jpg`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: person.name,
      jobTitle: person.role,
      description: person.headline,
      image: `${SITE}/ekip/${person.photo}.jpg`,
      url: `${SITE}/ekip/${person.slug}`,
      knowsLanguage: (person.languages || []).map((language) => language.name),
      // Yetkinlikler iki bicimde tutulabiliyor: duz liste ya da kategorili.
      knowsAbout: person.skills
        ? person.skills.items
        : person.skillGroups
          ? person.skillGroups.flatMap((group) => group.items)
          : undefined,
      sameAs: person.links ? person.links.map((link) => link.url) : undefined,
      worksFor: { '@type': 'Organization', name: COMPANY.name, url: SITE },
    },
  }
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/**
 * Etiketleri HTML dizesine çevirir (yalnızca build sırasında kullanılır).
 * @param {ReturnType<typeof buildHead>} head
 * @returns {string}
 */
export function renderHeadTags(head) {
  const url = `${SITE}${head.path === '/' ? '/' : head.path}`
  const title = escapeAttribute(head.title)
  const description = escapeAttribute(head.description)
  const image = escapeAttribute(head.image)

  const tags = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ]

  if (head.jsonLd) {
    // `</script>` kaçışı: JSON içinde geçerse script etiketi erken kapanır.
    const json = JSON.stringify(head.jsonLd).replace(/</g, '\\u003c')
    tags.push(`<script type="application/ld+json">${json}</script>`)
  }

  return tags.join('\n    ')
}
