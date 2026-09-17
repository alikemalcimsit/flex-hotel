import { SECTORS } from './sectors.js'

/**
 * Sektör çözümlerinin içeriği.
 *
 * KİMLİK BURADA DEĞİL: her dikeyin fontu ve rengi `sectors.js`'ten geliyor —
 * hero animasyonunu besleyen dosyanın aynısı. Böylece karttaki "FlexClinic"
 * ile animasyondaki "FlexClinic" birebir aynı tipografiye ve renge sahip
 * oluyor; ikisini ayrı yerde tutmak er geç birbirinden ayrışırdı.
 *
 * KONUMLANDIRMA: bunlar raftan satılan ürünler değil, o sektöre kurulan
 * çözümler. Metinler bu çerçeveye göre yazıldı; "hazır ürün" iması yok.
 * FlexHotel farkı, kurulmuş ve çalışıyor olması — o da kendi sayfasında
 * açıkça söyleniyor, rozetle değil.
 *
 * ÖNE ÇIKANLAR (`highlights`): çözüm kartındaki önizlemenin üç satırı.
 * Yeni bilgi değil, `capabilities`'in kısaltılmışı — kartta yeni bir iddia
 * belirmesin diye. Etiketler mobil kartta kesilmeden sığacak kadar kısa
 * tutuluyor (bkz. verticals.test.js).
 */

