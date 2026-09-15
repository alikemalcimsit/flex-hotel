import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { INVENTORY_CHANNEL, socket } from './socket.js';

/**
 * Canlı envanter: sunucuda bir şey değişince ekranı tazeler.
 *
 * Oda planı saatlerce açık duran bir ekran. İki yanlış yaklaşım var:
 * sürekli sorgulamak (sunucuyu ve veritabanını boşuna yorar) ve hiç
 * tazelememek (resepsiyonist bayat ızgaraya bakıp dolu odayı satar). Burada
 * sunucu "değişti" der, ekran kendi sorgusunu yeniler.
 *
 * ### Neden gecikmeli (debounce)
 *
 * Tek bir işlem birden fazla event yayınlar: oda değişikliğinde
 * `room.unassigned` + `room.assigned` + iki `room.status.changed`. Hepsine ayrı
 * tazeleme yapmak aynı sorguyu dört kez atmaktır.
 *
 * ### Bağlantı yoksa
 *
 * Canlı yayın bir hızlandırıcıdır, doğruluğun şartı değil: socket kopukken
 * çağıran ekran periyodik tazelemeye düşer (`isLive === false`), bağlantı
 * dönünce bir kez tam tazeleme yapılır (kopukken kaçan değişiklikler için).
 *
 * @param {string[][]} queryKeys Tazelenecek react-query anahtar önekleri
 * @returns {{ isLive: boolean, lastChangeAt: string | null }}
 */
const REFRESH_DEBOUNCE_MS = 400;

export function useLiveInventory(queryKeys) {
  const queryClient = useQueryClient();
  const [isLive, setIsLive] = useState(socket.connected);
  const [lastChangeAt, setLastChangeAt] = useState(null);
  // Anahtar listesi her çizimde yeni dizi olur; effect'i tetiklemesin.
  const keysRef = useRef(queryKeys);
  keysRef.current = queryKeys;

  useEffect(() => {
    let timer = null;

    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const queryKey of keysRef.current) queryClient.invalidateQueries({ queryKey });
      }, REFRESH_DEBOUNCE_MS);
    };

    const onChange = (payload) => {
      setLastChangeAt(payload?.at ?? new Date().toISOString());
      refresh();
    };
    const onConnect = () => {
      setIsLive(true);
      // Kopukken kaçırdıklarımız olabilir: bağlanır bağlanmaz tam tazeleme.
      refresh();
    };
    const onDisconnect = () => setIsLive(false);

    socket.on(INVENTORY_CHANNEL, onChange);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    // Socket modül yüklenirken bağlanmaya başlıyor; bağlantı bu bileşen
    // takılmadan önce kurulmuş olabilir. O durumda `connect` olayı çoktan
    // geçmiştir ve yalnızca olayı beklemek ekranı sonsuza dek "canlı değil"
    // gösterirdi — mevcut durumu bir kez okuyoruz.
    if (socket.connected) setIsLive(true);
    else socket.connect();

    return () => {
      clearTimeout(timer);
      socket.off(INVENTORY_CHANNEL, onChange);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [queryClient]);

  return { isLive, lastChangeAt };
}
