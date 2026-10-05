import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Kabın genişliğini izler: grafikler gerçek piksellerle çizilir (viewBox
 * esnetmesi yazıları bozardı). Kap görünmezken (gizli sekme) genişlik 0
 * kalır; grafikler 0'da çizmez.
 *
 * @returns {[import('react').RefObject<HTMLDivElement>, number]}
 */
export function useElementWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
