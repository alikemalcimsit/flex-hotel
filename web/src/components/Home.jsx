import CapabilityWall from './CapabilityWall.jsx'
import Icon from './Icon.jsx'
import LetterGlitch from './LetterGlitch.jsx'
import Logo from './Logo.jsx'
import ServicesAccordion from './ServicesAccordion.jsx'
import { COMPANY, HERO } from '../data/content.js'

/**
 * Harf yağmurunun renkleri: koyu, orta ve parlak kırmızı. Kanvas Tailwind
 * sınıfı okuyamadığı için değerler burada. Modül düzeyinde sabit olmalı —
 * her çizimde yeni dizi verilirse efekt baştan kurulur.
 */
const GLITCH_COLORS = ['#2a1213', '#7f1d1d', '#ef4444']

/**
 * Anasayfanın açılışı — şablonun "home" bölümü.
 *
 * Şablonun kişisel tanıtımı ("Hi, I'm Your Name / Software Developer")
 * FlexAI'ın tanıtımına döndü. Sosyal medya düğmeleri yerine e-posta ve panel
 * girişi var; şirketin gerçek karşılığı olan bağlantılar bunlar.
 *
 * Harf yağmuru şablondaki gibi tek başına duruyor.
 */
export default function Home() {
  const { lead, accent, tail } = HERO.tagline

  return (
    <section id="anasayfa" className="mt-12 text-ink md:mt-0">
      <div className="mx-auto max-w-5xl space-y-8 pb-14 md:py-36">
        <div className="space-y-4 text-left">
          <p className="flex items-center gap-3 text-base text-ink-muted md:text-lg">
            <Logo className="text-xl md:text-2xl" />
            <span aria-hidden="true">·</span>
            <span>{HERO.intro}</span>
          </p>

          <div className="flex flex-col space-y-4 md:gap-4 lg:flex-row lg:items-center lg:space-x-8 lg:space-y-0">
            <h1 className="text-pretty text-4xl font-medium leading-none sm:text-5xl md:text-6xl lg:shrink-0">
              {HERO.title.map((line, index) => (
                <span key={line}>
                  {index > 0 ? <br /> : null}
                  {line}
                </span>
              ))}
            </h1>
            <p className="text-base text-ink-muted md:text-2xl">
              {lead} <span className="shiny-sec">{accent}</span> {tail}
            </p>
          </div>

          <div className="flex flex-wrap justify-start gap-2 pt-3 md:pt-6">
            <a href={`mailto:${COMPANY.email}`} aria-label="E-posta gönder" className="tpl-icon-btn">
              <Icon name="mail" className="size-8" />
            </a>
            <a href={COMPANY.panelUrl} aria-label="Panele giriş" className="tpl-icon-btn">
              <Icon name="key" className="size-8" />
            </a>
            <a href={HERO.primaryCta.href} className="tpl-btn text-lg">
              {HERO.primaryCta.label}
              <Icon name="arrowRight" className="h-5 w-5" />
            </a>
          </div>
        </div>

        <CapabilityWall />

        <div className="flex flex-col items-center gap-8 lg:flex-row">
          <ServicesAccordion />

          {/* Geniş ekranda kutu listenin boyuna uzar. Şablonda liste kapalı
              başlıyordu, kutu sabit boyla ortalanıyordu; burada ilk hizmet
              açık başladığı için sabit boy üstte ve altta boşluk bırakıyordu. */}
          <div className="flex size-[290px] justify-center pt-3 md:h-[292px] md:w-full md:pt-9 lg:ml-16 lg:h-auto lg:self-stretch">
            <LetterGlitch colors={GLITCH_COLORS} outerVignette />
          </div>
        </div>
      </div>
    </section>
  )
}
