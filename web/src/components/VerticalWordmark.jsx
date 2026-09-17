/**
 * Bir dikeyin adı: sabit "Flex" + sektörün kendi tipografisi ve rengi.
 *
 * Biçim bilgisi `sectors.js`'ten geliyor — hero animasyonunu besleyen
 * dosyanın aynısı. Bu yüzden karttaki "FlexClinic" ile animasyondaki
 * "FlexClinic" aynı fontta ve aynı renkte; ikisi asla ayrışamaz.
 *
 * @param {{vertical: object, className?: string}} props
 */
export default function VerticalWordmark({ vertical, className = '' }) {
  const tracking = vertical.trackingEm ?? 0

  return (
    <span className={`inline-block whitespace-nowrap leading-none ${className}`.trim()}>
      <span className="inline-block -skew-x-6 font-brand font-bold text-sec">Flex</span>
      <span
        className="inline-block"
        style={{
          fontFamily: vertical.family,
          fontWeight: vertical.weight,
          letterSpacing: `${tracking}em`,
          color: vertical.color,
          // Harf aralığı SON harften sonra da boşluk bırakır; kelime sağa
          // kaymış görünmesin diye o kadar geri alınıyor
          marginRight: `${-tracking}em`,
          transform: vertical.skewDegrees ? `skewX(${vertical.skewDegrees}deg)` : undefined,
        }}
      >
        {vertical.label}
      </span>
    </span>
  )
}
