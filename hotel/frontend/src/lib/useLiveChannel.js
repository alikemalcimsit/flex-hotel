import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { socket } from './socket.js';

/** Olay patlamasını tek tazelemede toplayan pencere. */
const REFRESH_BATCH_MS = 400;

/**
 * Yeniden bağlanınca tazelemeden önce eklenen rastgele bekleme üst sınırı.
 * Sunucu yeniden başladığında yüzlerce panel aynı saniyede bağlanır; hepsi
 * aynı anda tam tazeleme yaparsa açılış anında sunucu boğulur.
 */
const RECONNECT_JITTER_MS = 3000;

/**
 * Değişiklik haberinde tazelemeye eklenen küçük rastgele bekleme. Aynı otelin
 * bütün panelleri aynı haberi aynı milisaniyede alır; istekler yayılsın diye.
 * Sunucu aynı görünümü zaten tek hesaplamada birleştiriyor (sürüm anahtarlı
 * okuma önbelleği).
 */
const CHANGE_JITTER_MS = 600;

/**
 * Canlı kanal: sunucuda bir şey değişince ilgili sorguları tazeler.
 *
 * Açık duran ekranlar (oda planı, gelen kutusu, istekler) için. İki yanlış
 * yaklaşım var: sürekli sorgulamak (sunucuyu boşuna yorar) ve hiç tazelememek
 * (resepsiyonist bayat ekrana bakar). Burada sunucu "değişti" der, ekran kendi
 * sorgusunu yeniler — socket'ten veri gelmez, yalnızca kimlikler (bkz. backend
 * `lib/realtime.js`).
 *
 * ### Toplu tazeleme
 *
 * Tek işlem birden fazla event yayınlar (cevap yazmak: `guest.message.reply` +
 * `conversation.updated`). İlk haber bir pencere açar; pencere içinde gelen
 * haberler aynı tazelemeye katılır. Pencere yeni haberle uzamaz: yoğun bir
 * otelde saniyede bir mesaj gelse de ekran tazelenir.
 *
 * ### Hangi sorgular
 *
 * `queryKeys` sabit bir liste ya da habere göre liste döndüren fonksiyondur
 * (gelen kutusu yalnızca açık olan konuşmanın mesajlarını tazeler). Fonksiyon
 * yeniden bağlanmada `null` ile çağrılır ve o zaman her şeyi döndürmelidir:
 * kopukken kaçan değişikliklerin hangisi olduğunu bilemeyiz.
 *
 * ### Bağlantı yoksa
 *
 * Canlı yayın bir hızlandırıcıdır, doğruluğun şartı değil: kopukken çağıran
 * ekran periyodik tazelemeye düşer (`isLive === false`).
 *
 * @param {string} channel `socket.js` içindeki kanal adı
 * @param {{
 *   queryKeys: unknown[][] | ((payload: object | null) => unknown[][]),
 *   onChange?: (payload: object) => void,
 *   enabled?: boolean,
 * }} options
 * @returns {{ isLive: boolean, lastChangeAt: string | null }}
 */
export function useLiveChannel(channel, { queryKeys, onChange, enabled = true }) {
  const queryClient = useQueryClient();
  const [isLive, setIsLive] = useState(socket.connected);
  const [lastChangeAt, setLastChangeAt] = useState(null);
  // Anahtarlar ve geri çağrı her çizimde yeni olur; effect'i yeniden kurmasın.
  const keysRef = useRef(queryKeys);
  const onChangeRef = useRef(onChange);
  keysRef.current = queryKeys;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return undefined;

    let timer = null;
    const pending = new Map();

    const resolveKeys = (payload) =>
      typeof keysRef.current === 'function' ? keysRef.current(payload) : keysRef.current;

    const flush = () => {
      timer = null;
      const keys = [...pending.values()];
      pending.clear();
      for (const queryKey of keys) queryClient.invalidateQueries({ queryKey });
    };

    const schedule = (keys, delay) => {
      for (const key of keys) pending.set(JSON.stringify(key), key);
      if (timer === null && pending.size > 0) timer = setTimeout(flush, delay);
    };

    const handleChange = (payload) => {
      setLastChangeAt(payload?.at ?? new Date().toISOString());
      schedule(resolveKeys(payload), REFRESH_BATCH_MS + Math.random() * CHANGE_JITTER_MS);
      onChangeRef.current?.(payload);
    };

    let connectedOnce = socket.connected;
    const handleConnect = () => {
      setIsLive(true);
      // İlk bağlantıda ekran zaten taze veriyle açıldı. Kopup yeniden
      // bağlandıysak kaçırdıklarımız olabilir: tam tazeleme, ama herkes aynı anda değil.
      if (connectedOnce) schedule(resolveKeys(null), REFRESH_BATCH_MS + Math.random() * RECONNECT_JITTER_MS);
      connectedOnce = true;
    };
    const handleDisconnect = () => setIsLive(false);

    socket.on(channel, handleChange);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    // Bağlantı bu bileşen takılmadan önce kurulmuş olabilir; o durumda
    // `connect` olayı çoktan geçmiştir, mevcut durumu bir kez okuyoruz.
    if (socket.connected) setIsLive(true);
    else socket.connect();

    return () => {
      if (timer !== null) clearTimeout(timer);
      socket.off(channel, handleChange);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [channel, enabled, queryClient]);

  return { isLive: enabled && isLive, lastChangeAt };
}
