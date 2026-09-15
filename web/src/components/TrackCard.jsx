import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { TRACK } from '../data/content.js'
import { mountPlayer } from '../lib/spotifyEmbed.js'

/**
 * "Bu şarkıyla oku" — iki parçalı.
 *
 * `TrackButton`  sayfanın en üstünde, isim hizasındaki köşede duran düğme.
 * `TrackPlayer`  sayfanın en altında duran oynatıcı.
 *
 * Neden ayrı: Spotify'ın gömülü kutusu kendi görünümünü dayatıyor ve üstte
 * durduğunda sayfanın dilini bozuyordu. Düğme yukarıda kalıyor, oynatıcı
 * göze batmayacağı yere iniyor. Ses yine sayfada çalıyor, kullanıcı siteden
 * çıkmıyor.
 *
 * Çalma durumu sayfada (PersonPage) tutuluyor: düğme yukarıda, oynatıcı
 * aşağıda olduğu için ikisinin ortak bir yerden yönetilmesi gerekiyor.
 */

/**
 * @param {{
 *   onToggle: () => void,
 *   isOpened?: boolean,
 *   isPlaying?: boolean,
 * }} props
 */
export function TrackButton({ onToggle, isOpened = false, isPlaying = false }) {
  const label = isPlaying ? TRACK.playingLabel : isOpened ? TRACK.pausedLabel : TRACK.hint

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isPlaying}
      aria-label={isPlaying ? `${TRACK.title} — durdur` : `${TRACK.title} — çal`}
      className={`group inline-flex h-12 items-center gap-3 rounded-full border bg-panel pl-2 pr-5 transition duration-300 ease-in-out hover:bg-line-soft ${
        isOpened ? 'border-sec' : 'border-line-soft'
      }`}
    >
      <span className="grid h-8 w-8 place-items-center rounded-full bg-sec text-background">
        <Icon name={isPlaying ? 'pause' : 'play'} className="h-4 w-4" />
      </span>
      <span className="flex items-baseline gap-2">
        <span
          className={`text-sm font-semibold transition-colors duration-300 ${
            isOpened ? 'text-white' : 'text-ink group-hover:text-white'
          }`}
        >
          {TRACK.title}
        </span>
        <span className="hidden text-xs text-ink-muted sm:inline">{label}</span>
      </span>
    </button>
  )
}

/**
 * Sayfanın en altındaki sessiz oynatıcı şeridi.
 *
 * Oynatıcı SAYFA AÇILIŞINDA kurulur ama çalmaz. Böylece kullanıcı düğmeye
 * bastığında betiğin yüklenmesini beklemez; ses hemen başlar. Denetleyici
 * hazır olunca yukarıdaki düğme görünür hale gelir.
 *
 * @param {{
 *   onController: (controller: any) => void,
 *   onPlayingChange: (isPlaying: boolean) => void,
 * }} props
 */
export function TrackPlayer({ onController, onPlayingChange }) {
  const hostRef = useRef(null)
  const [hasFailed, setHasFailed] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined

    let isCancelled = false

    const setUp = () => {
      if (isCancelled) return
      mountPlayer(host, TRACK.spotifyId, {
        onController: (controller) => {
          if (!isCancelled) onController(controller)
        },
        onPlayingChange: (isPlaying) => {
          if (!isCancelled) onPlayingChange(isPlaying)
        },
      }).catch(() => {
        if (!isCancelled) setHasFailed(true)
      })
    }

    // Kurulum boşta kalınan ilk ana ertelenir: Spotify'ın betiği üçüncü taraf
    // ve sayfanın ilk yüklenmesiyle yarışmasının bir anlamı yok. Düğme yine
    // hazır olur — betiğin ağdan gelmesi boşta beklemekten kat kat uzun.
    // Zaman aşımı şart: sürekli meşgul bir sayfada boş an hiç gelmeyebilir.
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(setUp, { timeout: 2000 })
      : window.setTimeout(setUp, 1)

    return () => {
      isCancelled = true
      if (window.cancelIdleCallback && window.requestIdleCallback) window.cancelIdleCallback(idle)
      else window.clearTimeout(idle)
    }
    // Yalnızca bir kez kurulur; işleyiciler sayfadan gelir ve değişmez.
  }, [])

  return (
    <div className="w-full border-t border-line py-12">
      <div className="section-inner flex flex-col items-center gap-3">
        <p className="shiny-sec text-lg">{TRACK.label}</p>

        <div className="w-full max-w-md overflow-hidden rounded-xl">
          {/* Bu eleman Spotify tarafından oynatıcıyla değiştirilir. */}
          <div ref={hostRef} />
        </div>

        {hasFailed ? (
          <a
            href={TRACK.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-ink-muted underline underline-offset-4 transition-colors duration-300 hover:text-white"
          >
            Oynatıcı yüklenemedi — Spotify'da aç
          </a>
        ) : null}
      </div>
    </div>
  )
}
