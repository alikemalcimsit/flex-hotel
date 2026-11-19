#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Masaj, hamam, cilt bakımı ve kişisel antrenman randevuları terapist × saat takviminde; yoga ve pilates gibi grup dersleri kontenjan ve yedek listesiyle. Randevu açılırken boş terapist ve oda kendiliğinden bulunur: terapistin çalışma saati, temizlik arası, izin ve bakım blokları, tercih edilen cinsiyet gözetilir; aynı terapist ya da oda aynı saate iki kez verilemez. Hizmet bitince ücret içerideki misafirin oda hesabına (folyoya) ya da spa kasasına gider; iptal ve gelmedi bedeli otelin ayarındaki süre ve orana göre kendiliğinden hesaplanır. Misafir aynı randevuları misafir portalından, kendi dilinde, anında onayla alır.],
  rakam: (("Terapist × saat", "günün takvimi"), ("Anında onay", "portaldan, dört dilde"), ("Oda ya da kasa", "folyoya otomatik"), ("Bedel", "geç iptal · gelmedi")),
  adimlar: (("Randevu", "personel ya da portal"), ("Yerleştirme", "terapist · oda · saat"), ("Hatırlatma", "e-posta / SMS"), ("Hizmet", "tamamla"), ("Ödeme", "oda hesabı ya da spa kasası"), ("Rapor", "gelir · doluluk")),
  akis-aciklama: [Hizmetin süresi ve temizlik arası takvimde yer tutar: 60 dakikalık masaj 15 dakikalık arayla terapisti ve odayı 75 dakika meşgul eder. Çift masajı iki terapisti ve çift odasını aynı anda ayırır; kişisel antrenman spor salonunu ve antrenörü. Misafir randevu alınca ve saatinden önce (otelin ayarı, varsayılan iki saat) kendi dilinde bildirim alır. Konaklama iptal olursa ya da misafir otele gelmezse ileri tarihli randevuları bedelsiz kapanır; çıkış yapan misafirin açık randevusu ya da borcu spa'nın ziline düşer.],
  ozellik: (
    ("Takvim", "Günün terapist × saat panosu: randevular, grup dersleri, izin ve bakım blokları, terapistin çalışmadığı saatler; boş hücreden yeni randevu. Oda görünümü aynı günü odalara göre gösterir."),
    ("Akıllı yerleştirme", "Terapist ve oda boş bırakılırsa uygun olanlar atanır; istenirse terapist ya da oda elle seçilir. İki resepsiyon aynı saati aynı anda verirse yalnız biri kazanır, diğeri boş başka terapiste yerleşir ya da \"bu saat az önce doldu\" uyarısı alır."),
    ("Grup dersleri", "Haftanın seçilen günlerinde tekrar eden dersler; kontenjan dolunca yedek liste, yer açılınca sıradaki kendiliğinden asıl listeye geçer ve bildirim alır. Ders bitince katılanlar tek tıkla tamamlanır: içerideki misafirin ücreti odaya, dışarıdan gelenin bakiyesi kasaya."),
    ("Ücret ve ödeme", "Fiyat hizmetten gelir (çift masajında kişi başı × kişi); ikram ya da indirim gerekçesiyle ve yetkiyle — hizmetten sonra da (şikâyet telafisi): fazla alınan para onaylı iadeyle geri verilir. Oda hesabına yazılan ücret folyoya spa kalemi olarak, KDV'siyle düşer. Spa kasasında nakit ve kart, ön ödeme; büyük ödeme, her iade ve hatalı girişin iptali ikinci kişinin onayına gider. Kasa ekranında \"Spa\" ayrı kaynak."),
    ("İptal ve gelmedi", "Ayardaki süreden (varsayılan 4 saat) önce iptal ücretsiz, sonra geç iptal bedeli (varsayılan %50); gelmedi bedeli (varsayılan %100). Bedel içerideki misafirde odaya yazılır; yetkili gerekçe yazarak bedeli silebilir. Yanlışlıkla kapatılan randevu, para hareketi yoksa geri alınır."),
    ("Misafir portalında", "Hizmetler misafirin dilinde (Türkçe, İngilizce, Almanca, Rusça) açıklama, süre ve fiyatla; boş saatler ve dersler; anında onay, iptal. Otel en erken kaç dakika sonrasına ve konaklama başına kaç açık randevu alınabileceğini belirler; portal ayardan açılır."),
    ("Rapor", "Dönemin geliri (odaya / kasaya), randevu, iptal ve gelmedi oranı; hizmet, kategori ve terapist kırılımı, terapist doluluğu, ders katılımı."),
  ),
  neden: [Spa randevusu çoğu otelde ayrı bir defterde ya da ayrı bir yazılımda tutulur: misafirin ödemesi folyoya elle aktarılır, iptal bedeli unutulur, aynı terapiste iki randevu verilir. Burada takvim, oda hesabı ve kasa aynı kayıttır: hizmet tamamlanınca ücret folyoda, ödeme kasada, gelir raporda görünür; çakışmayı veritabanı engeller. Misafir resepsiyonu aramadan, kendi dilinde, odasından randevu alır.],
  rol: (
    ([Misafir], [Portaldan hizmetleri görür, boş saate randevu alır, derse kaydolur, iptal eder; onay ve hatırlatma bildirimini alır.]),
    ([Spa resepsiyonu], [Randevu açar, taşır, tamamlar; iptal / gelmedi işaretler, kasada ödeme alır, derse kayıt yapar.]),
    ([Spa müdürü], [Fiyatı gerekçeyle değiştirir, bedeli siler, iadeyi ve büyük ödemeyi onaylar; hizmet, terapist, oda, ders ve ayarları yönetir; raporu izler.]),
    ([Ön büro / muhasebe], [Spa kalemlerini folyoda görür; spa kasasının hareketleri kasa ekranında ve ön muhasebede.]),
  ),
  baglantilar: (
    "*Folyo (15):* odaya yazılan ücret ve iptal bedeli spa kategorisinde, otelin KDV ayarıyla folyo kalemi olur.",
    "*Kasa (17) ve ön muhasebe (47):* spa kasası \"Spa\" kaynağıyla kasa ekranında; tahsilatlar ön muhasebede eşlenen kasa / banka hesabına.",
    "*Onaylar (11):* büyük spa ödemesi, iade ve hatalı girişin iptali ikinci kişinin onayına.",
    "*Misafir portalı (53):* spa sayfası misafir uygulamasında; konaklamanın bağlantısıyla.",
    "*Otomatik bildirimler (9):* \"Spa randevusu\" ve \"Spa hatırlatması\" şablonları (`{hizmetAdi}`, `{randevuTarihi}`, `{randevuSaati}`).",
    "*Rezervasyon ve giriş-çıkış (4, 6):* konaklama iptali / gelmedi ileri randevuları bedelsiz kapatır; çıkışta açık randevu ve borç uyarısı.",
  ),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/spa`: tanımlar (`setup.js`: ayar, oda, terapist ve çalışma saatleri, hizmet, blok), yerleştirme ve takvim (`schedule.js`: günün panosu, boş saat, `placeOnBoard`, tutma yazımı), randevu (`appointments.js`: aç / düzenle / fiyat / tamamla / iptal / gelmedi / geri al / odaya yaz, konaklama olayları), grup dersi (`sessions.js`, `seats.js`: tekrar, kontenjan sayaçları, yedekten asıla geçiş, toplu tamamlama), kasa (`payments.js`, `money.js`), misafir uçları (`guest.js`), rapor (`report.js`), hatırlatma işi (`jobs.js`), bildirim (`notify.js`), olay aboneleri (`subscribers.js`), saf kurallar (`rules.js`). Sözleşme `contracts/spa.js` (yerleştirme seçimi `pickSpaResources`, dilim üretimi, iptal oranı, şemalar). Ekranlar `frontend/src/pages/spa`, misafir sayfası `frontend/guest/src/pages/SpaPage.jsx`.],
  kural: (
    ("Yerleştirme", "Saat dilime oturmalı (ayardaki aralık), açılış–kapanış içinde bitmeli; terapist o gün o aralıkta çalışıyor olmalı. Tutma = başlangıç → bitiş + temizlik arası. Seçimde önce istenen kaynak, yoksa tercih edilen cinsiyet, sonra en az meşgul terapist; oda hizmetin odalarından boş olan. Çakışma son sözü `SpaHold` üzerindeki iki EXCLUDE (gist, `tsrange`) kısıtında: terapist ve oda başına etkin tutmalar örtüşemez."),
    ("Yarış", "Otomatik atamada kısıt ihlali olursa (eşzamanlı istek aynı kaynağı aldı) yerleştirme üç kez yeniden denenir; seçilen kaynakta \"saat doldu\" (409). Aynı `requestId` ikinci randevu açmaz (tekil `requestKey`)."),
    ("Tutar", "`listPrice` = kişi başı fiyat × kişi, `price` anlaşılan (gerekçe ve `spa.supervise` ile; açık randevuda ya da kasada kapanmış tamamlanan randevuda — o zaman borç yeniden hesaplanır, bakiye eksiye düşerse fazlası iade sınırı olur; odaya yazılmışta düzeltme folyodan). Tamamlanınca `amountDue` = fiyat, `totalDue` folyonun vergi hesabıyla (`chargeLine`, SPA kategorisi; dahil vergide aynı, hariçte üstüne). Bakiye = `totalDue` − kasada alınan − odaya yazılan. Randevu ya odaya ya kasaya kapanır (kısmi ikisi kuruş farkı doğurur)."),
    ("Bedel", "İptal anı başlangıçtan `freeCancelHours` önce ya da daha erken: %0; sonra `lateCancelFeePct`; gelmedi `noShowFeePct` (yalnız saati gelmiş randevuda). Yedek listedeki kayıt, seans iptali ve konaklama iptali bedelsiz. Bedel silmek `spa.supervise` ve gerekçe ister."),
    ("Oda hesabı", "Yalnız içerideki (CHECKED_IN, odası atanmış) konaklamaya; `spa.charged` olayı faturalama işçisinde `postExternalCharge` (kaynak SPA, kalem anahtarı `evt:<olay>:<sıra>`) ile folyoya. Randevu ekranı kalemin işlenme durumunu gösterir."),
    ("Kasa", "Açık randevuda ön ödeme fiyatın vergili toplamına kadar; kapanmışta kalan borç kadar. İade alınan paradan, kapanmışta yalnız borcun üstündeki fazla. Büyük ödeme eşiği (otel ayarı) ve her iade `SPA_PAYMENT` onayına; hatalı girişin iptali onaylanınca ters satır. Muhasebe `TreasuryChannel SPA` eşlemesiyle."),
    ("Grup dersi", "Seans satırı kilitliyken `bookedCount` / `waitlistCount` sayaçları; kontenjan aşılmaz (kısıt). Yer açılınca yedekten sıradaki (kayıt sırasıyla) asıla geçer. Toplu tamamlama süre bütçeli; içerideki ve kasada ödemesi olmayan kayıt odaya, diğerleri bakiyede."),
    ("Portal", "Konaklamanın portal bağlantısıyla; ayarda portal açık olmalı, en erken başlangıç şimdi + `portalLeadMinutes`, konaklama başına en fazla `portalMaxActive` açık randevu, konaklama bitmeden. Misafire randevunun kodu, hizmeti, saati, tutarı, odası ve iptal bedeli gider; personelin notu, terapist ataması, açan kişi ve kasa satırları gitmez. Okuma 60, yazma 10 istek / dk."),
    ("Hatırlatma", "5 dakikada bir: başlangıcına `reminderHours` kalmış, konaklamaya bağlı açık randevu; `reminderSentAt` ile tek kez (sürüm alanına dokunmadan), saat değişince yeniden."),
  ),
  tutarlilik: (
    "*Kilit sırası:* seans → randevu (satır kilidi, `FOR UPDATE`), ardından konaklama; ödeme randevu kilitliyken.",
    "*Sürüm:* randevu, seans ve tanımlar `updatedAt` ile iyimser kilitli; ödeme toplamı sürüm alanına dokunmadan güncellenir (ödeme sonrası işlem \"yenileyin\" demez).",
    "*Veritabanı kısıtları:* tutmada terapist / oda EXCLUDE, randevu kodu ve istek anahtarı tekil, kontenjan ve sayaçlar, tutarlar ≥ 0, oran 0–100, ayar sınırları.",
    "*Zaman:* duvar saati (`YYYY-MM-DDTHH:mm`) otelin saat diliminde çevrilir; ham SQL'de anlar `sqlTimestamp` ile.",
  ),
  olcek: (
    ("Boş saat: bugün · yarın (cinsiyet) · portal (50 terapist × 50 oda)", "28 · 27 · 21 ms"),
    ("Günün takvimi (≈310 kayıt) · tanımlar (110 hizmet)", "49 · 94 ms"),
    ("Randevu listesi: ilk sayfa · bugün · ad · kod · derin sayfa", "19 · 27 · 30 · 18 · 21 ms"),
    ("Randevu listesi: açık bakiye · gelmedi (1 yıl)", "63 · 66 ms"),
    ("Randevu ekranı · ders listesi · ders ekranı", "10 · 12 · 15 ms"),
    ("Rapor: 31 gün · 1 yıl", "80 · 587 ms"),
    ("Kasa özeti · spa hareketleri · hatırlatma turu", "7 · 6 · 4 ms"),
    ("Boş saat → aç (otomatik yerleştirme) → ön ödeme · derse kayıt", "142 · 47 ms"),
  ),
  olcek-not: [Ölçüm `scripts/perf-spa.mjs` (ortanca): 2500 kişilik resort otelin büyük spa'sı — 50 bakım odası + 4 stüdyo, 56 terapist / eğitmen, 120 hizmet (her biri bütün terapist ve odalara bağlı), 2 yıl + 60 gün: 272.000 randevu, 456.000 tutma, günde ≈280 randevu ve 8 ders. Ölçümle düzeltilen: 1 yıllık rapor 1,1–1,3 sn → 0,59 sn (çift terapistli randevunun pay sayısı randevu başına alt sorgu yerine pencere fonksiyonuyla). Planlar: liste ve açık bakiye indeks-yalnız taramayla (açık bakiye küçük kısmi indeksten), takvim tutmaları `[hotelId, startsAt]` indeksinden.],
  test-notu: [Sözleşme birim testleri: dilim üretimi, terapistin çalışma saati, yerleştirme seçimi (tercih, çift terapist, oda, blok, temizlik arası), iptal oranı, tekrar günleri, şemalar. Saf kurallar (`rules.test.js`): vergili toplam, bedel, bakiye, ödeme / iade sınırları, oda yazımı ve geri alma engelleri. Entegrasyon (gerçek PostgreSQL): tanımların sürüm kilidi ve ad tekilliği, kullanımdaki kaydın silinmemesi; boş saat ve yerleştirme (eşzamanlı iki istek → tek randevu, tekrar gönderim); yaşam döngüsü, folyo kalemi, dahil / hariç vergi; iptal ve gelmedi bedeli; geri alma; spa kasası, onaylar, kasa ekranında "Spa"; grup dersi (tekrar, kontenjan, yedek liste, saat değişimi, iptal, toplu tamamlama); misafir portalı; konaklama olayları ve hatırlatma; liste, rapor, izinler, otel kapsamı. Ön muhasebe: spa tahsilatının kaydı.],
  degistir: (
    ("Yeni hizmet kategorisi", "`SPA_CATEGORIES` ve etiketi (sözleşme), Prisma'da metin alan (migration gerekmez), raporun kategori kırılımı kendiliğinden."),
    ("Yeni ödeme yöntemi", "`SPA_PAYMENT_METHODS`, `TREASURY_CHANNEL_METHODS.SPA`, kasa ekranı ve muhasebe eşlemesi."),
    ("Paket / üyelik", "Randevunun `price` + `priceReason` alanı bugün ikramı ve indirimi taşır; paket bakiyesi ayrı tablo olarak (84) bağlanır."),
  ),
  devir: (
    "*84 (hediye kartı / üyelik):* spa paketleri ve üyelik bakiyesi randevu fiyatına kaynak olarak bağlanabilir.",
    "*FlexAI 2.0:* boş saat önerisi (doluluk tahminiyle), misafire kişisel spa önerisi (konaklama ve tercih).",
  ),
)
