#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Doluluk, ADR, RevPAR ve oda geliri seçilen döneme göre gün, hafta ya da ay kırılımında, grafik ve tabloyla çıkar. Geçmiş günler folyoya işlenen gerçekleşen gelirden (fiyat düzeltmeleri, indirimler, iptaller dahil), bugün ve sonrası eldeki rezervasyondan hesaplanır; her gün geçen yılın haftanın aynı günüyle kıyaslanır. Oda tipi ve kaynak kırılımı aynı ekranda; "rakamlar nasıl hesaplanıyor" açıklaması sayfada.],
  rakam: (("0,43 sn", "1 yıllık rapor, 1.500 oda / 550 bin rezervasyon"), ("364 gün", "geçen yıl = haftanın aynı günü"), ("Vergisiz", "net gelir; oranlar dönem toplamından"), ("Salt okunur", "yapay zekâ için MCP araçları")),
  ozellik: (
    ("Hazır aralıklar", "Bu ay, geçen ay, son 30 gün, önümüzdeki 30 gün, yılbaşından bugüne, son 12 ay ya da özel aralık; gün / hafta / ay."),
    ("Dört gösterge", "Doluluk, ADR, RevPAR, oda geliri — her biri geçen yıl ve değişimle."),
    ("Grafik", "Bu dönem vurgulu, geçen yıl gri bağlam, eldeki dönem gölgeli; imleç ipucu ve uç değerler; telefonda taşmaz."),
    ("Kırılımlar", "Oda tipi ve kaynak (acente, kanal, direkt…): gece, ADR, pay ve geçen yıl."),
    ("Ayrı gelir sütunları", "Erken giriş / geç çıkış ücreti ve iptal / gelmeme geliri ayrı; ADR'ye girmez. F&B, minibar, çamaşır oda geliri sayılmaz."),
    ("Tablo görünümü", "Grafiğin erişilebilir tablo hâli, toplam satırıyla."),
  ),
  neden: [Geçmişi gerçekleşenden, geleceği eldekinden okumak "rapor ne diyor, kasa ne diyor" ayrılığını bitirir; tanımlar oda planı ve günlük durumla aynı olduğu için hiçbir ekran başka sayı söylemez.],
  rol: (([Müdür, muhasebe], [Gelir raporunu görür.]), ([Yapay zekâ asistanı], [MCP üzerinden yalnız hazır raporları okur; serbest SQL yok.])),
  baglantilar: ("*Folyo (15):* geçmiş günlerin oda geliri folyo kalemlerinden.", "*Oda planı (5), günlük durum (13):* satılan / satılabilir gece tanımı ortak.", "*Forecast (25):* eldeki geceyi aynı sorgudan alır.", "*Bütçe (27):* gerçekleşen tarafı bu raporun tanımlarıyla."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/reports`: tek uç `GET /reports/revenue?from&to&groupBy` (en çok 366 gün; en ileri iş günü + 730 gün) tek cevapta kovaları, toplamı, oda tipi ve kaynak kırılımını ve geçen yılı döner. Geçmiş günler `RevenueDayStat` özetinden (gün × oda tipi × kaynak × para birimi) okunur; son 14 gün, eldeki rezervasyon ve özeti çıkmamış gün canlı sorgudan — rapor her zaman doğrudur, özet yalnız hızlandırır. MCP: `shared/mcp-server` genel salt okunur sunucu (yalnız `readOnly` araç, girdinin tam şemayla doğrulanması, iç hatanın modele sızmaması) + otelin araçları (`reports/mcp.js`: `get_occupancy`, `get_revenue`, `run_report_query` — yalnız adı verilen 4 hazır rapor).],
  kural: (
    ("Satılan gece", "Bugün ve sonrası opsiyonlu + kesin + içerideki; geçmişte yalnız gerçekleşen (içeride ya da çıkmış). Gelmeyen ama \"gelmedi\" işaretlenmemiş misafirin gecesi dolu sayılmaz."),
    ("Satılabilir", "O gece kayıtlı oda − arızalı oda; silinen oda silindiği güne kadar sayılır (geçmiş doluluk %100'ü aşamaz)."),
    ("Oranlar", "ADR = oda geliri / satılan gece; RevPAR = oda geliri / satılabilir. Dönem toplamlarından hesaplanır; oranların ortalaması alınmaz."),
    ("Gelir", "Vergiler hariç (eldekinden dahil oda vergisi ayrılır); iptal işlendiği güne düşer. Başka para birimindeki rezervasyon karışmaz, sayısı bildirilir."),
    ("Süre sınırı", "Sorgu süre sınırını aşarsa \"beklenmeyen hata\" değil 503 + \"daha kısa aralık\" (MCP'de de)."),
  ),
  tutarlilik: (
    "Saatlik iş son 31 kapanmış günü yeniden hesaplar, eski günleri 62'lik parçalarla doldurur; doldurulacak yoksa en eski parçayı yeniden hesaplar (kendini onarma). Özet turu otel başına ≤ 2 sn.",
    "Entegrasyon testi özetten ve canlıdan gelen rakamların birebir aynı olduğunu denetler.",
    "Bütün rapor sorguları `SET TRANSACTION READ ONLY` + süre sınırıyla; `REPORTING_DATABASE_URL` ile yalnız okuma yetkili veritabanı kullanıcısı verilebilir.",
  ),
  olcek: (("1 yıllık rapor (soğuk)", "3,9 sn → 0,43 sn"), ("±30 gün", "0,66 sn → 0,23 sn"), ("Özet turu (otel başına)", "≤ 2 sn")),
  olcek-not: [Ölçüm `scripts/perf-revenue.mjs`: 1.500 oda, 4 yıl, 550 bin rezervasyon, 1,1 milyon gece, 405 bin folyo kalemi. Canlı sorgu otelin bütün geçmişini taradığı için özet şarttı.],
  degistir: (
    ("Yeni kırılım", "Özet tablosunun boyutuna eklenmeli (migration + doldurma) ve canlı sorguya aynı gruplama; \"özet = canlı\" testi genişletilmeli."),
    ("Yeni MCP aracı", "`reports/mcp.js`'e `readOnly` araç + tam zod şeması; serbest SQL eklenmez."),
  ),
  devir: ("Doğal dil raporlama (24): `connectInProcess(createReportingMcpServer({ hotelId }))`; süreç dışı istemci `npm run mcp:reporting -w @hotelos/hotel-backend` (stdio).", "Gece kapanışı (18) iş günü dönünce özeti tetikleyebilir (`refreshHotelStats`)."),
)
