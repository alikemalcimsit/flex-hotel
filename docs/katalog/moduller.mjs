/**
 * Katalogdaki modüllerin kaydı: kodun nerede olduğu (olguların çıkarılacağı yerler), rotaların öneki,
 * migration'lar, izin grupları, olay önekleri ve ekran görüntüsü tanımları. İçerik metni
 * `moduller/NN-slug.typ` dosyasındadır.
 *
 * Ekran tanımı: `{ dosya, yol | bul, bekle, aciklama, eylem?, sonraBekle?, genislik?, yukseklik? }`
 * - `bul`: kimliği önceden bilinmeyen sayfa için uygulamanın API istemcisiyle (`api`) yol döndüren gövde.
 * - `bekle`: sayfada görünmesi gereken yazılar (`|` ile birden çok; büyük / küçük harf duyarsız).
 * - `eylem`: görüntüden önce sayfada çalışan JS (ör. bir düğmeye tıklayıp pencere açmak).
 */

import { DIGER } from "./moduller-diger.mjs";

/** Ön yüzde düğmeye adıyla tıklayan küçük eylem. @param {string} label */
export const tikla = (label) => `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click(); await new Promise((r) => setTimeout(r, 900));`;

const SATIN_ALMA = [
  {
    numara: 45,
    slug: 'satin-alma',
    ad: 'Satın alma',
    slogan: 'Talepten teklife, siparişten mal kabule tek zincir — mal kabulde stok kendiliğinden girer.',
    arka: ['hotel/backend/src/modules/purchasing', 'hotel/backend/src/modules/stock'],
    on: ['hotel/frontend/src/pages/purchasing', 'hotel/frontend/src/pages/stock', 'hotel/frontend/src/lib/purchasingFormat.js'],
    sozlesme: ['hotel/contracts/purchasing.js', 'hotel/contracts/stock.js'],
    rotalar: [/^\/purchasing\//, /^\/stock\//],
    migrationlar: ['20261029090000_purchasing_stock'],
    izinGruplari: ['purchasing', 'stock'],
    olaylar: ['purchase.', 'stock.'],
    ekranlar: [
      {
        dosya: '45-karsilastirma',
        bul: "const page = await api('/purchasing/rounds?status=OPEN&page=1&pageSize=1'); return page.items[0] ? '/satin-alma/teklif-turlari/' + page.items[0].id : null;",
        bekle: 'Karşılaştırma|Kazanan seçimi',
        alan: 'tam',
        genislik: 1720,
        yukseklik: 1240,
        aciklama: 'Teklif karşılaştırma: malzemeler satırda, tedarikçi teklifleri sütunda. Yeşil hücre satırın en uygun teklifi; "geç" rozeti ihtiyaç gününden sonra teslim edecek teklif. Kazanan satır bazında seçilir.',
      },
      {
        dosya: '45-kazanan',
        bul: "const page = await api('/purchasing/rounds?status=OPEN&page=1&pageSize=1'); return page.items[0] ? '/satin-alma/teklif-turlari/' + page.items[0].id : null;",
        bekle: 'Kazanan seçimi|Seçilenleri siparişe çevir',
        eylem: "document.querySelector('button')?.blur(); [...document.querySelectorAll('h2, h3, div')].find((n) => n.textContent.trim() === 'Kazanan seçimi')?.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 500));",
        genislik: 1720,
        yukseklik: 760,
        aciklama: 'Kazanan özeti: seçimler tedarikçi başına ayrı siparişe döner; onay eşiğini aşan sipariş "onaya gider" işaretiyle önceden görünür.',
      },
      {
        dosya: '45-siparis',
        bul: "const page = await api('/purchasing/orders?status=PARTIALLY_RECEIVED&page=1&pageSize=1'); return page.items[0] ? '/satin-alma/siparisler/' + page.items[0].id : null;",
        bekle: 'Mal kabuller|Teslim alınan',
        yukseklik: 780,
        aciklama: 'Sipariş ekranı: tedarikçi, tutarlar (KDV hariç / KDV / genel toplam / teslim alınan), satır bazında sipariş – alınan – kalan ve irsaliyeler. PDF tek tıkla.',
      },
      {
        dosya: '45-mal-kabul',
        bul: "const page = await api('/purchasing/orders?status=PARTIALLY_RECEIVED&page=1&pageSize=1'); return page.items[0] ? '/satin-alma/siparisler/' + page.items[0].id : null;",
        bekle: 'Mal kabuller',
        eylem: tikla('Mal kabul'),
        sonraBekle: 'Gelen tutar',
        yukseklik: 1100,
        aciklama: 'Mal kabul / irsaliye: depo, irsaliye no, kabul günü; satır başına gelen miktar ve farkı, canlı tutar. Kaydedince stok girer ve tedarikçi borcu doğar.',
      },
      {
        dosya: '45-stok',
        yol: '/stok',
        bekle: 'Stok değeri|Ort. maliyet',
        yukseklik: 780,
        aciklama: 'Stok mevcudu: stok değeri, eldeki ve minimum altındaki malzemeler; malzeme başına depo dağılımı, yoldaki miktar ve hareketli ortalama maliyet.',
      },
      {
        dosya: '45-oneriler',
        yol: '/satin-alma/oneriler',
        bekle: 'Önerilen|Talep aç',
        yukseklik: 700,
        aciklama: 'Minimum stok önerileri: minimum − (eldeki + yoldaki + talepteki); seçilenler tek tıkla satın alma talebine döner.',
      },
      {
        dosya: '45-tedarikciler',
        yol: '/satin-alma/tedarikciler',
        bekle: 'Satın alma politikası|Anadolu Süt',
        yukseklik: 760,
        aciklama: 'Tedarikçi kartları ve satın alma politikası (onay eşiği, varsayılan KDV).',
      },
    ],
  },
];

export const MODULLER = [...DIGER, ...SATIN_ALMA].sort((a, b) => a.numara - b.numara);
