/**
 * Spotify gömülü oynatıcı denetleyicisi.
 *
 * NEDEN GEREKLİ
 * Sıradan bir `<iframe>` gömdüğünüzde oynatıcı yalnızca YÜKLENİR; şarkı
 * kendiliğinden başlamaz, kullanıcının Spotify'ın kendi kutusundaki play
 * düğmesine ayrıca basması gerekir. Spotify'ın IFrame API'si oynatıcıyı
 * dışarıdan başlatıp durdurmaya izin veriyor — böylece bizim düğmemiz hem
 * başlatıyor hem durduruyor.
 *
 * Betik yalnızca bir kez, ihtiyaç duyulduğunda yüklenir; sayfa açılışında
 * üçüncü taraf betiği çalıştırmıyoruz.
 */

const API_SRC = 'https://open.spotify.com/embed/iframe-api/v1'

let apiPromise = null

/** @returns {Promise<any>} Spotify IFrame API nesnesi. */
export function loadSpotifyApi() {
  if (apiPromise) return apiPromise

  apiPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Tarayıcı ortamı yok'))
      return
    }

    // API hazır olduğunda bu genel işlevi çağırıyor — sözleşme Spotify'ın.
    window.onSpotifyIframeApiReady = (IFrameAPI) => resolve(IFrameAPI)

    const script = document.createElement('script')
    script.src = API_SRC
    script.async = true
    script.onerror = () => reject(new Error('Spotify betiği yüklenemedi'))
    document.body.appendChild(script)
  })

  return apiPromise
}

/**
 * Verilen elemanın yerine oynatıcıyı kurar.
 *
 * Çalmaya BAŞLATMAZ: oynatıcı sayfa açılışında hazırlanıyor, çalma kararını
 * kullanıcı düğmeye basarak veriyor. Böylece ilk basışta betik yüklenmesini
 * beklemek gerekmiyor.
 *
 * @param {HTMLElement} element Yerine oynatıcı geçecek eleman.
 * @param {string} trackId Spotify parça kimliği.
 * @param {{
 *   onController?: (controller: any) => void,
 *   onPlayingChange?: (isPlaying: boolean) => void,
 * }} [handlers]
 * @returns {Promise<void>}
 */
export async function mountPlayer(element, trackId, handlers = {}) {
  const { onController, onPlayingChange } = handlers
  const IFrameAPI = await loadSpotifyApi()

  IFrameAPI.createController(
    element,
    { uri: `spotify:track:${trackId}`, width: '100%', height: 80 },
    (controller) => {
      if (onController) onController(controller)

      // Kullanıcı Spotify'ın kendi kutusundan da durdurabilir; düğmenin
      // durumu buna göre güncellensin diye oynatıcıyı dinliyoruz.
      if (onPlayingChange) {
        controller.addListener('playback_update', (event) => {
          const data = event && event.data
          if (!data) return
          onPlayingChange(!data.isPaused)
        })
      }
    }
  )
}
