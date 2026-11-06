# 01 — Mimari (Hakimiyet Çekirdeği)

> Bu doküman sistemin kalbidir. İki kez oku. Sunumda "nasıl çalışıyor?" sorusuna buradan cevap vereceksin. Her başlık gerçek koddan doğrulandı.

## 0. Büyük resim

FlexHotel **olay-güdümlü (event-driven)** bir sistemdir. Üç katman:

```
  Kullanıcı / Misafir / OTA / Restoran
            │  (HTTP isteği)
            ▼
  ┌──────────────────────────┐
  │  Backend servis katmanı   │  → işi veritabanına TEK transaction'da yazar
  │  (Fastify + Prisma)       │    ve aynı transaction'da bir OLAY üretir
  └──────────────────────────┘
            │  (commit sonrası olay dağıtılır)
            ▼
  ┌──────────────────────────┐
  │  Olay bus'ı (event bus)   │  → olayı doğrular, kaydeder, dinleyicilere dağıtır
  └──────────────────────────┘
            │
            ▼
  ┌──────────────────────────┐
  │  Aktörler (worker + AI)   │  → her biri kendi işini yapar, yeni olay üretebilir,
  │                           │    kritik kararda ONAY kuyruğuna yazar
  └──────────────────────────┘
```

**Kod yeri:** çekirdek `shared/actor-kit/` ve `shared/core/`; otele özel aktörler `hotel/workers/`, `hotel/agents/`; backend bağlama `hotel/backend/src/lib/actors.js`.

---

## 1. Aktör modeli: Worker vs Agent

Sistemde iki tür otonom "aktör" var, ikisi de aynı tabandan türer:

- **Worker (`BaseWorker`)** — **Kural tabanlı.** Bir olaya deterministik tepki verir (oda atama, oda durumu değiştirme, folyo açma, bildirim). `shared/actor-kit/base-worker.js`.
- **Agent (`BaseLlmAgent`)** — **AI tabanlı.** `BaseWorker`'ı genişletir; worker'ın tüm garantilerini (idempotency, retry, manuel göreve düşme) miras alır, üzerine LLM çağrısının üç kuralını ekler. `shared/actor-kit/base-llm-agent.js`.

### Bildirge (manifest) — aktör kendini beyan eder

Her aktör, kodundan **önce** ne yaptığını `defineActor` ile beyan eder (`shared/actor-kit/manifest.js`). Gerçek örnek — oda aktörü (`hotel/workers/room-worker/manifest.js`):

```js
export const roomWorkerManifest = defineActor({
  name: 'room-worker',
  title: 'Oda aktörü',                 // panelde görünen Türkçe ad
  type: 'worker',
  subscribes: ['reservation.created', 'guest.checked_in',
               'guest.checked_out', ...],   // dinlediği olaylar
  publishes: ['room.assigned', 'room.status.changed'],  // ürettiği olaylar
  retry: { attempts: 3, backoffMs: 400 },  // 3 deneme, artan bekleme
  fallbackModule: 'Oda atama',         // kapalıyken görevin düşeceği modül
});
```

**Bildirgenin varlık sebebi:** Yönetim paneli (modül 12), "bu aktörü kapatırsam ne durur?" sorusunu **koda bakmadan** cevaplayabilsin. `subscribes`/`publishes` çapraz eşlemesiyle bir aktörün etkisi otomatik hesaplanır.

**Fail-fast koruma (çok önemli):** Katalogda tanımlı olmayan bir olaya bağlanan aktör **başlatılamaz**; bildirgede beyan edilmeyen bir olaya işleyici yazılamaz. Yani yanlış bağlantı sistemi sessizce bozmaz, en başta net Türkçe hatayla durur.

---

## 2. Olay akışı (event bus)

Ana sınıf: `InMemoryEventBus` (`shared/core/bus/event-bus.js`). Süreç içinde (in-process) çalışır.

### Yayın sırası: doğrula → kaydet → dağıt

```
publish(olayAdı, veri):
  1. DOĞRULA  → Zod katalog şemasına uyuyor mu? (uymazsa reddedilir)
  2. KAYDET   → önce EventLog tablosuna yaz
  3. DAĞIT    → dinleyicilere paralel gönder
```

Sıra bilinçli: önce kaydedip sonra dağıtmak. Ters olsaydı süreç çökünce "işlendi ama kaydı yok" durumu çıkardı. **Kalıcılık başarısızsa olay dağıtılmaz** — yani "olay dağıtıldı ama kaydedilmedi" de imkânsız.

### Olay kataloğu = modüller arası sözleşme

