/**
 * FlexHotel logosu — FlexAI tanıtım sitesindeki sektör kilidiyle aynı yapı:
 * "Flex" kalın, eğik, kırmızı; "Hotel" ince, geniş aralıklı, otel sektörünün
 * camgöbeği tonunda. Yazı tipi Space Grotesk (yerelde).
 *
 * `compact` daraltılmış yan menü rayı için yalnızca eğik "F" çizer; tam ad
 * ekran okuyucu için yine okunur.
 *
 * @param {{ compact?: boolean, className?: string }} props
 */
export function Logo({ compact = false, className = '' }) {
  if (compact) {
    return (
      <span className={`font-brand leading-none ${className}`}>
        <span aria-hidden="true" className="inline-block -skew-x-6 font-bold text-sec">
          F
        </span>
        <span className="sr-only">FlexHotel</span>
      </span>
    );
  }

  return (
    <span className={`whitespace-nowrap font-brand leading-none ${className}`}>
      <span className="inline-block -skew-x-6 font-bold text-sec">Flex</span>
      <span className="font-light tracking-[0.03em] text-cyan-400">Hotel</span>
    </span>
  );
}
