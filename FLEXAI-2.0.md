# FlexAI 2.0 — Mimari ve Yol Haritası

Tarih: 3 Kasım 2026
Kapsam: 1–68 tamamlandıktan sonra gelen 36 modül (**69–104**).
Görev maddeleri [GOREVLER.md](GOREVLER.md)'de ("FlexAI 2.0" bölümü), geliştirme sırası
[MODUL-SIRASI.md](MODUL-SIRASI.md)'de. Bu belge üçünün ortak zeminidir: 2.0'ın neden var olduğu,
mevcut mimariye nasıl oturduğu, hangi yeni yapı taşlarını getirdiği, yol haritası ve karar noktaları.

---

## 1. Neden 2.0

1.0 (1–68) otelin işini eksiksiz yapan çekirdektir. 2.0 o çekirdeğin üstüne üç şey koyar:

1. **İş yapan yapay zekâ.** Rakiplerde yapay zekâ ürünün yanına takılmış ayrı uygulamalardır (ayrı alan
   adı, ayrı panel, PMS'te ekran dolduran tarayıcı eklentisi). Bizde yapay zekâ çekirdeğin içindedir:
   personelle aynı izinlerden, aynı onay kuyruğundan, aynı denetim kaydından geçerek iş yapar ve
   olaylara kendiliğinden tepki verir. Sohbet eden değil, işi yürüten yapay zekâ.
2. **Lüks otel derinliği.** Misafiri tanımak, sorunu misafir otelden çıkmadan çözmek, gelir ve
   kârlılığı departman ve kontrat düzeyinde görmek, standartları denetlemek.
3. **Rakibin kopyalayamayacağı ağ.** Okul (Akademi), staj ağı ve otel sahibi. Öğrenci sistemi okulda
   öğrenir, stajda kullanır, yönetici olunca seçer; sahip otelini cebinden yönetir.

Hedef tek bir otel tipi değil: **genel ve büyük ölçek** (3 Kasım 2026 kararı). Bütün modüller bitince her
otel istediği modülleri ve paketleri alır; Elektraweb gibi çok sayıda paket hazırlanır. Bu yüzden 2.0'dan
itibaren **her modül paketlenebilir** yazılır (kural 10, modül 72).

Ayrıca 2.0, 1.0'ın "altyapı işleri bu listede yok" kuralını bilerek bozar: kusursuz çalışmak bir
özelliktir. Taşınma, yedek ve felaket kurtarma, güvenlik, gözlem ve mobil temel numaralı modüldür
(69–73) ve ilk otel taşınmadan önce biter.

---

## 2. Değişmeyen kurallar

2.0'ın her modülü 1.0'ın bütün kurallarına tabidir. Kısaca:

- **Çalışma akışı:** numara = geliştirme sırası; tek numara = Ahmet, çift numara = Ali Kemal; her
  modülün "Gün sonu" cümlesi karşılanmadan modül bitmez; modül başına tek onay döngüsü.
- **Ölçek:** 2500 kişi / büyük şehir oteli standardı: sayfalama, index, N+1 yok, kritik yazımda
  transaction, eşzamanlılık koruması, her sorguda `hotelId`.
- **Sözleşmeler:** zod şemaları `hotel/contracts`'ta tek kaynak; para metin olarak taşınır (`money.js`);
  "bugün" otelin günüdür (`getBusinessDate`); envanteri azaltan yazmalar kilit sırasıyla (`lib/locks.js`).
- **Yazma kalıbı:** `lib/write.js` — transaction + denetim izi + outbox'a olay, commit sonrası dağıtım.
  Rezervasyon yalnızca `reservations/service.js`, giriş-çıkış yalnızca `front-desk/service.js` üzerinden.
- **Aktörler:** her aktörün bildirgesi (manifest) dinlediği/yayınladığı olayları ve onaya götürdüğü işleri
  beyan eder; katalogda olmayan olay yayınlanamaz; aktör kapalıysa iş manuel göreve düşer.
- **Onay:** onay gerektiren iş kendi kendine yapılmaz; dört göz türlerinde isteyen onaylayamaz.
- **Canlı ekran:** socket yalnız "şu değişti" haberini taşır, veri taşımaz; kanal yalnız ilgilenene.
- **Şema:** yalnız migration; `prisma db push` yok.

---

## 3. 2.0'ın yeni kuralları

1. **Her dış bağlantı bir adaptördür.** Modül 49'un `providers/` deseni: ortak arayüz + **TEST adaptörü
   zorunlu** + gerçek adaptör(ler); hata `retryable` (geçici, artan aralıkla yeniden dene) ya da kalıcı
   (personel düzeltir) diye ayrılır. Sırlar `lib/secret-box.js` ile şifreli saklanır. Modül, gerçek
   sağlayıcı seçilmeden de TEST adaptörüyle uçtan uca çalışır ve test edilir.
2. **Her yapay zekâ özelliğinin yapay zekâsız yolu vardır.** Karar veren çekirdek deterministik kuraldır
   ve tek başına testlidir; LLM yorum, öneri, sınıflama ya da metin üretir. LLM kapalıysa, bütçe
   bittiyse ya da anahtar yoksa modül yine çalışır (şablon metin, manuel görev). Her çağrı `LlmUsage`'a
   yazılır, otelin günlük bütçesinden düşer (`BaseLlmAgent` kuralları aynen).
3. **Yapay zekâ yan etkili işi yalnızca insan onayıyla yapar.** Önce önizleme ("şu 14 kayıt şöyle
   değişecek"), sonra kullanıcının açık onayı, onay türü olan işlerde onay kuyruğu. Misafir mesajındaki,
   e-postadaki ya da belgedeki talimat hiçbir zaman eylem tetiklemez (istem enjeksiyonu kuralı).
   Ajan, adına çalıştığı kullanıcıdan fazla yetki taşımaz.
4. **Her yeni özellik bayrak arkasında yayına çıkar** (modül 72): önce tek otel, sonra yüzde, sonra herkes.
5. **Kişisel veri en azdır ve envanterdedir** (modül 71): yeni bir kişisel veri alanı ekleyen modül onu
   veri envanterine, saklama süresiyle birlikte yazar; süre dolunca imha işi siler. Gerekmeyen veri hiç
   alınmaz (ör. kimlik okumada görüntü saklanmaz, yalnız alanlar alınır).
6. **İstek içinde uzun iş yok.** 5 saniyeden uzun sürebilecek her iş (aktarım, model eğitimi, toplu
   dışa aktarım, eğitim oteli kurulumu) modül 69'un uzun iş çerçevesiyle arka planda, süre bütçeli
   turlarla, kaldığı yerden devam ederek çalışır; ilerleme canlı kanaldan izlenir.
7. **Sahadaki personel önce mobil.** Kat görevlisi, teknisyen, garson, denetçi, butler ekranları modül
   73'ün mobil kabuğunda yapılır; masaüstü ekranı sonra gelir.
8. **Herkese açık yüzey iki biçimde açılır:** imzalı, süreli bağlantı (modül 41'in oda servisi deseni;
   log'da yol jetonu maskeli) ya da ayrı kimlik alanı (acente portalı, Akademi). Personel JWT'si hiçbir
   dış kullanıcıya verilmez.
9. **Yapay zekâ ve tahminin isabeti ölçülür ve gösterilir.** Her model geriye dönük testle (backtest)
   değerlendirilir; her uyarı kuralının "yanlış alarm" oranı tutulur. Ekranda "bu öneri ne kadar
   güvenilir" sorusunun cevabı vardır.
10. **Her modül paketlenebilir.** Modül kataloğunda anahtarı, adı, bağımlılıkları, izin grupları, menüleri,
   aktörleri ve uç önekleri beyan edilir (modül 72). Otelin lisansında olmayan modülün uçları "paketinizde
   yok" (403, ayrı hata kodu) döner, menüsü gizlenir, aktörü o otel için çalışmaz, olay dinleyicisi o oteli
   atlar. Bir modül lisanssızken diğerleri bozulmaz: modüller arası bağ olaylarla ve "varsa" kuralıyla kurulur.

---

## 4. Mimari

### 4.1 Katman haritası

```
YÜZEYLER
  Personel web (hotel/frontend) · Mobil (hotel/mobile, 73) · Misafir portalı (53)
  Acente portalı (100) · Akademi (77, ayrı kurulum) · Uzaktan MCP (86) · Durum sayfası (72)
        │  HTTP + socket ("şu değişti" haberi)      │  imzalı bağlantı / ayrı kimlik alanı
        ▼                                            ▼
BACKEND MODÜLLERİ  (routes → service → lib/write.js: transaction + denetim + outbox)
        │  olaylar: EventLog → bus (outbox tarayıcısı geri alır)
        ▼
AKTÖRLER
  worker'lar (deterministik kural) · ajanlar (LLM, bütçeli, yedekli) · geçitler (kanal)
        │  adaptörler: providers/ (TEST + gerçek), sırlar secret-box'ta
        ▼
DIŞ DÜNYA
  GİB entegratörü · ÖKC · banka / toplayıcı · tur operatörü · rakip fiyat verisi · uçuş verisi
  GRMS / sayaç · telefon (SIP) · Logo / Mikro / Netsis / Luca · karbon dengeleme
```

### 4.2 Yeni yapı taşları

Bir yapı taşını ilk ihtiyaç duyan modül kurar, sonrakiler kullanır. Kuran modül onu genel yazar
(otel modülüne gömmez).

| Yapı taşı | Kuran | Kullananlar | Not |
|---|---|---|---|
| Uzun iş çerçevesi (`BackgroundJob`, üstlenme `FOR UPDATE SKIP LOCKED`, süre bütçeli tur, imleç, canlı ilerleme `jobs.changed`) | 69 | 77, 88, 90, 91, 92, 96, 104 | Muhasebe eşitlemesinin "20 sn bütçe + kalan" dersi genelleşir |
| Platform hesabı (FlexAI ekibi) + süreli destek erişimi (break-glass) | 71 | 72, 79 | Otel verisine yalnız otel onayıyla, süreli, her adımı denetimde |
| Gerçek kimlikli socket (JWT el sıkışması) | 71 | hepsi | README'deki "socket kimliği istemcinin söylediği e-posta" sınırı kapanır |
| Özellik bayrakları (`FeatureFlag`, `HotelFeature`, `isEnabled`, `useFeature`) | 72 | 2.0'ın tamamı | Yeni modül önce bayrak arkasında |
| Modül kataloğu + paket / lisans kapısı (`ModuleCatalog`, `Package`, `HotelSubscription`, `hasModule`) | 72 | 1–104'ün tamamı | 1–68 geriye dönük kataloğa girer; paket fiyatı oda / sabit / kullanıcı başı |
| Mobil kabuk (`hotel/mobile` PWA), anlık bildirim (Web Push), biyometrik açılış, çevrimdışı okuma önbelleği + yazma kuyruğu | 73 | 75, 76, 78, 82, 102 | Yazma kuyruğu `requestId` tekrar gönderim anahtarı desenini kullanır |
| Bilgi bankası (belge → parça → arama; pgvector + Türkçe tam metin, kaynak gösteren cevap) | 79 | 86, 101, 102 | Sunucuya pgvector eklentisi gerekir |
| `assistant-agent` (önce yardım içeriği, 86'da otel belgeleri + araçlar) | 79 | 86 | Tek ajan, büyüyen araç seti |
| Denetimli işlem (yetkisi olmayan işi yapınca istek amirin onayına düşer, onay türü `SUPERVISED_ACTION`) | 78 | stajyer, deneme süresindeki personel | İzin çözümüne "denetimli" kip eklenir |
| Kural motoru (`automation-worker`: güvenli koşul dili, beyaz liste eylemler, döngü koruması, prova) | 85 | 94 (İYS engeli), misafir yolculuğu şablonları | Eylem hep ilgili servisin kendisini çağırır |
| Model çerçevesi (`DemandModel`: sürüm, özellikler, backtest metrikleri, haftalık eğitim uzun işte) | 90 | 91, 92 | Yalnız JavaScript; açıklanabilir modeller (lojistik regresyon vb.) |
| Özet (fact) tabloları gece kapanışında güncellenir | 87 | 92, 93, 104 (75 önce 18'in günlük özetinden okur, sonra bunlara geçer) | Ekranlar ham kaleme inmez |
| Herkese açık doğrulama sayfası (QR'lı belge: sertifika) | 77 | 103 | Kişisel veri: ad + belge + tarih |
| Ayrı kimlik alanları (`PartnerUser`, Akademi kullanıcısı, OAuth istemcisi) | 77, 86, 100 | — | Personel JWT'sinden ayrı imza ve kapsam |

### 4.3 Yeni aktörler

| Aktör | Tür | Paket | Kuran | Ne yapar |
|---|---|---|---|---|
| `automation-worker` | worker | hotel/workers | 85 | Otelin kurallarını olaylara uygular; misafir yolculuğu mesajları |
| `guest-experience-worker` | worker | hotel/workers | 80 | Geliş hazırlığı (80), servis kurtarma sinyalleri (81), uçuş saati (82), upsell zamanlaması (83), tesis no-show (99) |
| `assistant-agent` | ajan | hotel/agents | 79 → 86 | Yardım cevabı; otel belgeleri; okuma ve eylem araçları; uzaktan MCP |
| `night-manager-agent` | ajan | hotel/agents | 87 | Gün kapanışında kontrol kütüphanesini koşar, brifingi yazar |
| `insight-agent` | ajan | shared/agents (yer tutucu var) | 54/55 → 80, 81, 102 | Duygu, konu, departman, tercih çıkarma |
| `voucher-reader-agent` | ajan | hotel/agents | 98 | E-posta / PDF / Excel voucher'ı yapılandırılmış rezervasyon taslağına çevirir |
| `tour-operator-sync-worker` | worker | hotel/workers | 98 | Operatör API taraması, tekrar deneme, eşitleme kaydı (`channel-sync-worker` deseni) |
| `rate-shop-worker` | worker | hotel/workers | 91 | Rakip fiyat verisini çeker, normalize eder, değişim olayı yayınlar |
| `bank-sync-worker` | worker | hotel/workers | 97 | Ekstre / toplayıcı hareketlerini alır, eşleştirme kurallarını koşar |
| `compliance-worker` | worker | hotel/workers | 94 | Yükümlülük takvimi, son tarih uyarıları, imha işleri |
| `academy-worker` | worker | hotel/workers | 77 | Senaryo denemelerini olay ve denetim kaydından puanlar |
| `voice-gateway` | geçit | shared/channels | 101 | Telefon (SIP) ↔ gerçek zamanlı ses ↔ concierge araçları |

Mevcut aktörler genişler: `fnb-worker` (74 mali fiş), `billing-worker` (84 provizyon), `accounting-worker`
(92 kârlılık özeti, 93 USALI, 96 aktarım partisi, 97 muhasebeleşme), `notification-worker` (73 PUSH
kanalı), `pricing-agent` (90 risk, 91 rakip verisi), `housekeeping-worker` (88 dağıtım önerisi),
`concierge-agent` (101 sesli kanal), 62'nin cihaz aktörü (74 ÖKC, 89 GRMS).

### 4.4 Kimlik alanları ve roller

| Alan | Kim | Nasıl | Kuran |
|---|---|---|---|
| Personel | Otel çalışanı | Mevcut JWT + 2FA + SSO (OIDC) | 2, 71 |
| Platform | FlexAI ekibi | Ayrı giriş; otel verisine yalnız süreli destek erişimiyle | 71 |
| Misafir | Konaklayan / gelecek misafir | İmzalı süreli bağlantı | 41, 53 |
| Acente | Acente kullanıcısı | `PartnerUser`, 2FA zorunlu, yalnız kendi acentesi | 100 |
| Akademi | Öğrenci, eğitmen | Ayrı kurulum; üniversite SSO'su | 77 |
| Uzaktan MCP | Claude / ChatGPT istemcisi | OAuth 2.1; kullanıcının izinleriyle sınırlı araç seti | 86 |

Yeni roller (`ROLES`): **OWNER** (Sahip, 75), **INSTRUCTOR** (Eğitmen, 77), **INTERN** (Stajyer, 78),
**GUEST_RELATIONS** (Misafir ilişkileri, 81). Varsayılan izinleri ilgili modül `DEFAULT_ROLE_PERMISSIONS`'a
yazar; matrisi kaydetmiş oteller yeni izinleri `Hotel.permissionCatalog` kuralıyla rol varsayılanından alır.

### 4.5 Yeni onay türleri

| Tür | Etiket | Dört göz | Modül |
|---|---|---|---|
| `MIGRATION_COMMIT` | Taşınan verinin canlıya alınması | evet | 69 |
| `DATA_EXPORT` | Toplu kişisel veri dışa aktarımı | evet | 71 |
| `FISCAL_VOID` | Mali fiş iptali | evet | 74 |
| `SUPERVISED_ACTION` | Denetimli işlem (stajyer / deneme süresi) | evet (amir onaylar) | 78 |
| `SERVICE_RECOVERY` | Eşik üstü telafi | evet | 81 |
| `GIFT_CARD_ADJUST` | Hediye çeki bakiye düzeltmesi | evet | 84 |
| `AUTOMATION_RULE` | Otomasyon kuralının yayına alınması | evet | 85 |
| `OPERATOR_PRICE` | Kontrat dışı fiyatla operatör rezervasyonu kabulü | evet | 98 |

Asistanın (86) yan etkili işleri yeni tür açmaz: işin kendi türü varsa (`BULK_PRICE_CHANGE`,
`OVERBOOKING`…) o kuyruğa gider, yoksa kullanıcının önizleme onayı yeterlidir.

### 4.6 Yeni izin grupları (özet)

Her modül kendi izinlerini `PERMISSIONS` + `PERMISSION_LABELS` + `PERMISSION_GROUPS` +
`DEFAULT_ROLE_PERMISSIONS`'a ekler (mevcut kural). Adlandırma `alan.view / alan.manage / alan.<iş>`:

`migration.manage` · `security.manage` · `fiscal.view/manage` · `owner.view` · `internship.view/manage` ·
`support.request` · `guests.preferences.manage` · `guests.sensitive.view` · `recovery.view/manage` ·
`concierge.view/manage` · `upsell.view/manage` · `payment.authorize` · `gift_cards.manage` ·
`memberships.manage` · `automation.view/manage` · `assistant.use` · `knowledge.manage` · `ops.view/manage` ·
`labor.view/manage` · `iot.view/manage` · `energy.view` · `risk.view` · `groups.evaluate` ·
`rate_shop.view/manage` · `profitability.view` · `usali.view/manage` · `compliance.view/manage` ·
`inbound_docs.view/manage` · `accounting_export.manage` · `bank.view/manage` ·
`operator_bookings.view/manage` · `facilities.view/operate/manage` · `partners.manage` ·
`voice.view/manage` · `quality.view/audit/manage` · `sustainability.view/manage` · `benchmark.view/manage`

Platform tarafının izinleri (bayrak yönetimi, destek konsolu) otel izin kataloğunda değil, platform
alanındadır.

### 4.7 Olaylar

Ad biçimi mevcut kuralla aynı: `alan.varlık.fiil` ya da `alan.varlık.changed`; gövde zod şemasıyla
`shared/core/events/catalog.js`'te, Türkçe adı `hotel/contracts/events.js`'te (eksik adı birim test
yakalar). 2.0'ın açtığı alanlar:

`job.*` (69) · `security.*` (71) · `feature.*` (72) · `fiscal.*` (74) · `owner.alert.*` (75) · `academy.*`,
`certificate.*` (77) · `internship.*` (78) · `support.*` (79) · `guest.preference.*`,
`guest.arrival.*` (80, 82) · `guest.incident.*` (81) · `concierge.*` (82) · `upsell.*` (83) ·
`payment.authorization.*`, `gift_card.*`, `membership.*` (84) · `automation.*` (85) · `assistant.*` (86) ·
`ops.finding.*`, `ops.briefing.*` (87) · `labor.*` (88) · `room.sensor.*`, `energy.*` (89) · `risk.*` (90) ·
`rate_shop.*` (91) · `profitability.*` (92) · `usali.*` (93) · `compliance.*` (94) · `edoc.inbound.*` (95) ·
`accounting.export.*` (96) · `bank.*` (97) · `operator.booking.*` (98) · `facility.*` (99) · `partner.*` (100) ·
`voice.call.*` (101) · `quality.*` (102) · `sustainability.*` (103) · `benchmark.*` (104)

İş günü kapanışı (modül 18) 2.0'ın en önemli tetiğidir: 87 (brifing), 92 (kârlılık özeti), 96 (aktarım
partisi), 104 (karşılaştırma verisi) onu dinler.

### 4.8 Veri ve yapay zekâ katmanı

- **LLM:** `shared/agents/llm` (sağlayıcı adaptörü, fiyat, bütçe) aynen. `AiSettings` ajan başına model
  ve bütçe payı alır (bugün router + concierge; 2.0'da assistant, insight, voucher, night-manager,
  voice). Bir ajanın bütçesi bitince diğerleri durmaz.
- **LLM'e giden veri:** gereken en az alan; TCKN/pasaport/kart hiç gitmez; misafir adı yalnız gerektiğinde.
  Sağlayıcıyla veri işleme sözleşmesi ve "eğitimde kullanılmaz" ayarı ön koşuldur.
- **Bilgi bankası:** belge sürümlü saklanır, parçalanır, gömme (embedding) ve Türkçe tam metin dizini
  birlikte aranır; cevap kaynak parçayı gösterir; erişim role göre süzülür (belge ACL'i).
- **Modeller:** Node içinde, ek servis yok; özellikler açıkça listelenir, katsayılar/önemler ekranda
  "neden riskli" diye gösterilir; haftalık eğitim, backtest metriği düşerse eski sürüm kalır.
- **Okuma yükü:** ağır raporlar `REPORTING_DATABASE_URL` (salt okuma kullanıcısı / replika) üzerinden;
  ekranlar gece kapanışında güncellenen özet tablolarından okur.

### 4.9 Çalışma ortamı

- **İki uygulama süreci + yedek sunucu (70):** süreç içi kayıtlar (event bus dağıtımı, realtime odaları,
  kanal kaydı `lib/channels.js`) paylaşılan bir yere taşınır (socket için Redis adaptörü ya da PG
  LISTEN/NOTIFY — karar 70'te). Aktörlerin tekrar gelen olayı tanıması (`ProcessedEvent`) ve outbox
  üstlenmesi (`SKIP LOCKED`) çok süreci zaten kaldırır.
- **Akademi ayrı kurulumdur (77):** aynı kod, `ACADEMY_MODE`; bütün dış adaptörler TEST'e kilitli,
  giden mesaj kapalı, canlı otellerin veritabanına hiçbir yol yok.
- **Durum sayfası ve izleme (72)**, sürekli yedek + aylık otomatik geri yükleme tatbikatı (70).

### 4.10 Hukuk ve KVKK

- **Kişisel veri envanteri ve imha (71, 94):** her alanın amacı, saklama süresi, imha işi, tutanak.
- **Özel nitelikli veri:** alerji ve sağlık bilgisi açık rızayla ve ayrı izinle (`guests.sensitive.view`, 80).
- **Ticari ileti:** pazarlama mesajı yalnız İYS izni olan alıcıya (85, 94); hizmet mesajı (rezervasyon,
  giriş bilgisi) ayrı sınıf.
- **Ses kaydı (101):** çağrı başında aydınlatma, saklama süresi, isteğe bağlı kayıt kapatma.
- **Rekabet hukuku (104):** yalnız geçmiş ve toplulaştırılmış veri; gelecek fiyat ve doluluk paylaşılmaz;
  hukuk görüşü alınmadan açılmaz.
- **Mali mevzuat:** ÖKC ve e-Adisyon (74), ticari fatura 8 gün yanıt süresi (95), e-belge saklama.

---

## 5. Yol haritası

| Aşama | Tek (Ahmet) | Çift (Ali Kemal) | Amaç | Kapı (aşama bitti sayılır, eğer…) |
|---|---|---|---|---|
| **1. Sağlam zemin** | 69 Göç sihirbazı · 71 Güvenlik · 73 Mobil temel | 70 Kesintisiz çalışma · 72 Gözlem, yayın ve paketleme · 74 ÖKC + e-Adisyon | İlk gerçek otel güvenle taşınsın | Prova taşımada mutabakat farkı 0; geri yükleme tatbikatı başarılı; sızma testi bulguları kapalı; ÖKC fişi gerçek cihazda |
| **2. Sahip ve okul** | 75 Patron uygulaması · 77 Akademi · 79 Yardım ve destek | 76 Personel mobil · 78 Staj ağı | Alıcıyı (sahip) ve kanalı (okul) kazan | Bir sahip onayları telefondan veriyor; bir sınıf 20 senaryoyu çözüyor; stajyer süreli hesapla çalışıyor |
| **3. Lüks misafir deneyimi** | 81 Servis kurtarma · 83 Upsell | 80 Misafir tanıma · 82 Concierge ve butler · 84 Ödeme güvencesi | Misafiri tanı, sorunu çıkıştan önce çöz | Tekrar gelen misafirin tercihi geliş görevine düşüyor; açık olayla çıkış uyarıyor |
| **4. Otonom operasyon** | 85 Otomasyon stüdyosu · 87 Gece müdürü · 89 Akıllı oda | 86 AI asistanı + uzaktan MCP · 88 İşgücü planlama | İş kendiliğinden yürüsün, sapma kendiliğinden yakalansın | Sabah brifingi her gün 07:00'de; asistan rooming list'ten grup taslağı açıyor |
| **5. Gelir ve kârlılık** | 91 Rakip fiyat · 93 USALI | 90 No-show ve grup değerlendirme · 92 Kontrat kârlılığı | Her gecenin ve kontratın kârı görünsün | Mizan = USALI toplamı; kontrat kârlılığı ay kapanışında |
| **6. Uyum ve finans otomasyonu** | 95 Gelen e-belge · 97 Banka mutabakatı | 94 Uyum merkezi · 96 Dış muhasebe aktarımı | Yasal iş ve mutabakat elle yapılmasın | Banka ve defter her gün mutabık; beyan taslağı faturalarla tutuyor |
| **7. Resort ve dağıtım** | 99 Tesis rezervasyonu · 101 Sesli santral | 98 Tur operatörü · 100 Acente portalı | Resort ve B2B satış | Operatör voucher'ı elle girmeden rezervasyon oluyor |
| **8. Kalite, çevre, ağ** | 103 Sürdürülebilirlik | 102 Kalite ve denetim · 104 Pazar karşılaştırması | Ölç, denetle, kıyasla | Denetimden DÖF'e, DÖF'ten kapanışa iz var |

Aşama numarası + 10 = GOREVLER ve MODUL-SIRASI'ndaki bölüm numarası (Aşama 1 = "11. Sağlam zemin").

**Paralel hatta bekleme:** iki hat aynı anda ilerler; bağımlılık hep küçük numaraya doğrudur, ama aynı
aşamadaki eşin işini bekleyen modül "Önkoşul" satırında bunu yazar: 76 → 73, 78 → 77, 103 → 102.
Diğer çapraz bağlar isteğe bağlıdır ("varsa kullanılır").

**Segment:** hedef genel ve büyük ölçek (3 Kasım 2026 kararı); sıra sabittir. Bütün modüller bitince
paketler 72'nin kataloğundan kurulur.

**Kaba süre:** 1.0'daki hızla tek numaralı hat modül başına 2–4 gün (dış entegrasyonlu modüller uzun
sürer), toplam kabaca 2–3 ay. Kritik yol çift numaralı hattadır; 1–68'in çift numaralı kalanları
bitmeden 2.0'ın çift hattı başlamaz.

---

## 6. Rakip karşılığı (Elektraweb)

| Elektraweb ürünü | 2.0 karşılığı | Fark |
|---|---|---|
| Online Booking | 32 + 83 + 84 | Upsell ve oda özelliği satışı aynı akışta |
| Kiosk / Smart ID | 59 + 53 + 76 | Görüntü saklamadan kimlik alanı; personel telefonu modu |
| Akıllı WhatsApp | 8 + 85 + 81 | Yolculuk otomasyonu ve konaklama içi servis kurtarma |
| Misafir uygulaması | 53 + 83 + 99 + 84 | Tesis hakları ve hediye çeki çekirdekte |
| HotelCall | 101 | Aynı concierge araçları, aynı bütçe ve devir kuralları |
| Acente bonus / sadakat | 35 + 100 | Acente kendi portalından görüyor |
| Tur operatörü konnektörü | 98 | Voucher'ı yapay zekâ okuyor, kontrat kuralı mevcut çekirdekte |
| İtibar yönetimi | 54 + 81 + 102 | Kötü yorum çıkmadan yakalama; yorum → DÖF |
| Kalite yönetimi | 102 + 103 + 88 | Kalite verisi otelin kendi operasyon verisinden |
| Karbon sertifikası | 103 | Ölçüm + belgelendirme + misafir dengelemesi birlikte |
| Şirketim (İK mobil) | 76 + 78 + 51/52 | Staj ağı ve Akademi ile birlikte |
| Banka entegrasyonu | 97 | Çoklu eşleştirme, POS komisyon/bloke ayrımı, günlük mutabakat |
| Kurumsal SI | 86 | Tarayıcı eklentisi yok; ajan çekirdeğin izin ve onayından geçiyor |
| SmartMenü | 39 + 41 + 53 + 99 | — |
| Rate Manager | 91 + 34 + 90 | Rakip verisi + no-show riski + forecast tek öneride |
| Elektraweb MCP | 23 + 86 | Okuma + izinli eylem araçları; OAuth |
| Muhasebe entegrasyonu | 96 | Aktarım mutabakatlı, bir kayıt bir kez |
| Yazarkasa / GMP3 | 74 | — |
| Yedekleme (BigQuery) | 70 | Sürekli yedek + otomatik geri yükleme tatbikatı |
| Manager / Handy / Operator uygulamaları | 75 + 76 | Patron uygulaması ayrı ürün yüzü |
| — (karşılığı yok) | 77, 78, 80, 87, 92, 93, 104 | Akademi, staj ağı, misafir tanıma, gece müdürü, kontrat kârlılığı, USALI, pazar karşılaştırması |

Bilerek dışarıda kalanlar: golf, fuar, park otomasyonu, sosyal medya yöneticisi, web sitesi yapıcı.
Gerekirse ortak ürünle çözülür.

---

## 7. İlk taslaktan plan numarasına

İlk görüşmedeki (2 Kasım) tema sıralı numaralar geliştirme sırasına göre yeniden verildi:

| İlk taslak | Plan | | İlk taslak | Plan |
|---|---|---|---|---|
| Göç sihirbazı | 69 | | 85 Ödeme güvencesi | 84 |
| Kesintisiz çalışma | 70 | | 92 Otomasyon stüdyosu | 85 |
| Güvenlik | 71 | | 80 İşlem yapan AI asistanı | 86 |
| Kontrollü yayın + izleme | 72 | | 93 AI gece müdürü | 87 |
| (yeni) Mobil temel | 73 | | 90 İşgücü planlama | 88 |
| 75 ÖKC + e-Adisyon | 74 | | 91 Akıllı oda ve enerji | 89 |
| 94 Patron uygulaması | 75 | | 88 No-show + grup değerlendirme | 90 |
| 78 Personel mobil | 76 | | 70 Rakip fiyat izleme | 91 |
| 95 Akademi | 77 | | 86 Kontrat kârlılığı | 92 |
| 96 Staj ve kariyer ağı | 78 | | 87 USALI + sahip raporu | 93 |
| Uygulama içi yardım | 79 | | 97 Uyum merkezi | 94 |
| 81 Misafir tanıma | 80 | | 98 Gelen e-belge | 95 |
| 82 Servis kurtarma | 81 | | 74 Dış muhasebe aktarımı | 96 |
| 83 Concierge ve butler | 82 | | 73 Banka mutabakatı | 97 |
| 84 Upsell | 83 | | 69 Tur operatörü | 98 |
| | | | 71 Tesis rezervasyonu | 99 |
| | | | 79 Acente B2B portalı | 100 |
| | | | 72 Sesli santral | 101 |
| | | | 76 Kalite ve denetim | 102 |
| | | | 77 Sürdürülebilirlik | 103 |
| | | | 89 Pazar karşılaştırması | 104 |

Mobil temel (73) yeni: patron ve personel uygulamaları aynı anda iki hatta yapılacağı için ortak kabuk
önce ve tek yerde kurulmalı.

---

## 8. Karar noktaları

1.0'daki gibi her modül başlamadan önce sorulur; cevap modülün GOREVLER notuna yazılır.

| Modül | Karar |
|---|---|
| Genel | Yapay zekâ sağlayıcısı ve anahtarı (bugün OpenAI; canlıda anahtar yok) |
| 59 (1.0) | Kimlik görüntüsü saklansın mı — öneri: hayır, yalnız MRZ alanları (GOREVLER 59 notu) |
| 69 | İlk kaynak sistem(ler) ve onların dışa aktarım biçimi (örnek dosya gerekir) |
| 70 | Barındırma ve yedek hedefi (bölge, nesne depolama), hedef RPO/RTO, bütçe |
| 71 | SSO sağlayıcıları; 2FA'nın zorunlu olduğu roller; sızma testi firması |
| 73 | PWA yeterli mi, mağaza (Capacitor) gerekli mi |
| 74 | İlk ÖKC markası; e-Adisyon kapsamı (mali müşavir görüşü) |
| 77 | Akademi kurulumunun barındırılması; sertifika seviyeleri ve adları; üniversite iş birliği metni |
| 82 | Uçuş verisi sağlayıcısı |
| 86 | Uzaktan MCP'de eylem araçlarının açılma zamanı (önce yalnız okuma önerilir) |
| 89 | İlk GRMS markası |
| 91 | Rakip fiyat veri sağlayıcısı ve maliyeti |
| 96 | İlk hedef muhasebe programı |
| 97 | Banka toplayıcısı (ya da yalnız ekstre dosyası) |
| 98 | İlk bağlanacak tur operatörleri |
| 101 | Telefon sağlayıcısı ve gerçek zamanlı ses modeli |
| 103 | Karbon dengeleme ortağı |
| 104 | Rekabet hukuku görüşü |

---

## 9. Riskler ve önlemler

| Risk | Önlem |
|---|---|
| İki hattın hızı farklı olabilir; aşama kapısı yavaş hatta takılır | Aşama kapıları; kritik bir modül gecikirse 1.0'daki gibi karşı hat devralabilir — ikimizin kararıyla, GOREVLER'e notla |
| Dış sağlayıcıya bağımlılık (operatör, banka, ÖKC, GRMS) | Adaptör + TEST adaptörü; modül sağlayıcısız da uçtan uca çalışır |
| LLM maliyeti ve kesintisi | Ajan başına bütçe, yapay zekâsız yol, `LlmUsageDaily` raporu |
| Yapay zekânın yanlış iş yapması | Önizleme + onay + denetim izi; misafir/belge metni eylem tetiklemez; isabet ölçümü |
| Kişisel veri sızıntısı | Envanter, en az veri, maskeleme, 2FA, süreli destek erişimi, sızma testi |
| Kapsam kayması | Her modülün "Gün sonu"su ve önkoşulu sabit; yeni fikir 2.0'a değil "sonrası" listesine |
| Çok süreçli çalışmaya geçişte gizli varsayımlar | 70'te süreç içi kayıtların envanteri ve iki süreçli entegrasyon testi |

---

## 10. Başarı ölçütleri

| Aşama | Ölçüt |
|---|---|
| 1 | Taşınan otelde ilk ay bakiye/rezervasyon kaynaklı hata 0; geri yükleme tatbikatı süresi ≤ 1 saat |
| 2 | Sahiplerin haftalık aktif kullanımı; Akademi'de sertifika alan öğrenci sayısı |
| 3 | Kötü yorum oranında düşüş; telafi maliyeti / olay; upsell geliri / dolu oda |
| 4 | Brifing bulgularının "yanlış alarm" oranı < %20; otomasyonla kapanan manuel görev sayısı |
| 5 | No-show tahmininin backtest isabeti; kârsız kontrat sayısının görünür olması |
| 6 | Elle eşleştirilen banka satırı oranı < %10; kaçırılan yasal son tarih 0 |
| 7 | Elle girilen operatör rezervasyonu oranı; AI santralin personele devir oranı |
| 8 | Açık DÖF süresi; konaklama-gece başı karbon trendi |
