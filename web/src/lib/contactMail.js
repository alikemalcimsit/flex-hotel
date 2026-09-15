/**
 * İletişim formundan `mailto:` adresi üretir.
 *
 * Sitenin arka ucu yok. Şablonun formu Formspree'ye gönderiyordu; burada
 * aynı form ziyaretçinin kendi e-posta uygulamasını dolu bir taslakla açar.
 * Böylece "gönderildi" deyip aslında hiçbir yere gitmeyen bir form olmaz.
 *
 * @param {{name?: string, company?: string, message?: string}} fields
 * @param {string} to
 * @returns {string}
 */
export function buildContactMailto(fields, to) {
  const name = (fields?.name ?? '').trim()
  const company = (fields?.company ?? '').trim()
  const message = (fields?.message ?? '').trim()

  const subject = company ? `FlexAI proje görüşmesi — ${company}` : 'FlexAI proje görüşmesi'
  const signature = [name, company].filter(Boolean).join(' · ')
  const body = signature ? `${message}\n\n${signature}` : message

  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
