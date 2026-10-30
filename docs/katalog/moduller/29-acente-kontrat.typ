#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Acenteler kodu, yetkilisi, komisyon oranı ve vadesiyle kayıtlıdır; her acentenin kontratı dönem × oda tipi × pansiyon fiyat tablosu ve stop-sale tarihleriyle girilir. Acente adına açılan rezervasyon her geceyi o günü kapsayan kontratın fiyatından otomatik alır; kontratta fiyatı olmayan ya da stop-sale'deki gece açıkça reddedilir. Acente kartında rezervasyonlar ve cari özeti (satış, komisyon, net, vadesi gelen) bir arada.],
  rakam: (("Gece gece", "iki kontrata yayılan konaklama doğru fiyatlanır"), ("Stop-sale", "elle fiyatla da aşılamaz"), ("90 ms", "acente rezervasyonu açma, 550 bin kayıtta"), ("Sabit oran", "komisyon açılışta rezervasyona kopyalanır")),
  adimlar: (("Acente", "kart · komisyon · vade"), ("Kontrat", "dönem × tip × pansiyon"), ("Satışa aç", "tek satıştaki kontrat"), ("Rezervasyon", "fiyat kontrattan"), ("Cari", "satış · komisyon · vade")),
  ozellik: (
    ("Acente kartı", "Kod ve ad otel içinde tekil, komisyon %, vade günü, aktif / pasif (silinmez); kontratı olmayan aktif acente listede uyarılır."),
    ("Kontrat fiyat tablosu", "Dönem blokları × oda tipi × pansiyon; dönemi kopyala, hata ilgili hücrede; çok dönemde bloklar kapalı başlar."),
    ("Stop-sale", "Oda tipine ya da bütün tiplere, tarih aralığıyla; aynı kapsamda çakışmaz."),
    ("Rezervasyon formunda", "Kaynak \"Acente\" → aramalı seçici; kontrat fiyatı canlı, satılamayan tip sebebiyle işaretli. Sonradan acente atanabilir / değiştirilebilir (geceler yeniden fiyatlanır)."),
    ("Fiyat değişikliği", "Satıştaki kontratın fiyatı denetim iziyle değişebilir ve yalnız sonradan açılan rezervasyonları etkiler; eklenen / kaldırılan / değişen satır izde."),
    ("Cari özeti", "Dönemde satış, açılıştaki oranla komisyon, net, iptal / gelmeme ücretleri; folyoda \"Acente / cari\" ile kapatılan tutar ve vadesi gelen kısmı."),
  ),
  neden: [Acente fiyatının elle yazılması hem hata hem tartışma kaynağıdır; kontrat fiyatı sistemden gelince resepsiyon fiyat aramaz, stop-sale gününe satış kaçmaz.],
  rol: (([Müdür], [Acente ve kontrat yönetir.]), ([Müdür, muhasebe], [Acenteleri, kontratları, cariyi görür.]), ([Rezervasyon personeli], [Rezervasyonda acente seçer (seçici yalnız ad / kod gösterir).])),
  baglantilar: ("*Rezervasyon (4):* açma, grup, düzenleme, iptal geri alma ve fiyat önizlemesi aynı kuraldan geçer.", "*Ödeme (17):* \"Acente / cari\" yöntemiyle kapatılan folyo cariye aktarılır.", "*Acente prim (35):* komisyon ve prim acente kartındaki komisyon oranından.", "*Kanal yönetimi (33):* kanal stop-sale'i ayrıdır (otel geneli)."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/agencies`: acente kartı, kontrat yaşam döngüsü (taslak → satışta → sonlandırıldı), fiyat tablosu (tamamı sürümlü kaydedilir), stop-sale, cari özeti ve acentenin rezervasyonları. Fiyatlama `agencies/sale.js` + `rules.js`: acente seçiliyse her gece o günü kapsayan satıştaki kontratın oda tipi + pansiyon fiyatından yazılır, gece dökümünde kontrat adı görünür. Rezervasyon modülünün `priceRoomLine`'ı acente → kontrat, değilse standart fiyat yolunu seçer.],
  kural: (
    ("Ret sebepleri", "`AGENCY_NOT_FOUND`, `AGENCY_PASSIVE`, `AGENCY_NO_CONTRACT`, `AGENCY_NO_RATE`, `AGENCY_STOP_SALE` (422; mesaj hangi geceler olduğunu söyler). Yetkili fiyatı elle girebilir, stop-sale elle fiyatla da aşılmaz."),
    ("Grup", "Satır başına tip + pansiyon; biri satılamıyorsa hiçbiri açılmaz."),
    ("Düzenleme", "Yalnız yeniden satılan geceler denetlenir (uzatma, pansiyon / tip / acente değişimi); eski geceler fiyatını ve stop-sale'den bağımsızlığını korur. İçerideki misafirde acente değişmez."),
    ("Komisyon kopyası", "`Reservation.agencyCommissionPct` açılışta karttan kopyalanır; acente varsa oran da vardır (CHECK)."),
    ("Para birimi", "Kontrat otelin para birimindedir (çoklu para birimi ayrı modül)."),
  ),
  tutarlilik: (
    "Aynı acentenin aynı günü kapsayan en çok bir satıştaki kontratı; aynı kontratta aynı tip + pansiyon için dönemler çakışmaz — ikisi de `EXCLUDE` kısıtı.",
    "Kilit düzeni: rezervasyon → oda tipi → acente (satışta paylaşımlı, kontrat / stop-sale / kart yazımında özel): stop-sale yazılırken gelen rezervasyon eski durumu görüp geçemez (testli).",
    "Kart ve fiyat tablosu sürüm kontrollü; kaydedilmemiş girişi canlı tazeleme silmez (kanal `agencies.changed`).",
  ),
  olcek: (("Acente listesi", "6–10 ms"), ("Seçici araması", "3 ms"), ("Kontrat ekranı", "7 ms"), ("Cari özeti", "4 ms"), ("Acente rezervasyonu açma", "~90 ms (acentesiz ~80 ms)")),
  olcek-not: [Ölçüm `scripts/perf-agencies.mjs`: 3.000 acente, 600 kontrat × 108 fiyat satırı, 82 bin acenteli rezervasyon, 550 bin rezervasyonlu tablo.],
  degistir: (
    ("Kişi başı fiyat", "Kontrat fiyatı oda başı gecelik; kişi başı ek, tek kişi farkı, çocuk indirimi fiyat planı modülünün işi — `priceRoomLine` içinde kontrat yolu ayrı kalmalı."),
    ("Yeni ret sebebi", "`agencies/rules.js` (birim testli) + sözleşmedeki kod; ekran sebebi tip seçicisinde gösterir."),
  ),
  devir: ("Acentenin yaptığı ödemelerin cariden düşümü ön muhasebe (47) ile bağlanacak.", "Allotment (30) kota ve release'i bu acenteye bağlar."),
)
