#import "/sablon/standart.typ": *

#let musteri(veri) = tanitim(
  veri,
  giris: [Otelin yazılımı tek başına bir ada değildir: kurumsal müşterinin seyahat aracı, şirketin CRM'i, acentenin rezervasyon yazılımı ya da otelin kendi web sitesi otele bağlanmak ister. Açık API bunu güvenli yoldan sağlar. Yönetici her dış sistem için bir uygulama açar ve kapsamı sınırlı bir anahtar verir. Dış sistem müsaitliği ve fiyatı okur, rezervasyonları çeker, paneldekiyle aynı kurallarla rezervasyon açar. Bir şey değiştiğinde (rezervasyon açıldı, misafir giriş yaptı, ödeme alındı, fatura kesildi) dış sistemin adresine imzalı bir haber (webhook) gider; "değişen bir şey var mı" diye sürekli sorması gerekmez.],
  rakam: (("4 kapsam", "anahtar başına ayrı"), ("17 olay", "webhook ile dışarıya"), ("8 deneme", "≈ 45 saat, artan bekleme"), ("0 kişisel veri", "webhook gövdesinde")),
  adimlar: (("Uygulama", "her dış sistem için"), ("Anahtar", "kapsam · süre · bir kez"), ("API", "müsaitlik · rezervasyon"), ("Olay", "rezervasyon · giriş · ödeme"), ("Webhook", "imzalı · yeniden dener"), ("Log", "teslimat · yeniden gönder")),
  akis-aciklama: [Dış sistem anahtarıyla gelir; sunucu anahtarın özetini, kapsamını ve uygulamanın dakikalık sınırını denetler. Rezervasyon açma isteği panelin kullandığı fiyat motorundan ve müsaitlik kilidinden geçer: dışarıdan fiyat verilemez, yer yoksa rezervasyon açılmaz. Aynı istek iki kez gelirse (ağ kopması) ikinci rezervasyon açılmaz. Olaylar işlem kaydedildikten sonra kuyruğa yazılır, ayrı bir gönderici imzalayıp iletir; alıcı cevap vermezse 1 dakikadan 24 saate artan aralarla tekrar dener.],
  ozellik: (
    ("Uygulama ve anahtar", "Her dış sistem ayrı uygulama: kapatılan uygulamanın bütün anahtarları anında durur. Anahtar oluşturulduğu an bir kez gösterilir; sistem yalnız özetini saklar, kaybolursa iptal edilip yenisi açılır. Son kullanım zamanı ve adresi görünür."),
    ("Kapsamlar", "Müsaitlik ve fiyat · Rezervasyonları okuma · Rezervasyon açma / değiştirme / iptal · Misafir kartlarını okuma. Yazma okumayı da ister. Kimlik belgesi bilgisi (TC / pasaport no, doğum tarihi) hiçbir kapsamla dışarı verilmez."),
    ("Paneldeki kurallar", "Fiyat otelin fiyat motorundan; müsaitlik kilitli; yer yoksa açılmaz; iptal cezası otelin politikasından ve API ile silinemez. Uygulama yalnız kendi açtığı rezervasyonu değiştirir; personelin iç notunu göremez. API rezervasyonu otelin ayarına göre opsiyonlu ya da kesin açılır; kaynağı \"Dış sistem (API)\"."),
    ("Değişenleri çekmek", "Rezervasyon ve misafir listelerinde \"şu andan sonra değişenler\" ve sayfa imleci: dış sistem kopyasını eksiksiz eşitler."),
    ("Webhook", "HTTPS adres ve seçilen olaylar. Her teslimat imzalı (zaman damgası imzaya dahil, eski teslimat yeniden oynatılamaz). Sır yenilenince eski sır 24 saat ikinci imza olarak gider; teslimat kesilmez. Uzun süre cevap alınamayan abonelik kendiliğinden kapanır, yöneticinin ziline uyarı düşer."),
    ("Teslimat logu ve doküman", "Her teslimatın denemeleri, alıcının cevap kodu ve süresi; bitmiş teslimat yeniden gönderilir. Geliştiriciler için Swagger sayfası otelin kendi sunucusundan: uçlar ve olaylar koddaki şemalardan üretilir, \"Dene\" ile istek atılır."),
  ),
  neden: [Entegrasyonu olmayan bir otel yazılımı, kurumsal müşterinin ve acentenin rezervasyonlarını e-posta ve telefonla, elle girer: hata, gecikme ve çift kayıt kaçınılmazdır. Açık API bu işi otomatikleştirir, ama güvenlik bedeli ödemeden: her bağlantı ayrı, kapsamı dar, iptali anında; dışarıdan gelen her rezervasyon otelin kendi fiyat ve müsaitlik kuralından geçer. Webhook gövdesinde kişisel veri olmaması, yanlış adrese giden bir haberin bile misafir bilgisi sızdırmaması demektir (KVKK).],
  rol: (
    ([Yönetici], [Uygulama açar, anahtar verir ve iptal eder, webhook aboneliği kurar, teslimatları izler ve yeniden gönderir.]),
    ([Müdür], [Bağlı sistemleri, anahtarların kullanımını ve teslimat logunu görür.]),
    ([Dış sistemin geliştiricisi], [Swagger dokümanından uçları ve olayları öğrenir; imzayı örnek kodla doğrular.]),
  ),
  baglantilar: (
    "*Rezervasyon (4):* API'den açılan rezervasyon aynı servisle açılır, değiştirilir, iptal edilir; tekrar gelen istek aynı rezervasyonu bulur.",
    "*Fiyat ve promosyon (25, 31):* fiyat motoru; promosyonun satış kanalı koşulunda \"Dış sistem (API)\" seçilebilir.",
    "*Giriş / çıkış, ödeme, fatura (6, 17, 16 / 49):* olayları webhook ile dışarıya.",
    "*Uyarılar (9):* kendiliğinden kapanan abonelik yöneticinin ziline.",
    "*Acente portalı (100), uzaktan MCP (86):* aynı uygulama ve anahtar altyapısı.",
  ),
)

