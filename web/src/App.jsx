import { useEffect, useRef } from 'react'
import { Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import Nav from './components/Nav.jsx'
import Footer from './components/Footer.jsx'
import HomePage from './pages/HomePage.jsx'
import PersonPage from './pages/PersonPage.jsx'
import VerticalPage from './pages/VerticalPage.jsx'
import { buildHead } from './lib/seo.js'

/**
 * Sayfa değişince başlığı ve açıklamayı günceller.
 *
 * Etiketlerin doğru hâli zaten build sırasında HTML'e yazılıyor (prerender);
 * bu yalnızca tarayıcı içi geçişler için — sekme başlığı ve paylaşımda
 * kullanılan açıklama güncel kalsın diye.
 */
function useDocumentHead(pathname) {
  useEffect(() => {
    const head = buildHead(pathname)
    document.title = head.title

    const description = document.querySelector('meta[name="description"]')
    if (description) description.setAttribute('content', head.description)

    const canonical = document.querySelector('link[rel="canonical"]')
    if (canonical) canonical.setAttribute('href', `${window.location.origin}${head.path}`)
  }, [pathname])
}

/**
 * Geçmiş girdisi başına bırakılan kaydırma konumu.
 *
 * Modül düzeyinde tutuluyor: React ağacı yeniden bağlansa da oturum boyunca
 * yaşamalı. Anahtar `location.key` — aynı adrese iki kez gidilse bile
 * girdiler ayrı tutulur.
 */
const scrollPositions = new Map()

/**
 * Kaydırma konumunu yönetir.
 *
 * İLERİ gidişte (yeni sayfa açılışı) en üste dönülür. GERİ gelişte kullanıcı
 * bıraktığı yere döner: ekip bölümünden bir kişinin sayfasına girip geri
 * gelen kişi yine ekip bölümünde olmalı, sayfanın tepesinde değil.
 *
 * Tarayıcının kendi geri yükleme mekanizmasına güvenilmiyor — tek sayfalık
 * uygulamada içerik `popstate` anında henüz yerinde olmadığı için konum
 * çoğu zaman kırpılıyor. `manual`'a alıp konumu kendimiz saklıyoruz.
 */
function useScrollRestoration(location, navigationType) {
  const lastScroll = useRef(0)
  const lastKey = useRef(location.key)

  /*
   * Ayrılan sayfanın konumu, DOM daha DEĞİŞMEDEN, çizim aşamasında saklanır.
   *
   * Bunu bir efekte bırakmak sessizce bozuluyordu: kişi sayfası ana sayfadan
   * kısa olduğu için DOM değişir değişmez tarayıcı kaydırmayı belgenin yeni
   * sonuna kırpıyor ve bir kaydırma olayı yayıyor. O olay efektler henüz
   * sökülmeden geldiğinde ana sayfanın kayıtlı konumunu bu kırpılmış değerle
   * eziyordu — geri dönen kullanıcı ekip bölümünün birkaç yüz piksel
   * yukarısına düşüyordu. Çizim aşaması kırpmadan önce gelir; oradaki değer
   * kullanıcının gerçekten bıraktığı yerdir.
   */
  if (lastKey.current !== location.key) {
    scrollPositions.set(lastKey.current, lastScroll.current)
    lastKey.current = location.key
  }

  useEffect(() => {
    // Tarayıcı da geri yüklemeye çalışırsa ikimiz birbirimizle çekişiriz
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }

    const remember = () => {
      lastScroll.current = window.scrollY
    }
    remember()
    window.addEventListener('scroll', remember, { passive: true })
    return () => window.removeEventListener('scroll', remember)
  }, [])

  useEffect(() => {
    // Çapa varsa hedefe gitmeyi tarayıcıya bırak
    if (location.hash) return
    const saved = navigationType === 'POP' ? scrollPositions.get(location.key) : undefined
    const target = saved ?? 0

    // Sayfa içi çapalar için `scroll-behavior: smooth` isteniyor, sayfa
    // GEÇİŞİ için istenmiyor: geri tuşuna basan kullanıcı bıraktığı yere
    // saniyelerce kayarak değil, anında dönmeli. Satır içi biçim yalnızca
    // bu sıçrama boyunca sayfa genelindeki kuralı bastırır.
    const root = document.documentElement
    const previousBehavior = root.style.scrollBehavior
    root.style.scrollBehavior = 'auto'
    window.scrollTo(0, target)
    root.style.scrollBehavior = previousBehavior

    lastScroll.current = target
  }, [location.key, location.hash, navigationType])
}

export default function App() {
  const location = useLocation()
  const navigationType = useNavigationType()
  useDocumentHead(location.pathname)
  useScrollRestoration(location, navigationType)

  return (
    // Yan boşluklar şablonun body'sindeki gibi; bölümler bu boşluğun içinde
    // ortalanmış dar sütunda duruyor, ayırıcı çizgiler boşluğa kadar uzanıyor.
    <div id="top" className="px-9 sm:px-28 lg:px-20">
      {/* Klavye kullanıcısı gezinmeyi atlayıp doğrudan içeriğe geçebilsin. */}
      <a
        href="#icerik"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[110] focus:rounded-lg focus:bg-sec focus:px-4 focus:py-3 focus:font-semibold focus:text-background"
      >
        İçeriğe geç
      </a>

      <Nav />

      <main id="icerik">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/cozumler/:slug" element={<VerticalPage />} />
          <Route path="/ekip/:slug" element={<PersonPage />} />
        </Routes>
      </main>

      <Footer />
    </div>
  )
}
