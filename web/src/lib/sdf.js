/**
 * Kapama (coverage) haritasından işaretli mesafe alanı (SDF) üretir.
 *
 * NEDEN SDF: iki harfi köşe köşe ara değerlemek (nokta bulutu ya da çokgen
 * morph'u) harfin kendi üstüne KATLANMASINA yol açar — F'in kolları L'in
 * gövdesine çekilirken kenarlar birbirini keser, yüzey delinir, parçalanır.
 * Mesafe alanları ara değerlendiğinde ise sonuç her zaman geçerli, kapalı ve
 * TEK parça bir gövdedir; kesişme ya da kopuk parça matematiksel olarak
 * oluşamaz. Harfler bu yüzden alan olarak saklanır, kenar listesi olarak değil.
 *
 * NEDEN İKİLİ MASKE DEĞİL: 0/1'e yuvarlanmış bir maskede kenarın yeri piksel
 * ızgarasına çakılır. Eğik bir kenar (marka logosundaki 6 derece) böyle
 * merdiven basamaklarına dönüşür ve bu basamaklar mesafe alanına gömülüp
 * yüzeyde düzenli aralıklı TIRTIK olarak görünür. Kısmi kapama değerleri
 * kullanılınca kenarın piksel içindeki gerçek yeri korunur, yüzey pürüzsüz
 * çıkar.
 */

/** Kaynak olmayan hücrelerin başlangıç maliyeti. */
const UNREACHABLE = 1e20

/**
 * Felzenszwalb–Huttenlocher tek boyutlu kare-mesafe dönüşümü (O(n)).
 *
 * `f` maliyet dizisidir: kaynak hücreler 0, diğerleri UNREACHABLE. Sonuç `d`
 * dizisine yazılır. `v` ve `z` çağrı başına yeniden ayrılmasın diye dışarıdan
 * verilen çalışma tamponlarıdır.
 *
 * @param {Float64Array} f @param {Float64Array} d
 * @param {Int32Array} v @param {Float64Array} z @param {number} n
 */
export function edt1d(f, d, v, z, n) {
  v[0] = 0
  z[0] = -UNREACHABLE
  z[1] = UNREACHABLE
  let k = 0
  for (let q = 1; q < n; q += 1) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k -= 1
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k += 1
    v[k] = q
    z[k] = s
    z[k + 1] = UNREACHABLE
  }
  k = 0
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1
    const delta = q - v[k]
    d[q] = delta * delta + f[v[k]]
  }
}

/**
 * İki boyutlu kare-mesafe dönüşümü: önce sütunlar, sonra satırlar.
 * `costs` yerinde güncellenir.
 * @param {Float64Array} costs @param {number} width @param {number} height
 */
export function edt2d(costs, width, height) {
  const span = Math.max(width, height)
  const source = new Float64Array(span)
  const result = new Float64Array(span)
  const hull = new Int32Array(span)
  const breaks = new Float64Array(span + 1)

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) source[y] = costs[y * width + x]
    edt1d(source, result, hull, breaks, height)
    for (let y = 0; y < height; y += 1) costs[y * width + x] = result[y]
  }
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    for (let x = 0; x < width; x += 1) source[x] = costs[row + x]
    edt1d(source, result, hull, breaks, width)
    for (let x = 0; x < width; x += 1) costs[row + x] = result[x]
  }
  return costs
}

/**
 * Kapama haritasından piksel biriminde işaretli mesafe üretir: içeride negatif,
 * dışarıda pozitif.
 *
 * Kısmen dolu bir pikselin merkezi kenardan yaklaşık `0.5 - kapama` kadar
 * uzaktadır. Bu değer mesafe dönüşümüne BAŞLANGIÇ MALİYETİ olarak verilir;
 * böylece kenarın piksel içindeki alt piksel konumu alana taşınır ve sıfır
 * geçişi ızgaraya çakılmadan, eğik kenarlarda bile pürüzsüz ilerler.
 *
 * @param {Float32Array|number[]} coverage - Hücre başına 0..1 doluluk oranı
 * @param {number} width @param {number} height
 * @returns {Float32Array} piksel biriminde işaretli mesafe
 */
export function signedDistanceField(coverage, width, height) {
  const count = width * height
  const outward = new Float64Array(count)
  const inward = new Float64Array(count)
  for (let index = 0; index < count; index += 1) {
    const filled = coverage[index]
    if (filled <= 0) {
      outward[index] = UNREACHABLE
      inward[index] = 0
    } else if (filled >= 1) {
      outward[index] = 0
      inward[index] = UNREACHABLE
    } else {
      // Yarım pikselin hangi tarafında kaldıysa o yönün kaynağı olur; öbür
      // yöne alt piksel sapması kadar maliyetle katılır.
      const offset = 0.5 - filled
      outward[index] = offset > 0 ? offset * offset : 0
      inward[index] = offset < 0 ? offset * offset : 0
    }
  }
  edt2d(outward, width, height)
  edt2d(inward, width, height)

  // Tamamen dolu ya da tamamen boş haritada karşı taraf hiç bulunamaz; alan
  // sonsuza gitmesin diye çerçeve köşegeniyle sınırlanır.
  const limit = Math.hypot(width, height)
  const field = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    const signed = Math.sqrt(outward[index]) - Math.sqrt(inward[index])
    field[index] = Math.max(-limit, Math.min(limit, signed))
  }
  return field
}
