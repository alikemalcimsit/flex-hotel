/**
 * Sitenin tüm metinleri tek yerde — bileşenlerde sabit metin tutulmaz.
 * Metin güncellemesi için sadece bu dosya değiştirilir.
 *
 * Rakamlar uydurulmaz: aşağıdaki sayılar depodan ölçülmüştür
 * (paket sayısı, worker/aktör sayısı, tablo sayısı, geçen test sayısı).
 */

export const COMPANY = {
  name: 'FlexAI',
  tagline: 'Yapay zekâ ile çalışan iş yazılımları',
  url: 'https://flexai.tr',
  panelUrl: 'https://hotel.flexai.tr',
  // Adres kurumsal alan adının üzerinde ve yapılandırılmış veride de
  // (index.html, Organization şeması) aynısı geçiyor; ikisi ayrışmamalı.
  email: 'iletisim@flexai.tr',
  location: 'Türkiye',
}

/**
 * Gezinme — `id`, bölümün anasayfadaki çapası. Masaüstünde yazı, mobilde
 * ekranın altındaki çubukta ikon + yazı gösterilir (Nav.jsx).
 */
export const NAV_LINKS = [
  { id: 'anasayfa', href: '/#anasayfa', label: 'Ana sayfa', icon: 'home' },
  { id: 'cozumler', href: '/#cozumler', label: 'Çözümler', icon: 'folder' },
  { id: 'hakkimizda', href: '/#hakkimizda', label: 'Hakkımızda', icon: 'info' },
  { id: 'ekip', href: '/#ekip', label: 'Ekip', icon: 'users' },
  { id: 'iletisim', href: '/#iletisim', label: 'İletişim', icon: 'send' },
]

export const HERO = {
  intro: 'Yapay zekâ çözümleri',
  // Satır satır: şablondaki başlık yanındaki cümleyle yan yana duruyor, dar
  // bir sütuna sığması gerekiyor.
  title: ['İşin tekrarı', 'yazılıma,', 'kararlar size'],
  tagline: {
    lead: 'Sektöre özel iş yazılımları kuruyoruz ve içine kendi işini yapan',
    accent: 'yapay zekâ aktörleri',
    tail: 'yerleştiriyoruz.',
  },
  primaryCta: { href: '/#iletisim', label: 'Projenizi konuşalım' },
}

/** Hero'daki kayan şerit — yeteneklerin hızlı taraması. */
export const MARQUEE_ITEMS = [
  { label: 'Otonom aktör ağları', icon: 'cpu' },
  { label: 'Doğal dil raporlama', icon: 'chart' },
  { label: 'Dinamik fiyatlama', icon: 'calculator' },
  { label: 'WhatsApp entegrasyonu', icon: 'phone' },
  { label: 'Kimlik OCR', icon: 'shield' },
  { label: 'Açık API ve webhook', icon: 'plug' },
  { label: 'Çoklu dil ve para birimi', icon: 'globe' },
  { label: 'KBS bildirimi', icon: 'bell' },
  { label: 'Gerçek zamanlı takip', icon: 'clock' },
  { label: 'Rol bazlı yetkilendirme', icon: 'key' },
]

/** Hero'daki açılır liste — şablondaki "What I do?". */
export const SERVICES_SECTION = {
  title: 'Ne yapıyoruz?',
}

/** Şablondaki "Projects" bölümü: kurduğumuz sektör çözümleri. */
export const SOLUTIONS = {
  label: 'Çözümler',
  title: 'Sektöre özel sistemler',
  description:
    'Aynı çekirdeği her sektöre yeniden kuruyoruz: akışı o işin kendi diline göre çıkarıyor, modülleri ona göre yerleştiriyoruz.',
  more: 'Sektörünüz listede yok mu? Konuşalım',
}

