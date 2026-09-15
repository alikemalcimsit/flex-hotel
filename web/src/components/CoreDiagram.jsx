import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from './Icon.jsx'
import Logo from './Logo.jsx'
import VerticalWordmark from './VerticalWordmark.jsx'
import { ABOUT } from '../data/content.js'
import { VERTICALS } from '../data/verticals.js'
import { withAlpha } from '../lib/color.js'
import { planCoreDiagram, scalePath } from '../lib/coreDiagram.js'

const LAYOUT = planCoreDiagram(VERTICALS.length)

/** Işığın bir sektörden ötekine geçme aralığı (saniye). */
const SLOT_SECONDS = 0.9
/** Bir turun süresi: ışık her sektöre bir kez uğrayıp başa dönüyor. */
const CYCLE_SECONDS = SLOT_SECONDS * VERTICALS.length

function timingFor(index) {
  return {
    animationDuration: `${CYCLE_SECONDS}s`,
    animationDelay: `${LAYOUT[index].slot * SLOT_SECONDS}s`,
  }
}

/**
 * Kapsayıcının piksel boyu. Çizgiler bu ölçüyle çiziliyor (bkz.
 * coreDiagram.js, "NEDEN PİKSEL"). İlk çizimde — prerender dahil — ölçü yok;
 * kutular yerinde duruyor, çizgiler tarayıcıda bir kare sonra beliriyor.
 */
function useBoxSize(ref) {
  const [size, setSize] = useState(null)

  useEffect(() => {
    const box = ref.current
    if (!box) return undefined

    const measure = () => {
      const rect = box.getBoundingClientRect()
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      setSize((previous) =>
        previous?.width === width && previous?.height === height ? previous : { width, height }
      )
    }
    measure()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [ref])

  return size
}

/**
 * Çizgiler. Geniş ve dar düzen için iki ayrı SVG var, ekrana göre biri
 * görünüyor; ikisi de dekoratif olduğu için tekrar ekran okuyucuya yansımıyor.
 *
 * Her sektörde iki çizgi üst üste: sabit ince hat ve üstünden akan ışık.
 * `pathLength="100"` ışığın boyunu hattın uzunluğuna oranlıyor; ışık her
 * hatta turun aynı anında yola çıkıp aynı anda varıyor.
 */
function Lines({ variant, size, activeIndex, className }) {
  if (!size) return null

  return (
    <svg
      viewBox={`0 0 ${size.width} ${size.height}`}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    >
      {VERTICALS.map((vertical, index) => {
        const path = scalePath(LAYOUT[index][variant].segments, size.width, size.height)
        return (
          <g key={vertical.slug}>
            <path
              d={path}
              fill="none"
              strokeWidth="1"
              className="stroke-ink/15 transition-[stroke] duration-300"
              style={activeIndex === index ? { stroke: vertical.color } : undefined}
            />
            <path
              d={path}
              pathLength="100"
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              stroke={vertical.color}
              className="diagram-pulse"
              style={timingFor(index)}
            />
          </g>
        )
      })}
    </svg>
  )
}

/**
 * Hakkımızda şeması — ortak çekirdek ve ona bağlı sektörler.
 *
 * "Aynı çekirdeği her sektöre yeniden kuruyoruz" cümlesinin görseli. Ortada
 * çekirdeğin dört katmanı (Ne yapıyoruz? bölümündeki dört hizmetin ikonlarıyla),
 * iki yanda sektörler. Işık çekirdekten sırayla her sektöre akıyor; vardığında
 * sektör kutusu kendi renginde parlıyor.
 *
 * Sektör kutuları gerçek bağlantı: ayrıntı sayfasına götürüyor. Üzerine
 * gelince ya da klavyeyle odaklanınca o sektörün hattı yanıyor.
 *
 * Hareket azaltma tercihinde ışıklar ve parlamalar hiç başlamıyor; şema
 * durağan hâliyle eksiksiz okunuyor (bkz. index.css).
 */
export default function CoreDiagram() {
  const [activeIndex, setActiveIndex] = useState(null)
  const boxRef = useRef(null)
  const size = useBoxSize(boxRef)
  const { diagram } = ABOUT

  return (
    <figure className="mt-10">
      <div ref={boxRef} className="relative h-[620px] lg:h-[440px]">
        <Lines variant="narrow" size={size} activeIndex={activeIndex} className="lg:hidden" />
        <Lines variant="wide" size={size} activeIndex={activeIndex} className="hidden lg:block" />

        <div className="absolute left-1/2 top-4 w-[260px] -translate-x-1/2 lg:top-1/2 lg:w-[280px] lg:-translate-y-1/2">
          <div aria-hidden="true" className="diagram-core-glow pointer-events-none absolute -inset-10" />
          <div className="relative rounded-2xl border border-sec/30 bg-background p-4 shadow-[0_24px_48px_-16px_rgba(0,0,0,0.9)]">
            <div className="flex items-baseline justify-between gap-3">
              <Logo className="text-2xl" />
              <span className="text-xs text-ink-muted">{diagram.core}</span>
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-2">
              {diagram.layers.map((layer) => (
                <li
                  key={layer.label}
                  className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-line-soft bg-card px-2.5 py-2 text-xs text-ink"
                >
                  <Icon name={layer.icon} className="size-4 shrink-0 text-sec" />
                  {layer.label}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {VERTICALS.map((vertical, index) => {
          const { narrow, wide } = LAYOUT[index]
          const isActive = activeIndex === index
          return (
            <Link
              key={vertical.slug}
              to={`/cozumler/${vertical.slug}`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex(null)}
              // Dar ekranda iki sütun yan yana; kutu yarım genişliği aşarsa
              // karşı sütuna biniyordu (360 piksellik telefonda ölçüldü).
              className="diagram-node absolute left-[var(--narrow-x)] top-[var(--narrow-y)] flex w-[min(150px,calc(50%_-_8px))] -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-xl border border-line-soft bg-background px-2.5 py-2 transition-colors duration-300 lg:left-[var(--wide-x)] lg:top-[var(--wide-y)] lg:w-[196px] lg:gap-3 lg:px-3 lg:py-2.5"
              style={{
                '--narrow-x': `${narrow.x}%`,
                '--narrow-y': `${narrow.y}%`,
                '--wide-x': `${wide.x}%`,
                '--wide-y': `${wide.y}%`,
                '--node-color': vertical.color,
                ...timingFor(index),
                ...(isActive ? { borderColor: vertical.color } : null),
              }}
            >
              {/* En dar telefonda rozete yer yok; ad kesilmesin diye gizleniyor. */}
              <span
                className="hidden size-7 shrink-0 place-items-center rounded-lg border border-line-soft min-[380px]:grid lg:size-8"
                style={{ color: vertical.color, backgroundColor: withAlpha(vertical.color, 0.12) }}
              >
                <Icon name={vertical.icon} className="size-4 lg:size-5" />
              </span>
              <span className="min-w-0">
                <VerticalWordmark vertical={vertical} className="text-sm lg:text-base" />
                <span className="mt-1 block truncate text-xs text-ink-muted">{vertical.industry}</span>
              </span>
            </Link>
          )
        })}
      </div>

      <figcaption className="mx-auto mt-6 max-w-2xl text-center text-sm leading-relaxed text-ink-muted">
        {diagram.caption}
      </figcaption>
    </figure>
  )
}
