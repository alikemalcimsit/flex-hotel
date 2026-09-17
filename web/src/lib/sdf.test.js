import assert from 'node:assert/strict'
import { test } from 'node:test'
import { signedDistanceField } from './sdf.js'

/** Satır-öncelikli alanda (x, y) hücresini okur. */
function at(field, width, x, y) {
  return field[y * width + x]
}

/** Verilen boyutta tamamen boş kapama haritası üretir. */
function emptyCoverage(width, height) {
  return new Float32Array(width * height)
}

/**
 * `edge` konumunda dikey, kenar yumuşatılmış bir sınır üretir: `edge`'in
 * solu dolu. `i` pikseli [i, i+1) aralığını kaplar, merkezi i+0.5'tedir.
 */
function verticalEdgeCoverage(width, height, edge) {
  const coverage = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      coverage[y * width + x] = Math.max(0, Math.min(1, edge - x))
    }
  }
  return coverage
}

/** Bir satırda işaret değiştiren ilk komşu çift arasında sıfır geçişi. */
function zeroCrossing(field, width, row) {
  for (let x = 0; x + 1 < width; x += 1) {
    const left = at(field, width, x, row)
    const right = at(field, width, x + 1, row)
    if ((left <= 0 && right > 0) || (left >= 0 && right < 0)) {
      return x + 0.5 + -left / (right - left)
    }
  }
  return Number.NaN
}

test('tek dolu piksel: içeride negatif, dışarıda Öklid mesafesi', () => {
  const size = 5
  const coverage = emptyCoverage(size, size)
  coverage[2 * size + 2] = 1

  const field = signedDistanceField(coverage, size, size)

  assert.equal(at(field, size, 2, 2), -1)
  assert.equal(at(field, size, 3, 2), 1)
  assert.equal(at(field, size, 2, 1), 1)
  assert.ok(Math.abs(at(field, size, 3, 3) - Math.SQRT2) < 1e-6)
  assert.ok(Math.abs(at(field, size, 4, 2) - 2) < 1e-6)
})

test('kısmi kapama, hücrenin kendi mesafesini alt piksel doğrulukla verir', () => {
  const size = 7
  const coverage = verticalEdgeCoverage(size, size, 3.7)

  const field = signedDistanceField(coverage, size, size)

  // Merkez 3.5, kenar 3.7 → 0.2 piksel içeride
  assert.ok(Math.abs(at(field, size, 3, 3) - -0.2) < 1e-6)
  assert.ok(at(field, size, 2, 3) < -1)
  assert.ok(at(field, size, 4, 3) > 0)
})

test('sıfır geçişi piksel ızgarasına çakılmaz, kenarla birlikte kayar', () => {
  const size = 9
  let previous = Number.NaN
  for (let step = 0; step <= 10; step += 1) {
    const edge = 3 + step / 10
    const field = signedDistanceField(verticalEdgeCoverage(size, size, edge), size, size)
    const crossing = zeroCrossing(field, size, 4)

    assert.ok(Number.isFinite(crossing), `kenar ${edge} için geçiş bulunamadı`)
    // Tırtıklanmanın kaynağı buydu: ızgaraya yuvarlansa ardışık kenar
    // konumlarının hepsi aynı geçişe düşer, kenar sıçraya sıçraya ilerlerdi.
    // Asıl aranan özellik geçişin kenarla birlikte KESİNTİSİZ ilerlemesidir.
    if (Number.isFinite(previous)) {
      const advance = crossing - previous
      assert.ok(advance > 0.05, `kenar ${edge} geçişi ilerlemedi (adım ${advance})`)
    }
    // Mesafe dönüşümü alt piksel sapmasını kareler toplamıyla taşıdığı için
    // kalan sapma sınırlıdır: ızgara ve yarım piksel çizgilerinde tam sıfır,
    // aralarda en çok bu kadar
    assert.ok(
      Math.abs(crossing - edge) < 0.12,
      `kenar ${edge} için geçiş ${crossing} — sapma çok büyük`
    )
    previous = crossing
  }
})

test('düz kenardan uzaklaşırken eğim piksel başına tam 1', () => {
  const size = 8
  const coverage = emptyCoverage(size, size)
  for (let y = 0; y < size; y += 1) {
    for (let x = 4; x < size; x += 1) coverage[y * size + x] = 1
  }

  const field = signedDistanceField(coverage, size, size)

  // Kenarın kendi üstünde adım 2'dir (bir yanda -1, öbür yanda +1); eğim
  // ölçümü bu yüzden kenardan uzakta yapılır
  for (let x = 1; x < 3; x += 1) {
    const step = at(field, size, x, 4) - at(field, size, x + 1, 4)
    assert.ok(Math.abs(step - 1) < 1e-9, `x=${x} adımı 1 değil: ${step}`)
  }
  assert.ok(at(field, size, 3, 4) > 0)
  assert.ok(at(field, size, 4, 4) < 0)
  // Keskin maskede kenar tam piksel sınırındadır
  assert.ok(Math.abs(zeroCrossing(field, size, 4) - 4) < 1e-9)
})

test('dolu bölgenin derinliği kenardan içeri doğru artar', () => {
  const size = 9
  const coverage = emptyCoverage(size, size)
  for (let y = 1; y <= 7; y += 1) {
    for (let x = 1; x <= 7; x += 1) coverage[y * size + x] = 1
  }

  const field = signedDistanceField(coverage, size, size)

  assert.ok(Math.abs(at(field, size, 1, 4) - -1) < 1e-9)
  assert.ok(Math.abs(at(field, size, 2, 4) - -2) < 1e-9)
  assert.ok(Math.abs(at(field, size, 4, 4) - -4) < 1e-9)
})

test('tamamen boş harita sonlu ve pozitif kalır', () => {
  const size = 4
  const field = signedDistanceField(emptyCoverage(size, size), size, size)
  const limit = Math.hypot(size, size)
  for (const value of field) {
    assert.ok(Number.isFinite(value))
    assert.ok(value > 0 && value <= limit)
  }
})

test('tamamen dolu harita sonlu ve negatif kalır', () => {
  const size = 4
  const coverage = new Float32Array(size * size).fill(1)
  const field = signedDistanceField(coverage, size, size)
  const limit = Math.hypot(size, size)
  for (const value of field) {
    assert.ok(Number.isFinite(value))
    assert.ok(value < 0 && value >= -limit)
  }
})

test('kare olmayan alanda satır ve sütun eksenleri karışmaz', () => {
  const width = 9
  const height = 3
  const coverage = emptyCoverage(width, height)
  coverage[1 * width + 4] = 1

  const field = signedDistanceField(coverage, width, height)

  assert.equal(at(field, width, 4, 1), -1)
  assert.ok(Math.abs(at(field, width, 8, 1) - 4) < 1e-6)
  assert.ok(Math.abs(at(field, width, 4, 0) - 1) < 1e-6)
})