`shared/core/events/catalog.js` — her olayın gövdesi Zod şemasıyla tanımlı, dondurulmuş (`Object.freeze`). Olayı yayınlayan ile dinleyen farklı zamanlarda, farklı kişilerce yazılır; şema bu sözleşmeyi garanti eder. İki katlı koruma: **bildirge zamanı** (olay adı katalogda var mı) + **yayın zamanı** (gövde şemaya uyuyor mu).

### correlationId — tam izlenebilirliğin tutkalı

Zincir bağlamı `AsyncLocalStorage` ile taşınır (`shared/core/correlation.js`). Bir dinleyici içinde yayınlanan olay, aynı `correlationId`'yi ve bir öncekini `causationId` olarak taşır.

Sonuç: `A → B → C` zincirinin hepsi aynı `correlationId` ile bağlıdır. Bu, modül 10'un **"bir WhatsApp mesajından folyoya kadar tüm zinciri tek ağaçta gör"** ekranının temelidir.

### Döngü koruması

Dinleyici olay üretebildiği için döngü riski var (A→B→A). Her adımda `hop` sayacı artar; `MAX_HOPS = 10` aşılırsa zincir güvenle kesilir ve loglanır.

### Transactional outbox (en önemli bütünlük garantisi)

`hotel/backend/src/lib/events.js` + `lib/write.js` (`writeWithEvents`): iş verisi **ve** olay **aynı transaction'da** yazılır (`EventLog`'a `publishedAt=null` ile), transaction commit olduktan sonra dağıtılır ve işaretlenir. Süreç commit sonrası çökse, `lib/outbox.js` dağıtılmamış olayları yeniden dağıtır.

**Sonuç — iki şey birden imkânsız:**
- "İzi olmayan değişiklik" (veri değişti ama olay/audit yok)
- "Olmayan değişikliğin olayı" (olay var ama veri değişmedi)

---

## 3. Onay mekanizması (human-in-the-loop) — EN ÖNEMLİ FARKLILAŞTIRICI

Bu, "otonom ama kritik kararda insan devrede" desenidir. Rakip sistemlerin ya hiç sunmadığı ya da bozuk sunduğu şey.

### Üretimde nasıl çalışıyor — servis katmanı yolu

Mevcut kodda onay **servis katmanında** açılıyor (`requestApproval(tx, stage, ...)`). Onay isteyen gerçek para akışları:

| Nerede | Ne zaman onay ister |
|---|---|
| `payments/service.js` | Eşik üstü **büyük ödeme** ve her **iade** |
| `reservations/service.js` | Politika "onaya gönder" ise **overbooking** |
| `folios/service.js` | Folyo kaleminin **iptali** (`FOLIO_VOID`) |
| `pos/` | Eşik üstü POS ikram / iptal / indirim |
| `banquet/`, `agency-bonus/`, `vouchers/`, `purchasing/` | Etkinlik, acente primi, muhasebe fişi, satın alma onayları |

### Akış (adım adım)

```
1. Servis riskli işi yapmadan requestApproval(...) çağırır
   → PendingAction tablosuna, olayın TÜM zarfıyla (id, name, payload,
     correlationId...) yazılır. (actorName, eventId) tekil kısıtla.

2. Onay kuyruğu ekranında (modül 11) iş görünür. Yetkiliye zil uyarısı düşer.

3. Yetkili ONAYLAR → approval.granted olayı
   → subscribers.js:resumeGrantedApproval işi üstlenir (resumedAt ile BİR KEZ)
   → ilgili aktörü/servisi AYNI olay kimliğiyle tekrar çağırır, correlationId korunur.

4. İş kaldığı yerden tamamlanır.
```

### Neden onaylanan olay bus'a YENİDEN verilmiyor? (kritik tasarım kararı)

Onaylanan olay bus'a geri yayınlansaydı, aynı olayı dinleyen **diğer** aktörler de (yeni kimlikle gelen olayı tanımadan) işi **ikinci kez** yapardı — örn. rezervasyon onayı misafire iki kez giderdi. Bu yüzden devam **hedeflidir** (yalnızca isteyen tarafa), **idempotenttir** (`resumedAt`), **zincir-korumalıdır** (aynı `correlationId`) ve **yetki-izlidir** (işi onaylayan kişi kaydedilir).

> **Çoğu olay-güdümlü sistemde "onayı bus'a geri yayınla" yaygın bir anti-pattern'dir ve tam da bu çift-işleme hatasını üretir.** FlexHotel bunu bilinçle yapmaz. IT ekibine anlatılacak güçlü bir detay.

### Dört göz kuralı

