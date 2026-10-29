#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Sistem "15–18 Ekim'de kaç Standart boş?" sorusunu rezervasyonları, arızalı odaları ve atanmamış konaklamaları birlikte hesaba katarak anında cevaplar; rezervasyona uygun oda kendiliğinden ya da elle atanır. Bir oda hiçbir koşulda aynı gece iki kez satılamaz.],
  rakam: (("3 parça", "oda durumu: doluluk · kat hizmeti · arıza"), ("0", "çifte satış (veritabanı garantisi)"), ("Otomatik", "oda atama aktörü")),
  ozellik: (
    ("Müsaitlik tablosu", "Satırda oda tipi, sütunda gün; hücrede satılabilir boş oda sayısı. Arızalı (OOO) oda envanterden düşer."),
    ("Ayrı oda durumları", "Doluluk yalnız sistemce (check-in / out) değişir; kat hizmeti (kirli → temizleniyor → temiz → kontrol edildi) ve tarihli arıza kaydı ayrı tutulur."),
    ("Tarihli arıza kaydı", "\"20–25 Ekim tadilat\" önceden girilir, o gün kendiliğinden devreye girer; bitince oda kirli işaretlenir."),
    ("Oda atama", "Aday odalar kapasite, arıza ve tip farkıyla (aynı / üst tip / eşdeğer / alt tip) listelenir; yeni overbooking yaratan atama reddedilir."),
    ("Otomatik atama", "Rezervasyon açılınca oda aktörü uygun odayı seçer; aktör kapalıysa \"oda atanacak\" elle görevi düşer."),
    ("Check-out sonrası", "Misafir çıkınca oda boş ve kirli olur; kat hizmeti ekranına düşer."),
  ),
  neden: [Satılabilir oda sayısı, arıza ve atanmamış rezervasyonlar birlikte hesaplandığında hem boş oda kaçırılmaz hem de aynı odaya iki misafir yerleştirilmez.],
  rol: (([Ön büro], [Müsaitliğe bakar, oda atar.]), ([Kat hizmeti], [Odanın temizlik durumunu günceller.]), ([Müdür / teknik], [Oda ve arıza kaydı yönetir.])),
  baglantilar: ("*Rezervasyon (4):* müsaitlik bu modülün kuralıyla; açma ve tarih değişikliği oda tipi kilidi altında (aynı anda iki satış oda tipini fazla satamaz).", "*Oda planı (5):* odadan odaya taşıma bu modülün kurallarıyla.", "*Check-in / out (6):* doluluk ve kat hizmeti durumunu sistem değiştirir."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [Müsaitlik tek yerden sorulur: `modules/rooms/service.js` → `checkAvailability` (sayı), `getAvailabilityCalendar` (takvim), `getAssignableRooms` (adaylar). Doğrudan Prisma'dan sayı sayılmaz — atanmış / atanmamış rezervasyon ve blok etkileşimi `rules.js` başında anlatılır. Sistem kaynaklı oda durumu değişikliğinin tek girişi `applySystemRoomState` (satırı kilitler, denetim + olay yazar). Oda aktörü `workers/room-worker` (`reservation.created` → oda seç → `room.assigned`).],
  kural: (
    ("Tarih aralığı", "Konaklama ve bloklar yarı açık `[)`: 15–18 rezervasyonu 15, 16, 17 gecelerini tutar; 18'de oda aynı gün tekrar satılabilir."),
    ("Arıza türleri", "Arızalı (OUT_OF_ORDER) envanterden düşer; hizmet dışı (OUT_OF_SERVICE) düşmez ama o odaya misafir yerleştirilmez; ikisi de atamayı engeller."),
    ("Kat hizmeti geçişi", "Kontrol edildi (INSPECTED) yalnız temizden gelir (`housekeepingTransitionError`, sözleşmede — ekran da aynı kuralı kullanır)."),
    ("Overbooking yaratmama", "Blok açma, oda silme, tip değişikliği ve atama işlem öncesi / sonrası envanteri karşılaştırır; eksi bir günü kötüleştiren reddedilir (`WOULD_OVERBOOK`)."),
  ),
  tutarlilik: (
    "Kilit sırası: önce oda tipleri, sonra odalar, kimlik sırasıyla (`lockRoomTypes`, `lockRooms`) — kilitlenme döngüsü olmaz.",
    "Veritabanı garantileri: `Reservation_no_double_booking` (EXCLUDE — aynı odaya çakışan iki aktif rezervasyon yazılamaz), `RoomBlock_no_overlap`, tetikleyiciyle arızalı odaya rezervasyon / rezervasyonlu odaya blok yazılamaz.",
    "Çakışma kısıtları gün başına yuvarlanmış tarihlerle: geç çıkış aynı gün girişle çakışmış sayılmaz.",
  ),
  degistir: (
    ("Müsaitlik kuralı", "Yalnız `rooms/rules.js` (saf, birim testli) ve `rooms/sql.js`; takvim önbelleği envanter sürümüyle tazelenir."),
    ("Yeni oda durumu", "Doluluk / kat hizmeti / blok ayrımını koruyun: yeni değer ilgili enum'a, geçiş kuralı sözleşmedeki fonksiyona."),
  ),
)