export const SERVICES = [
  {
    icon: 'cpu',
    title: 'Otonom aktör ağları',
    description:
      'Tek bir devasa yapay zekâ yerine, her biri tek işten sorumlu aktörler kuruyoruz: biri doluluğa göre fiyatı izliyor, biri gece denetimini kapatıp raporu yazıyor, biri misafirin WhatsApp mesajını yanıtlıyor. Aktörler birbirini tetikliyor, kendi sınırını aştığında işi insana devrediyor. Her kararın kaydı tutuluyor; sistem neyi neden yaptığını sonradan gösterebiliyor.',
    featured: true,
  },
  {
    icon: 'sparkle',
    title: 'Sektöre özel yazılım',
    description:
      'İşi hazır bir pakete sığdırmaya çalışmıyoruz. Önce akışı çıkarıyor, sonra o akışa göre modül kuruyoruz. Her modül tek başına ayakta durur; birini kapatmak diğerini bozmaz. İşletme büyüdükçe sistem de büyür, baştan kurulmaz.',
  },
  {
    icon: 'plug',
    title: 'Entegrasyon ve açık API',
    description:
      'Kullandığınız sistemler, kanal yöneticileri, muhasebe programları ve resmî servislerle konuşan webhook ile API katmanları. Dışa aktarım ilk günden var: veriniz bizim sistemimizde hapis kalmıyor, yarın başka bir çözüme geçmek isterseniz sizinle geliyor.',
  },
  {
    icon: 'shield',
    title: 'Mevzuata uyum',
    description:
      'KBS bildirimi, konaklama vergisi, kimlik doğrulama — bunlar sonradan yamalanan eklentiler değil, veri modelinin içinde. Kimlik OCR ile kayıt anında okunuyor, bildirim akışı kendiliğinden işliyor. Denetim geldiğinde hazırlanacak bir şey kalmıyor.',
  },
]

export const ABOUT = {
  eyebrow: 'Hakkımızda',
  title: 'Küçük ekip, tam sorumluluk',
  paragraphs: [
    'FlexAI’ı, işletmelerde aynı sahneyi tekrar tekrar gördüğümüz için kurduk: biri sabah aynı ekrana aynı veriyi giriyor, bir diğeri o veriyi Excel’e kopyalıyor, akşam da birileri raporu elle topluyor. Yazılım varken kimsenin yapmaması gereken işler bunlar.',
    'Yapay zekâyı vitrin olsun diye kullanmıyoruz. Bir işi aktöre devretmeden önce şunu soruyoruz: burada gerçekten karar verebilir mi, veremediğinde ne yapacak? Cevap net değilse o iş insanda kalıyor. “Yapay zekâlı” demek kolay; sorumluluğu doğru paylaştırmak zor olan kısım.',
    'İlk ürünümüz FlexHotel bu yaklaşımla doğdu: otel operasyonunun tamamını kapsayan, modülleri birbirinden bağımsız çalışan, üstüne kendi kendine iş yapan aktörler eklenmiş bir sistem. Ön bürodan gece denetimine, kat hizmetlerinden KBS bildirimine kadar her parçası gerçek bir otelin gününe göre tasarlandı.',
    'İki kişiyiz ve bu bilinçli bir tercih. Mimarisini kuran, kodunu yazan, sunucusunu ayağa kaldıran ve arayan telefonu açan aynı kişiler. Arada aktarım kaybı olmuyor.',
  ],
  principles: [
    {
      icon: 'sparkle',
      title: 'Otomasyonu ölçülü kurarız',
      description:
        'Her şeyi yapay zekâya yıkmıyoruz. Bir aktör, kararı verecek kadar güvenilir olduğu yerde devreye girer; olmadığı yerde işi insana bırakır ve neden bıraktığını yazar. Sessizce yanlış karar veren bir sistem, hiç karar vermeyenden kötüdür.',
    },
    {
      icon: 'plug',
      title: 'Sistemi açık bırakırız',
      description:
        'API, webhook ve dışa aktarım ilk günden var. Verinizi rehin almıyoruz: yarın başka bir çözüme geçmek isterseniz her şey standart biçimlerde dışarı çıkar. Kalıcılığı bağımlılıkla değil, işe yararlıkla sağlamayı tercih ediyoruz.',
    },
    {
      icon: 'shield',
      title: 'Mevzuatı sonraya bırakmayız',
      description:
        'KBS, konaklama vergisi, kimlik doğrulama — bunlar “sonra bakarız” maddesi değil, ilk günden şemanın parçası. Sonradan eklenen uyum katmanı hem pahalı hem kırılgan olur.',
    },
    {
      icon: 'users',
      title: 'Kurduğumuzu biz işletiriz',
      description:
        'Teslim edip kaybolmuyoruz. Sunucusundan yedeğine, güncellemesinden gece yarısı çıkan sorunun çözümüne kadar aynı iki kişi ilgileniyor. Kendi kurduğumuz sistemi kendimiz işlettiğimiz için baştan sağlam kurmak bizim de işimize geliyor.',
    },
  ],
  /**
   * Metnin altındaki şema. Katmanlar "Ne yapıyoruz?" bölümündeki dört
   * hizmetin kısa adı, ikonları da oradakilerle aynı.
   */
  diagram: {
    core: 'Ortak çekirdek',
    layers: [
      { icon: 'cpu', label: 'Aktör ağı' },
      { icon: 'sparkle', label: 'Modüller' },
      { icon: 'plug', label: 'Açık API' },
      { icon: 'shield', label: 'Mevzuat' },
    ],
    caption:
      'Aynı çekirdek her sektöre o işin diline göre yeniden kuruluyor. Bir sektörü seçin, orada ne kurulduğunu görün.',
  },
  /** Depodan ölçülen gerçek rakamlar — pazarlama sayısı değil. */
  statsNote: 'FlexHotel’in bugünkü hâli, ölçülmüş hâliyle:',
  stats: [
    { value: '37', label: 'bağımsız paket' },
    { value: '23', label: 'worker ve yapay zekâ aktörü' },
    { value: '71', label: 'veritabanı tablosu' },
    { value: '404', label: 'otomatik test' },
  ],
}