İsteyen kendi isteğini onaylayamaz (`approvalSelfDecisionError`). İki yönetici aynı anda karar veremez (satır kilidi). Süresi geçen onay ayrı bir işle, çok-süreçte çift düşürmeyi önleyen `FOR UPDATE SKIP LOCKED` ile kapatılır.

### Dürüstlük notu (IT sorarsa)

`BaseWorker` ayrıca **aktör-tarafı** bir onay kancası da sunar (`ctx.requireApproval` → devam `ctx.approval` ile aktöre döner). Bu altyapı **kurulu ve testlerle tam doğrulanmış**, ama mevcut üretim worker/agent'larında çağrılmıyor — bugün tüm canlı onaylar yukarıdaki servis katmanı yolundan açılıyor. Doğru ifade: **"Onay mekanizması gerçek ve para akışlarında kullanılıyor; aktörlerin de doğrudan onaya düşürebilmesi için altyapı hazır."**

---

## 4. Dayanıklılık — BaseWorker'ın beş garantisi

`BaseWorker.handle` **hiçbir koşulda dışarı hata fırlatmaz** — bir aktörün patlaması yayıncıyı ve diğer aktörleri etkilemez (testle doğrulanmış).

### a) Tekrar işlememe (idempotency)

Her olay işlenmeden önce `isProcessed(aktör, eventId)` denetlenir. Backend'de `ProcessedEvent` tablosunda `(actorName, eventId)` **unique kısıt** var; yarışta ikinci yazım veritabanı seviyesinde reddedilir (`P2002`). Yani outbox tekrarı / retry / çift webhook **odayı ikinci kez atamaz, kalemi ikinci kez yazmaz.**

### b) Yeniden deneme (retry)

Geçici hatada manifest'teki `attempts` kadar, artan beklemeyle (`backoffMs × deneme`) tekrar denenir. İki istisna beklemeden personele düşer: onay sinyali ve **iş kuralı hataları** (4xx, `retryable=false`) — örn. "boş oda yok" beklemekle düzelmez.

### c) Manuel göreve düşme (fallback)

İş yapılamazsa personelin "Görevler" listesine **insan-okur başlıklı** bir görev düşer: _"Rezervasyona oda atanacak: Ahmet Yılmaz, 15.06–18.06"_ gibi — ham olay adı değil. Görev + yetkiliye zil uyarısı aynı transaction'da.

### d) Aktör kapalıyken

Panelden kapatılan aktörün işi **kaybolmaz**, manuel göreve düşer; olay yine de "işlenmiş" sayılır ki tekrar gelince ikinci görev açılmasın. Ayar her olayda veritabanından **önbeleksiz** okunur → kapatma bir sonraki olayda anında etki eder.

**İki önemli ayrık durum:**
- **`skipWhenDisabled`:** Telafisi aktörün kendi zamanlı işi olan olaylar (örn. kanal gönderimi — tam eşitleme kaçanı yakalar) görev açmadan atlanır. Ama **gelen OTA rezervasyonu asla atlanmaz** — resepsiyona görev düşer, yoksa misafir kaybolurdu.
- **Onay sonrası devam:** Aktör kapalı olsa bile onaylanmış iş **yapılır** — onaylanmış işi manuel göreve düşürmek personele aynı işi iki kez sormak olurdu.

### e) Arka plan yürütme + taşma

LLM çağrısı gibi saniyeler süren işler kuyruklu çalışır (`maxConcurrent` / `maxQueued`); yayıncıyı bekletmez. Taşan iş `onOverflow` ayarına göre personele düşer (`fallback`) ya da atlanır (`skip`). Her iş **kendi** olayının bağlamını taşır (`AsyncResource.bind`).

---

## 5. Para bütünlüğü (money.js)

**Kural:** Para ve oranlar API'de ve veritabanında **string** taşınır; hesap yalnızca `shared/core/money.js` katmanından geçer. `Number()` ile çarpmak **yasak**.

**Neden:** `0.1 + 0.2 !== 0.3`. Biri `Number(basePrice) * nights` yazdığı an kayan nokta hatası geri gelir ve ay sonu mizan kuruş tutmaz. Altta `decimal.js` var (20 basamak, `ROUND_HALF_UP`).

**Altın kural:** **Ara adımda asla yuvarlama yapılmaz; yuvarlama yalnız nihai `toMoneyString`'de.** Ara adımda yuvarlamak hata biriktirir.

Fonksiyonlar: `toDecimal`, `multiply` (zincirde ara yuvarlama yok), `sum`, `subtract`, `percentOf` (KDV), `isEqual`, `isZero`, `toMoneyString`.

