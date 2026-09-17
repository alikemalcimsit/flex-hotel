/**
 * Hero animasyonundaki marka kilidi: sabit "Flex" + değişen sektör adı.
 *
 * "Flex" birebir sitedeki logodan gelir (Logo.jsx): Space Grotesk 700,
 * accent kırmızısı, -6 derece eğim. Sektör adları kendi tipografilerini ve
 * renklerini taşır; ikisi bitişik dizilir ve "FlexHotel", "FlexClinic" diye
 * okunur.
 *
 * RENKLER ÜZERİNE NOT: zemin neredeyse siyahtır (#08060A). Tarif edilen koyu
 * tonlar (toprak yeşili, lacivert, koyu gri-mavi) bu zeminde okunmuyordu —
 * karakterlerini koruyacak kadar az açıldılar. Değerler tek satırdır, kısılıp
 * açılabilir.
 *
 * FONT NOTU: buradaki aileler index.html'de YALNIZCA bu kelimelerin harfleri
 * için altkümelenmiş olarak yükleniyor. Yeni bir sektör eklenirken kullandığı
 * harflerin o altkümede bulunduğundan emin ol.
 */

/** Sabit marka parçası. */
export const BRAND = Object.freeze({
  label: 'Flex',
  family: '"Space Grotesk", sans-serif',
  weight: 700,
  // Logodaki `-skew-x-6` ile aynı
  skewDegrees: -6,
  trackingEm: 0,
  color: '#EF4444',
})

/**
 * Sektörler. Sıra ekranda görülecek sıradır.
 *
 * `trackingEm` harf aralığı (em), `skewDegrees` eğim, `weight` font ağırlığı.
 * En çok SEKTÖR SINIRI kadar öğe olabilir — bkz. flexWordmark.js.
 */
export const SECTORS = Object.freeze([
  {
    key: 'hotel',
    label: 'Hotel',
    // Otel panelindeki logonun ikinci kelimesiyle birebir: font-light,
    // tracking-wide, cyan-400 (Sidebar.jsx)
    family: '"Space Grotesk", sans-serif',
    weight: 300,
    trackingEm: 0.03,
    skewDegrees: 0,
    color: '#22D3EE',
  },
  {
    key: 'clinic',
    label: 'Clinic',
    // Çok ince, steril duruş; harf aralığı bilinçli olarak açık
    family: 'Inter, sans-serif',
    weight: 200,
    trackingEm: 0.2,
    skewDegrees: 0,
    color: '#8FE0BE',
  },
  {
    key: 'dental',
    label: 'Dental',
    // Clinic ile aynı aile; ayrım rengin daha açık ve soğuk olmasında
    family: 'Inter, sans-serif',
    weight: 200,
    trackingEm: 0.2,
    skewDegrees: 0,
    color: '#A6DDF7',
  },
  {
    key: 'realty',
    label: 'Realty',
    // Orta-kalın, köşeli, sağlam duruş
    family: 'Archivo, sans-serif',
    weight: 600,
    trackingEm: 0,
    skewDegrees: 0,
    color: '#6FA173',
  },
  {
    key: 'fit',
    label: 'Fit',
    // Kalın ve hafif eğik — dinamik duruş
    family: 'Archivo, sans-serif',
    weight: 800,
    trackingEm: -0.01,
    skewDegrees: -9,
    color: '#FB923C',
  },
  {
    key: 'spa',
    label: 'Spa',
    // Yuvarlak hatlı, sivri köşesiz
    family: 'Quicksand, sans-serif',
    weight: 400,
    trackingEm: 0.06,
    skewDegrees: 0,
    color: '#E4B7DE',
  },
  {
    key: 'legal',
    label: 'Legal',
    // Tek serif istisnası; otorite
    family: 'Lora, serif',
    weight: 600,
    trackingEm: 0.01,
    skewDegrees: 0,
    color: '#5578CE',
  },
  {
    key: 'academy',
    label: 'Academy',
    // Orta ağırlıkta klasik sans; ciddiyet ama sıcaklık
    family: '"Work Sans", sans-serif',
    weight: 500,
    trackingEm: 0.02,
    skewDegrees: 0,
    color: '#8497AE',
  },
])