/** "Nasıl çalışıyoruz" — projenin baştan sona akışı. */
export const PROCESS = {
  eyebrow: 'Süreç',
  title: 'Nasıl çalışıyoruz',
  description:
    'Teklif verip kaybolmuyoruz, aylarca sürecek bir analiz raporu da yazmıyoruz. Dört adım, her adımın sonunda elinizde somut bir şey oluyor.',
  steps: [
    {
      title: 'Akışı çıkarırız',
      description:
        'Sizi ve sahada çalışan ekibi dinliyoruz. Hangi iş günde kaç kez tekrar ediyor, kim kimi bekliyor, hangi bilgi hâlâ kâğıda ya da WhatsApp’a düşüyor. Bu adımın sonunda yazılım değil, işin haritası çıkıyor.',
    },
    {
      title: 'Kapsamı yazılı hale getiririz',
      description:
        'Ne yapılacağını, nasıl davranacağını ve “bitti” sayılması için neyin sağlanması gerektiğini yazıyoruz. Sürprizler burada bitiyor: sonradan “biz bunu böyle anlamamıştık” konuşması olmuyor.',
    },
    {
      title: 'Modül modül teslim ederiz',
      description:
        'Aylar sonra tek seferde büyük teslimat yerine, çalışan parçalar. İlk modül devreye girdiğinde ekibiniz onu kullanmaya başlıyor; geri bildirim, sistemin geri kalanı daha yazılmadan elimize geliyor.',
    },
    {
      title: 'Kurup bırakmayız',
      description:
        'Sunucu, yedek, sertifika, güncelleme ve sorun çözümü bizde. Sistemi biz işlettiğimiz için sağlam kurmak bizim de yükümüzü azaltıyor.',
    },
  ],
}

