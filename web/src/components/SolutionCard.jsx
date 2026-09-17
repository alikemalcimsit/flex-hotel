import { Link } from 'react-router-dom'
import Icon from './Icon.jsx'
import SolutionPreview from './SolutionPreview.jsx'
import { COMPANY } from '../data/content.js'

/**
 * Sektör kartı — şablonun proje kartı.
 *
 * Şablondaki ekran görüntüsünün yerinde sektörün önizlemesi duruyor (bkz.
 * SolutionPreview). Altında ad ve sektör, sağda iki kare
 * düğme: ayrıntı sayfası ve ikinci eylem. Kurulmuş sistemde ikinci eylem
 * panele giriş; diğerlerinde görüşme talebi.
 *
 * Görsel alan da ayrıntıya götürüyor ama klavye sırasına girmiyor — aynı
 * adrese üç ayrı durak olmasın diye.
 *
 * @param {{vertical: object, compact?: boolean}} props
 */
export default function SolutionCard({ vertical, compact = false }) {
  const detailHref = `/cozumler/${vertical.slug}`

  return (
    <article className="group">
      <Link to={detailHref} tabIndex={-1} aria-hidden="true" className="block">
        <div className="mb-4 overflow-hidden rounded-2xl shadow-lg transition-shadow duration-300 hover:shadow-xl">
          <div
            className={`w-full transition-transform duration-300 group-hover:scale-105 ${
              compact ? 'h-36 md:h-44' : 'h-48 md:h-72'
            }`}
          >
            <SolutionPreview vertical={vertical} compact={compact} />
          </div>
        </div>
      </Link>

      {/* Tablette iki sütunlu kart dar kalıyor; ad ile düğmeler sığmayınca
          üst üste binmek yerine düğmeler alt satıra iniyor. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-3">
        <div className="flex-grow">
          <h3 className="text-2xl font-semibold">
            <Link to={detailHref} className="transition-colors duration-300 hover:text-white">
              {vertical.name}
            </Link>
          </h3>
          <span className="py-1 text-sm text-ink-muted">{vertical.industry}</span>
        </div>

        <div className="ml-auto flex shrink-0 gap-2">
          {vertical.hasPanel ? (
            <a
              href={COMPANY.panelUrl}
              aria-label={`${vertical.name} paneline giriş`}
              className="tpl-icon-btn size-14"
            >
              <Icon name="key" className="size-7" />
            </a>
          ) : (
            <a
              href="/#iletisim"
              aria-label={`${vertical.name} için görüşme talebi`}
              className="tpl-icon-btn size-14"
            >
              <Icon name="send" className="size-7" />
            </a>
          )}
          <Link
            to={detailHref}
            aria-label={`${vertical.name} ayrıntıları`}
            className="tpl-icon-btn size-14"
          >
            <Icon name="arrowUpRight" className="size-7" />
          </Link>
        </div>
      </div>
    </article>
  )
}
