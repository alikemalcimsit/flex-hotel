import { Link, useParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import SolutionCard from '../components/SolutionCard.jsx'
import VerticalWordmark from '../components/VerticalWordmark.jsx'
import { COMPANY, MODULES } from '../data/content.js'
import { findVertical, VERTICALS } from '../data/verticals.js'

function NotFound() {
  return (
    <section className="py-32 text-center text-ink">
      <div className="section-inner">
        <h1 className="section-heading">Sayfa bulunamadı</h1>
        <p className="text-ink-muted">Aradığınız çözüm sayfası yayında değil.</p>
        <Link to="/#cozumler" className="tpl-btn mt-8">
          Çözümlere dön
        </Link>
      </div>
    </section>
  )
}

/**
 * Bir sektör çözümünün ayrıntı sayfası — şablonun diliyle.
 *
 * Açılış anasayfadaki "home" kurgusu: üstte küçük etiket, yan yana marka
 * kilidi ve cümle, altında düğmeler. Alt bölümler şablonun bölüm kabuğu;
 * yetenekler ve modüller şablonun kutusu, diğer sektörler proje kartı.
 *
 * İçerik `verticals.js`'ten geliyor; sayfa tek bir kalıp. Yeni bir sektör
 * eklemek için yalnızca veri eklenir — burada değişiklik gerekmez.
 */
export default function VerticalPage() {
  const { slug } = useParams()
  const vertical = findVertical(slug)

  if (!vertical) return <NotFound />

  const others = VERTICALS.filter((entry) => entry.slug !== vertical.slug)

  return (
    <article>
      <section className="mt-12 text-ink md:mt-0">
        <div className="mx-auto max-w-5xl space-y-8 pb-14 md:py-36">
          <div className="space-y-4 text-left">
            <Link
              to="/#cozumler"
              className="inline-flex items-center gap-2 text-base text-ink-muted transition duration-300 ease-in-out hover:text-white md:text-lg"
            >
              <Icon name="arrowRight" className="h-5 w-5 rotate-180" />
              Çözümler · {vertical.industry}
            </Link>

            <div className="flex flex-col space-y-4 md:gap-4 lg:flex-row lg:items-center lg:space-x-8 lg:space-y-0">
              {/* Sayfanın h1'i marka kilidinin kendisi: ekran okuyucu da aynı
                  metni okur, çünkü kilit düz yazıdan oluşuyor. */}
              <h1 className="text-5xl font-medium leading-none md:text-6xl lg:shrink-0">
                <VerticalWordmark vertical={vertical} />
              </h1>
              <p className="text-base text-ink-muted md:text-2xl">{vertical.tagline}</p>
            </div>

            <p className="max-w-3xl pt-2 leading-relaxed text-ink-muted md:text-lg">
              {vertical.summary}
            </p>

            <div className="flex flex-wrap justify-start gap-2 pt-3 md:pt-6">
              <a href="/#iletisim" className="tpl-btn text-lg">
                Projenizi konuşalım
                <Icon name="arrowRight" className="h-5 w-5" />
              </a>
              {vertical.hasPanel ? (
                <a href={COMPANY.panelUrl} aria-label="Panele giriş" className="tpl-icon-btn">
                  <Icon name="key" className="size-8" />
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="section-shell">
        <div className="section-inner">
          <p className="section-label shiny-sec">Neler var</p>
          <h2 className="section-heading">Yetenekler</h2>

          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {vertical.capabilities.map((capability) => (
              <li key={capability} className="tpl-box flex items-start gap-3 p-4">
                <Icon name="check" className="mt-0.5 h-6 w-6 shrink-0 text-sec" />
                <span className="leading-relaxed text-ink">{capability}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Modül listesi yalnızca kurulmuş sistemde var; ötekiler için böyle bir
          liste yazmak olmayan bir şeyi varmış gibi göstermek olurdu. */}
      {vertical.hasPanel ? (
        <section className="section-shell">
          <div className="section-inner">
            <p className="section-label shiny-sec">Sistem</p>
            <h2 className="section-heading">Modüller</h2>

            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {MODULES.map((module) => (
                <li key={module.title} className="tpl-box p-5">
                  <h3 className="flex items-center gap-3 text-lg text-ink">
                    <Icon name={module.icon} className="h-6 w-6 shrink-0 text-sec" />
                    {module.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">{module.description}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <section className="section-shell">
        <div className="section-inner">
          <p className="section-label shiny-sec">Diğer çözümler</p>
          <h2 className="section-heading">Diğer sektörler</h2>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            {others.map((entry) => (
              <SolutionCard key={entry.slug} vertical={entry} compact />
            ))}
          </div>
        </div>
      </section>
    </article>
  )
}
