import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { connectSpreadMs, releaseChannel, retainChannel, socket } from './socket.js';

/** Olay patlamasını tek tazelemede toplayan pencere. */
const REFRESH_BATCH_MS = 400;

/**
 * Yeniden bağlanınca tazelemeden önce eklenen rastgele bekleme alt sınırı.
 * Sunucu yeniden başladığında yüzlerce panel aynı saniyede bağlanır; hepsi
 * aynı anda tam tazeleme yaparsa açılış anında sunucu boğulur. Sunucu kalabalık
 * otelde daha geniş pencere söyler (`ready.spreadMs`).
 */
const RECONNECT_JITTER_MS = 3000;

/**
 * Değişiklik haberinde tazelemeye eklenen rastgele bekleme alt sınırı. Aynı
 * otelin bütün panelleri aynı haberi aynı milisaniyede alır; istekler yayılsın
 * diye. Sunucu, kanala bağlı panel sayısına göre daha geniş pencere söyler
 * (`payload.spreadMs`) ve aynı görünümü zaten tek hesaplamada birleştirir
 * (sürüm anahtarlı okuma önbelleği).
 */
const CHANGE_JITTER_MS = 600;

/**
 * Canlı kanal: sunucuda bir şey değişince ilgili sorguları tazeler.
 *
 * Açık duran ekranlar (oda planı, gelen kutusu, istekler) için. İki yanlış
 * yaklaşım var: sürekli sorgulamak (sunucuyu boşuna yorar) ve hiç tazelememek
 * (resepsiyonist bayat ekrana bakar). Burada sunucu "değişti" der, ekran kendi
 * sorgusunu yeniler — socket'ten veri gelmez, yalnızca kimlikler (bkz. backend
 * `lib/realtime.js`). Kanal, bileşen takılıyken sunucuda abone tutulur;
 * ekranı açık olmayan panele o kanalın haberi hiç gelmez.
 *
 * ### Toplu tazeleme
 *
 * Tek işlem birden fazla event yayınlar (cevap yazmak: `guest.message.reply` +
 * `conversation.updated`). İlk haber bir pencere açar; pencere içinde gelen
 * haberler aynı tazelemeye katılır. Pencere yeni haberle uzamaz: yoğun bir
 * otelde saniyede bir mesaj gelse de ekran tazelenir.
 *
 * `minIntervalMs` verilirse iki tazeleme arası en az o kadar olur (yan menü
 * rozeti gibi her panelde açık duran özetler: yoğun saatte 2500 panelin her
 * mesajda özet sorması gereksiz).
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
 *   minIntervalMs?: number,
 * }} options
 * @returns {{ isLive: boolean, lastChangeAt: string | null }}
 */
export function useLiveChannel(channel, { queryKeys, onChange, enabled = true, minIntervalMs = 0 }) {
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
    let lastFlushAt = 0;
    const pending = new Map();

    const resolveKeys = (payload) =>
      typeof keysRef.current === 'function' ? keysRef.current(payload) : keysRef.current;

    const flush = () => {
      timer = null;
      lastFlushAt = Date.now();
      const keys = [...pending.values()];
      pending.clear();
      for (const queryKey of keys) queryClient.invalidateQueries({ queryKey });
    };

    const schedule = (keys, spreadMs) => {
      for (const key of keys) pending.set(JSON.stringify(key), key);
      if (timer !== null || pending.size === 0) return;
      const jitter = REFRESH_BATCH_MS + Math.random() * spreadMs;
      const wait = Math.max(jitter, lastFlushAt + minIntervalMs - Date.now());
      timer = setTimeout(flush, wait);
    };

    const handleChange = (payload) => {
      setLastChangeAt(payload?.at ?? new Date().toISOString());
      schedule(resolveKeys(payload), Math.max(CHANGE_JITTER_MS, Number(payload?.spreadMs) || 0));
      onChangeRef.current?.(payload);
    };

    let connectedOnce = socket.connected;
    const handleConnect = () => setIsLive(true);
    const handleReady = (payload) => {
      if (!payload?.hotelId) setIsLive(false);
      // İlk bağlantıda ekran zaten taze veriyle açıldı. Kopup yeniden
      // bağlandıysak kaçırdıklarımız olabilir: tam tazeleme, ama herkes aynı anda değil.
      if (connectedOnce && payload?.hotelId) {
        schedule(resolveKeys(null), Math.max(RECONNECT_JITTER_MS, connectSpreadMs()));
      }
      connectedOnce = true;
    };
    const handleDisconnect = () => setIsLive(false);

    retainChannel(channel);
    socket.on(channel, handleChange);
    socket.on('connect', handleConnect);
    socket.on('ready', handleReady);
    socket.on('disconnect', handleDisconnect);

    // Bağlantı bu bileşen takılmadan önce kurulmuş olabilir; o durumda
    // `connect` olayı çoktan geçmiştir, mevcut durumu bir kez okuyoruz.
    if (socket.connected) setIsLive(true);
    else socket.connect();

    return () => {
      if (timer !== null) clearTimeout(timer);
      socket.off(channel, handleChange);
      socket.off('connect', handleConnect);
      socket.off('ready', handleReady);
      socket.off('disconnect', handleDisconnect);
      releaseChannel(channel);
    };
  }, [channel, enabled, minIntervalMs, queryClient]);

  return { isLive: enabled && isLive, lastChangeAt };
}
