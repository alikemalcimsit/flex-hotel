import Icon from './Icon.jsx'
import { MARQUEE_ITEMS } from '../data/content.js'

/**
 * Kayan yetenek şeridi — şablonun logo duvarı (logoWall).
 *
 * Şablonda teknoloji logoları kayıyordu; burada FlexAI'ın yetenekleri,
 * sitenin çizgi ikonlarıyla. Liste iki kez basılır ki %50'lik kaydırma
 * kesintisiz görünsün; ikinci kopya ekran okuyucudan gizlenir.
 */
export default function CapabilityWall() {
  const items = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS]

  return (
    <div className="relative overflow-x-hidden py-8">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-32 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-32 bg-gradient-to-l from-background to-transparent" />

      <ul className="flex w-max animate-scroll will-change-transform md:animate-scroll-fast">
        {items.map((item, index) => (
          <li
            key={`${item.label}-${index}`}
            aria-hidden={index >= MARQUEE_ITEMS.length ? 'true' : undefined}
            className="group flex items-center gap-2 pr-12 transition-all duration-300 md:pr-20"
          >
            <Icon
              name={item.icon}
              className="h-7 w-7 text-ink opacity-60 transition-transform group-hover:scale-110"
            />
            <span className="whitespace-nowrap text-lg font-medium text-ink-muted">{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
