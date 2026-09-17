import { useState } from 'react'
import Icon from './Icon.jsx'
import { SERVICES, SERVICES_SECTION } from '../data/content.js'

/**
 * "Ne yapıyoruz?" — şablonun SkillsList açılır listesi.
 *
 * Şablondan farkları:
 * - Başlıklar `div` değil `button`: klavyeyle açılıyor, durumunu
 *   `aria-expanded` ile bildiriyor.
 * - Açılınca madde listesi değil hizmetin kendi açıklaması görünüyor.
 * - Öne çıkan hizmet açık başlıyor; sayfa ilk açıldığında liste boş kutu
 *   sırası gibi durmasın. Kapalı olanların metni de DOM'da, arama motoru
 *   hepsini okuyor.
 */
export default function ServicesAccordion() {
  const initial = SERVICES.find((service) => service.featured)?.title ?? null
  const [openTitle, setOpenTitle] = useState(initial)

  return (
    <div id="hizmetler" className="w-full pt-3 text-left md:w-auto md:pt-9">
      <h2 className="text-3xl font-semibold text-ink md:mb-6 md:text-4xl">
        {SERVICES_SECTION.title}
      </h2>

      <ul className="mt-4 space-y-4 text-lg">
        {SERVICES.map((service, index) => {
          const isOpen = openTitle === service.title
          const panelId = `hizmet-${index}`

          return (
            <li key={service.title} className="w-full">
              <div className="tpl-box w-full overflow-hidden text-left transition-all md:w-[400px]">
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpenTitle(isOpen ? null : service.title)}
                    className="flex w-full items-center gap-3 p-4 text-left"
                  >
                    <Icon name={service.icon} className="h-6 w-6 shrink-0 text-sec" />
                    <span className="flex min-w-0 flex-grow items-center justify-between gap-2">
                      <span className="block truncate text-lg text-ink">{service.title}</span>
                      <Icon
                        name="chevronDown"
                        className={`h-6 w-6 shrink-0 text-ink transition-transform ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </span>
                  </button>
                </h3>

                <div
                  id={panelId}
                  aria-hidden={!isOpen}
                  className={`px-4 transition-all duration-300 ${
                    isOpen ? 'max-h-[500px] pb-4 opacity-100' : 'max-h-0 opacity-0'
                  }`}
                >
                  <p className="text-sm leading-relaxed text-ink-muted">{service.description}</p>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
