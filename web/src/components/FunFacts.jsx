import Icon from './Icon.jsx'

/**
 * "Künye" — kişinin resmî olmayan tarafı.
 *
 * CV bir insanın ne yaptığını anlatır, kiminle çalışacağını anlatmaz.
 * Bu blok o boşluğu dolduruyor: kahve tercihi, çalışma saati, vazgeçilmez
 * araç gibi küçük ama insanı görünür kılan ayrıntılar.
 *
 * Veri yoksa hiç basılmaz (PersonPage koşullu çağırıyor) — uydurma bir
 * "eğlenceli gerçek" koymaktansa bölümü hiç açmamak daha iyi.
 *
 * Görünüm şablonun yarı saydam kutusu ve açılır listesindeki ikon + metin
 * satırı.
 */
export default function FunFacts({ title, items }) {
  return (
    <div className="tpl-box p-5">
      <p className="shiny-sec text-lg">{title}</p>

      <dl className="mt-4 space-y-4">
        {items.map((item) => (
          <div key={item.label} className="flex items-start gap-3">
            <Icon name={item.icon} className="mt-0.5 h-6 w-6 shrink-0 text-sec" />
            <div className="min-w-0">
              <dt className="text-sm text-ink-muted">{item.label}</dt>
              <dd className="mt-0.5 leading-relaxed text-ink">{item.value}</dd>
            </div>
          </div>
        ))}
      </dl>
    </div>
  )
}
