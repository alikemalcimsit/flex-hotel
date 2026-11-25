import { findMrzLines, mrzProblems, parseMrz } from '@hotelos/hotel-contracts';

/**
 * Tarayıcıda MRZ okuma (modül 59). Görüntü cihazdan çıkmaz: OCR (tesseract.js, WebAssembly) bu sekmede çalışır,
 * dosyaları kendi sunucumuzdan gelir (`/ocr/…`, bkz. vite.config.js) — CDN ya da üçüncü taraf yok. Sonuçta
 * yalnız MRZ satırları kalır; tuvaller okumadan sonra sıfırlanır.
 *
 * Okuma sırası (ilk sağlaması tutan kazanır): belgenin alt bandı (MRZ orada) olduğu gibi, aynı bant kontrastı
 * açılmış (soluk / gölgeli fotoğraf), tüm görüntü, ters (180°) tutulmuş belge, yan (90° / 270°) çekilmiş fotoğraf.
 * Kontrast her zaman açılmaz: net fotoğrafta OCR'ın dolguyu ('<') fazladan okumasına yol açıyor. Tutan yoksa en az sorunlu okuma döner; personel satırları elle
 * düzeltebilir, sunucu yine sağlar.
 */

const OCR_BASE = `${import.meta.env.BASE_URL ?? '/'}ocr`;
/** OCR'a giden görüntünün genişliği: MRZ karakterleri ~25–35 px yükseklikte kalsın. */
const TARGET_WIDTH = 1800;
/** MRZ bandı: belgenin alt kısmı (pasaportta ~%25, kimlik kartının arka yüzünde ~%40). */
const MRZ_BAND_TOP = 0.5;
const WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<';
/** Tek blok metin (tesseract PSM 6). */
const PAGE_SEG_BLOCK = '6';

/** Son okumadan bu kadar sonra işçi bırakılır (sekmede ~30–50 MB tutar); sonraki okuma önbellekten ~1 sn'de açar. */
const IDLE_RELEASE_MS = 5 * 60_000;

let workerPromise = null;
/** @type {((progress: { status: string, progress: number }) => void) | null} */
let progressListener = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let idleTimer = null;

/**
 * OCR işçisi (sekme başına bir kez; ilk kullanımda dil verisi indirilir, tarayıcı önbelleğe alır).
 * @param {(progress: { status: string, progress: number }) => void} [onProgress]
 */
export async function getMrzWorker(onProgress) {
  progressListener = onProgress ?? null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM } = await import('tesseract.js');
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: `${OCR_BASE}/worker.min.js`,
        corePath: `${OCR_BASE}/core`,
        langPath: `${OCR_BASE}/lang`,
        gzip: true,
        workerBlobURL: false,
        logger: (message) => progressListener?.({ status: message.status, progress: message.progress ?? 0 }),
      });
      await worker.setParameters({ tessedit_char_whitelist: WHITELIST, tessedit_pageseg_mode: PAGE_SEG_BLOCK, preserve_interword_spaces: '0' });
      return worker;
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

/** Sekme kapanırken / uzun süre kullanılmayınca işçiyi bırakır. */
export async function releaseMrzWorker() {
  const pending = workerPromise;
  workerPromise = null;
  if (pending) (await pending.catch(() => null))?.terminate();
}

