/**
 * FlexAI'nin hazır yasal parametre setleri (modül 51).
 *
 * Kodda sabit değil, **kataloğa** yazılı: otel "hazır setleri yükle" dediğinde kendi `PayrollParameterSet`
 * tablosuna kopyalanır, gerekirse düzeltilir (denetim izinde) ve bir yetkili "teyit ettim" demeden o setle
 * hesaplanan bordro onaya gönderilemez. Mevzuat değişince buraya yeni set eklenir; oteller ekranda "yeni hazır set
 * var" görür.
 *
 * Bir ay, ayın **son günü** yürürlükte olan setle hesaplanır (ay içi değişiklikte gün bölünmez). Kıdem tavanı
 * çıkış gününde yürürlükte olan setten okunur.
 *
 * Kaynaklar 2 Kasım 2026'da derlendi; resmî metinle (Resmî Gazete, SGK genelgesi, GİB tebliği) teyit edilmeden
 * kullanılmamalı — ekran bunu "teyit edilmedi" diye gösterir.
 */

const BRACKETS_2026 = Object.freeze([
  { upTo: '190000.00', rate: '0.15' },
  { upTo: '400000.00', rate: '0.20' },
  { upTo: '1500000.00', rate: '0.27' },
  { upTo: '5300000.00', rate: '0.35' },
  { upTo: null, rate: '0.40' },
]);

const BASE_2026 = Object.freeze({
  minWageGross: '33030.00',
  sgkFloorDaily: '1101.00',
  sgkCeilingDaily: '9909.00',
  rates: {
    // 7566 sayılı Kanunla malullük-yaşlılık-ölüm işveren hissesi 1 puan arttı: 12 + 2,25 + 7,5
    NORMAL: { employeeSgk: '0.14000', employeeUnemployment: '0.01000', employerSgk: '0.21750', employerUnemployment: '0.02000' },
    // Sosyal güvenlik destek primi: işçi %7,5; işveren %22,5 + kısa vadeli %2,25; işsizlik yok
    RETIRED: { employeeSgk: '0.07500', employeeUnemployment: '0.00000', employerSgk: '0.24750', employerUnemployment: '0.00000' },
  },
  treasuryPoints: { GENERAL: '2.00', MANUFACTURING: '5.00' },
  stampDutyRate: '0.00759',
  taxBrackets: BRACKETS_2026,
  disability: { 1: '12000.00', 2: '7000.00', 3: '3000.00' },
  mealGvDaily: '300.00',
  mealSgkDaily: '158.00',
  transportGvDaily: '158.00',
  severanceCeiling: '64948.77',
  besRate: '0.03000',
});

const SOURCES_2026 = Object.freeze([
  { label: 'SGK — Prime esas kazanç miktarları 2026 (taban / tavan)', url: 'https://www.sgk.gov.tr/Content/Post/2e0c9e1a-2cfe-4456-af10-49d3de0c58ba/Prime-Esas-Kazanc-Miktarlari-2026-01-14-10-35-39' },
  { label: '7566 sayılı Kanun (RG 19.12.2025): işveren primi, tavan 9 kat', url: 'https://kpmgvergi.com/yayinlar/mali-bultenler/vergi/7566-sayili-kanun-resmi-gazete-de-yayimlandi/3316' },
  { label: 'SGK Genelgesi 2026/1: Hazine desteği imalat dışı 2 puan', url: 'https://www.alomaliye.com/2026/01/07/sgk-genelgesi-2026-1/' },
  { label: '332 Seri No.lu GV Genel Tebliği: 2026 tarifesi ve had / tutarlar', url: 'https://kpmgvergi.com/yayinlar/mali-bultenler/vergi/2026-yili-gelir-vergisi-dilimleri-ile-dikkate-alinacak-bazi-had-ve-tutarlar-belirlendi/3351' },
  { label: '2026 asgari ücreti', url: 'https://www.ey.com/tr_tr/insights/tax/2026-asgari-ucret' },
  { label: 'Kıdem tazminatı tavanı (Ocak / Temmuz 2026)', url: 'https://www.alomaliye.com/kidem-tazminati-tavani/' },
]);

/** @type {ReadonlyArray<{ key: string, validFrom: string, label: string, values: any, sources: ReadonlyArray<{ label: string, url: string | null }> }>} */
export const BUILT_IN_PARAMETER_SETS = Object.freeze([
  { key: '2026-01', validFrom: '2026-01-01', label: '2026 Ocak', values: BASE_2026, sources: SOURCES_2026 },
  {
    key: '2026-04-17',
    validFrom: '2026-04-17',
    label: '2026 Nisan (SGK yemek istisnası 300 TL)',
    values: { ...BASE_2026, mealSgkDaily: '300.00' },
    sources: [...SOURCES_2026, { label: '7577 sayılı Kanun: SGK yemek istisnası 300 TL (17.04.2026)', url: 'https://pkf.com.tr/sgk-yemek-istisnasinda-degisiklik-yapildi-17-nisan-2026/' }],
  },
  {
    key: '2026-07',
    validFrom: '2026-07-01',
    label: '2026 Temmuz (kıdem tavanı)',
    values: { ...BASE_2026, mealSgkDaily: '300.00', severanceCeiling: '73729.87' },
    sources: [...SOURCES_2026, { label: 'Çalışma Genel Müdürlüğü: kıdem tavanı 01.07.2026', url: 'https://x.com/cgm_csgb/status/2079157224333562088' }],
  },
]);
