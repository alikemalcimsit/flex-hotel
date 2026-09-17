import Icon from './Icon.jsx'
import Logo from './Logo.jsx'
import { COMPANY, NAV_LINKS } from '../data/content.js'

/**
 * Altbilgi — şablonun üç sütunlu footer'ı.
 *
 * Şablondan çıkarılanlar: Firebase'e bağlı beğeni düğmesi (sitenin arka ucu
 * yok) ve Spotify çalma listesi (ekip sayfalarında zaten kendi oynatıcısı
 * var; ikisi aynı sayfada çakışıyordu). "Built with" satırları gezinme ve
 * künyeye döndü — ziyaretçi için karşılığı olan bilgi bu.
 *
 * Şablon MIT lisanslı; lisans sayfada görünür bir kredi istemiyor, telif ve
 * izin metninin kopyayla birlikte tutulmasını istiyor. O metin
 * THIRD_PARTY_LICENSE_DARK_MINIMAL.txt dosyasında.
 */
export default function Footer() {
  return (
    <footer className="w-full border-t border-line py-12">
      <div className="section-inner">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-10">
          <div className="flex flex-col items-center gap-6 lg:items-start">
            <Logo className="text-2xl" />
            <p className="max-w-xs text-center text-sm leading-relaxed text-ink-muted lg:text-left">
              {COMPANY.tagline}
            </p>
            <div className="flex space-x-6 sm:space-x-8">
              <a
                href={`mailto:${COMPANY.email}`}
                aria-label="E-posta gönder"
                className="text-ink-muted transition duration-300 ease-in-out hover:text-ink"
              >
                <Icon name="mail" className="size-8" />
              </a>
              <a
                href={COMPANY.panelUrl}
                aria-label="Panele giriş"
                className="text-ink-muted transition duration-300 ease-in-out hover:text-ink"
              >
                <Icon name="key" className="size-8" />
              </a>
            </div>
          </div>

          <nav aria-label="Alt menü" className="flex flex-col items-center">
            <ul className="grid w-full max-w-xs grid-cols-1 gap-3 py-6 lg:py-0">
              {NAV_LINKS.map((link) => (
                <li key={link.id} className="flex items-center justify-center space-x-3 lg:justify-normal">
                  <Icon name={link.icon} className="h-5 w-5 text-ink-muted opacity-50" />
                  <a
                    href={link.href}
                    className="text-sm text-ink-muted transition duration-300 ease-in-out hover:text-ink"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <dl className="flex flex-col items-center gap-3 text-sm lg:items-start">
            <div className="flex items-center space-x-3">
              <dt className="text-ink-muted">Konum</dt>
              <dd className="text-ink">{COMPANY.location}</dd>
            </div>
            <div className="flex items-center space-x-3">
              <dt className="text-ink-muted">E-posta</dt>
              <dd>
                <a
                  href={`mailto:${COMPANY.email}`}
                  className="text-ink transition duration-300 ease-in-out hover:text-white"
                >
                  {COMPANY.email}
                </a>
              </dd>
            </div>
            <div className="flex items-center space-x-3">
              <dt className="text-ink-muted">Panel</dt>
              <dd>
                <a
                  href={COMPANY.panelUrl}
                  className="text-ink transition duration-300 ease-in-out hover:text-white"
                >
                  {COMPANY.panelUrl.replace(/^https?:\/\//, '')}
                </a>
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-12 border-t border-line pt-8">
          <p className="text-center text-sm text-ink-muted">
            © {new Date().getFullYear()} {COMPANY.name}. Tüm hakları saklıdır.
          </p>
        </div>
      </div>
    </footer>
  )
}
