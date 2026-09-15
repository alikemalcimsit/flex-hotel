/**
 * FlexAI wordmark'ı — otel panelindeki logonun aynısı:
 * "Flex" ağır ve eğik (`-skew-x-6`), ikinci kelime ince ve geniş harf aralıklı.
 * Panelde ikinci kelime "Hotels" ve cyan; burada "AI" ve açık ton, çünkü
 * kurumsal palet siyah + kırmızı tonlarından oluşuyor.
 *
 * @param {{className?: string}} props
 */
export default function Logo({ className = 'text-xl' }) {
  return (
    <span className={`font-brand leading-none ${className}`}>
      <span className="inline-block -skew-x-6 font-bold text-sec">Flex</span>
      <span className="font-light tracking-wide text-ink">AI</span>
    </span>
  )
}
