import { useCallback, useEffect, useState } from 'react';

/**
 * Tarayıcının tam ekran API'si. Desteklenmiyorsa (`isSupported: false`) üst
 * bardaki düğme hiç çizilmez — işe yaramayan düğme gösterilmez.
 *
 * Durum tarayıcının kendi olayından okunur: kullanıcı Esc ile çıksa da düğme
 * doğru hâlde kalır.
 */
export function useFullscreen() {
  const isSupported = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled);
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement));

  useEffect(() => {
    const handleChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, []);

  const toggle = useCallback(() => {
    const request = document.fullscreenElement
      ? document.exitFullscreen?.()
      : document.documentElement.requestFullscreen?.();
    // Tarayıcı reddederse (izin politikası) sessizce eski hâlde kalır.
    request?.catch?.(() => {});
  }, []);

  return { isSupported, isFullscreen, toggle };
}
