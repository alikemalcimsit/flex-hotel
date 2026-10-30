#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Günlük durum ekranında önümüzdeki 30 günün doluluk ve gelir tahmini: elde olan rezervasyonlar dolu çubuk, beklenen kesikli çizgi. Tahmin "pickup" yöntemiyle yapılır — geçen yılın aynı döneminde o gün kala ne kadar satış geldiyse bu yıl da o kadar gelmesi beklenir. Düşük doluluk, yüksek doluluk ve fazla satış (overbooking) riski olan günler işaretlenir ve ne yapılabileceği söylenir.],
  rakam: (("30 gün", "doluluk + gelir tahmini"), ("Pickup", "geçen yılın aynı gün kala satışı"), ("%30 / %95", "otelin ayarlayabildiği risk eşikleri"), ("0,45 sn", "1.500 odalı otelde soğuk hesap")),
  adimlar: (("Eldeki", "bugün itibarıyla satılan"), ("Karşılaştırma", "geçen yıl · son 8 hafta"), ("Pickup", "aynı gün kala gelen net satış"), ("Tahmin", "eldeki + beklenen"), ("Risk", "▼ düşük · ▲ yüksek · ! fazla")),
  akis-aciklama: [Karşılaştırma verisi yoksa tahmin eldekiyle aynıdır; sistem uydurma sayı üretmez, kaynağını notta söyler.],
  ozellik: (
    ("Tahmin grafiği", "Eldeki dolu çubuk, tahmin kesikli çizgi, eşikler yatay çizgi; kritik günler eksenin üstünde şekil + renkle. İpucu: eldeki, tahmin, beklenen ±, gelir, geçen yıl, kaynak."),
    ("Gelir tahmini kartı", "Tahmini oda geliri = eldeki + beklenen; geçen yıl aynı dönem ve değişim; tahmini doluluk ve ADR."),
    ("Kritik günler", "Tür, eldeki → tahmin, ne yapılabilir (düşükte fiyat, kampanya ve kanallar; yüksekte fiyat ve fazla satış sınırı; fazla satışta oda planı); oda planında aç."),
    ("Ayarlanabilir eşik", "Müdür tahmin kartından değiştirir; açık bütün günlük durum ekranlarına anında yansır. \"Bu gece\" doluluk uyarısı da aynı eşiği kullanır."),
    ("Kaynak notu", "\"30 gün geçen yılın aynı döneminden\" ya da veri yoksa açıklama — tahminin neye dayandığı her zaman yazılı."),
    ("Erişilebilir", "Tablo görünümü ve klavye ipucu; telefonda taşma yok."),
  ),
  neden: [Boş kalacak bir haftayı iki hafta önce görmek, kampanya ve fiyat için zaman kazandırır; fazla satış riski ise misafir kapıya gelmeden yönetilir.],
  rol: (([Müdür, muhasebe], [Tahmini görür.]), ([Müdür], [Risk eşiklerini değiştirir.])),
  baglantilar: ("*Günlük durum (13):* tahmin aynı ekranın \"Önümüzdeki 30 gün\" bölümünde.", "*Gelir raporları (23):* eldeki, geçen yıl ve satılabilir oda aynı hesaptan; yapay zekâ raporlaması için MCP sunucusunda tahmin aracı.", "*Oda planı (5):* kritik günden tek tıkla plana."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/forecast`: `GET /forecast?days=1..30` (eşikler ve sürümleri cevapta) ve `PUT /forecast/settings`. Yeni tablo yok: tahmin `ReservationNight (hotelId, date)` ve `Reservation (hotelId, createdAt, id)` index'lerinden okunur; eşikler `Hotel.forecastLowOccupancyPct / forecastHighOccupancyPct` (CHECK 0–100, aradaki fark ≥ 5). Saf hesap `contracts/forecast.js` ve `forecast/rules.js`'te; eldeki / geçen yıl / satılabilir gelir raporunun sorgularından.],
  kural: (
    ("\"O gün kala eldeki\"", "O anda açılmış, iptal / gelmedi işaretlenmemiş rezervasyonun gecesi; esas rezervasyonun açılış anı (düzenlemede gece satırları yeniden yazıldığı için gecenin değil)."),
    ("Karşılaştırma sırası", "Geçen yılın aynı dönemi (364 gün önce ± 1 hafta), yoksa son 8 haftanın aynı günleri, o da yoksa tahmin = eldeki. En az 2 örnek gerekir; sistemde kaydı olmayan an karşılaştırılmaz."),
    ("Pickup sınırları", "Pickup satılabilir odaya oranlanır (oda sayısı değişse de taşınır); artı pickup satılabilir odayı aşmaz, eksi pickup sıfırın altına indirmez."),
    ("Gelir tahmini", "Eldeki gece fiyatları (dahil vergi ayrılmış) + beklenen gece × o günün eldeki ADR'si (yoksa pencerenin, o da yoksa geçen yılın)."),
    ("Kritik gün", "Fazla satış (eldeki > satılabilir), tahmin > yüksek eşik, tahmin < düşük eşik. Düşük doluluk tahmin ister: karşılaştırma yokken uzak günün az eldekisi \"riskli\" sayılmaz."),
  ),
  tutarlilik: (
    "Eşik kaydı sürüm kontrollü (`expectedUpdatedAt`; eski sürümle 409), denetim kaydı ve `forecast.settings.changed` olayı.",
    "Cevap otel × iş günü × canlı sürüm anahtarıyla bir dakika önbellekte; rezervasyon ya da ayar değişince anahtar yenilenir.",
    "Gözden geçirmede modül 19 ve 21'in ayar uçlarına da sürüm kontrolü eklendi — iki kişi aynı anda kaydederse ikincisi ilkini sessizce ezmiyor.",
  ),
  olcek: (("30 günlük tahmin (soğuk)", "0,97 sn → 0,42–0,46 sn"), ("Önbellekli cevap", "anında")),
  olcek-not: [Ölçüm `scripts/perf-forecast.mjs`: 1.500 oda, 4 yıl. Geçen yılın örneği yeten günlerde son haftalar okunmaz; eldeki ile karşılaştırma okuması paralel.],
  degistir: (
    ("Yöntem", "Pickup kuralları `forecast/rules.js`'te saf ve birim testli; karşılaştırma penceresi ve örnek sayısı adlandırılmış sabitler."),
    ("Yeni risk türü", "Sözleşmedeki kritik gün türleri + ekrandaki şekil / renk / \"ne yapılabilir\" metni."),
  ),
  devir: ("Bilinen sınır: sonradan uzatılan konaklamanın eklenen gecesi, rezervasyonun açılış anından beri eldeymiş sayılır (pickup bir miktar az görünür).", "Gece kapanışı (18) otomatik \"gelmedi\" işaretleyince geçmiş geceler ve pickup örnekleri kendiliğinden düzelir."),
)
