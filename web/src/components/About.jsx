import CoreDiagram from './CoreDiagram.jsx'
import Icon from './Icon.jsx'
import { ABOUT } from '../data/content.js'

/**
 * Hakkımızda — şablonda karşılığı yok, şablonun diliyle üretildi.
 *
 * Bölüm kabuğu ve başlık "Projects" ile aynı; metin sütunları "Contact"
 * bölümünün iki sütunlu ızgarası; metnin altında çekirdek–sektör şeması
 * (bkz. CoreDiagram); rakamlar ve ilkeler şablonun yarı saydam kutusu.
 */
export default function About() {
  // İki sütuna eşit dağıtılıyor; başlık tek başına bir sütuna konursa karşı
  // sütun uzun kalıp altında boşluk bırakıyordu.
  const midpoint = Math.ceil(ABOUT.paragraphs.length / 2)
  const columns = [ABOUT.paragraphs.slice(0, midpoint), ABOUT.paragraphs.slice(midpoint)]

  return (
    <section id="hakkimizda" className="section-shell">
      <div className="section-inner">
        <p className="section-label shiny-sec">{ABOUT.eyebrow}</p>
        <h2 className="section-heading">{ABOUT.title}</h2>

        <div className="grid grid-cols-1 gap-8 text-ink-muted md:grid-cols-2">
          {columns.map((paragraphs, columnIndex) => (
            <div key={columnIndex} className="space-y-4">
              {paragraphs.map((paragraph) => (
                <p key={paragraph.slice(0, 24)} className="leading-relaxed">
                  {paragraph}
                </p>
              ))}
            </div>
          ))}
        </div>

        <CoreDiagram />

        {/* Rakamlar depodan ölçüldü; pazarlama sayısı değil. */}
        <p className="mb-4 mt-12 text-sm text-ink-muted">{ABOUT.statsNote}</p>
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {ABOUT.stats.map((stat) => (
            <div key={stat.label} className="tpl-box flex flex-col-reverse p-5">
              <dt className="mt-2 text-sm text-ink-muted">{stat.label}</dt>
              <dd className="text-4xl font-medium tabular-nums text-ink md:text-5xl">{stat.value}</dd>
            </div>
          ))}
        </dl>

        <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          {ABOUT.principles.map((principle) => (
            <li key={principle.title} className="tpl-box p-5">
              <h3 className="flex items-center gap-3 text-lg text-ink">
                <Icon name={principle.icon} className="h-6 w-6 shrink-0 text-sec" />
                {principle.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{principle.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
