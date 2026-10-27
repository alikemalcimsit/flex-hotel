import qrcode from 'qrcode-generator';

/**
 * QR kodu (modül 41: misafirin oda servisi bağlantısı; modül 53 misafir sayfaları da kullanır).
 *
 * `qrcode-generator` (MIT, bağımlılıksız; QR'ın başvuru kitaplıklarının yazarı Kazuhiko Arase) ile üretilir: hata
 * düzeltme ve maske seçimi standarda göre kitaplıkta. Çıktı **SVG**'dir — ekranda da basılı oda kartında da keskin
 * kalır. Hata düzeltme düzeyi **M** (%15): oda kartı kırışsa / lekelense de okunur, kod gereğinden büyümez. Sürüm
 * (boyut) metne göre kendiliğinden seçilir.
 */

/** Kenar boşluğu (modül): okuyucuların istediği sessiz bölge 4 modüldür. */
const QUIET_ZONE = 4;
/** Hata düzeltme düzeyi. */
const ERROR_CORRECTION = 'M';

/**
 * Metnin QR kodu: ölçeklenebilir SVG (genişlik / yükseklik kapsayıcıdan), siyah modüller beyaz zeminde.
 * @param {string} text bağlantı (ASCII)
 * @param {{ title?: string }} [options] ekran okuyucu adı
 * @returns {string} `<svg …>` metni
 */
export function qrSvg(text, { title = 'QR kodu' } = {}) {
  const qr = qrcode(0, ERROR_CORRECTION);
  qr.addData(text, 'Byte');
  qr.make();
  return qr.createSvgTag({ cellSize: 1, margin: QUIET_ZONE, scalable: true, title: { text: title, id: 'qr-title' } });
}

/**
 * QR'ın modül sayısı (test ve boyut kararı için).
 * @param {string} text
 */
export function qrModuleCount(text) {
  const qr = qrcode(0, ERROR_CORRECTION);
  qr.addData(text, 'Byte');
  qr.make();
  return qr.getModuleCount();
}
