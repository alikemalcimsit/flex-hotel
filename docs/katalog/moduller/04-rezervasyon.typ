#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Resepsiyon tek odalı ya da gruplu rezervasyonu tek formda açar; sistem müsaitliği ve gece gece fiyatı kendisi hesaplar, misafiri telefon / e-postadan tanır, iptal ve gelmedi ücretini politikadan bulur. Yer yoksa misafir bekleme listesine alınır, yer açılınca uyarı gelir. Son odaya aynı anda gelen iki istekten yalnız biri geçer.],
  rakam: (("Canlı", "müsaitlik ve fiyat önizlemesi"), ("Grup", "tek formda çok oda"), ("0", "çifte gönderim / çifte satış"), ("Otomatik", "iptal ve gelmedi ücreti")),
  adimlar: (("Talep", "telefon · kanal · oda planı"), ("Önizleme", "boş oda + fiyat + vergi"), ("Misafir", "eşleştir / yeni"), ("Rezervasyon", "onaylı / opsiyonlu"), ("Değişiklik", "tarih · tip · iptal")),
  ozellik: (
    ("Gece gece fiyat", "Gece = taban fiyat × sezon çarpanı; anlaşılan geceler düzenlemede korunur, eklenen geceler güncel fiyatla."),
    ("Elle fiyat yetkiyle", "Elle fiyat gerekçe ister ve ayrı izinle verilir (varsayılanda yönetici ve müdür)."),
    ("Misafir eşleştirme", "Telefon (otelin ülke koduyla) ya da e-posta eşleşir; ad farklıysa personele sorulur, yanlış misafir kartına yazılmaz."),
    ("İptal ve gelmedi", "Politika süresi içindeyse ceza oranıyla ücret; gelmedi = ilk gece. Gerekçeyle vazgeçilebilir, iz kalır."),
    ("Overbooking kuralı", "Otel ayarına göre reddedilir ya da onay kuyruğuna gider; onaylanınca aynı istekle açılır."),
    ("Bekleme listesi", "Yer açılınca \"yer açıldı\" + zil; tek tıkla rezervasyona çevrilir, tarihi geçen kapanır."),
  ),
  neden: [Fiyat ve müsaitlik hesaplamayı sisteme bırakmak hatalı fiyatı ve çifte satışı önler; her değişiklik geçmişte gerekçesiyle durur.],
  rol: (([Ön büro], [Rezervasyon açar, düzenler, iptal eder.]), ([Yönetici / müdür], [Elle fiyat verir, overbooking onayı verir.]), ([Rol matrisiyle], [Listeyi ve detayı görme yetkisi başka rollere de verilebilir; varsayılan yönetici, müdür, ön büro.])),
  baglantilar: ("*Oda (3):* müsaitlik ve oda ataması.", "*Folyo (15):* geceler oda gelirinin kalemleri; iptal / gelmedi ücreti folyoya.", "*Kanal (33), konuşarak rezervasyon (8):* kanaldan ve sohbetten gelen istekler aynı kurallardan geçer; uygunsa rezervasyon açılır, değilse gerekçeyle reddedilir.", "*Günlük durum (13), gelir raporları (23):* rezervasyonun her gecesi ayrı kayıt (otel + gün index'li); doluluk ve gelir bu kayıtlardan okunur."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [Rezervasyon servisleri `modules/reservations` altında (açma, grup, düzenleme, onay, iptal, gelmedi, geri alma, bekleme listesi, misafir eşleştirme). Durum kuralları tek yerde: `reservationActionError` (sözleşme). Kanal istekleri `workers/reservation-worker` aktörüyle işlenir. Liste aramasız hâlde sürüm anahtarlı önbellekte; önizleme envanter sürümüyle önbellekli takvimden.],
  kural: (
    ("Envanter kilidi", "Açma, grup, tarih / tip düzenleme ve geri alma: oda tipi kilidi, sonra aynı transaction'da müsaitlik. Değişiklik yeni overbooking yaratmamalı; son oda yarışında biri `NO_AVAILABILITY` alır."),
    ("Tekrar gönderim", "Form bir istek kimliği üretir; aynı kimlikle ikinci gönderim (eşzamanlı dahil) ikinci rezervasyon ve ikinci misafir kartı açmaz (kilidin arkasında)."),
    ("Fiyat", "Gece = taban × sezon çarpanı (kuruşa yuvarlı); toplam = gecelerin toplamı. Elle fiyatlı rezervasyonun konaklaması değişirse sunucu karar ister (`PRICE_DECISION_REQUIRED`)."),
    ("Durum geçişleri", "Opsiyonlu → onayla; bekleyen / onaylı → iptal; giriş günü gelmiş → gelmedi; iptal / gelmedi → çıkışı geçmediyse geri al (yer denetlenir)."),
    ("Oda ataması", "Düzenlemede atanmış oda yeni hâle uymuyorsa (tip, dolu, arızalı, kişi) atama kaldırılır."),
    ("Bekleme listesi taraması", "Envanteri artıran her olaydan sonra otel başına birleştirilmiş tarama (2 sn) + 5 dakikada bir güvenlik taraması."),
  ),
  tutarlilik: ("Elle fiyat gerekçesiz yazılamaz (veritabanı kısıtı); `requestId` otel başına tekil (kısmi index).", "Opsiyonlu rezervasyona onay bildirimi gitmez; onaylanınca gider.", "Her yazma olay yayınlar (`reservation.*`); oda planı ve müsaitlik önbelleği bunlarla tazelenir."),
  olcek: (("Liste / arama (2.500 misafir, 20.000 rezervasyon)", "index'li, sayım 2.000'de kesilir"), ("Misafir araması", "trigram / ifade index'i, 3 harften kısa ad aranmaz")),
  degistir: (
    ("Yeni durum / işlem", "Sözleşmede `reservationActionError`; servis fonksiyonu; olay kataloğu ve `INVENTORY_CHANGED_EVENTS` listesi (yoksa paneller geç tazelenir)."),
    ("Pansiyon / kişi farkı (28)", "Fiyatın eklenecek yeri `priceStay`."),
  ),
  devir: ("Misafir kartı düzenleme CRM'de (22) — burada yalnız açılır.",),
)
