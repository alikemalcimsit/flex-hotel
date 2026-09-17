import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import BrandIcon from '../components/BrandIcon.jsx'
import FunFacts from '../components/FunFacts.jsx'
import Icon from '../components/Icon.jsx'
import { TrackButton, TrackPlayer } from '../components/TrackCard.jsx'
import { COMPANY } from '../data/content.js'
import { findPerson } from '../data/people.js'
import { iconForLink } from '../lib/brand.js'

const PHOTO_SIZE = 640

function NotFound() {
  return (
    <section className="py-32 text-center text-ink">
      <div className="section-inner">
        <h1 className="section-heading">Sayfa bulunamadı</h1>
        <p className="text-ink-muted">Aradığınız ekip sayfası yayında değil.</p>
        <Link to="/#ekip" className="tpl-btn mt-8">
          Ekibe dön
        </Link>
      </div>
    </section>
  )
}

/** Zaman çizelgesi: süren maddelerin noktası dolu, geçmişlerinki içi boş. */
function Timeline({ items }) {
  return (
    <ol className="relative space-y-9 border-l border-line-soft pl-8">
      {items.map((item, index) => (
        <li key={`${item.title}-${index}`} className="relative">
          <span
            aria-hidden="true"
            className={`absolute -left-[2.3rem] top-1.5 h-3 w-3 rounded-full border-2 ${
              item.current ? 'border-sec bg-sec' : 'border-ink-muted bg-background'
            }`}
          />
          <p className="shiny-sec text-sm font-medium">{item.period}</p>
          <h3 className="mt-2 text-2xl font-semibold text-ink">{item.title}</h3>
          <p className="mt-1 text-ink-muted">{item.place}</p>
          <p className="mt-3 leading-relaxed text-ink-muted">{item.description}</p>

          {item.bullets ? (
            <ul className="mt-4 space-y-2.5">
              {item.bullets.map((bullet) => (
                <li key={bullet.slice(0, 32)} className="flex gap-3 leading-relaxed text-ink-muted">
                  <span aria-hidden="true" className="pl-1">
                    •
                  </span>
                  <span className="text-[0.95rem]">{bullet}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

/** Yetkinlik etiketi — şablonun kutusunun küçük hâli. */
function Tag({ children }) {
  return (
    <span className="rounded-xl border border-line-soft bg-panel px-3 py-1.5 text-sm text-ink">
      {children}
    </span>
  )
}

/**
 * Ekip üyesinin sayfası — şablonun diliyle.
 *
 * Açılış anasayfadaki "home" kurgusunun aynısı: küçük etiket, yan yana ad ve
 * başlık cümlesi, altında kare ikon düğmeleri (şablondaki GitHub/LinkedIn
 * düğmeleri). Deneyim, yetkinlik ve projeler şablonun bölüm kabuğunda.
 *
 * "Bu sayfayı şu şarkıyla oku" korunuyor: düğme açılışta, oynatıcı en altta.
 * Düğmeye basmak şarkıyı başlatır ve künyeyi açar.
 */
export default function PersonPage() {
  const { slug } = useParams()
  const person = findPerson(slug)
  const controllerRef = useRef(null)
  const [isPlayerReady, setIsPlayerReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isUnlocked, setIsUnlocked] = useState(false)

  function handleTrackToggle() {
    setIsUnlocked(true)
    const controller = controllerRef.current
    if (controller) controller.togglePlay()
  }

  if (!person || !person.hasPage) return <NotFound />

  return (
    <article>
      <section className="mt-12 text-ink md:mt-0">
        <div className="mx-auto max-w-5xl space-y-8 pb-14 md:py-36">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link
              to="/#ekip"
              className="inline-flex items-center gap-2 text-base text-ink-muted transition duration-300 ease-in-out hover:text-white md:text-lg"
            >
              <Icon name="arrowRight" className="h-5 w-5 rotate-180" />
              Ekip · {person.role}
            </Link>

            {/* Yüksekliği baştan ayrılır ki düğme belirince satır zıplamasın. */}
            <div className="flex min-h-12 items-center">
              {isPlayerReady ? (
                <TrackButton
                  onToggle={handleTrackToggle}
                  isOpened={isUnlocked}
                  isPlaying={isPlaying}
                />
              ) : null}
            </div>
          </div>

          <div className="grid gap-8 md:grid-cols-[14rem_1fr] md:items-center">
            <div className="overflow-hidden rounded-2xl shadow-lg">
              <picture>
                <source srcSet={`/ekip/${person.photo}.webp`} type="image/webp" />
                <img
                  src={`/ekip/${person.photo}.jpg`}
                  alt={`${person.name} portresi`}
                  width={PHOTO_SIZE}
                  height={PHOTO_SIZE}
                  decoding="async"
                  className="aspect-square w-full object-cover"
                />
              </picture>
            </div>

            <div className="space-y-4">
              <h1 className="text-pretty text-5xl font-medium leading-none md:text-6xl">
                {person.name}
              </h1>
              <p className="text-base text-ink-muted md:text-2xl">{person.headline}</p>
            </div>
          </div>

          <p className="max-w-3xl leading-relaxed text-ink-muted md:text-lg">{person.summary}</p>

          {person.links || person.languages ? (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {person.links?.map((link) => {
                const icon = iconForLink(link)
                return (
                  <a
                    key={link.label}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={link.label}
                    title={link.label}
                    className="tpl-icon-btn"
                  >
                    {icon === 'link' ? (
                      <span className="flex items-center gap-2 px-1 text-base">
                        <Icon name="link" className="size-6" />
                        {link.label}
                      </span>
                    ) : (
                      <BrandIcon name={icon} className="size-8" />
                    )}
                  </a>
                )
              })}

              {person.languages ? (
                <dl className="flex flex-wrap gap-2">
                  {person.languages.map((language) => (
                    <div
                      key={language.name}
                      className="flex items-baseline gap-2 rounded-xl border border-line-soft bg-panel px-4 py-4"
                    >
                      <dt className="text-sm text-ink-muted">{language.name}</dt>
                      <dd className="text-sm font-semibold text-sec">{language.level}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          ) : null}

          {/* Şarkı çalınca açılan künye — CV'nin anlatmadığı taraf. */}
          {person.funFacts && isUnlocked ? (
            <div className="animate-unlock md:max-w-md">
              <FunFacts title={person.funFacts.title} items={person.funFacts.items} />
            </div>
          ) : null}
        </div>
      </section>

      <section className="section-shell">
        <div className="section-inner">
          <p className="section-label shiny-sec">Yol haritası</p>
          <h2 className="section-heading">Deneyim</h2>
          <Timeline items={person.timeline} />
        </div>
      </section>

      <section className="section-shell">
        <div className="section-inner">
          <p className="section-label shiny-sec">Yetkinlik</p>
          <h2 className="section-heading">{person.skills?.title ?? 'Teknik yetkinlik'}</h2>

          {person.skillGroups ? (
            <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {person.skillGroups.map((group) => (
                <div key={group.title} className="tpl-box p-5">
                  <dt className="text-sm text-ink-muted">{group.title}</dt>
                  <dd className="mt-3 flex flex-wrap gap-2">
                    {group.items.map((item) => (
                      <Tag key={item}>{item}</Tag>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {person.skills ? (
            <div className="tpl-box p-5">
              <ul className="flex flex-wrap gap-2">
                {person.skills.items.map((skill) => (
                  <li key={skill}>
                    <Tag>{skill}</Tag>
                  </li>
                ))}
              </ul>
              {person.skills.note ? (
                <p className="mt-4 text-sm leading-relaxed text-ink-muted">{person.skills.note}</p>
              ) : null}
            </div>
          ) : null}

          {person.closing ? (
            <blockquote className="tpl-box mt-8 p-6">
              <p className="text-xl leading-relaxed text-ink">{person.closing}</p>
            </blockquote>
          ) : null}

          <a href={`mailto:${COMPANY.email}`} className="tpl-pill mt-9">
            <span className="text-base md:text-lg">İletişime geç</span>
            <Icon name="mail" className="size-6" />
          </a>
        </div>
      </section>

      {person.projects ? (
        <section className="section-shell">
          <div className="section-inner">
            <p className="section-label shiny-sec">Projeler</p>
            <h2 className="section-heading">Öne çıkan çalışmalar</h2>

            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {person.projects.map((project) => (
                <li key={project.title} className="tpl-box p-6">
                  <h3 className="text-2xl font-semibold text-ink">{project.title}</h3>
                  <p className="mt-1 text-sm text-ink-muted">{project.subtitle}</p>
                  <p className="mt-4 text-xs leading-relaxed text-ink-muted">{project.stack}</p>
                  <p className="mt-4 leading-relaxed text-ink-muted">{project.description}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {/* Şarkı en altta. Sayfa açılışında kurulur ki düğmeye basıldığında
          bekleme olmasın. */}
      <TrackPlayer
        onController={(controller) => {
          controllerRef.current = controller
          setIsPlayerReady(true)
        }}
        onPlayingChange={setIsPlaying}
      />
    </article>
  )
}