Veritabanı tipleri bunu destekler: `Decimal(12,2)` para, `(12,6)` kur, `(5,2)` yüzde, `(6,3)` çarpan, `(14,4)` birim maliyet. Ve CHECK kısıtları: `folioAmount = ROUND(amount×rate, 2)`, `total = net + vergi`, `balance = charges − payments` — tutarlılık **veritabanında da** doğrulanır.

---

## 6. Veri modeli ve veritabanı kısıtları (bütünlük garantileri)

**147 tablo.** 143'ünde `hotelId` (çok kiracılı), 44'ünde `deletedAt` (soft-delete), 108'inde `updatedAt` (optimistic lock).

### Şemada ifade edilemeyen, migration SQL'ine elle yazılmış özel kısıtlar

> ⚠️ Bu yüzden `prisma db push` **KULLANILMAZ** — şemada görünmeyen bu kısıtları uyarı vermeden siler. Şema değişikliği her zaman `npm run db:migrate` ile. (README'de özel uyarı var.)

**A) Çakışma engelleri — `EXCLUDE` + `btree_gist` (PostgreSQL 13+, `postgresql-contrib` şart):**
- **Sezon çakışması** (`Season_no_overlap`): aynı güne iki sezon çarpanı düşemez → fiyat belirsizliği imkânsız.
- **Çifte rezervasyon** (`Reservation_no_double_booking`): aynı odaya çakışan iki aktif rezervasyon fiziksel olarak yazılamaz → **overbooking'e karşı veritabanı seviyesi son hat.**
- **Arıza çakışması** (`RoomBlock_no_overlap`) ve **salon tutma** (`EventVenueHold_no_double_definite`).

**B) Kısmi unique index'ler (yalnız silinmemiş/aktif satır):** silinen oda tipi kodu/oda numarası tekrar kullanılabilir ama aktifler arasında tekil kalır; `requestId` ile rezervasyon idempotentliği.

**C) 120+ CHECK kısıtı:** iptal politikası tutarlılığı, sezon tarih sırası, ödeme işareti (`PAYMENT>0`, `REFUND<0`), çift taraflı defter (`LedgerEntry` ya borç ya alacak), durum makineleri (etkinlik/fiş/çek-senet).

### Soft-delete & optimistic lock

- **Soft-delete:** Prisma extension tüm sorgulara otomatik `deletedAt: null` ekler. **Kural: `findUnique` değil `findFirst`** — çünkü Prisma `findUnique`'in where'ine filtre eklemeye izin vermez, silinmiş kaydı döndürebilir. Audit/geri yükleme için ayrı `prismaUnfiltered` istemcisi var.
- **Optimistic lock:** `updateWithVersionCheck`, `updatedAt` damgasını kontrol eder; eskiyse 409 "başkası değiştirdi", kayıt yoksa 404 (ayrı mesajlar).

### Eşzamanlılık — overbooking neden imkânsız (iki kat savunma)

1. **Uygulama katmanı:** rezervasyon yazmadan önce `lockRoomTypes` ile oda tipi satırı kilitlenir (`SELECT ... FOR UPDATE`), **aynı transaction'da** müsaitlik yeniden hesaplanır. İki eşzamanlı istek sıraya girer; ikinci, birincinin aldığı odayı görür → "yer yok".
2. **Veritabanı katmanı:** yukarıdaki `Reservation_no_double_booking` kısıtı — kod hatalı olsa bile fiziksel engel.

**Kilit sırası kuralı** (`lib/locks.js`): tüm `FOR UPDATE` kilitleri sabit bir sırayla alınır (rezervasyon → oda tipi → oda → … ; muhasebede fiş → cari → kasa → çek/senet), her grup id sırasıyla. Farklı sırayla kilitleyen iki işlem birbirini kilitlerdi (deadlock) — sabit sıra bunu imkânsız kılar. Deadlock/serialization olursa `writeWithEvents` en fazla 3 kez otomatik yeniden dener.

### İş günü & saat dilimi

`getBusinessDate(hotelId)`: "bugün" = **otelin saat dilimindeki** takvim günü. Sunucu UTC ise İstanbul'da gece yarısından sonra `new Date()` dünü gösterir — gece denetimi, fiyatlama, SLA yanlış güne düşerdi. Ham SQL zaman sütunları UTC duvar saati tutar (`sql-time.js`), oturum saat diliminden bağımsız.

---

## 7. Güvenlik