const CONTENT = {
  hotel: {
    industry: 'Otelcilik',
    tagline:
      'Ön bürodan muhasebeye, kat hizmetlerinden kanal yönetimine kadar otel operasyonunun tamamı tek platformda.',
    summary:
      'İlk kurduğumuz ve bugün çalışan sistem. Modüller birbirinden bağımsızdır; birini kapatmak diğerini bozmaz, otel büyüdükçe sistem de büyür ve baştan kurulmaz. Üstüne gece denetimini kapatan, doluluğa göre fiyat öneren ve misafirle konuşan aktörler biniyor.',
    capabilities: [
      'Çok otelli yönetim — tüm tesisler tek konsoldan izlenir',
      'Çoklu dil ve para birimi; kur ve dil misafire göre çözülür',
      'Gerçek zamanlı takip — oda ve görev durumu anında yansır',
      'Rol bazlı yetki; her personel yalnızca kendi alanını görür',
      'KBS bildirimi ve kimlik OCR ile yasal akış',
      'Kanal yöneticisi senkronu, webhook ve açık API',
    ],
    icon: 'bed',
    highlights: [
      { icon: 'clock', label: 'Anlık oda durumu' },
      { icon: 'shield', label: 'KBS ve kimlik OCR' },
      { icon: 'plug', label: 'Kanal ve açık API' },
    ],
    hasPanel: true,
  },
  clinic: {
    industry: 'Sağlık',
    tagline: '7/24 randevu asistanı, çok dilli hasta iletişimi ve HBYS ile senkron hasta kartı.',
    summary:
      'Kliniğin gelen kutusunu ve takvimini tek yerde toplayan kurulum. Randevu trafiğinin tekrar eden kısmını asistan üstleniyor; doktor ile hasta arasındaki yazışma dağılmadan tek panelde kalıyor.',
    capabilities: [
      '7/24 yapay zekâ randevu asistanı, çok dilli hasta iletişimi',
      'Hasta geçmişi ve tercih profili tek ekranda',
      'Randevu hatırlatma, iptal ve erteleme otomasyonu',
      'Doktor–hasta mesajlaşması tek gelen kutusunda',
      'Muayene sonrası takip mesajları ve kontrol randevusu önerisi',
      'HBYS entegrasyonu ile senkron çalışma',
    ],
    icon: 'stethoscope',
    highlights: [
      { icon: 'clock', label: '7/24 randevu asistanı' },
      { icon: 'bell', label: 'Otomatik hatırlatma' },
      { icon: 'plug', label: 'HBYS entegrasyonu' },
    ],
  },
  dental: {
    industry: 'Diş Hekimliği',
    tagline: 'Seans seans ilerleyen tedavi planı, görsel dosya yönetimi ve online randevu-ödeme.',
    summary:
      'Diş hekimliğinde iş tek bir randevuda bitmiyor; tedavi seanslara yayılıyor. Kurulum bu akışa göre: planın hangi aşamada olduğu, sıradaki seansın ne zaman olduğu ve ödemenin nerede kaldığı aynı hasta kartında duruyor.',
    capabilities: [
      'Tedavi planı takibi ve seans hatırlatmaları',
      'Röntgen ve görsel dosya yönetimi hasta kartında',
      'Online randevu, ödeme ve taksit takibi',
      'Hasta memnuniyet anketi otomasyonu',
    ],
    icon: 'tooth',
    highlights: [
      { icon: 'calendar', label: 'Seanslı tedavi planı' },
      { icon: 'folder', label: 'Röntgen dosyaları' },
      { icon: 'calculator', label: 'Ödeme ve taksit' },
    ],
  },
  realty: {
    industry: 'Emlak',
    tagline:
      'Alıcı kriterine göre mülk eşleştirme, WhatsApp’tan portföy paylaşımı ve evrak takibi.',
    summary:
      'Portföyle alıcıyı eşleştirme işinin tekrar eden kısmını sistem yapıyor. Danışman, mesajlaşmadan sözleşmeye kadar olan akışı tek yerden yürütüyor.',
    capabilities: [
      'Yapay zekâ destekli mülk eşleştirme; alıcı kriterine göre otomatik öneri',
      'WhatsApp üzerinden portföy paylaşımı ve randevu planlama',
      'Sözleşme ve evrak takibi',
      'Fiyat ve piyasa analizi asistanı',
    ],
    icon: 'building',
    highlights: [
      { icon: 'sparkle', label: 'Mülk eşleştirme' },
      { icon: 'phone', label: 'WhatsApp’tan portföy' },
      { icon: 'folder', label: 'Sözleşme ve evrak' },
    ],
  },
  fit: {
    industry: 'Spor Salonu',
    tagline: 'Üyelik ve paket yönetimi, yapay zekâ antrenman önerisi, devamsızlık takibi.',
    summary:
      'Üyeliğin başladığı günden bıraktığı güne kadarki akış. Devamsızlığı sistem fark ediyor ve üye tamamen kopmadan hatırlatma gidiyor.',
    capabilities: [
      'Üyelik ve paket yönetimi',
      'Yapay zekâ antrenman ve program önerisi',
      'Devamsızlık takibi ve otomatik hatırlatma',
      'Grup ders rezervasyon sistemi',
    ],
    icon: 'dumbbell',
    highlights: [
      { icon: 'users', label: 'Üyelik ve paketler' },
      { icon: 'sparkle', label: 'Antrenman önerisi' },
      { icon: 'bell', label: 'Devamsızlık takibi' },
    ],
  },
  spa: {
    industry: 'Güzellik / SPA',
    tagline: 'Personel bazlı takvim, hizmet paketleri ve randevu öncesi-sonrası mesajlaşma.',
    summary:
      'Randevunun personele bağlı olduğu işletmeler için kurulum: takvim kişi bazında çözülüyor, paket ve üyelik takibi aynı yerde duruyor, kullanılan ürün stoktan düşüyor.',
    capabilities: [
      'Online randevu ve personel bazlı takvim',
      'Hizmet paketleri ve üyelik takibi',
      'Randevu öncesi ve sonrası otomatik mesajlaşma',
      'Ürün ve malzeme stok takibi',
    ],
    icon: 'leaf',
    highlights: [
      { icon: 'calendar', label: 'Personel bazlı takvim' },
      { icon: 'send', label: 'Randevu mesajları' },
      { icon: 'chart', label: 'Ürün stok takibi' },
    ],
  },
  legal: {
    industry: 'Hukuk',
    tagline: 'Dava dosyası ve süre takibi, duruşma takvimi, müvekkil iletişimi tek panelde.',
    summary:
      'Hukukta kaçırılan bir süre geri alınamıyor. Kurulumun ağırlığı burada: dosyanın hangi aşamada olduğu ve hangi sürenin yaklaştığı takvimle birlikte tek yerde.',
    capabilities: [
      'Dava ve dosya takibi, süre hatırlatmaları',
      'Müvekkil iletişimi tek panelde',
      'Evrak ve sözleşme şablon yönetimi',
      'Duruşma takvimi senkronizasyonu',
    ],
    icon: 'scale',
    highlights: [
      { icon: 'clock', label: 'Süre hatırlatmaları' },
      { icon: 'calendar', label: 'Duruşma takvimi' },
      { icon: 'mail', label: 'Müvekkil iletişimi' },
    ],
  },
  academy: {
    industry: 'Eğitim',
    tagline: 'Kayıt ve devam takibi, veli bilgilendirme otomasyonu, ödeme ve taksit takibi.',
    summary:
      'Kursiyer kaydından ödemeye kadarki akış tek yerde. Veliye giden bilgilendirme elle yazılmıyor; devam ve program bilgisi sistemden çıkıyor.',
    capabilities: [
      'Öğrenci ve kursiyer kayıt, devam takibi',
      'Veli ve öğrenci bilgilendirme otomasyonu',
      'Ders programı ve öğretmen takvimi',
      'Ödeme ve taksit takibi',
    ],
    icon: 'graduation',
    highlights: [
      { icon: 'users', label: 'Kayıt ve devam takibi' },
      { icon: 'bell', label: 'Veli bilgilendirme' },
      { icon: 'calculator', label: 'Ödeme ve taksit' },
    ],
  },
}

/**
 * Dikeyler — marka kimliği `sectors.js`'ten, metin yukarıdan.
 * Sıra ekranda görülecek sıradır (FlexHotel önce: kurulmuş olan o).
 */
export const VERTICALS = Object.freeze(
  SECTORS.map((sector) =>
    Object.freeze({
      ...sector,
      name: `Flex${sector.label}`,
      slug: `flex${sector.key}`,
      ...CONTENT[sector.key],
    })
  )
)

/** @param {string} slug @returns {object|undefined} */
export function findVertical(slug) {
  return VERTICALS.find((vertical) => vertical.slug === slug)
}
