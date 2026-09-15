import { signedDistanceField } from './sdf.js'

/**
 * "Flex" + değişen sektör adından oluşan marka kilidini işaretli mesafe
 * alanlarına çevirir.
 *
 * NEDEN TARAYICIYA ÇİZDİRİYORUZ: three.js'in `TextGeometry`'si typeface.json
 * biçiminde ayrı font dosyaları ister; sayfada yüklü webfont'ları kullanamaz.
 * Sekiz sektörün sekiz ayrı tipografisi olduğu için bu yol tek gerçekçi olan:
 * kelimeyi canvas'a çizip piksellerini okuyunca her sektör kendi fontuyla,
 * birebir korunuyor.
 *
 * NEDEN MESAFE ALANI: sektörler birbirine dönüşürken kelimelerin harf sayısı
 * ve şekli tamamen değişiyor. Köşe köşe ara değerleme burada kaçınılmaz olarak
 * kendi üstüne katlanır; mesafe alanı karışımı her ara karede geçerli, kapalı
 * ve tek parça bir gövde verir.
 */

/** Sektör alanları RGBA kanallarına paketlenir. */
export const CHANNELS_PER_TEXTURE = 4

/**
 * Kabuk iki sektör dokusu örnekliyor; sınır oradan geliyor. Daha fazlası
 * gerekirse hem burası hem FlexShape'teki örnekleyiciler artırılmalı.
 */
export const MAX_SECTORS = 8

/**
 * Büyük harf yüksekliğinin alan pikseli cinsinden hedefi.
 *
 * Ekranda kilit yaklaşık 115 aygıt pikseli yüksekliğe oturuyor; alanın bundan
 * belirgin yüksek olması gerekiyor ki büyütme yumuşamasın. 160 bu payı verirken
 * alan üretimini de makul tutuyor (sekiz sektör + marka = dokuz alan).
 */
export const CAP_HEIGHT_PX = 160

/** Kelimeler arası boşluk ve alan kenar payı — büyük harf yüksekliğine oranla. */
const WORD_GAP_RATIO = 0.1
const MARGIN_RATIO = 0.34

/*
 * Ölçüm tuvali. En uzun kelime ("Academy") ve en açık harf aralıklı kelime
 * ("Clinic", 0.2em) buraya TAMAMEN sığmak zorunda: kenardan taşan mürekkep
 * sessizce kırpılır, kelime olduğundan dar ölçülür ve alan dar üretilip
 * kelimenin sonu kesilir.
 */
const PROBE_WIDTH = 1024
const PROBE_HEIGHT = 352
const PROBE_PEN_X = 32
const PROBE_BASELINE_Y = 250
const PROBE_FONT_PX = 160

/** @param {number} degrees */
function toRadians(degrees) {
  return (degrees * Math.PI) / 180
}

function createContext(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas.getContext('2d', { willReadFrequently: true })
}

/**
 * Kelimeyi verilen kalem konumuna, kendi tipografisiyle çizer.
 *
 * Eğim TABAN ÇİZGİSİ etrafında uygulanır: harflerin üstü sağa yatar, otururken
 * kaymazlar — logodaki `-skew-x-6` ile aynı davranış.
 */