/** Telefon fotoğrafının EXIF yönü uygulanarak çözülür. @param {Blob} blob */
export async function loadBitmap(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Döndürülmüş, kırpılmış, gri tonlu ve kontrastı açılmış tuval. Saf hesap: dışarıda test edilir.
 * @param {{ width: number, height: number }} size @param {0 | 90 | 180 | 270} rotate @param {number} bandTop 0 = tüm görüntü
 */
export function variantGeometry(size, rotate, bandTop) {
  const sideways = rotate === 90 || rotate === 270;
  const width = sideways ? size.height : size.width;
  const height = sideways ? size.width : size.height;
  const cropTop = Math.round(height * bandTop);
  const cropHeight = height - cropTop;
  const scale = TARGET_WIDTH / width;
  return { width, height, cropTop, cropHeight, outWidth: TARGET_WIDTH, outHeight: Math.max(1, Math.round(cropHeight * scale)), scale };
}

/** @param {ImageBitmap | HTMLImageElement} bitmap @param {0 | 90 | 180 | 270} rotate @param {number} bandTop @param {boolean} contrast */
function drawVariant(bitmap, rotate, bandTop, contrast) {
  const geometry = variantGeometry({ width: bitmap.width, height: bitmap.height }, rotate, bandTop);
  // Önce döndürülmüş tam görüntü, sonra bant ölçeklenerek çıkış tuvaline.
  const turned = document.createElement('canvas');
  turned.width = geometry.width;
  turned.height = geometry.height;
  const t = turned.getContext('2d');
  t.translate(geometry.width / 2, geometry.height / 2);
  t.rotate((rotate * Math.PI) / 180);
  t.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  const out = document.createElement('canvas');
  out.width = geometry.outWidth;
  out.height = geometry.outHeight;
  const o = out.getContext('2d', { willReadFrequently: true });
  o.imageSmoothingQuality = 'high';
  o.drawImage(turned, 0, geometry.cropTop, geometry.width, geometry.cropHeight, 0, 0, geometry.outWidth, geometry.outHeight);
  turned.width = 0;
  turned.height = 0;
  if (contrast) enhance(o, out.width, out.height);
  return out;
}

/** Gri ton + %2–%98 aralığına kontrast germe (parlak / gölgeli fotoğraf). */
function enhance(context, width, height) {
  const image = context.getImageData(0, 0, width, height);
  const { data } = image;
  const histogram = new Uint32Array(256);
  for (let index = 0; index < data.length; index += 4) {
    const gray = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
    data[index] = gray;
    histogram[gray] += 1;
  }
  const total = width * height;
  let low = 0;
  let high = 255;
  for (let sum = 0; low < 255 && (sum += histogram[low]) < total * 0.02; low += 1);
  for (let sum = 0; high > 0 && (sum += histogram[high]) < total * 0.02; high -= 1);
  const range = Math.max(1, high - low);
  for (let index = 0; index < data.length; index += 4) {
    const value = Math.max(0, Math.min(255, Math.round(((data[index] - low) * 255) / range)));
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }
  context.putImageData(image, 0, 0);
}

/** Dikey fotoğrafta (yan çekilmiş kart) yan dönüşler önce denenir. */
function attemptsFor(bitmap) {
  const portrait = bitmap.height > bitmap.width * 1.15;
  const upright = [
    [0, MRZ_BAND_TOP, false],
    [0, MRZ_BAND_TOP, true],
    [0, 0, false],
    [180, MRZ_BAND_TOP, false],
  ];
  const sideways = [
    [90, MRZ_BAND_TOP, false],
    [270, MRZ_BAND_TOP, false],
  ];
  return portrait ? [...sideways, ...upright] : [...upright, ...sideways];
}

/**
 * @typedef {{ text: string, lines: string[], parsed: import('@hotelos/hotel-contracts').ParsedMrz, problems: string[] }} MrzReadResult
 */

/**
 * Görüntüden MRZ okur.
 * @param {Blob} blob
 * @param {{ today: string, onProgress?: (progress: { status: string, progress: number }) => void, signal?: AbortSignal }} options
 * @returns {Promise<MrzReadResult | null>} hiç MRZ bulunamazsa null
 */
export async function readMrzFromImage(blob, { today, onProgress, signal }) {
  const worker = await getMrzWorker(onProgress);
  const bitmap = await loadBitmap(blob);
  /** @type {MrzReadResult | null} */
  let best = null;
  try {
    for (const [rotate, band, contrast] of attemptsFor(bitmap)) {
      if (signal?.aborted) throw new DOMException('Okuma iptal edildi', 'AbortError');
      const canvas = drawVariant(bitmap, /** @type {any} */ (rotate), /** @type {number} */ (band), Boolean(contrast));
      let text;
      try {
        ({ data: { text } } = await worker.recognize(canvas));
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
      const found = findMrzLines(text);
      if (!found) continue;
      const parsed = parseMrz(found.lines, { today });
      if (!parsed) continue;
      const problems = mrzProblems(parsed);
      const result = { text: found.lines.join('\n'), lines: found.lines, parsed, problems };
      if (problems.length === 0) return result;
      if (!best || problems.length < best.problems.length) best = result;
    }
    return best;
  } finally {
    if ('close' in bitmap) bitmap.close();
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      releaseMrzWorker();
    }, IDLE_RELEASE_MS);
  }
}
