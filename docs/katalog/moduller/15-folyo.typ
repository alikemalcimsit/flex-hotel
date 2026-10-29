#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Her konaklamanın hesabı tek ekranda: oda ücretleri her gece kendiliğinden işlenir, restoran, minibar, oda servisi ve ücretler (erken giriş, geç çıkış, iptal, gelmedi) otomatik düşer, elle harcama vergi önizlemesiyle eklenir. Hesap pencerelere bölünebilir (misafir / şirket), grup hesapları birleştirilebilir, kalemler aktarılabilir. Kalem asla silinmez: iptal ters kayıttır ve ikinci bir yetkilinin onayına gider.],
  rakam: (("8 pencere", "konaklama başına (misafir, şirket, acente…)"), ("Her gece", "oda ücreti kendiliğinden, çift yazılmaz"), ("Dört göz", "kalem iptali isteyen onaylayamaz"), ("Kuruş", "satır bazında vergi, kayıp yok")),
  adimlar: (("Giriş", "folyo açılır"), ("Gece", "oda ücreti"), ("Harcama", "restoran · minibar · elle"), ("Ödeme", "bakiye düşer"), ("Çıkış", "bakiye 0 → kapanır")),
  ozellik: (
    ("Folyo detayı", "Pencere sekmeleri, yönlendirme satırı, toplamlar ve vergi özeti; döküm hizmet gününe göre, iptal edilen üstü çizili + iptal kaydı, aktarma izi."),
    ("Harcama ekle", "Sunucudan canlı vergi önizlemesi, hazır açıklamalar, çift gönderim koruması; indirim seçilen gelirin vergisini düşürür."),
    ("Böl, birleştir, aktar", "Kalemleri yeni pencereye böl (ödeyen + yönlendirme), grup hesabını tek folyoda topla, kalemi başka konaklamanın folyosuna aktar."),
    ("Yönlendirme", "\"Oda ücreti şirkete, restoran misafire\": tip → pencere kuralı; sistem kalemleri kurala uyar."),
    ("Gece oda ücreti", "Gün dönünce içerideki bütün konaklamaların eksik geceleri işlenir; fiyat sonradan değişirse fark kalemi; sunucu kapalıyken geçen geceler telafi edilir."),
    ("Güvenli kapatma", "Bakiye sıfır ve bekleyen iptal yoksa kapanır; yeniden açma yetkiyle ve gerekçeyle."),
  ),
  neden: [Kasa açığının en sık iki kaynağı — silinen kalem ve işlenmeyen gece — yapısal olarak kapalıdır: kalem silinmez, iptal başka bir göze gider; gece ücreti tek anahtarla bir kez yazılır.],
  rol: (([Resepsiyon, müdür, muhasebe], [Harcama ekler, aktarır, böler.]), ([Müdür, muhasebe], [İndirim, yeniden açma.]), ([Görüntüleyen], [Folyoyu görür; kat hizmeti görmez.])),
  baglantilar: ("*Check-in / out (6):* girişte folyo açılır; çıkışta ödenecek = bakiye + çıkışta işlenecekler.", "*Ödeme (17):* ödemeler folyo kilitliyken bakiyeye girer.", "*Onay kuyruğu (11):* kalem iptali onaya gider.", "*Minibar (19), restoran (39), oda servisi (41):* tüketim ve odaya yazılan hesap olayla folyoya kendiliğinden kalem olarak düşer.", "*Gelir raporları (23):* geçmiş günlerin oda geliri folyoya işlenenden."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/folios`: servis (`service.js`: aç, harcama, iptal isteği, aktar, böl, birleştir, kapat, yeniden aç), kalem yazımı (`posting.js`: tek giriş noktası — vergi dökümü, yönlendirme, tekrar işleme anahtarı), saf para kuralları (`rules.js`), gece zamanlayıcısı (`jobs.js`) ve onay dinleyicisi (`subscribers.js`). Otomatik kalemleri `@hotelos/billing-worker` aktörü yazar: giriş → folyo + erken giriş ücreti, çıkış → kalan geceler + geç çıkış, geri almalar → ücret düşer, iptal / gelmedi → ücret, gece → oda ücretleri, restoran / minibar → kalem. Aktör kapalıysa iş "Folyo" manuel görevine düşer; personel aynı işi ekrandan yapar (aynı anahtar: sonradan ikinci kez yazılmaz).],
  kural: (
    ("Satır hesabı", "brüt = birim × adet (dahil vergiler içinde); net = brüt ÷ (1 + Σ dahil oran), dahil vergi = brüt − net; hariç vergi = net × oran; toplam = brüt + hariç. Satır bazında yuvarlanır; işlendiği andaki döküm `taxLines`'ta saklanır (vergi sonra değişse de geçmiş bozulmaz)."),
    ("Bakiye", "Σ kalem toplamı − Σ (ödeme × kur, ödeme başına kuruşa). Denormalize borç / ödenen / bakiye folyo kilitliyken kalemlerden yeniden hesaplanır (`refreshFolioTotals`); kısıt: bakiye = borç − ödenen."),
    ("İptal", "Eksi tutarlı ters kayıt (`reversalOfId` tekil), iptal günü tarihli — kapanmış günün geliri geriye dönmez. Elle iptal `FOLIO_VOID` onayına; onaylanınca ters kayıt onaylayan adına."),
    ("Gece uzlaştırması", "İşlenmemiş gece işlenir; fiyatı değişen gece için fark kalemi; konaklamadan çıkan gece sıfırlanır; iptal edilmiş (ikram) geceye dokunulmaz. Anahtar `night:<konaklama>:<gün>[:<sıra>]`."),
    ("Tek seferlik ücret", "Erken / geç / iptal / gelmedi konaklama başına bir kez etkin; giriş geri alınıp yeniden yapılsa da ikinci ücret çıkmaz. İptal / gelmedi ücreti \"Diğer\" vergisiyle."),
    ("Birleştirme", "Kaynağın bütün kalem ve ödemeleri hedefe taşınır, kaynak `TRANSFERRED`; geri alınmaz (kalemler aktarılarak ayrılır)."),
  ),
  tutarlilik: (
    "Kilit sırası: rezervasyon → (oda tipi) → folyo; folyolar id sırasıyla tek seferde. Yeni pencere açabilen her işlem rezervasyonu kilitler; hedef kilit altında yeniden okunur.",
    "Aynı folyoya eşzamanlı 10 harcama: toplamlar tutarlı; iki gece çalışması aynı anda koşsa da çift kalem yazılmaz (`sourceKey` otel başına tekil) — ikisi de testli.",
    "Gece çalışması 100'lük parçalar, her parça ayrı transaction; yarıda kalan çalışma kaldığı yerden devam eder (`RoomChargeRun`, otel × gece tekil).",
    "Olaylar tutar / açıklama taşımaz; gece başına tek özet olay (`folio.room_charges.posted`) — 2.500 ayrı socket haberi değil.",
  ),
  olcek: (("Kalem listesi (imleçli)", "`(folioId, serviceDate, postedAt, id)`"), ("Gece uzlaştırması", "`(reservationId, source, serviceDate)`"), ("Folyo listesi", "`(hotelId, status, updatedAt | closedAt, id)`")),
  olcek-not: [Liste sayımı 2000'de kesilir; çıkış yalnız o konaklamanın folyolarını kilitler.],
  degistir: (
    ("Yeni otomatik kalem kaynağı", "`FolioItemSource` enum + migration, aktörde olay işleyicisi, `posting.js` üzerinden yazım; kaynak anahtarı tekil olmalı (tekrar gelen olay ikinci kalem yazmasın)."),
    ("Vergi kuralı", "Ayarlardaki vergi tanımı ve \"uygulandığı kalem\"; hesap `folios/rules.js` (birim testli). Rezervasyon ekranının dökümüyle aynı formül korunmalı."),
  ),
  devir: ("Fatura (modül 16): `folio.closed`'u dinler; satırlar kalemlerden, alıcı varsayılanı `payerName`. Faturası kesilmiş folyonun yeniden açılması orada durdurulmalı.", "Gece kapanışı (18): `runRoomCharges(hotelId, { night })` günü kapatmadan önce o geceyi işlemek için hazır."),
)