function drawWord(ctx, spec, fontPx, penX, baselineY) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  // Harf aralığı her tarayıcıda yok; olmadığında kelime normal aralıkla çizilir
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${(spec.trackingEm ?? 0) * fontPx}px`
  }
  ctx.font = `${spec.weight} ${fontPx}px ${spec.family}`
  ctx.translate(penX, baselineY)
  if (spec.skewDegrees) {
    ctx.transform(1, 0, Math.tan(toRadians(spec.skewDegrees)), 1, 0, 0)
  }
  ctx.fillText(spec.label, 0, 0)
}

/** Alfa kanalını 0..1 kapama oranına çevirir (bkz. sdf.js). */
function readCoverage(ctx, width, height) {
  const { data } = ctx.getImageData(0, 0, width, height)
  const coverage = new Float32Array(width * height)
  for (let index = 0; index < coverage.length; index += 1) {
    coverage[index] = data[index * 4 + 3] / 255
  }
  return coverage
}

/** Mürekkebin kapladığı kutu; hiçbir şey çizilmediyse null. */
function inkBounds(coverage, width, height) {
  let minX = width
  let maxX = -1
  let minY = height
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (coverage[y * width + x] < 0.5) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  return { minX, maxX, minY, maxY }
}

/**
 * Kapama haritasını yatayda tam sayı piksel kaydırır.
 *
 * Yalnızca YATAY: kelimeler ortak taban çizgisine oturuyor, dikey kaydırma
 * onları birbirinden koparırdı. Tam sayı kaydırma alt piksel bilgisini bozmaz.
 */
function shiftCoverageX(coverage, width, height, dx) {
  if (dx === 0) return coverage
  const shifted = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    for (let x = 0; x < width; x += 1) {
      const value = coverage[row + x]
      if (value === 0) continue
      const targetX = x + dx
      if (targetX < 0 || targetX >= width) continue
      shifted[row + targetX] = value
    }
  }
  return shifted
}

/**
 * Bir kelimenin ölçüleri: hedef büyük harf yüksekliğine oturan font boyu ve
 * taban çizgisine göre mürekkep kutusu.
 *
 * Büyük harf yüksekliği kelimenin İLK HARFİNDEN ölçülür; kelimenin kendi
 * üst sınırı kullanılamaz, çünkü "Hotel"deki `l` ve `t` büyük harf hizasının
 * üstüne çıkar. Fontlar ancak ortak büyük harf yüksekliğine getirilince aynı
 * boyda görünür.
 */
function measureSpec(probeCtx, spec, capHeight) {
  drawWord(probeCtx, spec, PROBE_FONT_PX, PROBE_PEN_X, PROBE_BASELINE_Y)
  const wordBounds = inkBounds(
    readCoverage(probeCtx, PROBE_WIDTH, PROBE_HEIGHT),
    PROBE_WIDTH,
    PROBE_HEIGHT
  )
  if (!wordBounds) return null

  if (wordBounds.maxX >= PROBE_WIDTH - 1 || wordBounds.minY <= 0) {
    console.warn(`"${spec.label}" ölçüm tuvaline sığmadı; PROBE ölçüleri büyütülmeli`)
  }

  // Tek büyük harfin mürekkep yüksekliği = büyük harf yüksekliği. Yatay eğim
  // yüksekliği değiştirmediği için ölçüm eğimden bağımsızdır. `measureText`
  // rasterleştirmeden veriyor; ikinci bir tuval taraması ölçüm adımını iki
  // katına çıkarıyordu.
  probeCtx.setTransform(1, 0, 0, 1, 0, 0)
  if ('letterSpacing' in probeCtx) probeCtx.letterSpacing = '0px'
  probeCtx.font = `${spec.weight} ${PROBE_FONT_PX}px ${spec.family}`
  const ascent = probeCtx.measureText(spec.label[0]).actualBoundingBoxAscent
  // Tarayıcı bu ölçüyü vermiyorsa kelimenin kendi üst sınırına düşülür:
  // çıkıntılı harflerde biraz küçük çizer ama hiç çizmemekten iyidir
  const probeCapHeight =
    Number.isFinite(ascent) && ascent > 0 ? ascent : PROBE_BASELINE_Y - wordBounds.minY
  if (probeCapHeight <= 0) return null

  // Büyük harf yüksekliği font boyuyla doğrusal ölçeklendiği için tek adım yeter
  const scale = capHeight / probeCapHeight
  return {
    spec,
    fontPx: PROBE_FONT_PX * scale,
    inkWidth: (wordBounds.maxX - wordBounds.minX + 1) * scale,
    above: (PROBE_BASELINE_Y - wordBounds.minY) * scale,
    below: (wordBounds.maxY - PROBE_BASELINE_Y) * scale,
  }
}

/**
 * Ölçülerden alan boyutunu ve kelime konumlarını hesaplar (saf).
 *
 * Sektörler SOLA hizalanır: hepsi aynı x'te başlar, böylece hangi sektör
 * gösterilirse gösterilsin "Flex"e bitişik durur ve kelime uzayıp kısalırken
 * sol kenar yerinden oynamaz.
 *
 * @param {{inkWidth: number, above: number, below: number}} brand
 * @param {Array<{inkWidth: number, above: number, below: number}>} sectors
 * @param {{capHeight: number, gapRatio?: number, marginRatio?: number}} options
 */
export function planWordmarkLayout(brand, sectors, { capHeight, gapRatio, marginRatio } = {}) {
  const gap = capHeight * (gapRatio ?? WORD_GAP_RATIO)
  const margin = capHeight * (marginRatio ?? MARGIN_RATIO)
  const all = [brand, ...sectors]

  const widestSector = sectors.reduce((widest, item) => Math.max(widest, item.inkWidth), 0)
  const above = all.reduce((highest, item) => Math.max(highest, item.above), 0)
  const below = all.reduce((lowest, item) => Math.max(lowest, item.below), 0)

  // Çift sayıya yuvarlanır: doku boyutları tek kalınca bazı sürücülerde
  // satır hizalaması sorun çıkarıyor
  const width = 2 * Math.ceil((2 * margin + brand.inkWidth + gap + widestSector) / 2)
  const height = 2 * Math.ceil((2 * margin + above + below) / 2)

  return {
    width,
    height,
    baselineY: Math.round(margin + above),
    brandX: Math.round(margin),
    sectorX: Math.round(margin + brand.inkWidth + gap),
    capHeight,
  }
}

/**
 * Marka kilidinin alanlarını KELİME KELİME üretir.
 *
 * Jeneratör: dokuz alanın hepsini tek seferde üretmek ana iş parçacığında
 * saniyeye yakın bir kilitlenme demek. Çağıran her adımdan sonra tarayıcıya
 * dönebilsin diye iş bölündü.
 *
 * @param {object} brand @param {object[]} sectors
 * @param {{capHeight?: number}} [options]
 * @yields {{width: number, height: number, unitsPerPixel: number,
 *   halfExtentX: number, halfExtentY: number, brand: Float32Array,
 *   sectors: Float32Array[], ready: number, total: number}}
 */
export function* streamWordmarkFields(brand, sectors, { capHeight = CAP_HEIGHT_PX } = {}) {
  if (sectors.length > MAX_SECTORS) {
    throw new Error(`en çok ${MAX_SECTORS} sektör desteklenir`)
  }

  const probeCtx = createContext(PROBE_WIDTH, PROBE_HEIGHT)
  const brandMetrics = measureSpec(probeCtx, brand, capHeight)
  const sectorMetrics = sectors.map((spec) => measureSpec(probeCtx, spec, capHeight))
  // Fontlar gelmediyse ölçüm boş çıkar; uydurma bir kilit çizmektense hiç çizme
  if (!brandMetrics || sectorMetrics.some((item) => item === null)) return

  const layout = planWordmarkLayout(brandMetrics, sectorMetrics, { capHeight })
  const unitsPerPixel = 1 / capHeight
  const textureCount = Math.ceil(sectors.length / CHANNELS_PER_TEXTURE)

  // Sektörün kendi yatay ekseni: çevirme buradan döner, kelime dengeli
  // görünsün diye mürekkebinin tam ortasından geçer
  const sectorAbove = sectorMetrics.reduce((top, item) => Math.max(top, item.above), 0)
  const sectorBelow = sectorMetrics.reduce((low, item) => Math.max(low, item.below), 0)
  const sectorMidY = layout.baselineY - (sectorAbove - sectorBelow) / 2
  const sectorPivotY = (layout.height / 2 - sectorMidY) * unitsPerPixel
  const sectorSweep = ((sectorAbove + sectorBelow) / 2) * unitsPerPixel

  const cells = layout.width * layout.height
  const brandField = new Float32Array(cells)
  const sectorFields = Array.from(
    { length: textureCount },
    () => new Float32Array(cells * CHANNELS_PER_TEXTURE)
  )
  const frame = {
    width: layout.width,
    height: layout.height,
    unitsPerPixel,
    halfExtentX: (layout.width / 2) * unitsPerPixel,
    halfExtentY: (layout.height / 2) * unitsPerPixel,
    // Mürekkebin alan kenarına en yakın olduğu mesafe: alanın dışına düşen
    // örnekleme noktaları için güvenli bir alt sınır olarak kullanılıyor
    fieldMargin: MARGIN_RATIO,
    sectorPivotY,
    sectorSweep,
    capHeight,
    brand: brandField,
    sectors: sectorFields,
    total: 1 + sectors.length,
  }

  const fieldCtx = createContext(layout.width, layout.height)
  // Ölçüm kendi başına bir adım: marka alanıyla aynı göreve sıkıştırılınca
  // ana iş parçacığı yüz milisaniyeyi aşıyordu
  yield { ...frame, ready: 0 }

  /** Kelimeyi çizer, mürekkebi hedef x'e oturtur, mesafe alanını döner. */
  function fieldFor(metrics, targetX) {
    drawWord(fieldCtx, metrics.spec, metrics.fontPx, targetX, layout.baselineY)
    let coverage = readCoverage(fieldCtx, layout.width, layout.height)
    const bounds = inkBounds(coverage, layout.width, layout.height)
    if (bounds)
      coverage = shiftCoverageX(coverage, layout.width, layout.height, targetX - bounds.minX)
    return signedDistanceField(coverage, layout.width, layout.height)
  }

  const brandDistances = fieldFor(brandMetrics, layout.brandX)
  for (let cell = 0; cell < cells; cell += 1) {
    brandField[cell] = brandDistances[cell] * unitsPerPixel
  }
  yield { ...frame, ready: 1 }

  // Kullanılmayan kanallar "çok uzakta" kalır; yüzey üretmezler
  const farAway = Math.max(frame.halfExtentX, frame.halfExtentY)
  for (let index = 0; index < textureCount * CHANNELS_PER_TEXTURE; index += 1) {
    const target = sectorFields[Math.floor(index / CHANNELS_PER_TEXTURE)]
    const channel = index % CHANNELS_PER_TEXTURE
    const metrics = sectorMetrics[index]

    if (metrics === undefined) {
      for (let cell = 0; cell < cells; cell += 1) target[cell * 4 + channel] = farAway
      continue
    }
    const distances = fieldFor(metrics, layout.sectorX)
    for (let cell = 0; cell < cells; cell += 1) {
      target[cell * 4 + channel] = distances[cell] * unitsPerPixel
    }
    yield { ...frame, ready: 2 + index }
  }
}