- **Kimlik doğrulama (gerçek):** bcrypt parola (kullanıcı yoksa da sabit dummy-hash → enumeration koruması), JWT access token (15 dk), DB'de saklanan **rotation'lı** refresh token (yenilemede eski iptal → sızmış token tekrar kullanılamaz). `/login` ve `/refresh` IP başına sıkı hız sınırlı. Üretimde JWT secret zayıf/eksik/örnekse **sunucu açılmaz.**
- **RBAC:** 77+ `domain.action` izni, tek kaynaktan (`@hotelos/hotel-contracts/permissions.js`) — sunucu ve tarayıcı aynı katalog. Her istekte sunucuda denetlenir (`requirePermission`). **ADMIN her zaman tam yetkili** (matristen kilitlenemez). **Arayüzdeki yetki kontrolü yalnız menü/buton gizlemedir; asıl koruma sunucuda.**
- **Çok kiracılı:** `hotelId` JWT'den gelir, her sorgu bununla filtreli. Şu an tek aktif otel; zincir/çoklu otel (modül 63) için şema hazır.
- **Maskeleme (KVKK):** kimlik no, telefon, e-posta, pasaport, IBAN, kart denetim/aktivite loglarında maskeli; tam kimlik yalnız giriş önizlemesi + `stays.manage` izni.
- **Sır yönetimi:** DB'de saklanan SMTP/SMS parolaları AES-256-GCM şifreli; anahtar (`SETTINGS_SECRET_KEY`) ortamda, DB'de değil — yedek sızsa bile hesap ele geçmez.
- **Hata sızıntısı önleme:** 500+ hatalarda istemciye yalnız "beklenmeyen hata" + kod; SQL/stack/dosya yolu yalnız sunucu logunda (testle doğrulanmış). DB kısıt ihlalleri Türkçe mesaja çevrilir.
- **CORS / hız sınırı / gövde boyutu:** üretimde CORS beyaz listesi dar (başka site tarayıcıdan API cevabını okuyamaz); IP+personel başına dakikada 600 istek; gövde boyutu sınırlı (fotoğraf uçları bilerek biraz yüksek).

---

## 8. Yapay zeka altyapısı (AI)

- **Sağlayıcı: OpenAI**, gerçek resmi SDK (`import OpenAI from 'openai'`), Chat Completions API. **Mock değil.** (Anthropic değil — IT sorarsa net cevap: OpenAI.)
- **`BaseLlmAgent` her çağrıda:** (1) **önce izin** — AI açık mı, modelin fiyatı tanımlı mı, otelin günlük bütçesi doldu mu; (2) çağrı; (3) **sonra kayıt** — token + maliyet `Decimal` ile, günlük özetle aynı transaction'da.
- **Bütçe bir sigortadır:** bütçe 0 = AI kapalı (sınırsız bütçe yok). Dolunca model çağrılmaz, konuşma personele devrolur. Fiyatlar otelin AI ayarından (1M token başına USD) — sağlayıcı fiyatı değişince kod değil ayar değişir.
- **Kayıt koşulu:** AI ajanları yalnız `OPENAI_API_KEY` tanımlıysa kaydedilir. Anahtar yoksa panel "anahtar tanımlı değil" der, yeni konuşmalar personel modunda açılır — sistem hata vermez.
- Üç ajan: `router-agent` (ucuz model, niyet sınıflandırma), `concierge-agent` (ana model, LangGraph `StateGraph` + araçlar), `budget-agent` (ana model, sapma yorumu). Detay `03-MODULLER-ARKA-OFIS.md`.

---

## 9. "Neden böyle?" — bilinçli mühendislik kararları (sunumda güven verir)

| Karar | Neden |
|---|---|
| Para string + decimal.js, ara yuvarlama yok | Ay sonu mizan kuruşu kuruşuna tutsun |
| Olay önce kaydedilir sonra dağıtılır | Süreç çökse "işlendi ama izi yok" olmasın |
| Onay bus'a geri verilmez | Diğer aktörler işi ikinci kez yapmasın |
| `findFirst` zorunlu, `findUnique` yasak | Silinmiş kayıt sessizce geri gelmesin |
| Sabit kilit sırası | Deadlock imkânsız olsun |
| "Bugün" = otelin günü | Gece yarısından sonra işlem dünü göstermesin |
| Aktör kapalıyken iş manuel göreve düşer | Otomasyon arızası veri/iş kaybına dönmesin |
| `prisma db push` yasak | Elle yazılmış kritik kısıtlar silinmesin |
| TypeScript yerine saf JS + Zod + DB kısıtı | Tip güvenliği yerine çalışma-zamanı doğrulaması + veritabanı garantisi; riskli (para) kod test edilir |
