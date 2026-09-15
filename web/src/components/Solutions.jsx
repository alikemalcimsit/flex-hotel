import Icon from './Icon.jsx'
import SolutionCard from './SolutionCard.jsx'
import { SOLUTIONS } from '../data/content.js'
import { VERTICALS } from '../data/verticals.js'

/**
 * Sektör çözümleri — şablonun "Projects" bölümü.
 *
 * Şablonda dört proje kartı vardı; sekiz sektör aynı iki sütunlu ızgarada,
 * aynı kartla dört satıra yayılıyor. Alttaki tam genişlik hap şablonda
 * "More projects on GitHub" idi; burada listede olmayan sektör için görüşme.
 */
export default function Solutions() {
  return (
    <section id="cozumler" className="section-shell">
      <div className="section-inner">
        <p className="section-label shiny-sec">{SOLUTIONS.label}</p>
        <h2 className="section-heading mb-4">{SOLUTIONS.title}</h2>
        <p className="mb-8 max-w-2xl text-ink-muted">{SOLUTIONS.description}</p>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {VERTICALS.map((vertical) => (
            <SolutionCard key={vertical.slug} vertical={vertical} />
          ))}
        </div>

        <a href="/#iletisim" className="tpl-pill mt-9">
          <span className="text-base md:text-lg">{SOLUTIONS.more}</span>
          <Icon name="send" className="size-6" />
        </a>
      </div>
    </section>
  )
}
