/**
 * Hakkımızda şemasının yerleşimi: ortak çekirdek ve ona bağlı sektörler.
 *
 * Koordinatlar 0–100 aralığında yüzde. Sektör kutuları bu yüzdelerle CSS'te
 * konumlanıyor — prerender edilen HTML'de JavaScript çalışmadan yerinde.
 * Çizgiler ise kapsayıcının ölçülen piksel boyuna çevrilip (`scalePath`)
 * çiziliyor.
 *
 * NEDEN PİKSEL: ilk denemede SVG yüzde koordinatla, oranı korumadan
 * (`preserveAspectRatio="none"`) kutuya yayılıyordu. Uç noktalar doğru
 * düşüyordu ama tarayıcı, sündürülmüş çizgide ışığın tire boyunu ekran
 * pikseliyle hesaplayıp tekrarlıyordu: tek ışık yerine hat boyunca kesik
 * kesik çizgi akıyordu. Gerçek ölçüde çizilen SVG'de `pathLength` doğru
 * çalışıyor.
 *
 * İki düzen var:
 * - geniş (lg ve üstü): çekirdek ortada, sektörler iki yanda dikey sütun,
 *   çizgiler yatay S eğrisiyle çıkıyor.
 * - dar: çekirdek üstte, ortadan inen tek gövde; her satırda gövdeden sola ve
 *   sağa dallanan köşeli kol.
 */

const WIDE = Object.freeze({ coreX: 50, coreY: 50, leftX: 12, rightX: 88, top: 14, bottom: 86, pull: 18 })

/** `trunkY`: gövdenin başladığı yer — çekirdek kutusunun altında gizli kalır. */
const NARROW = Object.freeze({ trunkX: 50, trunkY: 15, leftX: 25, rightX: 75, top: 44, bottom: 92, corner: 2.5 })

function round(value) {
  return Math.round(value * 100) / 100
}

/** `rows` satırı `top`–`bottom` arasına eşit aralıkla dağıtır. */
function spreadRows(rows, top, bottom) {
  if (rows <= 0) return []
  if (rows === 1) return [round((top + bottom) / 2)]
  const step = (bottom - top) / (rows - 1)
  return Array.from({ length: rows }, (_, row) => round(top + step * row))
}

/**
 * @typedef {['M' | 'L', number, number] | ['C', number, number, number, number, number, number]
 *   | ['Q', number, number, number, number] | ['H', number] | ['V', number]} Segment
 *   Mutlak SVG yol komutu; sayılar yüzde. H yalnızca x, V yalnızca y alır.
 */

/**
 * @param {number} count sektör sayısı
 * @returns {Array<{
 *   side: 'left' | 'right',
 *   slot: number,
 *   wide: {x: number, y: number, segments: Segment[]},
 *   narrow: {x: number, y: number, segments: Segment[]},
 * }>}
 *   Sıra girdiyle aynı. İlk yarı sol sütuna, kalanı sağa düşer (tek sayıda
 *   fazlası solda). `slot` ışığın sırası: sol 1, sağ 1, sol 2, sağ 2… —
 *   ışık bir sütunu bitirip ötekine geçmek yerine iki yan arasında gidip gelir.
 */
export function planCoreDiagram(count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`sektör sayısı pozitif tam sayı olmalı: ${count}`)
  }

  const leftCount = Math.ceil(count / 2)
  const wideLeft = spreadRows(leftCount, WIDE.top, WIDE.bottom)
  const wideRight = spreadRows(count - leftCount, WIDE.top, WIDE.bottom)
  const narrowRows = spreadRows(leftCount, NARROW.top, NARROW.bottom)

  return Array.from({ length: count }, (_, index) => {
    const isLeft = index < leftCount
    const row = isLeft ? index : index - leftCount
    const direction = isLeft ? -1 : 1

    const wideX = isLeft ? WIDE.leftX : WIDE.rightX
    const wideY = (isLeft ? wideLeft : wideRight)[row]

    const narrowX = isLeft ? NARROW.leftX : NARROW.rightX
    const narrowY = narrowRows[row]

    return {
      side: isLeft ? 'left' : 'right',
      slot: isLeft ? row * 2 : row * 2 + 1,
      wide: {
        x: wideX,
        y: wideY,
        segments: [
          ['M', WIDE.coreX, WIDE.coreY],
          [
            'C',
            WIDE.coreX + direction * WIDE.pull,
            WIDE.coreY,
            WIDE.coreX + direction * (WIDE.pull + 2),
            wideY,
            wideX,
            wideY,
          ],
        ],
      },
      narrow: {
        x: narrowX,
        y: narrowY,
        segments: [
          ['M', NARROW.trunkX, NARROW.trunkY],
          ['V', round(narrowY - NARROW.corner)],
          ['Q', NARROW.trunkX, narrowY, NARROW.trunkX + direction * NARROW.corner, narrowY],
          ['H', narrowX],
        ],
      },
    }
  })
}

/**
 * Yüzde koordinatlı yolu verilen piksel boyuta çevirip SVG `d` metni yapar.
 *
 * @param {Segment[]} segments
 * @param {number} width kapsayıcı genişliği (piksel)
 * @param {number} height kapsayıcı yüksekliği (piksel)
 * @returns {string}
 */
export function scalePath(segments, width, height) {
  const sx = (value) => round((value * width) / 100)
  const sy = (value) => round((value * height) / 100)

  return segments
    .map(([command, ...values]) => {
      if (command === 'H') return `H${sx(values[0])}`
      if (command === 'V') return `V${sy(values[0])}`
      // Kalan komutlarda sayılar x, y çiftleri hâlinde gelir
      const points = values.map((value, i) => (i % 2 === 0 ? sx(value) : sy(value)))
      return `${command}${points.join(' ')}`
    })
    .join(' ')
}
