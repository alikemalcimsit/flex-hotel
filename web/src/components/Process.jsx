import { PROCESS } from '../data/content.js'

/**
 * Süreç — şablonda karşılığı yok, şablonun diliyle üretildi.
 *
 * Dört adım, proje ızgarasıyla aynı iki sütunda, şablonun yarı saydam
 * kutusunda. Adım numarası bölüm etiketinin parıltılı vurgusunu taşıyor;
 * sıra bu bölümün asıl bilgisi, numara onu gösteriyor.
 */
export default function Process() {
  return (
    <section id="surec" className="section-shell">
      <div className="section-inner">
        <p className="section-label shiny-sec">{PROCESS.eyebrow}</p>
        <h2 className="section-heading mb-4">{PROCESS.title}</h2>
        <p className="mb-8 max-w-2xl text-ink-muted">{PROCESS.description}</p>

        <ol className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {PROCESS.steps.map((step, index) => (
            <li key={step.title} className="tpl-box p-6">
              <span className="shiny-sec text-lg font-medium">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-2 text-2xl font-semibold text-ink">{step.title}</h3>
              <p className="mt-3 leading-relaxed text-ink-muted">{step.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
