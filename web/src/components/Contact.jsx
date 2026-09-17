import { useState } from 'react'
import { COMPANY, CONTACT } from '../data/content.js'
import { buildContactMailto } from '../lib/contactMail.js'

/**
 * İletişim — şablonun "Contact" bölümü: solda metin ve künye, sağda form.
 *
 * Şablonun formu Formspree'ye gönderiyordu. Sitenin arka ucu yok; burada
 * form ziyaretçinin e-posta uygulamasında dolu bir taslak açıyor. Düğme de
 * notu da bunu açıkça söylüyor, "gönderildi" diye yanıltmıyor.
 *
 * Şablonda alanların yalnızca yer tutucu metni vardı; ekran okuyucu için
 * görünmez etiketler eklendi.
 */
export default function Contact() {
  const [isDraftOpened, setIsDraftOpened] = useState(false)
  const { form } = CONTACT

  function handleSubmit(event) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    window.location.href = buildContactMailto(
      {
        name: data.get('name')?.toString(),
        company: data.get('company')?.toString(),
        message: data.get('message')?.toString(),
      },
      COMPANY.email
    )
    setIsDraftOpened(true)
  }

  return (
    <section id="iletisim" className="section-shell">
      <div className="section-inner">
        <p className="section-label shiny-sec">{CONTACT.eyebrow}</p>
        <h2 className="section-heading mb-6">{CONTACT.title}</h2>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="text-ink-muted">
            <p className="mb-4 leading-relaxed">{CONTACT.description}</p>
            <div className="flex items-center gap-2">
              <span>Konum:</span>
              <span className="text-ink">{COMPANY.location}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span>E-posta:</span>
              <a
                href={`mailto:${COMPANY.email}`}
                className="text-ink transition duration-300 ease-in-out hover:text-white"
              >
                {COMPANY.email}
              </a>
            </div>
          </div>

          <div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <label htmlFor="iletisim-ad" className="sr-only">
                {form.name}
              </label>
              <input
                id="iletisim-ad"
                type="text"
                name="name"
                autoComplete="name"
                placeholder={form.name}
                required
                className="tpl-input"
              />

              <label htmlFor="iletisim-isletme" className="sr-only">
                {form.company}
              </label>
              <input
                id="iletisim-isletme"
                type="text"
                name="company"
                autoComplete="organization"
                placeholder={form.company}
                className="tpl-input"
              />

              <label htmlFor="iletisim-mesaj" className="sr-only">
                {form.message}
              </label>
              <textarea
                id="iletisim-mesaj"
                name="message"
                placeholder={form.message}
                rows={6}
                required
                className="tpl-input resize-none"
              />

              <button
                type="submit"
                className="rounded-lg border border-line-soft bg-line-soft px-4 py-2 text-ink opacity-60 transition-opacity hover:opacity-100"
              >
                {form.submit}
              </button>
            </form>

            <p role="status" className="mt-4 text-sm text-ink-muted">
              {isDraftOpened
                ? `Taslak e-posta uygulamanızda açıldı. Açılmadıysa doğrudan ${COMPANY.email} adresine yazabilirsiniz.`
                : form.note}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
