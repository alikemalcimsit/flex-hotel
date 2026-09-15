import Icon from './Icon.jsx'
import VerticalWordmark from './VerticalWordmark.jsx'
import { withAlpha } from '../lib/color.js'

/**
 * Sektör kartının görsel alanı — şablonda burada projenin ekran görüntüsü
 * duruyordu.
 *
 * Kurulmamış sektörlerin ekran görüntüsü yok; gerçek ekran gibi duran sahte
 * bir görüntü de yanıltıcı olurdu. Onun yerine şablonun kendi parçalarından
 * bir önizleme kuruluyor: ince kenarlı panel, içinde açılır listedeki gibi
 * ikonlu satırlar. Sayı ya da uydurma veri yok; satırlar sektörün gerçek
 * yeteneklerinin kısaltılmışı. Yanlarındaki anahtar, modüllerin tek tek açılıp
 * kapanabildiğini anlatıyor.
 *
 * Katmanlar arkadan öne: ızgara zemin, sektör renginde köşe ışıması, panel.
 * Kimlik sektör renginden geliyor (ışıma, rozet, anahtarlar); satır ikonları
 * sitenin geri kalanı gibi kırmızı.
 *
 * Panel alttan taşıp kırpılıyor. Görsel alanın boyu değişince (mobil,
 * sıkışık kart) satırlar sığdığı kadar görünür, düzen bozulmaz.
 *
 * Tamamen dekoratif: kartta bu alanı saran bağlantı zaten ekran okuyucudan
 * gizli, aynı bilgi ayrıntı sayfasında düz metin olarak var.
 *
 * @param {{vertical: object, compact?: boolean}} props
 */
export default function SolutionPreview({ vertical, compact = false }) {
  const { color } = vertical

  return (
    <div className="relative h-full w-full overflow-hidden bg-card">
      <div className="tpl-grid absolute inset-0" />
      <div
        className="absolute inset-0 opacity-70 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          backgroundImage: `radial-gradient(80% 90% at 100% 0%, ${withAlpha(color, 0.3)}, transparent 70%)`,
        }}
      />

      <div
        className={`absolute inset-x-3 -bottom-6 rounded-2xl border border-line-soft bg-background/80 shadow-[0_24px_48px_-16px_rgba(0,0,0,0.9)] transition-transform duration-300 group-hover:-translate-y-1 lg:inset-x-9 ${
          compact ? 'top-5 md:top-7' : 'top-7 md:top-12'
        }`}
      >
        <div className="flex items-center gap-3 border-b border-line-soft px-3 py-3 lg:px-4">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-line-soft"
            style={{ color, backgroundColor: withAlpha(color, 0.12) }}
          >
            <Icon name={vertical.icon} className="size-5" />
          </span>
          <VerticalWordmark vertical={vertical} className="text-lg" />
          {/* Pencere başlığındaki üç nokta — panel olduğunu söyleyen tek süs. */}
          <span className="ml-auto flex gap-1.5">
            <span className="size-2 rounded-full bg-ink/10" />
            <span className="size-2 rounded-full bg-ink/10" />
            <span className="size-2 rounded-full bg-ink/10" />
          </span>
        </div>

        <ul className="space-y-2 p-2 lg:p-3">
          {vertical.highlights.map((item) => (
            <li
              key={item.label}
              className="flex items-center gap-2.5 rounded-xl border border-line-soft bg-card px-2.5 py-2.5 lg:gap-3 lg:px-3"
            >
              <Icon name={item.icon} className="size-5 shrink-0 text-sec" />
              <span className="truncate text-sm text-ink">{item.label}</span>
              {/* Tablette kartlar iki sütunda en dar hâlinde (~256 piksel);
                  anahtar orada etiketi kesiyordu, yalnızca o aralıkta gizli. */}
              <span
                className="ml-auto flex h-4 w-7 shrink-0 items-center justify-end rounded-full p-0.5 md:hidden lg:flex"
                style={{ backgroundColor: withAlpha(color, 0.3) }}
              >
                <span className="size-3 rounded-full" style={{ backgroundColor: color }} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
