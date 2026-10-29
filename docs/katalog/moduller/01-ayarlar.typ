#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Otelin kimliği ve kuralları tek yerden tanımlanır: otel bilgileri, oda tipleri, vergiler, sezonlar ve genel parametreler. Rezervasyon, fiyat, folyo ve rapor modüllerinin hepsi bu tanımları kullanır; bir değer değiştiğinde ilgili ekranlar kendiliğinden güncellenir.],
  rakam: (("5", "tanım ekranı: otel, oda tipi, vergi, sezon, genel"), ("Tek kaynak", "bütün modüller aynı tanımı okur"), ("Korumalı", "kullanımdaki tanım bozulamaz")),
  ozellik: (
    ("Otel bilgileri", "Ad, adres, iletişim, logo, para birimi, saat dilimi, giriş / çıkış saati. \"Bugün\" otelin saat diliminden hesaplanır."),
    ("Oda tipleri", "Kod, ad, yetişkin / çocuk kapasitesi ve taban fiyat. Gelecekte daha kalabalık rezervasyonu olan tipin kapasitesi düşürülemez."),
    ("Vergiler", "Ad, oran ve fiyata dahil / hariç; uygulandığı kalem türü. Rezervasyon ve folyo vergi dökümünü buradan alır."),
    ("Sezonlar", "Tarih aralığı ve fiyat çarpanı; iki sezon çakışamaz (veritabanı kısıtı)."),
    ("Genel parametreler", "İptal politikası, overbooking kuralı (reddet / onaya gönder), telefon ülke kodu ve diğer otel kuralları."),
    ("Güvenli değişiklik", "Rezervasyon ya da folyo varken otelin para birimi değiştirilemez; silinen kodun yeniden kullanılması serbest."),
  ),
  neden: [Fiyat, vergi ve politika kuralları bir yerde tanımlandığında her ekran aynı sonucu verir; resepsiyonun gördüğü fiyat, folyoya düşen ve rapora giren tutar birbirini tutar.],
  rol: (([Yönetici], [Tanımları düzenler.]), ([Müdür, muhasebe], [Tanımları görür.]), ([Diğer personel], [Ayar ekranını görmez; ekranlar otelin saat dilimi, para birimi gibi bilgileri kendiliğinden kullanır.])),
  baglantilar: ("*Rezervasyon (4):* gece fiyatı = oda tipinin taban fiyatı × o gecenin sezon çarpanı.", "*Folyo (15), raporlar (23):* vergi tanımları ve para birimi.", "*Bütün modüller:* \"bugün\" otelin saat diliminden (iş günü her ekranda aynı)."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [Ayarlar modülü ayrıca bütün sistemin paylaşılan altyapısını kurdu: soft-delete'i otomatik uygulayan Prisma uzantısı (`db.js`), para aritmetiği (`@hotelos/core/money.js` — para / oran alanları API'de metin taşınır), ön yüz ve sunucunun aynı zod şemasını kullandığı sözleşme paketi, tipli hatalar ve veritabanı kısıtlarının Türkçe karşılıkları (`lib/errors.js`), sayfalama, önbellek, denetim izi ve olay yayını. Diğer modüller ayarı doğrudan Prisma'dan değil önbellekli "sıcak okuma" fonksiyonlarından okur: `getHotelSettings`, `getActiveRoomTypes`, `getActiveTaxes`, `getActiveSeasons`, `getSeasonForDate`.],
  kural: (
    ("Sezon seçimi", "Fiyat çarpanı saf fonksiyonlarda: `findSeasonForDate`, `resolveMultiplierForDate`. Sezonlar iki uçtan kapalı `[]`, konaklama yarı açık `[)` — ikisi bilerek farklı."),
    ("Sezon çakışması", "Veritabanı kısıtı `Season_no_overlap` (EXCLUDE + btree_gist); uygulama yalnız daha iyi hata mesajı için de denetler."),
    ("Kısmi tekillik", "`RoomType.code` ve `Room.number` yalnız silinmemiş kayıtlar arasında tekil (kısmi index); bu tablolarda bileşik anahtarlı `upsert` kullanılamaz."),
    ("Kapasite koruması", "Gelecekte daha kalabalık rezervasyonu olan oda tipinin kapasitesi düşürülemez (409 `CAPACITY_IN_USE`)."),
    ("Para birimi kilidi", "Rezervasyon ya da folyo varken para birimi değişmez (409 `CURRENCY_LOCKED`); check-out saati check-in'den önce olmalı, logo adresi http(s)."),
  ),
  tutarlilik: ("Ayar yazımları önbelleği olayla tazeler (`settings.*` olayları); okuma uçları önbellekten.", "\"Bugün\" için `new Date()` kullanılmaz: `getBusinessDate(hotelId)` / `calendarDateInTimeZone`.", "`findUnique` yerine `findFirst` — soft-delete filtresi bileşik tekil anahtara eklenemez."),
  degistir: (
    ("Yeni genel parametre", "Prisma `Hotel` alanı + migration (CHECK), `contracts/settings.js` şeması, `settings/service.js` güncelleme fonksiyonu, `GeneralTab.jsx`. Önbellek anahtarı `settings:` ile tazelenir."),
    ("Fiyat kuralı", "Yalnız `settings/rules.js` saf fonksiyonları; rezervasyon fiyatı bunları çağırır, iki yerde yazılmaz."),
    ("Sorgu parametreleri", "Mantıksal değerlerde `queryBoolean`, boş bırakılabilen sayıda `optionalQueryInt` (z.coerce \"false\"u true yapar)."),
  ),
  devir: ("Pansiyon / paket farkı (28) fiyat hesabına `priceStay` üzerinden eklenecek.",),
)
