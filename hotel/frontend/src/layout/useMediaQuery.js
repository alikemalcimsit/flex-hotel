import { useSyncExternalStore } from 'react';

/**
 * Bir CSS medya sorgusunun anlık sonucu; pencere boyutu değişince güncellenir.
 *
 * @param {string} query örn. `(min-width: 80rem)`
 * @returns {boolean}
 */
export function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}