/** FlexHotel modul listesi — yalnizca o sistemin detay sayfasinda. */
export const MODULES = [
  {
    icon: 'bell',
    title: 'Ön büro',
    description: 'Check-in, check-out, oda durumu, online check-in.',
  },
  { icon: 'calendar', title: 'Rezervasyon', description: 'Grup, banket ve acente kontratlarıyla.' },
  {
    icon: 'sparkle',
    title: 'Kat hizmetleri',
    description: 'Oda bakımı, çamaşır ve minibar takibi.',
  },
  { icon: 'utensils', title: 'F&B ve QR menü', description: 'Menü yönetimi, oda servisi, banket.' },
  { icon: 'calculator', title: 'Muhasebe', description: 'Folio, bütçe, gider ve gece denetimi.' },
  { icon: 'chart', title: 'Raporlama', description: 'ADR/RevPAR ve doğal dil sorguları.' },
  { icon: 'plug', title: 'Kanal yönetimi', description: 'OTA senkronu, webhook, açık API.' },
  { icon: 'shield', title: 'KBS bildirimi', description: 'Kimlik OCR ile yasal bildirim akışı.' },
  { icon: 'users', title: 'Personel ve İK', description: 'Vardiya, izin, mesai ve yetki.' },
  { icon: 'wrench', title: 'Teknik servis', description: 'Arıza, bakım planı, demirbaş takibi.' },
  { icon: 'key', title: 'Kilit ve santral', description: 'Kapı kilidi ve PBX entegrasyonu.' },
  { icon: 'globe', title: 'CRM ve sadakat', description: 'Satış, promosyon, kupon, sadakat.' },
]

export const TEAM = {
  eyebrow: 'Ekip',
  title: 'Kiminle çalışacaksınız',
  description:
    'İki kişilik bir ekibiz. Projeyi anlattığınız kişi, kodu yazan kişiyle aynı. Arada aktarım kaybı ya da “ilgili birime ilettim” yok.',
  members: [
    { name: 'Ahmet Yusuf Demir', role: 'Kurucu Ortak', photo: 'ahmet-yusuf-demir' },
    { name: 'Ali Kemal Cimşit', role: 'Kurucu Ortak', photo: 'ali-kemal-cimsit' },
  ],
}

/**
 * Ekip sayfalarındaki "bu şarkıyla oku" kartı.
 * Ses dosyası siteye konmuyor (telifli eser); Spotify'ın resmî gömülü
 * oynatıcısı kullanılıyor ve yalnızca kullanıcı basınca yükleniyor.
 */
export const TRACK = {
  label: 'Bu sayfayı şu şarkıyla oku',
  title: 'Flex Up',
  artists: 'Lil Yachty · Future · Playboi Carti',
  spotifyId: '5Ryu0SlsYjKh78RkJUONFr',
  url: 'https://open.spotify.com/track/5Ryu0SlsYjKh78RkJUONFr',
  action: 'Çal',
  hint: 'CV’de yazmayanlar',
  pausedLabel: 'durduruldu',
  playingLabel: 'çalıyor',
  /**
   * Sitede çalacak ses dosyası — `public/` altına konur, örn. '/muzik/intro.mp3'.
   * Boş bırakılırsa düğme şarkıyı Spotify'da açar.
   *
   * Buraya YALNIZCA kullanım hakkına sahip olunan bir kayıt konmalıdır
   * (telifsiz/lisanslı müzik ya da kendi kaydınız). Ticari olarak yayınlanmış
   * bir parçayı — kısaltılmış olsa bile — siteye koymak lisans gerektirir.
   */
  audioFile: null,
}

export const CONTACT = {
  eyebrow: 'İletişim',
  title: 'Hangi iş her gün tekrar ediyor?',
  description:
    'İşletmenizde en çok zaman yiyen süreci birkaç cümleyle anlatın. Bakalım, yapay zekânın gerçekten fark yaratacağı yeri birlikte bulalım. Yaratmayacaksa onu da açıkça söyleriz — satmak için evet demiyoruz.',
  form: {
    name: 'Adınız',
    company: 'İşletmeniz ve sektörünüz',
    message: 'Her gün tekrar eden iş ne?',
    submit: 'E-posta uygulamasında aç',
    note: 'Form hiçbir yere kaydedilmez; e-posta uygulamanızda dolu bir taslak açılır, göndermek sizde.',
  },
}
