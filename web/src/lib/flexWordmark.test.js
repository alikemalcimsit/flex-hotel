import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planWordmarkLayout } from './flexWordmark.js'

const CAP = 100
const OPTIONS = { capHeight: CAP, gapRatio: 0.1, marginRatio: 0.34 }

/** "Flex": çıkıntılı `l` yüzünden büyük harf hizasının üstüne taşar. */
const BRAND = { inkWidth: 260, above: 105, below: 0 }

const SECTORS = [
  { inkWidth: 500, above: 100, below: 22 },
  { inkWidth: 300, above: 100, below: 0 },
  { inkWidth: 180, above: 100, below: 30 },
]

test('sektörler sola hizalanır: hepsi aynı x`te başlar', () => {
  const layout = planWordmarkLayout(BRAND, SECTORS, OPTIONS)

  // Bitişiklik: sektör, markanın bittiği yerden bir boşluk sonra başlar
  assert.equal(layout.brandX, 34)
  assert.equal(layout.sectorX, 34 + 260 + 10)
})

test('alan en geniş sektöre göre boyutlanır, dar olanlar küçültmez', () => {
  const wide = planWordmarkLayout(BRAND, SECTORS, OPTIONS)
  const onlyNarrow = planWordmarkLayout(BRAND, [SECTORS[2]], OPTIONS)

  assert.equal(wide.width, 2 * Math.ceil((68 + 260 + 10 + 500) / 2))
  assert.ok(wide.width > onlyNarrow.width)
  // Sektör başlangıcı en geniş sektörden bağımsızdır
  assert.equal(wide.sectorX, onlyNarrow.sectorX)
})

test('yükseklik en yüksek çıkıntıyı ve en derin kuyruğu birlikte kapsar', () => {
  const layout = planWordmarkLayout(BRAND, SECTORS, OPTIONS)

  // Üstte markanın `l` çıkıntısı (105), altta sektörün `y` kuyruğu (30)
  assert.equal(layout.height, 2 * Math.ceil((68 + 105 + 30) / 2))
  assert.equal(layout.baselineY, 34 + 105)

  // Her kelime alanın içinde kalmalı
  for (const word of [BRAND, ...SECTORS]) {
    assert.ok(layout.baselineY - word.above >= 0, 'kelime üstten taşıyor')
    assert.ok(layout.baselineY + word.below <= layout.height, 'kelime alttan taşıyor')
  }
})

test('kuyruğu olmayan tek kelimede taban çizgisi alta yaklaşır', () => {
  const layout = planWordmarkLayout(BRAND, [{ inkWidth: 200, above: 100, below: 0 }], OPTIONS)

  assert.equal(layout.baselineY, 34 + 105)
  assert.equal(layout.height, 2 * Math.ceil((68 + 105) / 2))
})

test('doku boyutları çift kalır', () => {
  for (const capHeight of [37, 100, 161]) {
    const layout = planWordmarkLayout(BRAND, SECTORS, { ...OPTIONS, capHeight })
    assert.equal(layout.width % 2, 0, `genişlik tek: ${layout.width}`)
    assert.equal(layout.height % 2, 0, `yükseklik tek: ${layout.height}`)
  }
})

test('varsayılan boşluk ve kenar payı büyük harf yüksekliğiyle ölçeklenir', () => {
  const small = planWordmarkLayout(BRAND, SECTORS, { capHeight: 100 })
  const large = planWordmarkLayout(BRAND, SECTORS, { capHeight: 200 })

  // Ölçüler aynı kalıp yalnızca capHeight iki katına çıkınca boşluk da iki katı
  assert.ok(
    large.sectorX - (BRAND.inkWidth + large.brandX) >
      small.sectorX - (BRAND.inkWidth + small.brandX)
  )
  assert.equal(large.brandX, 2 * small.brandX)
})