#let teknik(veri) = teknik-bolum(
  veri,
  mimari: [Sözleşme: `contracts/integrations.js` (kapsamlar, anahtar biçimi, olay tablosu ve iç olay → dış olay çevirisi, adres kuralı, tekrar deneme çizelgesi, panel ve API şemaları) ve `contracts/public-api-spec.js` (uç tablosu `PUBLIC_API_ROUTES`, webhook gövde şemaları, OpenAPI 3.1 üretici). Sunucu: `modules/integrations` (panel servisi, kuyruğa yazan dinleyici `outbox.js`, gönderici `sender.js`, zamanlanmış işler) ve `modules/public-api` (anahtar doğrulama `auth.js`, uçlar tablodan kaydedilir, işleyiciler rezervasyon / ayar / misafir servislerinin ince sarmalayıcısı). Güvenlik yardımcıları: `lib/ssrf.js` (çözülen IP denetimi), `lib/webhook-signature.js` (imza, anahtar üretimi, istek kimliği). Ekran: `pages/integrations`, doküman Vite eklentisiyle `dist/api-docs`.],
  kural: (
    ("Anahtar", "Biçim `fhk_` + 12 karakter önek + 43 karakter sır (32 bayt). Saklanan: önek (tekil indeks) ve bütün anahtarın SHA-256 özeti; karşılaştırma sabit sürede. Satır 60 sn önbellekte; iptal / uygulama değişikliği önbelleği siler. Geçersiz anahtar denemesi IP başına dakikada 60'tan sonra 429."),
    ("Sıra", "Anahtar (onRequest, 401) → uygulamanın dakikalık sınırı (429, `X-RateLimit-*`) → kapsam (403) → şema (400) → işleyici. Hata gövdesinden `details` atılır."),
    ("Rezervasyon açma", "`Idempotency-Key` zorunlu; uygulamaya özel deterministik istek kimliğine çevrilir (`sha256(api:uygulama:anahtar)` → UUID). Onaya gönderme kapalı: yer yoksa 409. Misafir iletişimi başka adlı kartla çakışırsa yeni kart (eşleşen kart dışarı gösterilmez). Değiştirme ve iptal yalnız `apiClientId` uygulamanınsa; sürüm (`expectedUpdatedAt`) denetlenir."),
    ("Senkron", "`updatedSince` verilince (updatedAt, id) artan imleç; indeks `(hotelId, updatedAt, id)` (Reservation, Guest)."),
    ("Kuyruk", "İş olayı commit sonrası `WEBHOOK_SOURCE_EVENTS` dinleyicisine gelir; otelin açık abonelikleri 30 sn önbellekte; isteyen her aboneliğe teslimat `createMany(skipDuplicates)` — `(subscriptionId, eventId)` tekil, outbox tekrarı çift teslimat yazmaz."),
    ("Gönderim", "Sahiplenme `FOR UPDATE SKIP LOCKED` + süreli kilit (süreç düşerse geri alınır); abonelik başına sırayla, abonelikler arası 8 paralel; ulaşılamayan alıcıda turun kalanı hak yakmadan 1 dk sonraya. Bağlantı çözülen ve denetlenen IP'ye (`https.request` `lookup`); özel / döngü / bağlantı-yerel / meta-veri / CGNAT / ULA / eşlemeli adres engellenir; 3xx takip edilmez; cevabın ilk 8 KB'ı okunur, 1000 karakteri saklanır; 10 sn süre."),
    ("Yeniden deneme ve kapanma", "1, 5, 30, 120, 360, 720, 1440 dk (+%10'a kadar dağıtma), toplam 8 deneme; `Retry-After` çizelgeden uzunsa uyulur (24 sa tavanı). Art arda 20 başarısızlık ve 72 saat başarısızlıkta `DISABLED` + `INTEGRATION` zili; yeniden açınca bekleyenler hemen sıraya. Sayaç yazımları `updatedAt`'i ilerletmez (ekrandaki düzenleme bayatlamaz)."),
    ("İmza", "`X-FlexHotel-Signature: t=<unix>,v1=<hex>[,v1=<hex>]`, HMAC-SHA256(sır, t + \".\" + gövde). Sır AES-256-GCM ile şifreli (`SETTINGS_SECRET_KEY`); yenilemede eski sır 24 sa ikinci imza."),
  ),
  tutarlilik: (
    "*Tek tablo:* uçlar ve doküman `PUBLIC_API_ROUTES`'tan; tabloda olup işleyicisi olmayan uç sunucuyu açtırmaz (birim test).",
    "*Olay kataloğu:* dinlenen her iç olay katalogda var (birim test); her olayın ince gövdesi doküman şemasına uyar ve kişisel alan içermez (sözleşme testi).",
    "*Aynı kod yolu:* API rezervasyonu panelin `createReservation` / `applyReservationUpdate` / `cancelReservation` servislerinden geçer; işlem kaydında kişi `api:<uygulama> (fhk_<önek>)`.",
  ),
  olcek: (
    ("Anahtar doğrulaması", "önbellekten, özet karşılaştırması µs"),
    ("Aboneliği olmayan otelde iş olayı", "sorgu yok (30 sn önbellek)"),
    ("Teslimat taraması", "kısmi indeks `(nextAttemptAt) WHERE PENDING / RETRYING`"),
    ("Son kullanım yazımı", "anahtar başına dakikada en fazla 1"),
    ("Saklama", "30 gün, 5000'lik paketlerle silme"),
  ),
  olcek-not: [Personelin işlemi alıcının cevabını hiç beklemez: olay yalnız kuyruğa yazılır (tek `INSERT`), gönderici ayrı çalışır. Yavaş ya da kapalı bir alıcı diğer uygulamaların teslimatını bekletmez. Hız sınırı sayacı süreç içidir; birden fazla sunucu sürecinde paylaşılan bir depoya taşınmalı.],
  test-notu: [Sözleşme: anahtar biçimi, kapsam gereksinimi, webhook adres kuralı (IPv4 / IPv6 / iç ad), tekrar deneme çizelgesi ve Retry-After, kapanma kuralı, her olay örneğinin ince gövdesi + doküman şeması, OpenAPI (her uç, zorunlu parametreler, webhook bölümü). Backend birim: SSRF (özel aralıklar, eşlemeli IPv6, NAT64, çoklu IP'li çözüm, üretimde yerel izin kapalı), imza ve geçiş sırrı, tekrar oynatma, anahtar özeti, Idempotency-Key, olay kataloğu, tablo ↔ işleyici. Ön yüz: kapsam seçimi. Entegrasyon (gerçek PostgreSQL, 12): panel izinleri ve sırların hiçbir uçtan / denetim kaydından okunamaması, anahtar yaşam döngüsü ve otel kapsamı, hız sınırları, müsaitlik, rezervasyon açma / tekrar / yer yok, misafir sızıntısı, sahiplik ve sürüm, senkron imleci, webhook kuyruğu / imza / tekrar deneme / FAILED / ulaşılamayan alıcı / kapanma + zil / duraklatma / sır yenileme / deneme olayı / silme / temizlik, sınırların kilit altında sayılması.],
  degistir: (
    ("Yeni uç", "`PUBLIC_API_ROUTES`'a satır (yol, kapsam, şemalar) + `public-api/routes.js` işleyicisi; doküman kendiliğinden güncellenir."),
    ("Yeni webhook olayı", "`WEBHOOK_EVENT_DEFINITIONS` (kaynak iç olay + ince gövde seçici) ve `WEBHOOK_EVENT_DATA_SCHEMAS`; testler eksikliği yakalar."),
    ("Yeni kapsam", "`API_SCOPES` + etiket / açıklama; gereksinimi varsa `API_SCOPE_REQUIRES`."),
  ),
  devir: (
    "*100 (acente portalı):* uygulamayı acenteye bağlayıp okuma kapsamını o acentenin rezervasyonlarına daraltır, satışı kontrat fiyatından açar.",
    "*86 (uzaktan MCP):* OAuth 2.1 istemcileri uygulama olarak kaydedilir; kapsamlar aynı.",
    "*85 (otomasyon):* \"webhook gönder\" eylemi aynı gönderici ve imzayla.",
  ),
)
