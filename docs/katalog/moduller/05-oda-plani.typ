#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Resepsiyon bütün odaları ve konaklamaları tek takvimde görür: satırda oda, sütunda gece. Konaklamaya tıklayınca detay çekmecesi açılır, sürükle-bırakla oda değiştirilir (içerideki misafir dahil), boş hücreye tıklayınca o oda ve tarihle yeni rezervasyon açılır. Ekran canlıdır; başka bir kullanıcının değişikliği anında görünür.],
  rakam: (("7 / 14 / 30", "günlük pencere"), ("Canlı", "değişiklik anında ekranda"), ("Sürükle", "bırak ile oda değişimi"), ("Tek tık", "boş hücreden rezervasyon")),
  ozellik: (
    ("Takvim ızgarası", "Rezervasyonlar renkli çubuk, arıza kayıtları tarih aralığında; satır başında doluluk ve kat hizmeti durumu."),
    ("Oda bekleyenler şeridi", "Odası atanmamış rezervasyonlar ayrı şeritte; tek tıkla otomatik atama."),
    ("Sürükle-bırak oda değişimi", "Misafir gelmemişse atama değişir; içerideyse eski oda boş + kirli, yeni oda dolu olur — aynı işlemde."),
    ("Oda geçmişi bozulmaz", "Taşınan misafirin geçmiş geceleri eski odada kalır; ızgarada iki çubuk, detayda \"oda geçmişi\"."),
    ("Günlük özet", "Gelen / giden (yapılan / bekleyen), doluluk — otelin tamamından, sayfalamadan bağımsız."),
    ("Filtre ve arama", "Kat, tip, durum; misafir adı / onay koduyla arama; görünüm adres çubuğunda (paylaşılabilir)."),
  ),
  neden: [Bütün otelin tek bakışta görülmesi oda kayıplarını (boş kalan, yanlış atanan) ve çifte yerleşimi önler; taşımalar kayıt altında kalır.],
  rol: (([Ön büro], [Planı izler, oda verir / değiştirir, boş hücreden rezervasyon açar.]), ([Kat hizmeti / yönetim], [Doluluk ve oda durumunu görür.])),
  baglantilar: ("*Oda (3):* oda değişikliği tek kapıdan: hangi ekrandan yapılırsa yapılsın aynı kurallar.", "*Rezervasyon (4):* boş hücre → yeni rezervasyon formu, çekmeceden rezervasyon sayfası.", "*Check-in / out (6):* içeride taşıma; misafirin hangi gece hangi odada kaldığı kayıtlı kalır (erken çıkış dahil)."),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [`modules/plan` kendi tablosu olmayan bir okuma katmanıdır: oda envanteri ile rezervasyonların kesişimini ekranın istediği şekle sokar (`GET /plan`, `/plan/unassigned`, `/plan/reservations/:id` + açık işlemler). Yerleşim hesabı saf fonksiyonlarda (`placeInWindow`, `buildRoomSegments`, `summarizeDays`). Oda değişikliği `rooms/service.js → changeRoom` ile; içerideki misafirde oda dilimi `RoomStaySegment`'e kapanır, açık dilim `[coalesce(roomSince, checkIn), checkOut)`. Canlı yayın altyapısı (`lib/realtime.js`) bu modülde kuruldu: olaylar socket kanallarına yalnız "şu değişti" haberi olarak düşer, panel ilgili sorguyu tazeler.],
  kural: (
    ("Sütun = gece", "15–18 rezervasyonu 15, 16, 17 sütunlarını doldurur; çıkış günü boyanmaz. Pencereden taşan çubuk kırpılır (`continuesBefore/After`)."),
    ("Değişiklik modları", "`ASSIGNED` / `MOVED` (misafir gelmemiş) atama yolunu, `IN_HOUSE_MOVED` aynı transaction'da oda durumlarını değiştirir; `UNCHANGED` yazmaz."),
    ("Geçmiş yeniden yazılmaz", "Çifte rezervasyon kısıtı ve arıza tetikleyicisi yalnız açık dilime bakar; içerideki misafirde uygunluk kalan gecelere bakar."),
    ("Bitmiş konaklama", "Bitmiş konaklamanın oda ataması kaldırılamaz (`STAY_ENDED`)."),
  ),
  tutarlilik: (
    "Plan cevapları otelin envanter sürümüyle anahtarlı önbellekte; aynı anda gelen aynı istekler tek hesaplamada birleşir (`lib/read-cache.js`, `lib/live-version.js`).",
    "Envanteri değiştiren her yazma olay yayınlamalı; yoksa ekran en fazla 15 sn bayat kalır.",
    "Panel tazelemesi sunucunun söylediği yayılma süresine (`spreadMs`, en çok 8 sn) rastgele dağıtılır — 2.500 panel aynı milisaniyede istek atmaz.",
  ),
  degistir: (
    ("Izgara hesabı", "Yalnız `plan/rules.js` (saf, birim testli); ekran `PlanGrid.jsx`."),
    ("Yeni canlı ekran", "Kanalı `lib/realtime.js` haritasına ekleyin, panelde `useLiveChannel(kanal, { queryKeys })`."),
  ),
  devir: ("Sürükle-bırak ile tarih değiştirme açık madde (rezervasyon düzenlemesi üzerinden eklenecek).",),
)
