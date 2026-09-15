import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Icon from './Icon.jsx'
import { NAV_LINKS } from '../data/content.js'

/** Bu kadar kaydırıldığında hap en dar hâline iner. */
const MAX_SCROLL = 1000
/** Daralırken bağlantıların iki yanında bırakılan pay (px). */
const SIDE_ROOM = 96
const DESKTOP_QUERY = '(min-width: 768px)'

/**
 * Alt sayfalarda da gezinmenin "neredeyim" bilgisi kaybolmasın: sektör
 * sayfası Çözümler'i, ekip sayfası Ekip'i işaretler.
 */
function activeFromPath(pathname) {
  if (pathname.startsWith('/cozumler/')) return 'cozumler'
  if (pathname.startsWith('/ekip/')) return 'ekip'
  return null
}

/**
 * Yüzen gezinme — DarkMinimal şablonunun nav bileşeni.
 *
 * Masaüstünde sayfanın üstünde ortalanmış bir şerit; kaydırıldıkça hapa
 * dönüşüp içeriğine kadar daralır. Mobilde ekranın altına yapışır ve her
 * bağlantı ikonuyla görünür. Anasayfada ekranın ortasından geçen bölüm
 * kırmızı noktayla işaretlenir.
 *
 * Şablondaki en dar genişlik sabit 528 pikseldi; Türkçe etiketler oraya
 * sığmadığı için genişlik bağlantıların gerçek boyundan hesaplanıyor.
 */
export default function Nav() {
  const navRef = useRef(null)
  const listRef = useRef(null)
  const { pathname } = useLocation()
  const isHome = pathname === '/'
  const [isScrolled, setIsScrolled] = useState(false)
  const [sectionId, setSectionId] = useState(null)

  const activeId = isHome ? sectionId : activeFromPath(pathname)

  useEffect(() => {
    const nav = navRef.current
    const list = listRef.current
    if (!nav || !list) return undefined

    const desktop = window.matchMedia(DESKTOP_QUERY)
    let frame = 0

    function update() {
      frame = 0
      const y = window.scrollY
      setIsScrolled(y > 0)

      if (!desktop.matches) {
        nav.style.removeProperty('width')
        return
      }

      const maxWidth = window.innerWidth * 0.8
      const minWidth = Math.min(maxWidth, list.offsetWidth + SIDE_ROOM)
      const progress = Math.min(y / MAX_SCROLL, 1)
      const eased = 1 - Math.pow(1 - progress, 4)
      nav.style.width = `${maxWidth - (maxWidth - minWidth) * eased}px`
    }

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [])

  useEffect(() => {
    if (!isHome || typeof IntersectionObserver === 'undefined') return undefined

    const sections = NAV_LINKS.map((link) => document.getElementById(link.id)).filter(Boolean)
    if (sections.length === 0) return undefined

    // Bölüm, ekranın ortasındaki ince banttan geçerken etkin sayılır. Şablon
    // bölümün %60'ının görünmesini bekliyordu; ekrandan uzun bölümlerde bu
    // eşik hiç sağlanmıyor ve işaret takılı kalıyordu.
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setSectionId(entry.target.id)
        })
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: 0 }
    )

    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [isHome])

  const shellClass = isScrolled
    ? 'md:rounded-full md:border-line md:bg-background/70'
    : 'md:rounded-none md:border-transparent md:bg-background'

  return (
    <nav
      ref={navRef}
      aria-label="Ana menü"
      className={`fixed bottom-0 left-1/2 z-[100] w-full -translate-x-1/2 rounded-t-2xl border border-line bg-background/90 backdrop-blur-xl transition-all duration-500 ease-in-out md:bottom-auto md:top-6 md:w-[80%] ${shellClass}`}
    >
      <div className="mx-auto flex items-center justify-center p-3">
        <ul
          ref={listRef}
          className="flex w-full justify-between gap-2 md:w-auto md:justify-center md:gap-12"
        >
          {NAV_LINKS.map((link) => {
            const isActive = link.id === activeId
            return (
              <li key={link.id} className="flex-1 md:flex-none">
                <a
                  href={link.href}
                  aria-current={isActive ? 'location' : undefined}
                  className={`group relative flex flex-col items-center gap-1 text-xs transition-colors md:text-base ${
                    isActive ? 'text-white' : 'text-ink-muted hover:text-white'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute -left-6 top-1/2 hidden h-2 w-2 -translate-y-1/2 rounded-full bg-sec transition-all duration-300 md:block ${
                      isActive ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
                    }`}
                  />
                  <span className="flex h-6 w-6 items-center justify-center md:hidden">
                    <Icon name={link.icon} className="h-5 w-5" />
                  </span>
                  <span className="whitespace-nowrap">{link.label}</span>
                </a>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
