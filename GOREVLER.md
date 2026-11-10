# HotelOS — Modül Modül Geliştirme Maddeleri

Tarih: 5 Eylül 2026
Paylaşım: **Tek numaralar = arkadaşın, çift numaralar = Ali Kemal.**
Her modülde: **Gün sonu** = modül bitince elinde ne olacak. Altındaki maddeler = yapılacak işler, sırayla.
"Backend" = API + servis + tablo. "Ekran" = React sayfası. "Aktör" = worker/agent kodu.

---

## 1. ÖN BÜRO (temel)

### 1. Ayarlar / parametreler — arkadaşın
**Gün sonu:** Admin, oteli tanımlayabiliyor: oda tipleri, vergiler, sezonlar, otel bilgileri girilmiş; rezervasyon modülü bu tanımları kullanabiliyor.
- [x] Backend: RoomType, Tax, Season, Hotel için listele / ekle / düzenle / sil API'leri
- [x] Ekran: Otel bilgileri formu (ad, adres, telefon, logo, para birimi, saat dilimi, check-in/out saati)
- [x] Ekran: Oda tipleri listesi + form (kod, ad, yetişkin/çocuk kapasitesi, taban fiyat, açıklama)
- [x] Ekran: Vergiler listesi + form (ad, oran, fiyata dahil mi)
- [x] Ekran: Sezonlar listesi + form (ad, başlangıç, bitiş, çarpan)
- [x] Ekran: Genel parametreler (iptal politikası, para birimi, varsayılan pansiyon)
- [x] Sidebar'a "Ayarlar" menüsü, sadece ADMIN görür

> **Diğer modüller için:** ayar verisini doğrudan Prisma'dan okumayın.
> `hotel/backend/src/modules/settings/service.js` içindeki "sıcak okuma" fonksiyonları
> cache'li ve yazmalarda kendini tazeliyor:
> `getHotelSettings`, `getActiveRoomTypes`, `getActiveTaxes`, `getActiveSeasons`, `getSeasonForDate`.
> Fiyat çarpanı seçimi `rules.js` içindeki saf fonksiyonlarda (`findSeasonForDate`,
> `resolveMultiplierForDate`) — modül 4 fiyat hesabını bunların üstüne kurmalı.
>
> Ayrıca **paylaşılan altyapı** eklendi (tüm modülleri ilgilendirir):
>
> **Veritabanı**
> - `db.js` artık soft-delete filtresini Prisma extension'ı olarak otomatik uyguluyor.
>   **`findUnique` kullanmayın, `findFirst` kullanın** — Prisma `findUnique`'in where'ine
>   `deletedAt` eklemeye izin vermediği için silinmiş kayıt dönebilir.
>   Silinmiş kayıtları da görmesi gereken yerler `prismaUnfiltered` kullanır.
> - `RoomType.code` ve `Room.number` benzersizliği artık **kısmi (partial) unique index**:
>   `WHERE "deletedAt" IS NULL`. Düz unique index, silinen bir kodun tekrar
>   kullanılmasını engelliyordu (kullanıcı listede görmediği bir kayıt yüzünden
>   "zaten var" hatası alıyordu). Prisma kısmi index'i ifade edemediği için bu iki
>   modelde `@@unique` yok — **bu tablolarda `upsert`/`findUnique` bileşik anahtarı
>   kullanılamaz**, `findFirst` + `create` deseni kullanın.
> - Sezon çakışması artık veritabanı kısıtı (`Season_no_overlap`, EXCLUDE + btree_gist).
>   Uygulama kodu da kontrol ediyor ama yalnızca daha iyi hata mesajı için;
>   garantiyi veritabanı veriyor. Sunucuda `postgresql-contrib` gerekiyor.
>
> **Kod**
> - `@hotelos/core`: event bus (katalog doğrulamalı), `correlationId` bağlamı,
>   ve **para aritmetiği** (`money.js`). Fiyat/vergi/bakiye hesaplarında
>   `Number()` ile çarpma yapmayın — `multiply`, `sum`, `percentOf`, `toMoneyString`
>   kullanın. Para/oran alanları API'de **string** taşınır.
> - `@hotelos/hotel-contracts`: zod şemaları. Sunucu doğrulaması ve React form
>   doğrulaması **aynı şemayı** kullanıyor; kuralı iki yerde yazmayın.
>   Zod'un varsayılan hata mesajları Türkçeye ayarlı (`locale.js`).
> - `lib/errors.js` (tipli hatalar → HTTP durumu + veritabanı kısıtlarının Türkçe
>   karşılıkları), `lib/pagination.js`, `lib/cache.js`, `lib/audit.js`, `lib/events.js`.
> - `app.js` ve `server.js` ayrıldı: testler `buildApp()` ile port açmadan
>   `app.inject()` kullanabiliyor (bkz. `src/app.test.js`).
>
> **Test**
> - `npm test` → tüm paketlerin birim testleri (veritabanı gerekmez).
> - `npm run test:integration -w @hotelos/hotel-backend` → gerçek veritabanı ister,
>   `TEST_DATABASE_URL` yoksa atlanır.

> **🎨 Tasarım altyapısı (15 Eylül 2026 — Ahmet):** `shared/ui` ve `hotel/frontend`
> Spark Admin şablonundan uyarlanan FlexAI renkleriyle (koyu #101010 + kırmızı
> #EF4444) yeniden giydirildi. Bu bir görev maddesi değil, mevcut modüllerin
> (1 ve 3) ekranlarının görünümünün değişmesi — veri akışı, doğrulama ve API'ler
> aynı kaldı.
>
> - `shared/ui`: `Button` (yeni `dangerSoft` varyantı — tablo satırında silme
>   düğmesi), `Card`, `Input`/`Select` (yeni `compact`)/`Textarea` (+ `trailing`
>   slotu, ör. şifre göster), `Checkbox`, `Alert`, `Badge`, `EmptyState`,
>   `Spinner`, `Icon` (tek kaynaklı SVG seti). Jetonlar `hotel/frontend/src/index.css`
>   içindeki `@theme` bloğunda (`bg-ink`, `text-sec-strong`, `rounded-card` vb.) —
>   yeni bir ekran yazarken bunlara bak, ham hex kullanma.
> - `AppLayout`: koyu yan menü (`layout/navigation.js` tek kaynaklı menü
>   listesi — yeni sayfa eklerken oraya eklenir, üç yerde ayrı ayrı değil),
>   daraltılabilir rayda, mobilde çekmece; üst barda konum satırı ve kullanıcı
>   menüsü. `store/ui.js` (zustand) rayın açık/kapalı tercihini tutuyor.
> - `PageHeader`, `TabNav`, `Toolbar`, `FormActions`, `QueryFallback`: bölüm
>   sayfalarının (Odalar, Ayarlar) ortak iskeleti — modül 2, 4, 5 vb. yeni bölüm
>   sayfası açarken bunları kullanabilir.
> - Dashboard (madde 13) **yapılmadı** — ana sayfada (`HomePage.jsx`) yalnızca
>   gerçek sistem durumu (sunucu/veritabanı/socket/önbellek) ve role göre hızlı
>   erişim kartları var, uydurma KPI/grafik yok.
> - `npm run build` ve `npm test` (176 test) temiz; yeni bağımlılık eklenmedi.

> **🔍 Genel kontrol (16 Eylül 2026 — Ahmet) — modül 1 ve paylaşılan altyapı:**
>
> - **Ayarlar iş kuralları:** oda tipinin kapasitesi, gelecekte o tipte (ya da o
>   tipin odalarında) kalacak fazla kişili rezervasyon varken düşürülemez
>   (409 `CAPACITY_IN_USE`); rezervasyon/folyo varken otelin para birimi
>   değiştirilemez (409 `CURRENCY_LOCKED`); check-out saati check-in saatinden
>   önce olmalı; logo adresi http(s) olmalı. Sezon çakışma kontrolü artık tüm
>   sezonları belleğe çekmiyor, veritabanında soruluyor.
> - **Sorgu parametresi tuzağı:** `z.coerce.boolean()` `"false"` metnini `true`
>   yapıyor. Sorgu dizesindeki mantıksal değerler için contracts'taki
>   `queryBoolean`, boş bırakılabilen sayılar için `optionalQueryInt` kullanın.
> - **"Bugün":** `@hotelos/core` → `calendarDateInTimeZone(timeZone)`; backend'de
>   `getBusinessDate(hotelId)`. `new Date()` ile UTC gün almayın.
> - **HTTP güvenliği (`lib/http-security.js`):** CORS artık yalnızca `CORS_ORIGINS`
>   listesine açık (eskiden her siteye açıktı) ve PUT/PATCH/DELETE ön kontrolüne
>   izin veriyor (eskiden panelden bu istekler geliştirme ortamında engelleniyordu);
>   `NODE_ENV=production` iken `JWT_SECRET` yoksa/kısaysa/örnek değerse sunucu açılmaz;
>   backend varsayılan olarak `127.0.0.1` dinler; `x-correlation-id` ve `x-actor`
>   başlıkları temizlenmeden log'a yazılmıyor. Yeni değişkenler `.env.example`'da.
> - **Panel:** `lib/useHotel.js` (`useHotelSettings`, `useHotelToday`) ve geçici
>   `lib/permissions.js` (`useCan`) — modül 2 gelince rol → izin eşlemesi oradan
>   gerçek oturuma bağlanır, düğmeler zaten izin adıyla gizleniyor.

> **Ek (17 Eylül 2026 — modül 7):** Genel parametrelere **telefon ülke kodu** eklendi
> (`Hotel.phoneCountryCode`, varsayılan 90, CHECK kısıtlı; `updateGeneralSettings`
> alanı gönderilmezse değiştirmez).

### 2. Kullanıcı, rol, yetki (RBAC) — Ali Kemal
**Gün sonu:** Personel kendi hesabıyla giriyor; rolüne göre menüler ve işlemler kısıtlı. Kat görevlisi folyoyu göremiyor, resepsiyon fatura silemiyor.

> **⚠️ Modül 1'den devir notu (9 Eylül 2026 — Ahmet):**
> Ayarlar modülü yazıldı ama RBAC olmadığı için iki geçici çözüm bırakıldı.
> Bunlar bilinçli, işaretli ve tek noktada duruyor — bu modülde bağlanmaları gerekiyor:
>
> 1. **`hotel/backend/src/lib/permissions.js`** — `requirePermission('...')` hook'u var ve
>    ayarlar route'larının hepsine takılı, ama **hiçbir şeyi engellemiyor** (kasıtlı: var olmayan
>    güvenliği varmış gibi göstermek istemedik). Sunucu açılışında bir kez uyarı log'u basıyor.
>    Yapılacak: fonksiyonun gövdesini `shared/auth`'un gerçek kontrolüne devret — route'lara
>    dokunmaya gerek yok, hepsi zaten izin adıyla işaretli.
>    Kullandığı izinler: `settings.view`, `settings.manage` (katalog aynı dosyada `PERMISSIONS`).
> 2. **`hotel/backend/src/lib/tenant.js`** — aktif otel `HOTEL_CODE` ortam değişkeninden
>    çözülüyor (varsayılan `DEMO`). Yapılacak: `hotelId`'yi JWT'den al. Servis katmanı zaten
>    her sorguda `hotelId` ile filtreliyor; değişmesi gereken tek şey kimliğin nereden geldiği.
>
> Frontend tarafında `App.jsx` içindeki `RequireRole` ve sidebar'daki "Ayarlar" menüsü
> sahte oturumdaki `user.role` alanına bakıyor — bunlar güvenlik sınırı değil, gerçek
> giriş gelince aynı yerden gerçek role bağlanacak.
> **Modül 7'den ek (17 Eylül 2026 — Ahmet):** "şu anki personel" (bana atanan,
> Üstlen, işi başlatana atama) `lib/staff.js → currentStaff` içinde isteğin `x-actor`
> e-postasından bulunuyor; okuma uçları 60 sn önbellekli sürümü (`currentStaffCached`)
> kullanıyor. JWT gelince yalnızca bu iki fonksiyon kimliği token'dan okumalı. Yeni
> izinler: `messages.view`, `messages.reply`, `requests.view`, `requests.manage`
> (backend ve frontend `permissions.js`). Kat görevlisi rolü tanımlanırken
> `requests.*` verilip `messages.*` verilmeyebilir — ekranlar buna göre ayrışıyor.
> Atanabilir personel listesi `/guest-requests/assignees` (aktif kullanıcılar);
> kullanıcı yönetimi senin.
- [x] Backend: gerçek login (e-posta + şifre → JWT + refresh), logout, refresh, `/me`
- [x] Backend: User CRUD API'leri (ekle, düzenle, pasife al, şifre sıfırla)
- [x] Backend: izin listesi tanımı (örn. `reservation.create`, `folio.view`, `invoice.cancel`) ve rol → izin eşlemesi
- [x] Backend: `requirePermission('...')` hook'u; her route'a eklenir
- [x] Ekran: Login sayfasını gerçek API'ye bağla (çatıdaki sahte girişi değiştir)
- [x] Ekran: Kullanıcı listesi + form (ad, e-posta, rol, aktif)
- [x] Ekran: Rol → izin matrisi (satır rol, sütun izin, checkbox)
- [x] Frontend: sidebar menüleri ve butonlar izne göre gizlenir

> **📌 Ali'ye not (guard sırası, 10 Kasım 2026 — Ahmet):** kimlik/izin guard'ları artık route'un
> **`preValidation`**'ında, `preHandler`'ında değil. Sebep: Fastify şema doğrulamasını `preHandler`'dan
> önce yapıyor; token'sız ve bozuk gövdeli istek 401 yerine 400 + alan listesi alıyordu (canlıda
> `POST /lost-items {}` → 400, `GET /reports/revenue` → 400) — korumalı ucun şeması herkese görünüyordu.
> Şimdi anonim → 401, izinsiz rol → 403, ikisi de doğrulamadan önce; izni olan kişi bozuk girdide yine 400 alır.
>
> - **Değişen:** tüm modüllerin `routes.js`'inde `{ preHandler: [withHotelContext, requirePermission(...)] }`
>   → `{ preValidation: [...] }` (seninkiler dahil; yalnız anahtar adı, guard'lar ve izinler aynı).
>   `/auth/me` ve `/auth/logout`'taki `requireAuth` da öyle. İç fonksiyon adları `permissionGuard` /
>   `anyPermissionGuard` oldu (katalog aracı `docs/katalog/araclar/olgular.mjs` buna göre okuyor).
> - **Yeni kural:** guard'ı `preHandler`'a yazarsan uygulama **açılmaz** — `app.js`'teki `onRoute`
>   denetimi (`assertGuardsBeforeValidation`, `lib/permissions.js`) route adıyla "preValidation'a taşıyın"
>   hatası verir. flex-ali'de bu değişiklikten önce başlanmış bir modülde eski kalıp varsa
>   `preHandler:` → `preValidation:` yeter. Yeni guard yazarsan `markAuthGuard(...)` ile işaretle.
> - **Değişmeyen:** gövdeye bağlı ek izin (`assertRequestPermission`) handler içinde, doğrulanmış gövdeyle
>   çalışıyor; guard olmayan `preHandler`'lar orada kalabilir. `request.requiredPermission` aynı şekilde set ediliyor.
>   Bozuk JSON (ayrıştırma hatası) hâlâ 400 — ayrıştırma `preValidation`'dan önce, şema bilgisi sızdırmaz.
> - **Testler:** `app.test.js` (anonim bozuk gövde/sorgu/yol → 401, açık uçlar doğrulamayı sürdürür;
>   doğrulama testleri artık ADMIN token'ıyla), `lib/permissions.test.js`, `rbac.integration.test.js`
>   (anonim 401 / yetkisiz 403 / yetkili 400).

### 3. Oda tipi müsaitlik & oda atama — arkadaşın
**Gün sonu:** "15-18 Ekim'de kaç Standart boş?" sorusuna sistem cevap veriyor; rezervasyona uygun oda otomatik veya elle atanıyor.
- [x] Backend: `checkAvailability(checkIn, checkOut, roomTypeId)` servisi (rezervasyonlar + bloke odalar düşülür)
- [x] Backend: `assignRoom`, `unassignRoom`, `blockRoom`, `setHousekeepingStatus` servisleri + API
      (16 Eylül'de `setRoomStatus` üç parçalı durum modeline bölündü — aşağıdaki nota bak)
- [x] Backend: Room CRUD API'leri
- [x] Ekran: Oda listesi (numara, kat, tip, doluluk, kat hizmeti, arıza) + oda ekle/düzenle formu
- [x] Ekran: Arıza kayıtları (odaya "Arızalı / Hizmet dışı" kaydı aç, geçmişi gör, iptal et / bitir)
- [x] Ekran: Müsaitlik tablosu (satır oda tipi, sütun gün, hücrede boş sayısı)
- [x] Ekran: "Oda atama" — **rezervasyon detayı yerine bağımsız ekran** (modül 4 henüz yok).
      Aynı API, Ali'nin rezervasyon detayına da takılabilir.
- [x] Aktör: room-worker paketi (manifest, `reservation.created` → oda seç → `room.assigned`; `guest.checked_out` → oda boş + kirli)
- [x] Aktör kapalıysa: "oda atanacak" manuel görevi düşer

> **Diğer modüller için — müsaitlik nasıl sorulur:**
> `modules/rooms/service.js` → `checkAvailability(hotelId, { checkIn, checkOut, roomTypeId })`
> tek sayı döner ("kaç tane satılabilir"). Takvim için `getAvailabilityCalendar`,
> atanabilir odalar için `getAssignableRooms`. **Doğrudan Prisma'dan sayı saymayın** —
> atanmış/atanmamış rezervasyon ve blok etkileşimi göründüğünden karmaşık
> (bkz. `rules.js` başındaki açıklama).
>
> **⚠️ Tarih aralığı semantiği:** konaklama ve bloklar **yarı açık** `[)` —
> 15-18 rezervasyonu 15, 16, 17 gecelerini tutar, 18'de oda boşalır ve aynı gün
> tekrar satılabilir. Sezonlar ise **iki uçtan kapalı** `[]`. İkisi bilerek farklı;
> `@hotelos/core/dates.js` içinde ayrı fonksiyonlar olarak duruyor
> (`rangesOverlapHalfOpen` / `rangesOverlapClosed`). Karıştırmak bir günlük
> kaymalara ve çifte satışa yol açar.
>
> **Veritabanı seviyesindeki yeni garantiler:**
> - `Reservation_no_double_booking` (EXCLUDE): bir fiziksel odaya çakışan iki
>   aktif rezervasyon yapılamaz — uygulama kodu ne yaparsa yapsın.
> - `RoomBlock_no_overlap` (EXCLUDE): bir odanın çakışan iki bloğu olamaz.
> - `Reservation_date_order` (CHECK): çıkış girişten sonra olmalı.
>
> **Yeni tablo:** `RoomBlock` — odanın belirli tarihlerde kullanılamaz olması
> (arıza, tadilat). `endDate` boşsa süresiz.

> **🔧 Oda durum modeli yeniden kuruldu (16 Eylül 2026 — Ahmet) — 4, 5, 6, 13, 14, 18, 20'yi ilgilendirir:**
>
> Eski `Room.status` tek sütunda birbirinden bağımsız üç şeyi karıştırıyordu
> (AVAILABLE / OCCUPIED / DIRTY / CLEANING / MAINTENANCE / BLOCKED). Sonuçları
> canlıda doğrulandı: dolu oda elle "boş" yapılabiliyordu; "kirli" bir oda aynı
> anda "arızalı" olamıyordu; MAINTENANCE'a hiçbir akış ulaşmıyordu; arıza kaydı
> bir tarihe bağlı değildi. Otelcilikte (Opera, Protel vb.) bunlar ayrı tutulur;
> artık bizde de öyle:
>
> | Parça | Nerede | Değerler | Kim değiştirir |
> |---|---|---|---|
> | **Doluluk** | `Room.occupancy` | `VACANT` Boş · `OCCUPIED` Dolu | **Yalnızca sistem** (check-in/out). Ekrandan değiştirilemez. |
> | **Kat hizmeti** | `Room.housekeepingStatus` | `DIRTY` Kirli · `CLEANING` Temizleniyor · `CLEAN` Temiz · `INSPECTED` Kontrol edildi | Personel (`PATCH /rooms/:id/housekeeping`) ve sistem |
> | **Arıza** | `RoomBlock.type` (tarihli kayıt) | `OUT_OF_ORDER` Arızalı · `OUT_OF_SERVICE` Hizmet dışı | Yönetim (`POST /rooms/:id/blocks`, `DELETE /rooms/blocks/:id`) |
>
> "Oda bugün arızalı mı?" bir sütun değil, **iş gününü kapsayan bloktan türetilir**
> (API'de `condition` + `currentBlock` alanları). Böylece "20-25 Ekim tadilat"
> önceden girilebilir ve o gün kendiliğinden devreye girer.
>
> - **Arızalı (OOO)** envanterden düşer: satılabilir oda sayısı azalır.
>   **Hizmet dışı (OOS)** envanterden düşmez: oda satılabilir sayılır ama o
>   odaya misafir yerleştirilmez (ör. perde değişimi). İkisi de atamayı engeller.
> - Blok kaldırma: başlamamış kayıt **iptal** edilir (silinir, iz kalır);
>   sürmekte olan kayıt **bitirilir** (`endDate` = bugün; OOO bitince oda kirli
>   işaretlenir, teknisyen sonrası temizlik gerekir). Geçmiş kayıt 409 `BLOCK_ENDED`.
> - Kat hizmetinde tek geçiş kuralı: `INSPECTED` yalnızca `CLEAN`'den gelir
>   (`housekeepingTransitionError` — contracts'ta, ekran da aynı kuralı kullanıyor).
> - `room.status.changed` event'i artık `field: 'occupancy' | 'housekeeping'`
>   taşıyor (`from`/`to` o alanın değerleri). `room.blocked` → `type`,
>   `room.unblocked` → `mode: 'CANCELLED' | 'ENDED'`.
> - Sistem kaynaklı değişiklik için tek giriş: `applySystemRoomState(hotelId, roomId,
>   { occupancy?, housekeepingStatus? }, gerekçe)` — satırı kilitler, audit + event yazar.
>
> **"Bugün" artık otelin saat diliminden:** `lib/business-date.js` →
> `getBusinessDate(hotelId)`. UTC kullanılınca İstanbul'da 00:00–03:00 arası
> dünün tarihi dönüyordu. Tarih karşılaştıran her yeni kod bunu kullanmalı;
> night audit (modül 18) geldiğinde tek değişecek yer burası.
>
> **Eşzamanlılık ve envanter garantileri:**
> - `lib/locks.js` → `lockRoomTypes(tx, hotelId, ids)`, `lockRooms(...)`:
>   `SELECT ... FOR UPDATE`. Sıra hep **önce oda tipleri, sonra odalar, id'ye göre**
>   — farklı sırayla kilitleyen iki işlem birbirini kilitler (deadlock).
> - Blok açma, oda silme, oda tipini değiştirme ve oda atama **yeni overbooking
>   yaratamaz** (`WOULD_OVERBOOK`, 409): işlemden önceki ve sonraki envanter
>   karşılaştırılır; zaten eksi olan bir günü daha da kötüleştirmek reddedilir.
> - Veritabanı tetikleyicisi `hotelos_guard_room_block_overlap`: arızalı odaya
>   rezervasyon yazılamaz (`Reservation_room_blocked`), rezervasyonu olan odaya
>   blok açılamaz (`RoomBlock_has_reservations`) — uygulama kodu atlasa bile.
> - `Reservation_no_double_booking` ve `Reservation_date_order` artık gün
>   başına yuvarlanmış tarihlerle çalışıyor: geç çıkış saati (ör. 14:00) aynı
>   gün 12:00'de girecek misafirle çakışma sanılmıyor.
> - Oda ataması aday listesi sayfalı; başka tipe atama `kind` ile işaretli
>   (`SAME` / `UPGRADE` / `LATERAL` / `DOWNGRADE`), kapasite aşımı `CAPACITY_EXCEEDED`.
>
> **Migration:** `20260916090000_room_status_split` — mevcut veriyi taşır
> (CHECKED_IN rezervasyonu olan oda dolu; eski BLOCKED/MAINTENANCE kirli sayılır,
> çünkü tarihsiz eski durumdan blok üretmek uydurma veri olurdu). Sunucuda
> `npm run db:migrate` değil **`prisma migrate deploy`** ile uygulanır.

### 4. Rezervasyon yönetimi — Ali Kemal
**Gün sonu:** Resepsiyon elle rezervasyon açıyor, düzenliyor, iptal ediyor; sistem müsaitlik ve fiyatı kendi hesaplıyor; grup rezervasyon ve bekleyen liste çalışıyor.
- [x] Backend: `createReservation` servisi (müsaitlik kontrolü, fiyat hesabı: taban fiyat × sezon çarpanı × gece, onay kodu üretimi)
- [x] Backend: `updateReservation`, `cancelReservation`, `markNoShow` servisleri (+ `confirmReservation`, `reinstateReservation`, grup iptali)
- [x] Backend: overbooking kuralı (kapasite aşımında reddet veya onaya gönder) — otel ayarı, onay modül 11 kuyruğunda
- [x] Backend: Guest oluştur/eşleştir (telefon/e-posta ile mevcut misafiri bul)
- [x] Backend: listeleme API'si (filtre: tarih aralığı, durum, kaynak, misafir adı)
- [x] Ekran: Rezervasyon listesi (tablo, filtre, durum rozeti)
- [x] Ekran: Yeni rezervasyon formu (misafir ara/yeni, tarih, kişi, oda tipi, pansiyon, fiyat önizleme, not)
- [x] Ekran: Rezervasyon detayı (bilgiler, durum geçmişi, iptal butonu)
- [x] Ekran: Rezervasyon detayında folyo linki — modül 15'le geldi: "Folyo" kartı (pencereler, bakiyeler, eksik oda ücreti uyarısı), folyo ekranına bağlantı; iptal / gelmedi ücreti folyo aktörüyle folyoya işlenir
- [x] Ekran: Grup rezervasyon (tek formda birden fazla oda satırı)
- [x] Ekran: Bekleyen liste (yer yoksa "listeye al", yer açılınca uyarı)
- [x] Aktör: reservation-worker paketi (`reservation.requested` → servis → `reservation.created` / `reservation.rejected`)

> **📌 Modül 4 tamamlandı (22 Eylül 2026 — Ahmet, Ali Kemal adına geçici).** Modül 13
> (günlük durum) gerçek rezervasyon verisi olmadan yazılamadığı için Ali'nin modülü
> bu dalda yapıldı. Folyo bağlantısı bilinçli olarak boş (modül 15).
>
> **Birleştirme (23 Eylül 2026):** main'e aynı modülün paralel bir sürümü de gelmişti (Ali).
> İki sürüm gerçek veritabanında aynı 11 senaryoyla sınandı (çift gönderim, son oda yarışı,
> aynı telefonda farklı kişi, telefon yazım farkı, fiyat değişince düzenleme, erken "gelmedi",
> geçmişe tarih, kanal isteğinin tekrar teslimi, atanmış odayla uzatma, bayat ekrandan iptal,
> 2500 misafir / 20 bin rezervasyonda liste-arama süresi); bu sürüm kaldı. Ali'nin modül 2'si
> (giriş, kullanıcılar, rol matrisi) olduğu gibi alındı; rezervasyon izinleri ona bağlandı.
> O sürümün `WAITLISTED` durumu şemada kaldı (enum değeri silinemez) ama yazılmıyor; kalan
> satırlar `20260923090000_waitlisted_to_entries` ile bekleme listesine taşınır.
> Rol matrisine `Hotel.permissionCatalog` eklendi (`20260923090100_role_permission_catalog`):
> matris kaydedildikten sonra kataloğa giren izin rolün varsayılanına düşer — yeni modülün izni
> matrisi kaydetmiş otelde herkese kapalı kalmaz, yöneticinin kaldırdığı izin geri gelmez.
>
> **Veri** (migration `20260922090000_reservation_management`):
> - `Reservation`: fiyat kaynağı (`priceMode` sistem/elle + `priceNote` gerekçe; elle fiyat
>   gerekçesiz yazılamaz — kısıt), `createdBy`, `confirmedAt`, iptal (`cancelledAt/By`,
>   `cancelReason`, `cancellationFee`), gelmedi (`noShowAt`, `noShowFee`). `requestId` artık
>   **tekrar gönderim anahtarı** (otel başına tekil, kısmi index). Kişi ≥ 1 yetişkin, fiyat ≥ 0 kısıtları.
> - `ReservationNight`: gece gece fiyat (taban, çarpan, sezon adı). **Gelir raporları (13, 23) ve
>   folyo (15) geceyi buradan okur.** Eski rezervasyonların geceleri migration'da toplamdan eşit
>   bölünerek aktarıldı (son gece kuruş farkını alır).
> - `ReservationGroup` (ad, kod), `WaitlistEntry` (misafir iletişimi, tip, tarih, kişi, durum:
>   yer bekliyor / yer açıldı / çevrildi / vazgeçildi / tarihi geçti).
> - `Hotel.overbookingPolicy` (REJECT / APPROVAL; Ayarlar → Genel parametreler).
> - Zil: `APPROVAL_DECIDED` (istediğim kapasite onayının sonucu), `WAITLIST_AVAILABLE`.
>
> **Olaylar:** `reservation.updated` / `confirmed` / `cancelled` / `no_show` / `reinstated`
> (envanter listelerinde; oda planı ve müsaitlik önbelleği tazelenir), `reservation.requested` /
> `rejected` (kanal), `waitlist.changed`. Canlı yayın kanalı `reservations.changed`.
> `reservation.created` gövdesine `groupId` eklendi.
>
> **API** (`/reservations`): liste (görünüm: tümü, bugün gelecek, bugün gidecek, içeride, gelecek,
> opsiyonlu; durum, kaynak, tip, grup, tarih aralığı, arama: ad / onay kodu / telefon / oda no;
> sayfalı, sayım 2000'de kesilir), `POST /quote` (tip başına boş oda + fiyat + vergi + iptal koşulu),
> `GET /guests?q=`, `POST /` (201 açıldı, 200 aynı istek, 202 onaya gitti), `POST /groups`,
> `POST /groups/:id/cancel`, `GET /:id`, `GET /:id/history`, `PATCH /:id`, `POST /:id/confirm`,
> `/cancel`, `/no-show`, `/reinstate`; bekleme listesi `GET/POST /waitlist`, `GET /waitlist/:id`,
> `POST /waitlist/:id/close`. İzinler `reservations.view` / `reservations.manage`; elle fiyat
> `reservations.price_override` (gövdeye bağlı: handler'da `assertRequestPermission` ile oturumdaki
> etkin izinlerden denetlenir; varsayılanda yönetici ve müdürde var, ön büroda yok).
>
> **Kurallar:**
> - **Envanter kilidi:** açma, grup, tarih/tip düzenleme ve geri alma → oda tipi kilidi, sonra aynı
>   transaction'da müsaitlik. Kural modül 3'ünkü: değişiklik **yeni** overbooking yaratmamalı. Son
>   odaya aynı anda gelen iki istekten biri `NO_AVAILABILITY` alır (test edildi).
> - **Tekrar gönderim:** form bir istek kimliği üretir; aynı kimlikle ikinci gönderim (eşzamanlı
>   dahil) ikinci rezervasyon ve ikinci misafir kartı açmaz. Kontrol kilidin arkasında.
> - **Fiyat:** gece = oda tipinin taban fiyatı × o gecenin sezon çarpanı (kuruşa yuvarlanır; toplam =
>   gecelerin toplamı). Oda başına; pansiyon/kişi farkı modül 28. Düzenlemede anlaşılan geceler
>   anlaşılan fiyatında kalır, eklenen geceler güncel fiyatla; tip değişirse tümü yeni tipin fiyatıyla.
>   Elle fiyatlı rezervasyonun konaklaması değişirse sunucu karar ister (`PRICE_DECISION_REQUIRED`).
>   Vergi dökümü (dahil / hariç, yalnız "Oda" kalemi) bilgi amaçlı; tahsilat folyoda.
> - **Misafir:** telefon (otelin ülke koduyla, mesajlaşmanın kuralı) ya da e-posta eşleşir ve ad soyad
>   aynıysa var olan kart; ad farklıysa personele sorulur (`GUEST_MATCH` + adaylar). Kanal isteği
>   soramayacağı için yeni kart açar. Telefon `+90…` biçiminde saklanır.
> - **Durumlar:** işlem kuralı tek yerde (`reservationActionError`, contracts): opsiyonlu → onayla;
>   bekleyen/onaylı → iptal; giriş günü gelmiş bekleyen/onaylı → gelmedi; iptal/gelmedi → çıkışı
>   geçmediyse geri al (yer denetlenir; eski oda doluysa atama kalkar). İçerideki misafirde giriş ve tip
>   kilitli; çıkış uzatılır/kısaltılır (odası doluysa reddedilir, oda planından taşıyın).
> - **Ücretler:** iptal = politika süresi içindeyse toplam × ceza oranı (`X gün öncesine kadar
>   ücretsiz`); gelmedi = ilk gece. Personel gerekçeyle vazgeçebilir (denetim izinde politika ücreti).
> - **Oda ataması:** düzenlemede atanmış oda yeni hâle uymuyorsa (tip, dolu, arızalı, kişi) atama
>   kaldırılır (`room.unassigned`); oda planından açılan rezervasyon odasıyla açılır.
> - **Overbooking politikası "onaya gönder":** yer yoksa istek modül 11 kuyruğuna (`OVERBOOKING`)
>   gider; onaylanınca aynı istek kimliğiyle kapasite aşılarak açılır (aktör: onaylayan, açan:
>   isteyen), isteyenin ziline sonuç düşer. Düzenleme/geri alma ve kanal istekleri onaya gitmez.
> - **Bekleme listesi:** envanteri artırabilen her olaydan sonra otel başına birleştirilmiş tarama
>   (2 sn), ayrıca 5 dakikada bir güvenlik taraması; yer açılınca "yer açıldı" + zil, dolunca geri
>   döner, girişi geçen kapanır. Rezervasyona çevrilince kapanır.
> - **Opsiyonlu rezervasyona onay bildirimi gitmez;** onaylanınca (`reservation.confirmed`) gider.
>
> **Ekranlar:** `/rezervasyonlar/liste`, `/rezervasyonlar/yeni` (tek oda / grup, canlı müsaitlik ve
> fiyat, elle fiyat yetkiliye, misafir eşleşme sorusu, yer yoksa tek tıkla bekleme listesi; adresten
> ön doldurma `?giris=&cikis=&tip=&oda=` ve `?bekleme=`), `/rezervasyonlar/:id` (geceler, vergi,
> iptal koşulu, grup üyeleri, geçmiş, işlemler), `/rezervasyonlar/bekleme-listesi`. Oda planında boş
> hücreye tıklamak o odayla yeni rezervasyon açar; plan çekmecesinden rezervasyon sayfasına bağlantı.
>
> **2500 kişi için:** liste index'leri (`hotelId, checkIn, id` / `createdAt, id` / `status, checkIn,
> id` / `groupId`), sayım üst sınırı, aramasız liste sürüm anahtarlı önbellekte (`/health` →
> `reservationCache`), önizleme envanter sürümüyle önbellekli takvimden, misafir araması trigram /
> ifade index'leriyle (3 harften kısa ad aranmaz), bekleme listesi taraması pencere başına tek envanter
> okuması. Test: kurallar 25 + sözleşme 17 + aktör 6 birim, 30 entegrasyon (eşzamanlı son oda, tekrar
> gönderim, grup bütünlüğü, eşleştirme, fiyat koruma, ücretler, geri alma, onay akışı, bekleme listesi,
> liste/arama, kanal isteği).
>
> **Devir:**
> - **Modül 6 (check-in/out):** `guest.checked_in` / `guest.checked_out` yayınla; durum kuralını
>   `reservationActionError`'a ekle; içerideki misafirin çıkış değişikliği hazır (`updateReservation`).
> - **Modül 8 (kanal):** `reservation.requested` yayınla (istek kimliğiyle); cevap `reservation.created`
>   ya da gerekçeli `reservation.rejected`.
> - **Modül 13 / 23 (gelir, ADR):** `ReservationNight` (otel + gün index'li).
> - **Modül 15 (folyo):** iptal / gelmedi ücreti rezervasyonda; geceler oda gelirinin kalemleri.
> - **Modül 22 (CRM):** misafir kartı düzenleme burada yok (rezervasyondan yalnızca açılır).
> - **Modül 28 (pansiyon/paket):** fiyat şu an oda başına; pansiyon farkı eklenecek yer `priceStay`.

> **⚠️ Modül 3'ten devir notu (16 Eylül 2026 — Ahmet):** oda envanteri tarafı
> rezervasyonun güvenli açılabilmesi için hazır; senin tarafında dikkat edilecekler:
>
> 1. **Müsaitlik kontrolü ve kayıt aynı transaction'da, kilitle.** Yoksa son odaya
>    aynı saniyede gelen iki rezervasyon ikisi de "1 yer var" okur ve oda iki kez satılır:
>    ```js
>    await writeWithEvents(async (tx, stage) => {
>      await lockRoomTypes(tx, hotelId, [roomTypeId]);          // lib/locks.js
>      const free = await checkAvailability(hotelId, stay, { client: tx });
>      if (free < 1) throw new ConflictError('...', 'NO_AVAILABILITY');
>      await tx.reservation.create(...);
>    });
>    ```
>    `client: tx` şart: verilmezse grup rezervasyonunda ikinci oda ilkini görmez.
>    Birden fazla tip kilitlenecekse tek çağrıda ver (`lockRoomTypes` id'ye göre sıralar).
>    `lib/write.js` → `writeWithEvents` transaction'ı ve event outbox'ını hazır veriyor
>    (`prisma.$transaction` yerine onu kullan); denetim izi aynı `tx` ile `lib/audit.js`.
> 2. **Tarih düzenleme ve iptal geri alma** da envanter tüketir — aynı kilit + kontrol.
> 3. **Veritabanı son savunma hattı:** odası atanmış rezervasyon arızalı odaya
>    (`Reservation_room_blocked`) ya da dolu odaya (`Reservation_no_double_booking`)
>    yazılırsa kayıt reddedilir; `rethrowPrismaError` bunu 409 `ROOM_NOT_FREE`'ye
>    çevirir. Bu bir **garanti**, kullanıcı mesajı değil — önce servis kontrol etmeli.
> 4. **Overbooking kuralı** için hazır parça: `rooms/rules.js` → `findNewOverbooking`
>    (önceki/sonraki envanteri karşılaştırır). "Onaya gönder" dalı modül 11 ile bağlanır.
> 5. **"Bugün" / geçmiş tarih** kontrolünde `new Date()` değil `getBusinessDate(hotelId)`.
> 5a. **Her rezervasyon yazması event yayınlamalı** (17 Eylül 2026): oda planı
>    cevapları envanter sürümüyle önbelleğe alınıyor ve canlı paneller bu event'lerle
>    tazeleniyor. `reservation.updated`, `reservation.cancelled` gibi yeni event'leri
>    `shared/core/events/catalog.js`'e ekleyince `INVENTORY_CHANGED_EVENTS` listesine de
>    ekleyin; yoksa tarih değişikliği / iptal panellerde 15 sn gecikmeyle görünür.
> 6. Oda seçimi elle yapılacaksa `GET /rooms/assignments/:reservationId/candidates`
>    ve `PUT /rooms/assignments/:reservationId` hazır; kapasite, arıza, tip farkı
>    (`kind`) ve overbooking kontrolleri içinde. Rezervasyon detay ekranın
>    "oda değiştir" düğmesini modül 5'in `PUT /plan/reservations/:id/room` ucuna
>    bağlayabilir — içerideki misafiri de doğru şekilde taşır.
> 7. **Ekranın olduğu yer:** rezervasyon listesi/detayı henüz yok ama oda planı
>    (`/oda-plani`) bir konaklamayı görmenin ve oda vermenin çalışan yolu. Modül 4
>    gelince plan ekranındaki "boş hücreye tıkla → yeni rezervasyon" adımı da açılır.

> **Modül 53'ten not (4 Kasım 2026 — Ahmet):** rezervasyon ayrıntısına `GuestPortalCard` eklendi (`guest_portal.view` ile: misafir
> portalı bağlantısı, QR, davet, online check-in durumu ve incelemesi). Online check-in'in giriş günü `reservation.updated`
> olayındaki `checkIn` ile eşitlenir: tarih değiştiren yeni bir yol bu olayı yayınlamalı.

### 5. Oda planı / takvim — arkadaşın
**Gün sonu:** Resepsiyon, tüm odaları ve rezervasyonları tek takvimde görüyor; tıklayınca detay açılıyor.
- [x] Backend: takvim verisi API'si (tarih aralığı → odalar + o aralıktaki rezervasyonlar)
- [x] Ekran: Takvim ızgarası (satır oda, sütun gece; rezervasyon renkli bar; arıza kayıtları tarih aralığında; satır başında doluluk + kat hizmeti)
- [x] Ekran: 7 / 14 / 30 günlük pencere, bugüne git, tarih seçici, kat–tip–durum filtreleri
- [x] Ekran: Bara tıkla → rezervasyon detay çekmecesi (misafir, konaklama, folyo bakiyesi, işlemler)
- [x] Ekran: Oda bekleyen rezervasyonlar şeridi (ızgarada görünmeyen talep) + otomatik ata
- [x] Frontend: socket ile canlı güncelleme; bağlantı kopunca "canlı değil" rozeti ve periyodik tazeleme
- [x] Sürükle-bırak ile **oda** değiştirme (içerideki misafir dahil, onaylı)
- [x] Ekran: Boş hücreye tıkla → o oda ve tarihle yeni rezervasyon formu — modül 4 ile açıldı
- [ ] Sürükle-bırak ile **tarih** değiştirme — modül 4'ün `updateReservation`'ı gelince

> **📌 Modül 5 tamamlandı (16 Eylül 2026 — Ahmet). Diğer modüller için:**
>
> **Okuma modeli:** `modules/plan` kendi tablosu olmayan bir okuma katmanı;
> oda envanteri ile rezervasyonların kesişimini ekranın istediği şekle sokar.
> - `GET /plan?from&days&page&pageSize&...filtreler` → `window`, `summary`,
>   `items` (oda satırları + barlar), `meta`.
> - `GET /plan/unassigned?from&days` → pencereye düşen, odası olmayan kayıtlar.
> - `GET /plan/reservations/:id` → detay + `actions` (hangi işlem açık, değilse neden).
> - `PUT /plan/reservations/:id/room` → oda ver / değiştir. `DELETE` aynı yol → atamayı kaldır.
>
> **Izgara semantiği:** bir sütun bir **gecedir**; 15-18 rezervasyonu 15, 16, 17
> sütunlarını doldurur, çıkış günü boyanmaz. Pencereden taşan barlar kırpılır ve
> `continuesBefore/After` ile işaretlenir. Yerleşim hesabı saf:
> `modules/plan/rules.js` (`placeInWindow`, `buildRoomSegments`, `summarizeDays`).
>
> **Günlük özet sayfalanmaz:** ızgara 40 odalık sayfalar hâlinde gelir ama
> başlıktaki giriş/çıkış/doluluk **otelin tamamından** hesaplanır. Doluluk
> paydası satılabilir oda (toplam − arızalı); oda bekleyen rezervasyon paya dahil.
>
> **Oda değişikliği tek kapıdan:** `rooms/service.js` → `changeRoom(hotelId,
> reservationId, roomId, { reason })`. Dönen `mode`:
> - `ASSIGNED` (odası yoktu) / `MOVED` (misafir gelmemiş) → `assignRoom` yolu.
> - `IN_HOUSE_MOVED` (misafir içeride) → rezervasyonun odası değişir **ve aynı
>   transaction'da** eski oda boş + kirli, yeni oda dolu olur. Modül 6 ve 14
>   bunun üstüne kurulmalı; oda durumunu ayrıca yazmayın.
> - `UNCHANGED` → zaten o odada, yazma yapılmaz.
>
> **🔧 Revizyon (17 Eylül 2026 — Ahmet): oda değişikliği geçmişi yeniden yazmıyor.**
> İlk sürümde rezervasyonun tek `roomId`'si vardı; içerideki misafir taşınınca geçmiş
> geceler de yeni odaya yazılmış sayılıyordu. Hedef odada konaklamanın *geçmiş*
> gecelerinde bitmiş bir arıza kaydı ya da başka misafir varsa taşıma
> reddediliyordu (oda bugün tamamen boş olsa bile). Şimdi:
> - `Reservation.roomSince`: misafirin mevcut odada kalmaya başladığı gece
>   (boşsa konaklamanın tamamı o odada). Açık dilim = `[coalesce(roomSince, checkIn), checkOut)`.
> - `RoomStaySegment`: kapanmış oda dilimleri (eski oda, geceler, sebep, taşıyan).
>   Migration `20260917090000_room_stay_segments`.
> - Çifte rezervasyon kısıtı ve arıza tetikleyicisi yalnızca **açık dilime** bakar;
>   uygunluk kontrolü içerideki misafir için **kalan gecelere** bakar.
> - Müsaitlik (`buildAvailabilityCalendar`, `freeRoomsForStay`) dilimleri biliyor:
>   geçmiş gecelerde eski oda dolu, yeni oda boş görünür.
> - Izgarada taşınan konaklama iki bar olur (`movedOut` eski odada, `movedIn` yeni odada);
>   detayda "Oda geçmişi" listelenir.
>
> **Diğer revizyonlar:** günlük özet çıkış yapmış konaklamaları da sayıyor (öğlen
> "8 çıkıştan 5'i yapıldı": `departures` / `departuresDone`, `arrivals` / `arrivalsDone`;
> geçmiş gecelerin doluluğu sonradan düşmüyor); oda numaraları doğal sırada
> (1, 2, 10 — oda listesi de); ızgarada misafir adı / onay koduyla arama; görünüm
> adres çubuğunda (yenileyince kaybolmuyor, link paylaşılabiliyor); taşıma sebebi;
> bitmiş konaklamanın oda ataması kaldırılamıyor (`STAY_ENDED`).
>
> **2500 eşzamanlı panel için:** plan cevapları otelin **envanter sürümüyle**
> anahtarlanıp önbelleğe alınıyor ve aynı anda gelen aynı istekler tek hesaplamada
> birleşiyor (`lib/read-cache.js`, `lib/live-version.js`). Sürüm,
> `LIVE_VIEW_EVENTS` + ayar event'leriyle artıyor; bu yüzden **envanteri değiştiren
> her yazma bir event yayınlamalı** — yoksa ekran en fazla 15 sn bayat kalır.
> Panel tarafında değişiklik haberine ve yeniden bağlanmaya rastgele gecikme
> ekleniyor (herkes aynı milisaniyede istek atmasın). Sağlık ucunda `planCache`
> isabet oranı görünüyor.
>
> **Canlı yayın altyapısı (modül 10 ve 12'yi de ilgilendirir):** `lib/realtime.js`
> event bus'ı socket.io'ya köprülüyor; kanal odasına (`hotel:<id>:ch:inventory.changed`)
> **yalnızca "şu değişti" haberi** düşüyor (veri değil — socket kimliği henüz
> istemcinin söylediği e-posta). Panel yalnızca açık ekranın kanalına abone olur
> (`subscribe` / `unsubscribe`, `lib/socket.js` sayaçla tekler); zil haberi
> otelin tamamına değil kişi/izin odasına gider. Sunucu her haberde odadaki panel
> sayısına göre bir **yayılma süresi** söyler (`spreadMs`, en çok 8 sn); panel
> tazelemesini o pencereye rastgele yayar, yan menü rozetleri ise en çok 10 sn'de
> bir tazelenir. Panel tarafında `lib/useLiveChannel.js` (oda planı için
> `useLiveInventory` sarmalayıcısı) bu haberi alıp
> ilgili react-query anahtarlarını tazeliyor; olaylar 400 ms geciktirilerek
> toplanıyor (tek işlem birden çok event yayınlar). Activity Feed aynı köprüye
> ikinci bir kanal ekleyerek bağlanabilir.

### 6. Check-in / Check-out — Ali Kemal
**Gün sonu:** Misafir gelince tek tıkla giriş, giderken tek tıkla çıkış yapılıyor; oda durumu ve folyo otomatik değişiyor.
- [x] Backend: `checkIn(reservationId)` servisi (oda atanmış mı, kimlik bilgisi var mı kontrolü → CHECKED_IN → `guest.checked_in`)
- [x] Backend: `checkOut(reservationId)` servisi (folyo bakiyesi 0 mı kontrolü → CHECKED_OUT → `guest.checked_out`)
- [x] Backend: erken giriş / geç çıkış ücreti parametresi
- [x] Ekran: Bugün gelecekler listesi (rezervasyon, oda, durum) + "Check-in" butonu → kısa form (kimlik no, uyruk, plaka, kart/depozito)
- [ ] Ekran: Bugün gidecekler listesi + "Check-out" butonu → bakiye gösterimi, bakiye varsa ödeme ekranına yönlendir
      — liste, çıkış ve bakiye gösterimi hazır; **"ödeme ekranına yönlendir" modül 17'yi bekliyor** (ekran yok)
- [x] Ekran: Konaklayanlar listesi (şu an içeride kim var)
- [x] Aktör: room-worker'a `guest.checked_in` → dolu, `guest.checked_out` → boş + kirli kuralları — **modül 3'te yapıldı**

> **📌 Modül 6 tamamlandı (23 Eylül 2026 — Ahmet, Ali Kemal adına geçici).** Modül 13
> (günlük durum) gerçek giriş-çıkış verisi olmadan yazılamadığı için bu dalda yapıldı.
> Ödeme ekranına yönlendirme bilinçli olarak boş (modül 17; ekran yok).
>
> **Veri** (migration `20260923120000_front_desk`):
> - `Reservation`: `checkedInAt/By`, `checkedOutAt/By` (içerideki kaydın giriş, çıkmışın iki
>   zamanı da **zorunlu** — kısıt), `earlyCheckInFee`, `lateCheckOutFee`, `vehiclePlate`, teminat
>   (`depositMethod` NONE/CASH/CARD_PREAUTH/TRANSFER, `depositAmount`, `depositReference`),
>   bakiyeyle çıkış (`checkoutOpenBalance` + zorunlu `openBalanceReason`).
> - `Guest.idType` (kimlik kartı / pasaport / diğer) + `(hotelId, idNumber)` index'i.
> - `Hotel`: `earlyCheckInFeeMode/Value`, `lateCheckOutFeeMode/Value` (yok / sabit / gecenin yüzdesi),
>   `checkInIdentityPolicy` (yalnız sahibi / bütün yetişkinler). Ayarlar → Genel parametreler.
> - Folyo tablolarına index: `Folio(hotelId, reservationId)`, `FolioItem(folioId)`, `Payment(folioId)`.
> - Zil: `CHECKOUT_OPEN_BALANCE` (`stays.checkout_open_balance` iznine).
> - **Testlerde / seed'de `CHECKED_IN` yazan herkes `checkedInAt` da yazmalı** (kısıt).
>
> **Olaylar:** `guest.checked_in` (+ `guestId`, `roomTypeId`, tarihler, `earlyCheckInFee`, `deposit`),
> `guest.checked_out` (+ `lateCheckOutFee`, `earlyDeparture`, `openBalance`), yeni
> `guest.check_in_reverted` / `guest.check_out_reverted` (room-worker doluluğu düzeltir).
> Bildirim merkezi (9) giriş/çıkış bildirimlerini kendiliğinden gönderir.
>
> **API** (`/front-desk`): `GET /summary`, `GET /arrivals?view=EXPECTED|CHECKED_IN`,
> `GET /departures?view=EXPECTED|CHECKED_OUT`, `GET /in-house?sort=`, `GET|POST /stays/:id/check-in`,
> `GET|POST /stays/:id/check-out`, `POST /stays/:id/check-in/revert`, `POST /stays/:id/check-out/revert`.
> İzinler: `stays.view` (liste; kat hizmetleri ve muhasebe de görür), `stays.manage` (giriş/çıkış,
> önizleme — kimliğin tamamını döndürür), `stays.checkout_open_balance` (yönetim).
>
> **Kurallar:**
> - **Giriş:** giriş günü gelmiş, çıkış günü gelmemiş (geç gelen ertesi gün de girer). Oda
>   verilmemişse aynı işlemde verilir. Odada önceki misafir hâlâ içerideyse, oda arızalıysa ya da
>   bu gecelerde başkasınaysa giriş olmaz; kirliyse personel onaylar. Aynı konaklamaya aynı anda iki
>   giriş: biri olur (kilit + sürüm; test edildi).
> - **Kimlik (KBS):** sahibinin belgesi zorunlu; TC kimlik no sağlamalı, pasaport biçimli. Politika
>   "bütün yetişkinler" ise refakatçi yetişkinlerin de. Refakatçi belgesinden tanınır (aynı kişiye
>   ikinci kart açılmaz); belge başka adla kayıtlıysa personele söylenir. Kimlik numarası listede ve
>   denetim izinde **maskeli** (KVKK). Teminat referansına / nota kart numarası yazılamaz (PCI).
> - **Ücret:** otelin saatine göre (sunucunun değil). Erken giriş: giriş günü, giriş saatinden önce;
>   ilk gecenin fiyatı üzerinden. Geç çıkış: çıkış günü, çıkış saatinden sonra; son gece üzerinden.
>   İstemci gördüğü tutarı gönderir, sunucu farklı hesaplarsa (saat geçti) yazmaz (`FEE_CHANGED`).
>   Personel ücreti uygulamayabilir (denetim izinde politika tutarıyla).
> - **Erken ayrılış:** bugünden sonraki geceler bırakılır — envantere döner, fiyattan düşer (personel
>   onayıyla; `EARLY_DEPARTURE`). Çıkış günü geçmişse (unutulmuş çıkış) tarih değişmez, ücret yok.
> - **Bakiye:** `bakiye = Σ(kalem × adet) − Σ(ödeme × kur)`; silinmiş kalem/ödeme ve aktarılmış folyo
>   sayılmaz; denormalize `Folio.balance`'a güvenilmez (`front-desk/folio.js`). Açıksa çıkış olmaz
>   (`BALANCE_DUE`); yetkili gerekçeyle bakiyeyle çıkar, zile uyarı düşer. **Folyo yoksa bakiye
>   bilinmiyor** sayılır (sıfır değil) ve ekran bunu söyler.
> - **Geri alma:** yalnızca aynı gün. Giriş, folyoda hareket varsa geri alınmaz. Çıkış, oda bu arada
>   başka misafire girişle verildiyse geri alınmaz; erken ayrılışta bırakılan geceler geri gelmez.
>
> **Modül 15'e (folyo) not:** billing-worker `guest.checked_in` ile folyoyu açsın; `earlyCheckInFee`,
> `guest.checked_out`taki `lateCheckOutFee` ve `deposit` kalem/ödeme olarak işlensin. Çıkış bakiye
> denetimi folyo tablolarını zaten okuyor — folyo yazıldığı gün bir şey değiştirmeden çalışır.
> **Modül 17'ye (ödeme) not:** çıkış ekranındaki "bakiye var" uyarısına ödeme ekranı bağlantısı eklenir.
> **Modül 13'e not:** `GET /front-desk/summary` gelecek / gidecek / içeride / gecikmiş sayılarını verir;
> kısa listeler için `/front-desk/arrivals` ve `/front-desk/departures` (sayfa `/on-buro`).

> **Modül 3'ten not (16 Eylül 2026 — Ahmet):** oda tarafı hazır, sen yalnızca
> event'i yayınla. `guest.checked_in` / `guest.checked_out` gövdesinde `hotelId`
> ve `roomId` olmalı; room-worker `applySystemRoomState` ile doluluğu (ve çıkışta
> kat hizmetini) değiştirir. **Oda durumunu servisinden doğrudan yazma** — doluluğun
> tek yazıcısı bu akış; ekranda "boş/dolu" değiştiren bir düğme kasıtlı olarak yok.
> Aktör kapalıysa iş "Oda dolu olarak işaretlenecek" manuel görevine düşer.
> Check-in'de ek kontrol önerisi: oda **arızalı** (`condition !== 'IN_SERVICE'`)
> ya da **kirli** ise uyar (kirli odaya giriş otelin tercihi; engellemek yerine onay iste).
>
> **Ek (16 Eylül 2026 — modül 5):** "misafir odada, odasını değiştirelim" işi
> hazır: `changeRoom(hotelId, reservationId, roomId)` rezervasyonun odasını
> değiştirir ve aynı transaction'da eski odayı boş + kirli, yenisini dolu yapar
> (oda planı ekranında sürükle-bırak ile kullanılıyor). Check-in/out akışında
> oda durumunu elle yazmayın; giriş-çıkış için room-worker, oda değişikliği için
> bu fonksiyon tek yazıcıdır.
>
> **Ek (17 Eylül 2026):** taşınmış misafirde `Reservation.roomSince` dolu olabilir.
> Erken çıkışta `checkOut`'u kısaltırken `roomSince <= checkOut` kısıtı var
> (`Reservation_room_since_valid`): taşındığı gün çıkan misafirin çıkış tarihi
> taşıma günüyle eşit olabilir, daha önce olamaz. Oda geçmişi için
> `RoomStaySegment` + açık dilim kullanılır (bkz. modül 5 notu).

> **Modül 53'ten not (4 Kasım 2026 — Ahmet):** `CheckInDialog` rezervasyonun online check-in'ini okur (`guest_portal.view` varsa) ve boş
> formu onunla doldurur (kimlik, refakatçiler, plaka; onay durumunu gösteren uyarı). Giriş kuralları değişmedi. `guest.checked_in`
> online check-in'i "giriş yapıldı"ya, `guest.check_in_reverted` onaylıya çeker. Ön büroya "Online check-in" sekmesi eklendi
> (gezinme kaydıyla; `FrontDeskPage` değişmedi).

### 7. Misafir mesajları / istek takibi — arkadaşın
**Gün sonu:** Personel, misafirlerle yapılan tüm chat/WhatsApp konuşmalarını görüyor, gerekirse elle cevaplıyor; misafir istekleri görev olarak takip ediliyor.
- [x] Backend: Conversation / Message API'leri (liste, detay, mesaj gönder, okundu işaretle)
- [x] Backend: GuestRequest (istek) tablosu + API (tip: havlu, oda servisi, uyandırma; durum)
- [x] Ekran: Konuşma listesi (kanal ikonu, misafir, son mesaj, okunmamış sayısı)
- [x] Ekran: Konuşma detayı (balonlar; AI cevapları etiketli; elle cevap kutusu)
- [x] Ekran: "Manuele al" butonu (concierge bu konuşmaya karışmaz)
- [x] Ekran: İstekler listesi (oda, istek, durum, atanan) + tamamla
- [x] Frontend: yeni mesaj gelince socket ile anlık güncelleme + ses/rozet
- [x] Gerçek kanal trafiği (WhatsApp / web chat) — modül 8'de bağlandı (aşağıdaki not)

> **📌 Modül 7 tamamlandı (17 Eylül 2026 — Ahmet). Modül 8'in kısmı bilinçli olarak boş.**
>
> **Kanal yok, sözleşme var.** Gelen kutusu kanaldan bağımsız. WhatsApp / web chat
> geçidi ve AI asistanı modül 8'de; o gelene kadar ekran "bağlantı kurulmadı" der,
> personelin cevapları **"gönderim bekliyor"** olarak saklanır. Gönderilmiş gibi
> gösteren, sahte gelen mesaj üreten hiçbir şey yok. Devir sözleşmesi modül 8'in altında.
>
> **Veri** (migration'lar `20260917120000_guest_messaging`,
> `20260917121000_conversation_state_version`, `20260917130000_guest_phone_match`):
> - `Conversation`: durum (açık/kapalı), mod (`AI` / `MANUAL`), atanan, okunmamış
>   sayısı, cevap beklemenin başladığı an, son mesaj özeti, `stateVersion`.
> - `Message`: yazar (misafir / personel / AI / sistem), iç not, teslim durumu
>   (`RECEIVED`, `PENDING` → `SENT` → `DELIVERED` → `READ`, `FAILED`), kanal mesaj kimliği.
> - `GuestRequest`: kategori, öncelik, durum, hedef süre (`dueAt`), zamanlı iş
>   (`scheduledFor`), oda / konaklama / misafir, kaynak konuşma ve mesaj.
> - `Hotel.phoneCountryCode` (Genel parametreler → Misafir iletişimi).
>
> **API:** `/messaging/conversations` (imleçli liste; görünüm: açık, cevap bekleyen,
> bana atanan, atanmamış, kapalı, tümü), `/messaging/summary`, `/messaging/channels`,
> `/messaging/conversations/:id` (+ `/messages` imleçli, `POST /messages`, `POST /read`,
> `PATCH` yönetim). `/guest-requests` (liste, `/summary`, `/assignees`,
> `/room-context`, `POST /`, `POST /from-conversation/:id`, `PATCH /:id`, `POST /:id/status`).
>
> **Kurallar:**
> - Hizmet süresi önceliğe göre (`GUEST_REQUEST_SLA_MINUTES`: acil 15, yüksek 30,
>   normal 60, düşük 240 dk); uyandırma gibi zamanlı işte istenen saat. Başlatılmış
>   işi geri almak süreyi **sıfırlamaz** (gecikme gizlenemez); tamamlanmış / iptal
>   işi yeniden açmak sıfırlar (misafir yeniden bekliyor).
> - Durum geçişi tek kural: `guestRequestTransitionError` (contracts). İptal sebep ister.
> - Konuşma yönetimi `expectedStateVersion` ile korunur — misafirin yazması çakışma
>   sayılmaz; istek işlemleri `expectedUpdatedAt` ile.
> - Personel yazınca AI modundaki konuşma personele geçer; kapalı konuşmaya
>   misafir ya da personel yazınca konuşma açılır. Aynı istemci kimliğiyle ikinci
>   gönderim yeni mesaj yazmaz (çift tık, ağ tekrarı).
> - Saatler **otelin saat diliminde** girilir ve gösterilir (`zonedWallTimeToUtc`,
>   contracts; yaz saati geçişleri test edildi).
> - Misafir telefondan bulunur: kartta `+`/`00` ile yazılmış numara birebir,
>   `0` ile ya da ülke kodsuz yazılmış numara otelin telefon ülke koduyla
>   karşılaştırılır; son rakamları aynı başka ülke numarası eşleşmez
>   (`phoneMatchScore`). Aday kartlar ifade dizininden (`Guest_phone_match_idx`) gelir.
>
> **Ekranlar:** `/mesajlar` (geniş ekranda liste · konuşma · misafir/konaklama/istekler;
> dar ekranda tek sütun), `/istekler` (özet kutuları filtre olarak, kategori çipleri,
> akan geri sayım, satırdan başlat/tamamla/ata, detay + düzenleme, adres çubuğunda
> görünüm). Mesajdan tek tıkla istek; web chat konuşması oda seçilerek içerideki
> konaklamaya bağlanır. Yan menüde rozetler (cevap bekleyen konuşma / açık istek;
> süresi aşılan varsa kırmızı), sekme başlığında sayı, yeni misafir mesajında ses
> (kapatılabilir; birden çok sekmede bir kez çalar).
>
> **2500 panel için:** rozet ve sekme sayıları iki parçalı önbellekte — otel geneli
> sayılar (sürüm + dakika anahtarlı) bütün personelde ortak, yalnızca "bana atanan"
> kişi başına. Gelen kutusu ilk sayfası ve aramasız istek listeleri de sürüm
> anahtarlı önbellekte; canlı haberde yalnızca açık olan konuşmanın geçmişi
> tazelenir. Sağlık ucunda `messagingCache` / `requestCache`.
>
> **Sınırlar (bilinçli):** konaklamaya bağlama yalnızca içerideki misafir için
> (gelecek rezervasyon araması modül 4 ile gelir); "şu anki personel" geçici olarak
> `x-actor` e-postası (modül 2 notu); hazır cevap şablonları modül 9'la.

### 8. WhatsApp / web chat ile konuşarak rezervasyon — Ali Kemal
**Gün sonu:** Misafir web chat'e "15-18 Ekim 2 kişilik oda" yazıyor; AI konuşup onay alıyor; rezervasyon kendiliğinden oluşuyor, oda atanıyor, onay mesajı gidiyor.
- [x] Web chat widget'ı (siteye gömülen balon; socket ile mesaj gönder/al)
- [x] webchat-gateway paketi (widget mesajı → `guest.message.received`; `guest.message.reply` → widget'a)
- [x] whatsapp-gateway paketi (Meta Cloud API webhook doğrulama, gelen mesaj → event, giden mesaj → API)
- [x] router-agent paketi (küçük model; intent: rezervasyon / soru / şikâyet / diğer → `guest.intent.detected`)
- [x] concierge-agent paketi (LangGraph grafiği; tool'lar: `check_availability`, `request_reservation`, `get_hotel_info`; konuşma geçmişi + rolling summary; misafir "evet" demeden rezervasyon talebi basmaz)
- [x] Prompt caching + günlük token bütçesi + LlmUsage kaydı
- [x] Bütçe aşımı veya agent kapalıysa konuşma manuel göreve düşer (7'deki ekrana)
- [x] Uçtan uca demo: chat → rezervasyon → oda → onay mesajı, Activity Feed'de izlenir (entegrasyon testi, sahte modelle; gerçek model anahtar gelince)

> **📌 Modül 8 tamamlandı (24 Eylül 2026 — Ahmet, Ali'nin yerine; modül 13'ün önünü açmak için).**
>
> **Paketler:** `shared/agents/llm` (OpenAI resmi SDK adaptörü, maliyet ve bütçe
> hesabı — `usageCost`, `budgetExhausted`, `priceFor`), `shared/actor-kit`
> (`BaseLlmAgent`: izin → çağrı → kullanım kaydı; **arka plan yürütmesi**:
> `manifest.background = { maxConcurrent, maxQueued, onOverflow }`, `accepts()` ile
> ilgisiz olayı sıraya almama, `registry.idle()`), `shared/agents/router-agent`,
> `hotel/agents/concierge-agent` (LangGraph `StateGraph`), `shared/channels/whatsapp-gateway`,
> `shared/channels/webchat-gateway` (+ `widget/widget.js`, Shadow DOM, bağımlılıksız).
>
> **Akış:** misafir yazar → `receiveInboundMessage` → `guest.message.received` →
> router (küçük model, katı JSON şeması) niyeti mesaja ve hafızaya yazar →
> `guest.intent.detected` → concierge turu (en fazla 5 model çağrısı; araçlar
> `check_availability`, `get_hotel_info`, `propose_reservation`, `request_reservation`,
> `handoff_to_staff`) → misafir **yeni bir mesajda** açıkça "evet" deyince (router
> onayı + teklif önceki turda sunulmuş + fiyat/müsaitlik yeniden denetlenmiş)
> `reservation.requested` → reservation-worker → `reservation.created` → room-worker
> odayı atar → concierge onay kodunu **veritabanından, şablonla** sohbete yazar,
> konuşmayı rezervasyona bağlar. Onay kodu "talebiniz alındı" cevabından sonra
> gider (konuşma başına sıra).
>
> **Korumalar:** şikâyet / personel isteği modelsiz devredilir; günlük bütçe
> (otelin iş gününe göre, fiyat ayardan, maliyet yukarı yuvarlanır) dolunca model
> çağrılmaz, konuşma personele geçer, yönetime `AI_BUDGET` uyarısı; konuşma başına
> günlük cevap sınırı; tur sınırı; teklif 30 dk geçerli; 30 geceden uzun / 10
> kişiden kalabalık / 540 günden ileri istek personele; AI yalnızca WhatsApp ve
> web chat'te. Devirde misafire kısa bilgi (dili bilinmiyorsa modelsiz tahmin),
> konuşmaya iç not (sebep), zile `AI_HANDOFF`. 5 dk'dan uzun cevapsız AI konuşması
> süpürücü işle personele geçer (süreç çöktüyse sıradaki iş kaybolmasın).
>
> **Kanallar:** WhatsApp webhook'u `/webhooks/whatsapp/:kanalKimliği` —
> `X-Hub-Signature-256` ham gövde üzerinden doğrulanır, başka numaranın öğesi
> atlanır, tekrar gelen mesaj tek kayıt; teslim bildirimleri mesaja işlenir; 24
> saat penceresi kapalıysa "gönderilemedi" + sebep. Web chat `/webchat` socket ad
> alanı: imzalı oturum token'ı (30 gün kayar), izinli site adresi, IP ve oturum
> başına hız sınırı, "yazıyor…", "gördüm" → okundu. Gönderilmeden kalan cevapları
> dakikada bir iş gönderir (mesaj önce sahiplenilir; çift gönderim yok).
>
> **Veri** (migration `20260924090000_conversational_booking`): `AiSettings`,
> `ConversationAiState` (özet, teklifler, onay bekleyen teklif, istek kimliği,
> günlük cevap sayacı), `MessagingChannel` (sırlar şifreli JSON), `LlmUsage.conversationId`,
> kısmi index'ler `Message_pending_outgoing_idx` ve `Conversation_ai_waiting_idx`;
> `Message_internal_note_valid` artık sistem iç notuna da izin verir;
> `reservation.created` gövdesinde `source` ve `requestId`.
>
> **API:** `/ai/settings` (GET, PUT), `/ai/usage?days=`, `/messaging-channels`
> (GET, `PUT /whatsapp`, `PUT /webchat`, `POST /webchat/rotate-key`),
> `/webhooks/whatsapp/:channelId` (GET doğrulama, POST), `/webchat/widget.js`.
> **Ekranlar:** Ayarlar → AI asistanı (model, fiyat, bütçe, AI rezervasyonu
> kesin/opsiyonlu, otel bilgisi, kullanım ve maliyet), Ayarlar → Mesaj kanalları
> (WhatsApp bilgileri + webhook adresi, balon ayarı + gömme kodu); gelen kutusunda
> niyet etiketi, otomatik (onay kodu) mesajın teslim durumu, sistem iç notları.
>
> **Canlıya alırken:** `.env`'e `OPENAI_API_KEY` (yoksa ajanlar başlamaz, konuşmalar
> personelde açılır), migration uygulanır, nginx `/webhooks/`, `/webchat/` ve
> `/socket.io/` yollarını backend'e geçirir. WhatsApp için Meta uygulamasında webhook
> kurulur (adres ve doğrulama token'ı ekranda).
>
> **Bilinçli sınırlar:** WhatsApp **bildirim** (otelin başlattığı, Meta onaylı
> şablonlu mesaj — modül 9'un `registerNotificationProvider` kaydı) yapılmadı:
> şablon onayı Meta panelinde otel başına yürüyor, ayrı iş; bildirimler e-posta/SMS
> ile gidiyor. Ajan sırası, kanal kaydı ve event bus süreç içi (çok örnekli
> kurulumda paylaşılan kuyruğa taşınmalı). AI yalnızca otelin varsayılan
> pansiyonuyla fiyat verir; başka pansiyon / grup / uzun konaklama personele.

> **📌 Modül 7'den devir (17 Eylül 2026 — Ahmet): gelen kutusu hazır; kanal ve AI tarafı sende.**
> Modül 7 senin kısmını boş bıraktı, sahte doldurmadı. Bağlanma noktaları:
>
> 1. **Geçidi kaydet:** `hotel/backend/src/lib/channels.js` →
>    `registerChannel('WHATSAPP', { name: 'whatsapp-gateway' })` (dönen fonksiyon
>    kapanışta kaydı siler). Kayıt olunca ekrandaki "bağlantı kurulmadı" uyarısı kalkar.
> 2. **Gelen mesaj:** `modules/messaging/service.js → receiveInboundMessage(hotelId,
>    { channel, externalId, externalMessageId, text, displayName?, sentAt? })`.
>    **HTTP ucu yok** — webhook imzasını / token'ını sen doğrula, sonra süreç içinde
>    çağır. `externalMessageId` zorunlu: aynı webhook iki kez gelirse
>    `{ duplicate: true }` döner, tek kayıt olur. Konuşma yoksa açılır; misafir
>    telefondan / e-postadan bulunur, içerideki (yoksa yaklaşan) konaklamaya bağlanır;
>    aynı numaradan eşzamanlı mesajlar tek konuşmada toplanır.
> 3. **Giden mesaj:** personel ya da AI yazınca `guest.message.reply` yayınlanır
>    (`conversationId, messageId, channel, recipient, author`). Geçit dinler, gönderir,
>    sonucu `markMessageDelivery(hotelId, messageId, { delivery: 'SENT' | 'DELIVERED' |
>    'READ' | 'FAILED', externalMessageId?, failureReason?, at? })` ile bildirir. Durum
>    yalnızca ileri gider (geç gelen bildirim geri almaz). **Geçit kapalıyken yazılmış
>    cevaplar bekliyor:** açılışta `Message` içinde `delivery = 'PENDING'`,
>    `direction = 'OUT'`, `internal = false` olanları gönder (`hotelId + delivery` index'li).
> 4. **Concierge (AI):** `registerAutoResponder({ name })` ile kaydol. Kayıt varken
>    yeni konuşmalar `AI` modunda açılır ve ekranda "AI'a devret" görünür.
>    `guest.message.received` gövdesinde `mode` var — yalnızca `AI` ise cevap üret.
>    Cevabı `appendAiReply(hotelId, conversationId, { text, meta })` ile yaz; konuşma bu
>    arada personele alındıysa ya da kapandıysa 409 `CONVERSATION_MANUAL` döner, gönderme.
> 5. **Manuele düşme** (bütçe aşımı, ajan hatası): `updateConversation(hotelId, id,
>    { mode: 'MANUAL', expectedStateVersion })`. Misafir mesajıyla bekleme zaten
>    başladığı için konuşma "cevap bekleyen" görünümüne ve yan menü rozetine düşer.
> 6. **AI'ın açtığı istek:** personel formu `source: 'AI'` kabul etmez. Ajan istek
>    açacaksa `guest-requests/service.js`'teki `insertRequest` çekirdeğini kullanan,
>    kaynağı `AI` olan bir sarmalayıcı ekle (`createRequestFromConversation` kaynağı
>    `CONVERSATION` yazar).
> 7. **Web chat:** `externalId` = widget oturum kimliği. Misafir kimliği taşımaz;
>    personel ekranda odayı seçip konuşmayı içerideki konaklamaya bağlıyor.
>
> Kanal kaydı ve event bus süreç içi; backend çok örnekli çalıştırılacaksa ikisi
> birlikte paylaşılan bir yere taşınmalı.

### 9. Bildirim merkezi — arkadaşın
**Gün sonu:** Sistem misafire e-posta/SMS/WhatsApp, personele uygulama içi bildirim gönderiyor; her gönderim loglu; şablonlar ekrandan düzenleniyor.
- [x] Backend: Notification, NotificationTemplate, ChannelConfig tabloları + API
- [x] Backend: kanal adaptörleri (SMTP e-posta, SMS sağlayıcı, uygulama içi) — WhatsApp gönderimi **modül 8'in geçidinde** (kayıt noktası hazır)
- [x] Ekran: Şablon listesi + editör (değişkenler: {misafirAdi}, {odaNo}, {tarih} ve diğerleri)
- [x] Ekran: Kanal ayarları (SMTP bilgileri, SMS API bilgisi; WhatsApp geçit bağlanınca)
- [x] Ekran: Gönderim geçmişi (kanal, alıcı, durum, hata, tekrar gönder)
- [x] Frontend: üst barda zil ikonu, personel bildirimleri listesi
- [x] Aktör: notification-worker paketi (`reservation.created` → onay, `room.assigned` → oda bilgisi, `guest.checked_in/out` → hoş geldiniz / teşekkür; gönderim ayrı göndericide → `notification.sent/failed`)

> **Modül 7'den not (17 Eylül 2026 — Ahmet):** personel bildirimi için hazır
> event'ler: `guest.request.created` (`requestId, category, priority, roomId`),
> `guest.request.updated`, `guest.message.received`. Yeni mesaj sesi ve tercihi
> şimdilik `frontend/src/lib/inboxSound.js`'te. Misafire giden WhatsApp mesajının
> **teslimi** modül 8'in geçidinde — bildirim merkezinin WhatsApp adaptörü aynı
> geçidi kullanmalı, ikinci bir gönderici kurulmamalı.

> **📌 Modül 9 tamamlandı (17 Eylül 2026 — Ahmet). WhatsApp kısmı modül 8'e bırakıldı.**
>
> **Veri** (migration `20260918090000_notification_center`):
> - `Notification`: kuyruk + geçmiş. Metin kuyruğa girerken **dondurulur** (şablon
>   sonra değişse de giden metin görülür). Durum `PENDING → SENDING → SENT → DELIVERED`,
>   ya da `FAILED` / `CANCELLED`; deneme sayısı, sıradaki deneme, sağlayıcı kaydı,
>   hata kodu. Aynı olay iki kez işlense de ikinci bildirim açılmaz (`dedupeKey`,
>   kısmi tekil index). Durum tutarlılığı veritabanı kısıtlarıyla korunur.
> - `NotificationTemplate`: olay × kanal × dil (tr/en) başına tek metin. Kurulumda
>   16 önerilen metin yüklenir (`ensureDefaultTemplates`, seed çağırıyor).
> - `NotificationChannelConfig`: kanal ayarı; parola **AES-256-GCM ile şifreli**
>   (`SETTINGS_SECRET_KEY`), hiçbir cevapta dönmez; son test / son hata.
> - `StaffAlert` (+ `StaffAlertRead`, `StaffAlertState`): zil. Uyarı bir kişiye ya da
>   bir izne gider (kişi başına satır çoğaltılmaz); aynı konu tek uyarıda birleşir.
> - `GuestRequest.overdueAlertedAt`: gecikme uyarısı bir kez.
>
> **Akış:** olay → notification-worker (`enqueueTriggerNotifications`) → kuyruk →
> gönderici (`dispatcher.js`, `FOR UPDATE SKIP LOCKED` ile üstlenir; HTTP isteğinin
> yolunda değil) → sağlayıcı. Geçici hatada 30 sn / 2 dk / 10 dk / 30 dk arayla
> yeniden dener (en fazla 5 deneme); kalıcı hatada (yanlış parola, onaysız başlık)
> hemen vazgeçer ve yöneticinin ziline "misafire ulaşmadı" düşer (aynı gün aynı
> hata tek uyarı). Süreç gönderim ortasında kapanırsa 5 dk sonra sıraya geri alınır.
> SMS teslim raporu Netgsm'den 2 dakikada bir sorulur (`DELIVERED` / `FAILED`).
>
> **Kurallar:**
> - Oda bilgisi yalnızca giriş günü ya da misafir içerideyken gider (günler önceki
>   atamada oda değişebilir); olay geç işlendiyse ve oda yine değiştiyse eskisi gitmez.
> - Dil: Türk (ya da uyruğu bilinmeyen) misafire Türkçe, diğerlerine İngilizce;
>   İngilizce metin kapalıysa Türkçeye düşülür.
> - SMS: Netgsm şartnamesine göre uzunluk (Türkçe harf 2 karakter, en fazla 6 parça);
>   desteklenmeyen karakter şablona yazılamaz, misafir adındaki yabancı harfler
>   karşılığına çevrilir. Otel isterse **sessiz saatler** (ör. 22:00–08:00): o arada
>   sıraya giren SMS bitişte gider. Bildirimler bilgilendirme amaçlı (İYS filtresi yok).
> - Misafir kanal bazında bildirim istemiyorsa satır "gönderilmedi" olarak kalır
>   (`Guest.preferences.notifications.optOut: ['SMS', ...]` — ekranı modül 22'de).
> - Tekrar gönderim yeni kayıt açar ve misafir kartındaki güncel adrese gider.
>   Yalnızca sıradaki bildirim iptal edilir (sebep zorunlu). Kanal testleri tekrar
>   gönderilmez, zil açmaz, özet sayılarına girmez.
> - Servis katmanının alan hatası (`ValidationError(..., { field })`) artık şema
>   hatalarıyla aynı biçimde `fields` olarak döner; formlar alanın altında gösterir.
>
> **Zil (personel uyarıları):** cevapsız misafir mesajı (AI modundaysa değil) →
> konuşmanın sahibine, yoksa mesaj görenlere; acil istek ve geciken istek → isteğin
> sahibine, yoksa istek yönetenlere; aktörün personele bıraktığı iş → işin modülüne
> yetkili olanlara; misafire ulaşmayan bildirim → bildirim yöneticilerine. Kişi
> türleri susturabilir. 30 gün saklanır.
>
> **API:** `/notifications/history` (imleçli; durum, kanal, olay, arama),
> `/summary`, `/history/:id`, `POST /history/:id/resend`, `POST /history/:id/cancel`,
> `GET|PUT /templates`, `GET /channels`, `PUT /channels/:channel`, `POST /channels/test`.
> `/staff-alerts` (imleçli), `/summary`, `POST /seen`, `POST /read-all`,
> `POST /:id/read`, `PUT /preferences`. Yetki: geçmiş `notifications.view`
> (ön büroda da var), diğerleri `notifications.manage`; zil herkese (kendi uyarıları).
>
> **Ekranlar:** `/bildirimler/gecmis` (özet kutuları filtre olarak, canlı liste,
> detay: tam metin, denemeler, tekrar gönder / iptal), `/bildirimler/sablonlar`
> (olaylar; kanal ve dil; değişken çipleri; örnek değerlerle önizleme; SMS karakter
> ve parça sayacı; kaydedilmemiş değişiklik uyarısı), `/bildirimler/kanallar`
> (SMTP, Netgsm, sessiz saatler, test gönder, son hata). Üst barda zil.
>
> **2500 personel için:** uyarılar kişi başına çoğaltılmaz; rozet sunucudan bir kez
> (görülmemiş kimlikler, 99 üst sınır) gelir, sonra socket haberiyle panelde artar
> (haber yalnızca kimlik + kime taşır). Özet 5 dk + rastgele payla tazelenir,
> yeniden bağlanmada rastgele beklemeyle. Hız sınırı artık **IP + personel**
> başına (`RATE_LIMIT_MAX`, varsayılan 600/dk); nginx arkasında gerçek IP için
> `TRUST_PROXY` (varsayılan `loopback`) ve nginx'te
> `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` gerekli.
>
> **Canlıya alırken:** sunucu ortamına `SETTINGS_SECRET_KEY` (32 bayt base64;
> komut `.env.example`'da) eklenmeli — yoksa kanal parolası kaydedilemez, ekran
> bunu söyler. Anahtar değişirse kayıtlı parolalar yeniden girilir. Migration
> `20260918090000_notification_center` uygulanmalı; mevcut otel için şablonlar
> seed ile yüklenir (var olana dokunmaz).
>
> **Diğer modüllere devir:**
> - **Modül 8 (WhatsApp):** geçit açılırken
>   `modules/notifications/providers/index.js → registerNotificationProvider({ channel:
>   'WHATSAPP', name, send })`. `send({ hotelId, settings, secret, to, toName,
>   subject, text })` → `{ providerMessageId }`; hata `ProviderError(message, { code,
>   retryable, configIssue })`. Kayıt olunca Kanallar ekranında WhatsApp açılabilir;
>   şablonlar şimdiden düzenlenebilir. Meta onaylı şablon eşlemesi geçidin işi.
> - **Modül 4 / 6:** `reservation.created`, `guest.checked_in`, `guest.checked_out`
>   yayınlandığında bildirimler kendiliğinden gider (gövdede `reservationId`, varsa `roomId`).
> - **Modül 2:** zil ve "şu anki personel" geçici olarak `x-actor` e-postasıyla;
>   socket el sıkışmasındaki `auth.actor` da aynı e-posta (kişi/izin odaları buna
>   göre kuruluyor, JWT gelince kaynağı değişecek; `registerSocketHandlers`).
>   Rol → izin eşlemesi backend `lib/permissions.js`'te geçici (`permissionsForRole`);
>   modül 11'in `approvals.view` / `approvals.decide` izinleri de orada (şimdilik yalnızca `ADMIN`).
> - **Modül 11 / 12:** aktörün bıraktığı işler (`ManualTask`) zile düşüyor; modülden
>   izne eşleme `notifications/rules.js → manualTaskPermission`.
> - **Modül 22:** misafir kartına kanal bazında "bildirim istemiyor" seçeneği
>   (`preferences.notifications.optOut`).
> - Mesaj kutusundaki hazır cevaplar bu şablonlardan ayrı; modül 7'ye eklenecek.

### 10. Aktör Activity Feed + audit log — Ali Kemal
**Gün sonu:** Admin, sistemde olan biteni canlı izliyor: hangi aktör hangi event'i işledi, ne kadar sürdü, hata var mı; bir rezervasyonun tüm zincirini tek tıkla görüyor.
- [x] Backend: ActivityLog ve EventLog listeleme API'si (filtre: aktör, event, seviye, tarih, correlationId)
- [x] Backend: AuditLog (kullanıcı hangi kaydı değiştirdi; servis katmanında otomatik yazım) — **modül 1'de yapıldı**
- [x] Backend: socket.io `activity` kanalı (her log satırı anlık yayınlanır — kimliğiyle; içerik HTTP'den)
- [x] Ekran: Canlı akış (liste, otomatik kaydırma, duraklat)
- [x] Ekran: Filtre çubuğu (aktör, event adı, seviye, tarih)
- [x] Ekran: Zincir görünümü (correlationId seç → adımlar sıralı, süreleriyle)
- [x] Ekran: Kullanıcı audit listesi (kim, ne zaman, hangi kayıt, eski/yeni değer)

> **📌 Modül 10 tamamlandı (25 Eylül 2026 — Ahmet, Ali'nin yerine).**
>
> **Önemli düzeltme (modül 2'den kalan):** HTTP isteğinin bağlamı (kişi ve
> zincir kimliği) `onRequest` kancasında `await`'lerden **sonra** kuruluyordu;
> `AsyncLocalStorage.enterWith` bu hâliyle route işleyicisine geçmiyordu. Sonuç:
> HTTP'den yapılan her değişikliğin denetim izinde kişi `system`, her yazımın
> zincir kimliği farklıydı. Bağlam artık kancanın başında kurulup kimlik
> doğrulanınca güncelleniyor (`app.js`). Eski denetim satırlarında kişi
> `system` olarak kalır (geriye dönük düzeltilemez).
>
> **Veri** (migration `20260925090000_activity_feed`): `ActivityLog.eventName` ve
> `correlationId` sütunları (eski satırlar `EventLog`'dan dolduruldu); otel
> kapsamlı imleç index'leri: aktivite (zaman / aktör / olay / seviye), olay
> (zaman / ad), denetim (zaman / kişi / kayıt türü / kayıt). Eski otel kapsamsız
> index'ler kaldırıldı. ⚠️ Büyük tabloda bakım penceresinde uygulanmalı (index
> kilitle oluşur).
>
> **Aktör tabanı:** her aktivite satırı olay adını ve zincir kimliğini taşır;
> aktör kapalıyken ya da iş sırası taşınca akışa **uyarı** satırı yazılır (eskiden
> iz yoktu); geçici hatadan sonra başaran işin deneme sayısı izde.
>
> **Canlı akış:** satır yazılınca süreç içi yayın (`lib/activity-stream.js`) →
> socket köprüsü 500 ms'de bir otel başına **yalnızca kimlikleri** ve seviye
> sayılarını gönderir (socket kimliği henüz doğrulanmadığı için içerik yok);
> panel satırları aynı süzgeçle HTTP'den çeker. 200 kimliği aşan pakette panel
> listeyi baştan yükler. İşlem içinde yazılan satır commit'ten sonra yayınlanır
> (`writeWithEvents` → `afterCommit`). İzleyen yoksa toplama yapılmaz.
>
> **Zincir:** olay → onu işleyen aktör → aktörün yazdığı değişiklik ve
> yayınladığı olay (ağaç; `causationId`, aktör adı ve işleyiş süresi ile
> kurulur, bozuk kayıtta döngü koruması). Her kaynaktan en çok 500 adım.
> Değişikliklerin eski/yeni değerleri yalnızca `audit.view` iznine. Olay
> gövdesindeki telefon, e-posta, kimlik, kart vb. maskelenir (`redactPayload`).
>
> **API:** `/activity/feed` (aktör, olay, seviye — `PROBLEMS` = uyarı+hata —,
> tarih, zincir, imleç; canlı için `ids`), `/activity/events` (ad, zincir,
> `unpublished`, tarih), `/activity/chains/:correlationId`,
> `/activity/records/:entity/:entityId` (kaydın bütün zincirleri),
> `/activity/options`, `/audit` (kişi, kayıt türü + kimlik, işlem, tarih).
> **İzinler:** `activity.view`, `audit.view` (yönetici ve müdür varsayılan).
>
> **Ekranlar:** `/aktivite/akis` (canlı, duraklat, okunan yeri korur, "N yeni"),
> `/aktivite/olaylar` (dağıtılmamış süzgeci), `/aktivite/denetim` (eski → yeni,
> "bu kişinin değişiklikleri", "bu kaydın geçmişi"), `/aktivite/zincir/:id`,
> `/aktivite/kayit/:tür/:kimlik`. Rezervasyon detayında **"İşlem zinciri"**.
> Süzgeçler adres çubuğunda (paylaşılabilir).
>
> **Bilinçli sınırlar:** socket el sıkışması hâlâ kimliksiz (modül 2'nin işi;
> bu yüzden socket'ten içerik gönderilmiyor). Saklama süresi (eski aktivite /
> olay satırlarının silinmesi) yok — denetim kaydı silinmemeli; aktivite/olay
> için politika kararı gerekir.

> **🎁 Modül 1'de senin adına yapılanlar (9 Eylül 2026 — Ahmet):**
> Ayarlar modülünü yazarken bu modülün altyapısına ihtiyaç oldu, biz de temelini
> kurduk. Ekran tarafı sana kaldı ama arka taraf hazır:
>
> - **`AuditLog` tablosu + otomatik yazım.** Her ayar değişikliği kim/ne zaman/eski
>   değer/yeni değer/değişen alan listesiyle kaydediliyor
>   (`hotel/backend/src/lib/audit.js`). Değişiklikle **aynı transaction'da** yazılıyor,
>   yani "değişti ama izi yok" durumu imkânsız. Senin "kullanıcı audit listesi"
>   ekranın doğrudan bu tabloyu okuyabilir.
> - **`correlationId` zinciri.** Her HTTP isteğine bir kimlik veriliyor
>   (`x-correlation-id` başlığıyla dışarı da veriliyor) ve `AsyncLocalStorage`
>   üzerinden çağrı ağacında kendiliğinden taşınıyor. Audit ve event kayıtları
>   aynı kimliği paylaşıyor — "zincir görünümü" ekranının ihtiyacı olan tutkal bu.
> - **EventLog + transactional outbox.** Event'ler iş verisiyle aynı transaction'da
>   `EventLog`'a yazılıyor (`publishedAt` boş), commit sonrası dağıtılıp
>   işaretleniyor. Dağıtılamayan event `publishedAt = null` kalıyor; ileride bir
>   "outbox tarayıcı" ile yeniden denenebilir.
>
> Sende kalan: listeleme API'si, socket.io `activity` kanalı ve ekranlar.

### 11. Onay kuyruğu — arkadaşın
**Gün sonu:** Para iadesi, büyük ödeme, toplu fiyat değişimi gibi işler personelin önüne düşüyor; onaylayınca sistem kaldığı yerden devam ediyor.
- [x] Backend: Approval CRUD + `grant` / `deny` API'leri
- [x] Backend: `approval.granted` yayınlanınca PendingAction'daki event tekrar bus'a verilir — **isteyen aktöre** verilir (bkz. not: bus'a yeniden vermek diğer aktörlere işi ikinci kez yaptırırdı)
- [x] Backend: süre dolan onaylar EXPIRED olur (zamanlayıcı)
- [x] Ekran: Bekleyen onaylar listesi (tip, özet, isteyen aktör, tutar, süre)
- [x] Ekran: Onay detayı (veri, gerekçe) + Onayla / Reddet + not
- [x] Ekran: Geçmiş onaylar
- [x] Frontend: yeni onay gelince üst barda sayaç + socket bildirimi
- [x] Onaya iş götüren ilk gerçek akış — **folyo kalemi iptali (modül 15, tür `FOLIO_VOID`)**: servis açar, karar dinleyicisi uygular; dört göz kuralı (isteyen onaylayamaz). İade / büyük ödeme (17) ve toplu fiyat (31) aynı yoldan gelecek

> **📌 Modül 11 tamamlandı (17 Eylül 2026 — Ahmet). İsteyen tarafı bilinçli olarak boş.**
>
> **Kuyruk var, isteyen yok.** Para iadesi (17), büyük ödeme (17), toplu fiyat
> değişimi (31) henüz yazılmadı; bugün üretimde onay açan bir akış yok. Altyapı
> gerçek bir aktörle (test aktörü) uçtan uca doğrulandı: onay iste → zil → onayla →
> aktör aynı olayla devam eder. Sahte istek üreten hiçbir şey yok. Devir sözleşmesi aşağıda.
>
> **Veri** (migration `20260920090000_approval_queue`):
> - `Approval`: tür (`APPROVAL_TYPES`: iade, büyük ödeme, toplu fiyat, diğer), özet,
>   gerekçe, `data` (isteyenin serbest verisi; ekranda gösterilir, yorumlanmaz),
>   `amount`/`currency`, isteyen aktör ve iş adı (`actorName`, `action`), `requestedBy`,
>   karar (`decidedBy`, `decidedAt`, `note`), ilgili kayıt, `expiresAt`.
> - `PendingAction`: onaylanınca devam edecek aktör işi — olayın zarfı olduğu gibi;
>   `(actorName, eventId)` tekil (aynı olay yeniden gelse de ikinci istek açılmaz),
>   `resumedAt` üstlenme işareti (haber tekrar gelse de devam bir kez).
> - `StaffAlertKind.APPROVAL_REQUESTED`: zile "onay bekliyor" / "süresi doldu".
>
> **Olaylar:** `approval.requested` / `granted` / `denied` / `expired` (yalnızca kimlik ve
> tür; özet ve tutar socket'e çıkmaz). Canlı yayın kanalı `approvals.changed`.
>
> **API:** `/approvals` (imleçli; `view=PENDING` eskiden yeniye, `view=HISTORY` yeni
> karar önce; tür / karar / arama süzgeci), `/approvals/summary` (bekleyen, süresi
> yaklaşan, en eski), `/approvals/:id`, `POST /:id/grant` (not isteğe bağlı),
> `POST /:id/deny` (gerekçe zorunlu). Görüntüleme `approvals.view`, karar
> `approvals.decide`. **HTTP'den onay açılmaz**; onay aktörden ya da servisten açılır.
>
> **Aktör tarafı (`shared/actor-kit`):** işleyici `ctx.requireApproval({ action, type,
> summary, data, amount, expiresInMs })` der. Taban sınıf bunu hata gibi değil sinyal
> gibi ele alır: yeniden denemez, manuel göreve düşürmez, olayı işlenmiş saymaz;
> `deps.requestApproval` ile onay + bekleyen iş açar. `action` bildirgedeki
> `requiresApproval` listesinde olmalı (modül 12 paneli oradan okur); değilse
> programlama hatası sayılır, iş manuel göreve düşer. Onay verilince aynı işleyici
> aynı olayla, `ctx.approval` dolu olarak çağrılır (aktör bu arada kapatılmış olsa da:
> onaylanmış işi bir daha sormak olmaz). Ret / süre dolumu olayı o aktör için
> `ProcessedEvent`'e yazar; bir daha ele alınmaz. Aktör kayıttan kalkmışsa iş manuel
> göreve düşer (`Onay kuyruğu` modülü).
>
> **Neden devam bus'a değil aktöre gider:** onaylanan olay bus'a yeniden verilseydi
> aynı olayı dinleyen diğer aktörler de (yeni kimlikli olayı tanımadan) işi ikinci kez
> yapardı — rezervasyon onayı misafire iki kez giderdi. Devam yalnızca isteyen aktörün
> işleyicisine, aynı olay kimliğiyle, zincir (`correlationId`) korunarak yapılır;
> aktör olarak onaylayan kişi yazılır ("kim yetkilendirdi").
>
> **Kurallar:**
> - Karar satır kilidiyle: aynı anda iki yönetici karar veremez; ikinci "zaten karara
>   bağlanmış" (409 `NOT_PENDING`) alır. Süresi geçmiş onaya karar verilemez; o anda
>   düşürülür (ayrı transaction'da: 409 ile biten karar transaction'ı düşürmeyi geri alırdı).
> - Süre: isteyen vermezse bir gün (`APPROVAL_DEFAULT_TTL_MS`), `expiresInMs: null` süresiz,
>   en çok 30 gün. Tarayıcı dakikada bir `FOR UPDATE SKIP LOCKED` ile düşürür; süresi
>   dolan iş zile "yapılmadı" uyarısı düşürür.
> - Denetim izi: açılış ve karar `AuditLog`'a (karar veren kişiyle); aktör tarafı
>   `ActivityLog`'a ("onaya gönderildi", "iade yapıldı", "onay reddedildi").
> - Onay isteği tek şemadan doğrulanır (`approvalRequestSchema`, contracts): tür bilinmeli,
>   tutar iki ondalıklı metin, para birimi 3 harf.
>
> **Ekranlar:** `/onaylar/bekleyen` (özet kutuları, en uzun bekleyen üstte, akan kalan süre,
> satırdan tek tıkla onayla / reddet, detay + karar aynı pencerede, adreste `?onay=`),
> `/onaylar/gecmis` (karar süzgeci). Üst barda bekleyen sayacı (süresi yaklaşan varsa
> kırmızı), yan menüde rozet, zilde uyarı, karar yetkisi olana kısa bildirim.
>
> **2500 panel için:** özet sürüm + dakika anahtarlı önbellekte (`/health` →
> `approvalCache`); sayaç canlı haberle en çok 10 sn'de bir tazelenir; liste imleçli
> (`(hotelId, status, createdAt, id)` / `(hotelId, status, decidedAt, id)` index'leri);
> süre dolumu için kısmi index; özet araması trigram.
>
> **Sınırlar (bilinçli):** rol matrisi geçici — yalnızca `ADMIN` görür ve karar verir
> (modül 2 gerçek matrisi getirince `MANAGER` eklenir); onaylanan servis işinin (aktör
> olmayan) devamı isteyen modülün kendi `approval.granted` dinleyicisidir.
>
> **Devir sözleşmesi:**
> - **Modül 15 / 17 (folyo, ödeme, iade):** servis içinden
>   `requestApproval(tx, stage, { hotelId, type: 'REFUND' | 'LARGE_PAYMENT', summary, amount,
>   currency, data, entityType, entityId })` (`modules/approvals/service.js`); `approval.granted`
>   / `denied` olayını dinleyip `approvalId` ile kendi işini bitirir. `Payment.approvalId`
>   hazır. Eşik (ör. nakit sınırı) modül 1 ayarlarına eklenir.
> - **Modül 31 (toplu fiyat değişimi):** aynı yol, tür `BULK_PRICE_CHANGE`.
> - **Modül 12 (aktör paneli):** bildirgedeki `requiresApproval` "onay gerektiren
>   aksiyonlar" kartıdır; `ManualTask.module = 'Onay kuyruğu'` kayıtları aktörü kayıttan
>   kalkmış onaylardır.
> - **Modül 13 (günlük durum):** "bekleyen işler" kutusu `/approvals/summary`'den.
> - **Modül 2:** `approvals.view` / `approvals.decide` izinleri; zil ve sayaç bu izne göre.

### 12. Aktör yönetim paneli — Ali Kemal
**Gün sonu:** Admin, aktörleri tek ekrandan açıp kapatıyor; kapalı aktörün işleri "manuel görevler"de listeleniyor; LLM agent'ların token harcaması görünüyor.
- [x] Backend: `GET /actors` (manifest + durum), `enable` / `disable` API'leri
- [x] Backend: ManualTask listeleme / tamamlama API'si
- [x] Backend: LlmUsage günlük özet API'si
- [x] Ekran: Aktör listesi (ad, tip, paket, durum, switch)
- [x] Ekran: Aktör detay paneli (açıklama, dinlediği / yayınladığı event'ler, onay gerektiren aksiyonlar, retry politikası)
- [x] Ekran: LLM agent kartı (model, günlük bütçe, bugünkü kullanım çubuğu, tahmini maliyet)
- [x] Ekran: Manuel görevler listesi (modül, başlık, orijinal event, "tamamla")

> **📌 Modül 12 tamamlandı (26 Eylül 2026 — Ahmet, Ali'nin yerine).**
>
> **Aktör paneli** (`/aktorler`, izin `actors.view`; aç/kapa `actors.manage` —
> varsayılan yalnızca yönetici, müdür görür): her aktör tek satırda — Türkçe adı,
> tür, paket, bu otelde açık mı (kim, ne zaman, hangi gerekçeyle kapattı), son 24
> saatte iş/uyarı/hata, son iş, açık manuel görev, arka plan sırası. Kapatma
> "ne durur"u söyleyip gerekçe sorar. Açma/kapama ayrı uçlar
> (`POST /actors/:ad/enable|disable`): iki yönetici aynı anda "kapat" derse
> sonuç yine kapalı, ikinci istek iz bırakmaz; ayar satırı kilitlenir, denetim
> izine (`ActorSetting`) ve aktivite akışına (uyarı satırı) yazılır, olay
> `actor.setting.changed`. Aktör her olayda ayarı veritabanından okur: kapatılan
> aktör bir sonraki olayda durur.
>
> **Aktör detayı** (`/aktorler/:ad`): "kapatırsam ne olur" (işler hangi manuel
> göreve düşer, yayınladığı olayları bekleyen aktörler kimler — bildirgeden
> hesaplanır), dinlediği / yayınladığı olaylar (Türkçe adlarıyla, kim yayınlıyor /
> kim dinliyor), onay gerektiren işler, yeniden deneme ve arka plan politikası,
> son 10 iş (zincire bağlantılı). **Kurulu olmayan** aktör de görünür (ör. sunucuda
> `OPENAI_API_KEY` yokken AI ajanları, sebebiyle); ayarı değiştirilebilir.
>
> **Bildirge:** `defineActor` artık `title` (panelde Türkçe ad) ve `packageName`
> alır. **Yeni aktör yazan:** ikisini de ver; `fallbackModule` adını
> `MANUAL_TASK_MODULE_PERMISSIONS`'a (contracts, `actors.js`) izniyle ekle — yoksa
> görevleri yalnızca ayar yöneticisine görünür.
>
> **Manuel görevler** (`/gorevler`, menüde rozetli): görev, işin modülüne yetkili
> personele görünür (zil uyarısıyla aynı izin: oda atama → oda işlemleri, cevapsız
> mesaj → mesaj yazma). Üstlen / bırak / tamamla (not) / "gerek kalmadı"
> (gerekçe zorunlu). Her işlem satırı kilitler: iki kişi aynı görevi üstlenemez,
> ikinci "tamamla" 409 alır; kapanmış görev yeniden açılmaz (veritabanı kısıtı).
> Başkasının üstlendiği görev yine tamamlanabilir (iş acil; izde tamamlayan
> yazar). Görev işi düşüren aktörü ve olayın zincirini taşır; bağlı kayıtlara
> (rezervasyon, konuşma, istek, onay) bağlantı verir. Liste olay gövdesi taşımaz;
> görev açılınca gövde **maskesiz** gelir (işi yapacak kişi misafirin iletişim
> bilgisine ihtiyaç duyar; zaten o modülün yetkisine sahip). Zil uyarısı artık
> göreve götürür (`/gorevler?gorev=`).
> API: `/manual-tasks` (açık — en eski önce / kapanan — en yeni kapanan önce,
> modül, aktör, imleç), `/manual-tasks/summary`, `/manual-tasks/:id`,
> `.../claim|release|complete|cancel`. Olaylar `manual_task.created|updated`,
> canlı kanal `manual-tasks.changed`.
> **Modül 13 için:** "bekleyen işler" kutusundaki manuel görev sayısı
> `GET /manual-tasks/summary` (kişinin kapsamıyla; otel başına dakikada tek sorgu).
>
> **LLM kullanımı:** her model çağrısı `LlmUsage` satırına ek olarak **günlük
> özete** (`LlmUsageDaily`: otel × iş günü × ajan × model) aynı transaction'da
> sayılır. Bütçe denetimi ve kullanım ekranları (`/ai/usage`,
> `/actors/:ad/usage`) artık satırları değil özeti toplar — büyük otelde günde on
> binlerce çağrı olsa da okunan satır birkaç düzine. Ajan kartı: model, otelin
> günlük bütçesi (ajanlar paylaşır; çubukta ajanın payı koyu), bugünkü ve dönem
> maliyeti, çağrı başına ortalama, gün gün çubuk, model kırılımı.
> **AI ajanları panelden kapatılırsa** AI misafire cevap vermez: yeni konuşmalar
> personelde açılır (`aiActiveFor` ajanların açık olmasını da arar; her mesaj ayrı
> manuel göreve düşmez). AI ayar ekranı bunu uyarı olarak gösterir.
>
> **Veri** (migration `20260926090000_actor_panel`): `ActorSetting.updatedBy/note`;
> `ManualTask` üstlenen/kapanış/kapatan/not/aktör/zincir sütunları, açık görev
> `closedAt IS NULL` ile otel kapsamlı index'ten (zaman / modül / aktör), durum ile
> kapanış anı ve üstlenen kısıtları; `LlmUsageDaily` tablosu (eski çağrılardan
> dolduruldu). ⚠️ `LlmUsage` büyükse bakım penceresinde uygulanmalı.
>
> **Bilinçli sınırlar:** `ActorSetting.dailyTokenBudget` kullanılmıyor — bütçe
> modül 8'deki otel geneli USD bütçesi (ajan başına bütçe istenirse ayrı karar).
> Arka plan sırası (çalışan/bekleyen) süreç içidir; birden fazla sunucu
> çalışırsa panel isteğin düştüğü sunucununkini gösterir.

> **🎁 Modül 1'de senin adına yapılanlar (9 Eylül 2026 — Ahmet):**
> `shared/core` artık boş değil — event bus'ın çekirdeği kuruldu
> (`shared/core/bus/event-bus.js`, `shared/core/events/catalog.js`):
>
> - Event'ler **katalogda tanımlı olmadan yayınlanamıyor**; gövde zod ile
>   doğrulanıyor. Modüller arası sözleşme böylece yazılı.
> - Dinleyici hataları izole (biri patlarsa yayıncı ve diğerleri etkilenmiyor),
>   yavaş dinleyici log'lanıyor, döngüye karşı hop sınırı var.
> - `subscribe` / `subscribeMany` abonelik iptali döndürüyor.
> - Bus altyapıdan bağımsız: Prisma bağlantısı `hotel/backend/src/lib/events.js`'te.
>   Süreç içi çalışıyor; kuyruğa taşınacağı gün arayüz aynı kalacak.
>
> Ayarlar modülü bunu gerçek bir tüketiciyle kullanıyor: cache geçersiz kılma
> artık doğrudan çağrıyla değil, `settings.*` event'lerini dinleyerek yapılıyor.
>
> **Ek (10 Eylül 2026 — modül 3):** `shared/actor-kit` de artık boş değil.
> `BaseWorker` + `defineActor` + `ActorRegistry` kuruldu ve ilk gerçek aktör
> (`hotel/workers/room-worker`) bunun üstünde çalışıyor. Taban sınıf dört şeyi
> garanti ediyor:
>
> - **İdempotency:** aynı event iki kez gelirse iş tekrarlanmaz (`ProcessedEvent`).
> - **Kapalıyken iş kaybolmaz:** `ActorSetting.enabled = false` ise iş `ManualTask`
>   olarak personelin önüne düşer — okunur bir başlıkla ("Rezervasyona oda atanacak").
> - **Yeniden deneme:** geçici hatada manifest'teki politikaya göre denenir;
>   `error.retryable = false` işaretli iş kuralı hataları hemen manuel göreve düşer.
> - **İz:** her işlem süresiyle `ActivityLog`'a yazılır.
>
> `actorRegistry.list()` yönetim paneline hazır: her aktörün adı, açıklaması,
> dinlediği ve yayınladığı event'ler manifest'te beyan edilmiş durumda.
> Sende kalan: `GET /actors` + enable/disable API'si, `ManualTask` listeleme
> ekranı, LLM bütçe kartı.
>
> **Ek (17 Eylül 2026 — modül 11):** onay akışı geldi. Bildirgedeki `requiresApproval`
> artık gerçek: aktör `ctx.requireApproval({ action, ... })` dediğinde `action` bu listede
> olmalı; panelin "onay gerektiren aksiyonlar" kartı buradan okunur. Onaylanmış iş,
> aktör **kapalı olsa da** yapılır (onay bir kez verilmiştir). `ManualTask.module =
> 'Onay kuyruğu'` olan görevler, aktörü kayıttan kalkmış onaylardır.

### 13. Günlük durum ekranı — arkadaşın
**Gün sonu:** Müdür sabah tek ekrana bakıp günü anlıyor: doluluk, gelecek/gidecek, gelir, bekleyen işler.
- [x] Backend: `GET /dashboard/today` (doluluk %, gelecek/gidecek sayısı, dolu/boş oda, kirli oda, arızalı oda, bugünkü gelir, ADR)
      — doluluk % paydası **satılabilir oda** (toplam − arızalı); hizmet dışı paydadan düşmez
- [x] Backend: `GET /dashboard/week` (7 günlük doluluk serisi)
- [x] Ekran: KPI kartları (6 kart)
- [x] Ekran: Haftalık doluluk çizgi grafiği
- [x] Ekran: Bugün gelecekler / gidecekler kısa listesi (6'ya link)
- [x] Ekran: Bekleyen işler kutusu (onaylar, manuel görevler, açık arızalar)

> **📌 Modül 13 tamamlandı (26 Eylül 2026 — Ahmet).**
>
> **Nerede:** ana sayfa (`/`), izin `dashboard.view` (yeni; müdür ve muhasebe
> varsayılan — gelir içerdiği için ayrı izin). İzni olmayan eskisi gibi hızlı
> erişim kartlarını görür.
>
> **Tanımlar tek kaynaktan:** doluluk, satılan ve satılabilir oda oda planının
> gün özetinden (`plan/rules.js` → `summarizeDays`) gelir — iki ekranın sayısı
> ayrışamaz (entegrasyon testi haftalık seriyi oda planıyla birebir karşılaştırır).
> Satılan = bekleyen + onaylı + içeride; geçmiş gecelerde çıkış yapmış olanlar da
> (erken çıkışta ileriki geceler sayılmaz). Satılabilir = toplam − arızalı;
> hizmet dışı oda paydada kalır. Gelecek / gidecek sayıları ön büro özetinden
> (`getFrontDeskSummary`): kart tıklanınca açılan listeyle aynı.
>
> **Gelir, ADR, RevPAR — vergiler hariç:** gece fiyatlarından (`ReservationNight`,
> `(hotelId, date)` index'i) aynı "sayılan gece" kuralıyla SQL'de toplanır. Fiyata
> dahil oda vergileri (KDV, konaklama vergisi — ayardaki `isIncluded` + `ROOM`)
> ayrılır: net = brüt ÷ (1 + dahil oranlar); rezervasyon ekranının vergi dökümüyle
> aynı formül. Brüt ayrıca döner. ADR = net / fiyatı olan satılan gece (satış yoksa
> tanımsız, "0" değil); RevPAR = net / satılabilir oda. Opsiyonlu (kesinleşmemiş)
> gelir ayrı. Otelin para birimi dışında satır çıkarsa toplama **karıştırılmaz**,
> ayrı uyarılır. Bu **oda geliridir** (eldeki rezervasyon); F&B, minibar, iptal /
> gelmedi ücreti folyo gelince (modül 15) eklenir. Vergi oranı güncel ayardan
> okunur (geçmiş günde oran değişmişse küçük fark; gece bazında vergi folyoda).
>
> **Dünle kıyas ve kalan oda:** doluluk ve gelir dün geceyle (gerçekleşen)
> kıyaslanır. "Kalan" = satılabilir − satılan; **fazla satışta negatif** (gizlenmez,
> ekranda uyarı; grafik ekseni %100'ün üstüne açılır). Oda tipine göre kırılım
> modül 3'ün müsaitlik takviminden (rezervasyon ekranının "yer var mı" cevabı).
> Bu gece konaklayan kişi sayısı pansiyona göre (kahvaltı / mutfak planı).
> Dünden kalan gelecekler (girişi geçmiş, gelmemiş — gelmedi adayı) ayrıca sayılır.
>
> **Anlık oda durumu:** dolu / boş / kirli / temizleniyor / temiz / kontrol
> edildi, "hazır boş oda" (boş, temiz ya da kontrol edilmiş, bugün arıza kaydı
> yok) ve bunlardan **bu gece kimseye verilmemiş** olanlar tek SQL sayımında;
> odası verilmemiş gelecek sayısı bundan fazlaysa kat hizmeti kartı uyarır. Açık
> arızalar: bugün süren arıza / hizmet dışı kayıtları (en eski 10'u + toplam).
>
> **Gözden geçirmede bulunan hata (modül 6'yı da etkiliyordu):** rezervasyon
> tarihleri saat taşıyabilir (veritabanı kısıtları `date_trunc` ile gün
> karşılaştırır; demo verisi 11:00). Ön büro "bugün gelecekler / gidecekler" ve
> özeti gece yarısıyla karşılaştırıyordu: bugün 11:00'de gelecek misafir listede
> yoktu, bugün 11:00'de çıkacak olan gidecekler listesinde yoktu. Karşılaştırmalar
> gün düzeyine çevrildi (`stayCoversNight`: girişi yarından önce, çıkışı yarın ya
> da sonra; index'ten okunur). **Yeni sorgu yazan:** rezervasyon tarihini gece
> yarısıyla `<=` / `>` karşılaştırmayın; gün sınırıyla yazın.
>
> **API:** `GET /dashboard/today`, `GET /dashboard/week?from=YYYY-MM-DD` (7 gün;
> iş gününden en çok 366 gün uzak, aşarsa 422). Cevaplar otel × canlı sürüm
> (envanter + rezervasyon) × iş günü anahtarıyla önbellekli: rezervasyon, giriş /
> çıkış, oda durumu, arıza olayı gelince tazelenir; aynı anda gelen istekler tek
> hesaplamayı bekler. Ekran `inventory.changed` kanalını dinler (en sık 15 sn'de
> bir tazelenir; kopukken 5 dk'da bir).
>
> **Ekran:** 6 kart (doluluk + dünle kıyas + kalan, gelecekler + dünden kalanlar,
> gidecekler, odalar, kat hizmeti ve arıza, oda geliri + ADR + RevPAR) ilgili
> ekrana bağlanır; oda tipine göre bu gece, bu gece konaklayanlar (pansiyon). Haftalık doluluk: bugünden 3
> gün önce + 3 gün sonra, tek çizgi (dün gerçekleşen, yarın eldeki), "Bugün"
> işaretli, üzerine gelince / klavyeyle gün ayrıntısı (gelir, ADR, opsiyonlu,
> arızalı), erişilebilir **tablo görünümü**. Bekleyen işler: onaylar
> (`/approvals/summary`), manuel görevler (`/manual-tasks/summary`, kişinin
> kapsamıyla), cevap bekleyen mesajlar, açık / geciken misafir istekleri (her
> biri kendi izniyle), açık arızalar. Bugünün gelecek / gidecek ilk 5'i ön büroya
> bağlantılı (`stays.view` gerekir).
>
> **Modül 23 / 25'e not:** gelir ve doluluk için aynı iki kaynağı kullanın
> (`summarizeDays` + gece geliri sorgusu, `modules/dashboard/service.js`);
> forecast (25) haftalık serinin ileri günlerini zaten "eldeki rezervasyon"
> olarak veriyor. Gece kapanışı (18) gelince iş günü `getBusinessDate`'ten döner;
> ekran kendiliğinden uyar.

---

## 2. ÖN BÜRO (operasyon + para)

### 14. Housekeeping / kat hizmetleri — Ali Kemal
**Gün sonu:** Check-out olan oda otomatik temizlik listesine düşüyor, kat görevlisine atanıyor, telefondan "temizledim" deyince oda tekrar satılabilir oluyor.
- [x] Backend: HousekeepingTask CRUD, atama, tamamlama, inspection API'leri
- [x] Backend: her sabah konaklayan odalar için STAYOVER görevi üreten zamanlayıcı
- [x] Ekran: Günlük temizlik listesi (oda, tip, öncelik, atanan, durum)
- [x] Ekran: Toplu atama (kat görevlisi seç, odaları işaretle)
- [x] Ekran: Mobil görünüm (büyük butonlar: Başladım / Bitti / Sorun var)
- [x] Ekran: Kat şefi kontrol ekranı (temizlenen odayı onayla → CLEAN → INSPECTED)
- [x] Ekran: Oda durum haritası (kat kat, renkli kutular)
- [x] Aktör: housekeeping-worker paketi (`guest.checked_out` → CHECKOUT_CLEAN görevi; `housekeeping.task.completed` → kat hizmeti CLEANING→CLEAN)

> **Modül 14 kararları (28 Ekim 2026 — Ali Kemal):**
>
> - **Görev odayı yazmaz.** Görev kaydı (`HousekeepingTask`) olay yayınlar
>   (`housekeeping.task.started/completed`, `housekeeping.room.inspected`);
>   odanın kat hizmeti durumunu **housekeeping-worker** `applySystemRoomState`
>   ile günceller. Aktör kapalıyken iş manuel göreve düşer — modül 3'ün "tek
>   yazıcı" kuralı bozulmaz.
> - Görev tipleri: `CHECKOUT_CLEAN` (çıkış, öncelik 2), `STAYOVER` (sabah
>   zamanlayıcısı, her 10 dk idempotent koşar; bugün çıkacak oda almaz),
>   `DEEP_CLEAN` (arıza kaydı kapanınca — `room.unblocked ENDED` — ve elle),
>   `GUEST_REQUEST` (modül 7'nin `HOUSEKEEPING`/`AMENITY` isteğinden; görev
>   bitince istek `changeRequestStatus` ile kapanır, elle açılamaz).
> - **Oda başına tek açık temizlik görevi** — kısmi tekil index + servis
>   tekilleştirmesi (`createSystemCleaningTask` "zaten var" döndürür, hata
>   değil). Misafir isteği görevleri muaf (havlu + temizlik aynı anda olur).
> - **Dört göz:** temizliği yapan kendi işini onaylayamaz
>   (`housekeepingInspectionError`, contracts). Ret → oda yeniden `DIRTY` +
>   aynı işlemde öncelikli düzeltme görevi (ret sebebi görev notunda).
> - "Sorun var" arıza kaydı **açmaz** (modül 3'ün notuna uygun):
>   `housekeeping.issue.reported` → `rooms.operate` yetkilisine manuel görev
>   (`'Teknik servis'` modülü). Modül 20 gelince dinleyici MaintenanceTicket
>   açacak; olay sözleşmesi değişmez.
> - İzinler: `housekeeping.view` (resepsiyon da görür) / `operate` (görevli) /
>   `manage` (şef: aç, ata, iptal) / `inspect` (kontrol). HOUSEKEEPING rolünde
>   dördü de varsayılan açık; otel isterse rol matrisinden ayırır.
> - Liste "bugün" görünümünde önceki günlerden **açık** kalan görevleri de
>   gösterir (`carriedOver` rozeti) — devreden iş kaybolmaz.
> - Canlı yayın: `housekeeping.changed` kanalı; toplu işler tek event yayınlar
>   (`housekeeping.tasks.assigned/generated`) — 2500 odada görev başına event
>   defteri ve socket'i boğardı.
>
> **Modül 14 — canlıya almadan önce düzeltmeler (2 Kasım 2026 — Ahmet, kullanıcı kararıyla; modül 49 ile birlikte
> canlıya çıktı):** inceleme dört sorun buldu, hepsi testli düzeltildi.
>
> - **Oteller arası sızıntı:** `floorMap` odaları `hotelId` olmadan çekiyordu (`prisma` istemcisi yalnız silinmişleri
>   süzer, oteli süzmez) — harita bütün otellerin odalarını gösteriyordu. `where: { hotelId }` + çok otelli test.
> - **Büyük otelde kaybolan görevler:** "Görevlerim" ve "Kontrol" günün ilk 100 görevini çekip tarayıcıda
>   süzüyordu; yüzlerce görevli günde görevlinin kendi işi / kontrol bekleyen oda görünmüyordu. Liste sorgusuna
>   sunucu süzgeçleri eklendi: `openOnly`, `unassigned`, `awaitingInspection` (çelişen süzgeç şemada reddedilir);
>   ekranlar bunları kullanıyor, sayaçlar `meta.total`'dan.
> - **Hata durumu:** harita, Görevlerim ve Kontrol sekmelerinde istek hatası "oda yok" / "görev yok" diye
>   görünüyordu; `QueryFallback` (yükleniyor / hata + tekrar dene) eklendi.
> - **Erken çıkış:** sabahki konaklama temizliği açıkken misafir çıkınca çıkış temizliği açılmıyordu ("zaten var");
>   açık STAYOVER artık CHECKOUT_CLEAN'e yükseliyor (öncelik ≤ 2, denetim izi, `housekeeping.task.changed`).
>   Haritada odada hem temizlik hem misafir isteği görevi açıksa kutu temizliği gösteriyor.

> **Modül 3'ten not (16 Eylül 2026 — Ahmet):** "AVAILABLE" diye bir durum artık yok —
> oda durumu üç bağımsız parça (bkz. modül 3 notu). Senin alanın yalnızca **kat hizmeti**:
>
> - Değerler: `DIRTY` → `CLEANING` → `CLEAN` → `INSPECTED`. Tek kural: `INSPECTED`
>   yalnızca `CLEAN`'den gelir (`housekeepingTransitionError`, contracts).
>   Görevli "Başladım" → CLEANING, "Bitti" → CLEAN, kat şefi onayı → INSPECTED.
> - Personel işlemi: `PATCH /rooms/:id/housekeeping` (`status`, `expectedUpdatedAt`) —
>   sürüm çakışmasında 409 `STALE_WRITE`. Aktör/zamanlayıcı işlemi:
>   `applySystemRoomState(hotelId, roomId, { housekeepingStatus }, gerekçe)`.
> - Her değişiklik `room.status.changed` yayınlar (`field: 'housekeeping'`); kat
>   haritası buna abone olup canlı güncellenebilir.
> - Checkout sonrası oda **zaten kirli** geliyor (room-worker); görevi o event'ten üret,
>   durumu ikinci kez yazma. Arızalı oda (OOO) bitince de oda kirliye düşer → görev üret.
> - Oda ataması, **bugün girecek** misafir için temiz/kontrol edilmiş odayı öne alıyor;
>   yani kat hizmetinin zamanında işaretlenmesi doğrudan atama kalitesini etkiler.
> - Sorun var → teknik servis (modül 20): arıza kaydını `blockRoom` açar, bu modül açmaz.
>
> **Modül 7'den ek (17 Eylül 2026):** misafir istekleri `HOUSEKEEPING` ve `AMENITY`
> kategorisinde `guest.request.created` yayınlıyor (`requestId, category, priority,
> roomId`). Kat görevi üreteceksen bu event'i dinle ve görevi isteğe bağla; görev
> bitince isteği `changeRequestStatus(hotelId, requestId, { status: 'DONE', note,
> expectedUpdatedAt })` ile kapat — istek ekranı misafirin gözünden takip olarak kalır.

### 15. Folyo yönetimi — arkadaşın
**Gün sonu:** Her konaklamanın hesabı tek ekranda: oda ücreti, restoran, minibar kalemleri; bölme, birleştirme, transfer yapılabiliyor.
- [x] Backend: Folio / FolioItem API'leri (aç, kalem ekle, kalem iptal, kapat)
- [x] Backend: `splitFolio`, `mergeFolios`, `transferItem` servisleri
- [x] Backend: bakiye hesabı (kalemler − ödemeler), vergi dahil/hariç
- [x] Ekran: Folyo detayı (kalem tablosu, toplam, ödenen, bakiye)
- [x] Ekran: Harcama ekle formu (tip, açıklama, tutar, adet, vergi)
- [x] Ekran: Bölme (kalemleri iki folyoya dağıt), birleştirme (grup), transfer
- [x] Ekran: Kalem iptali → onay kuyruğuna gider
- [x] Aktör: billing-worker paketi (`guest.checked_in` → folyo aç; gece → oda ücreti kalemi; `fnb.order.charged` / `minibar.consumed` → kalem; `guest.checked_out` → bakiye kontrolü)

> **📌 Modül 15 tamamlandı (30 Eylül 2026 — Ahmet).**
>
> **Veri** (migration `20260930090000_folio_management`):
> - `Folio`: konaklamadaki **pencere** (`window`, 1 ana folyo; bölmeyle 2, 3… en çok 8,
>   konaklamada tekil), ödeyen adı (`payerName`: şirket / acente — faturanın alıcı
>   varsayılanı), denormalize **borç / ödenen / bakiye** (kısıt: bakiye = borç − ödenen),
>   açan / kapatan, birleştirme izi (`mergedIntoId`, durum `TRANSFERRED`).
> - `FolioItem`: doğduğu konaklama (`reservationId`, aktarmada değişmez), **hizmet günü**
>   (oda ücretinde gece), **kaynak** (`FolioItemSource`: elle, gece, erken giriş, geç çıkış,
>   iptal, gelmedi, restoran, minibar, iptal kaydı), vergi kategorisi ve **işlendiği andaki
>   vergi dökümü** (`taxLines`), satır net + vergi = toplam (kısıt), **tekrar işleme
>   anahtarı** (`sourceKey`, otel başına tekil), iptal (ters kayıt `reversalOfId` tekil +
>   `voidedAt/By/Reason`), bekleyen iptal onayı, son aktarma izi. `taxId` kolonu kalktı
>   (vergi kalemin dökümünde; vergi silinse de geçmiş bozulmaz — silme engeli kaldırıldı).
> - Yeni: `FolioRoute` (konaklama × tip → folyo), `RoomChargeRun` (otel × gece tekil).
> - Zil: `FOLIO_ATTENTION`. Eski satırlar (yalnızca demo seed'inden) silinmedi, dolduruldu.
>
> **Para kuralları:**
> - **Satır:** brüt = birim × adet (dahil vergiler içinde); net = brüt ÷ (1 + Σ dahil oran),
>   dahil vergilerin toplamı brüt − net (kuruş kaybolmaz); hariç her vergi net × oran;
>   toplam = brüt + hariç vergiler. Rezervasyon ekranının dökümüyle aynı formül, **satır
>   bazında** yuvarlanır (çok gecede toplamla kuruş farkı olabilir). Vergi kalemin
>   kategorisine göre (ayarlardaki "uygulandığı kalem"); indirim seçilen gelirin vergisini düşürür.
> - **Bakiye** = Σ kalem toplamı − Σ (ödeme × kur, ödeme başına kuruşa yuvarlanır).
>   Denormalize toplamlar folyo kilitliyken kalemlerden yeniden hesaplanır
>   (`refreshFolioTotals`); çıkış yine kalemlerden hesaplar.
> - **Kalem silinmez:** iptal eksi tutarlı ters kayıttır (asıl kalem "iptal edildi"),
>   iptal günü tarihli (kapanmış günün geliri geriye dönmez). Elle iptal **onay kuyruğuna**
>   gider (`FOLIO_VOID`); **isteyen onaylayamaz** (dört göz — kasa açığına karşı),
>   reddederek geri çekebilir. Onaylanınca ters kayıt onaylayan adına işlenir.
> - **Gece oda ücreti:** gün dönünce (iş günü ilerleyince) zamanlayıcı otel başına bir
>   kez `folio.room_charges.due` yayınlar; folyo aktörü içerideki bütün konaklamaların o
>   geceye kadar eksik gecelerini işler (100'lük parçalar, her parça ayrı transaction,
>   yarıda kalan çalışma kaldığı yerden devam eder). **Uzlaştırma:** işlenmemiş gece
>   işlenir; fiyatı sonradan değişen gece için fark kalemi (artıysa oda, eksiyse oda
>   gelirinden indirim); konaklamadan çıkan işlenmiş gece sıfırlanır; **iptal edilmiş
>   (ikram) geceye dokunulmaz**. Anahtar `night:<konaklama>:<gün>[:<sıra>]`: iki çalışma
>   aynı anda koşsa da çift kalem yazılmaz (test edildi). Sunucu kapalıyken geçen geceler
>   ilk çalışmada telafi edilir.
> - **Yönlendirme:** sistem kalemleri (gece, ücretler, restoran, minibar) konaklamanın
>   tip → folyo yönlendirmesine, yoksa ilk açık folyosuna düşer; açık folyosu yoksa yeni
>   pencere açılır. Elle harcama seçili folyoya gider.
> - **Tek seferlik ücretler** (erken giriş, geç çıkış, iptal, gelmedi) konaklama başına bir
>   kez etkin: giriş geri alınıp yeniden yapılsa da ikinci ücret çıkmaz; geri alınınca ücret
>   ters kayıtla düşer (yalnızca geri almadan **önce** işlenen). Erken / geç ücret "Oda"
>   vergisiyle, iptal / gelmedi ücreti **"Diğer"** vergisiyle (otel ayarlar).
> - **Kapatma:** bakiye sıfır, bekleyen iptal yok, içerideki misafirin **son açık
>   folyosu değil** (önce yapısal engel söylenir). Kapanan folyoya yönlenen tipler serbest
>   kalır. Yeniden açma yetkiyle, gerekçeli.
> - **Birleştirme (grup hesabı):** kaynakların bütün kalem ve **ödemeleri** hedefe taşınır,
>   kaynak `TRANSFERRED`; kaynak konaklamada o folyoya düşen tipler hedefe yönlenir (diğer
>   pencerelere düşenler olduğu gibi). Geri alınmaz (kalemler aktarılarak ayrılır).
>
> **Kilit sırası:** rezervasyon → (oda tipi) → folyo; folyolar id sırasıyla tek seferde.
> Yeni pencere açabilen her işlem rezervasyonu kilitler; hedef kilit altında yeniden
> okunur (bu arada kapanan folyoya kalem düşmez). Aynı folyoya eşzamanlı 10 harcama:
> toplamlar tutarlı (test edildi).
>
> **Olaylar** (`folios.changed` kanalı; gövdede tutar / açıklama yok): `folio.opened`,
> `.updated`, `.charge.posted`, `.room_charges.due` (iç tetikleyici), `.room_charges.posted`
> (gece başına tek özet — 2500 socket haberi değil), `.item.void_requested`, `.item.voided`,
> `.item.void_declined`, `.items.transferred`, `.split`, `.merged`, `.routes.changed`,
> **`folio.closed`** (fatura), `.reopened`. Dış kaynak sözleşmeleri: `fnb.order.charged`,
> `minibar.consumed` (konaklama ya da oda + kalemler; odada misafir yoksa iş personele düşer).
>
> **API** (`/folios`): liste (`view`: içeridekiler / açık bakiye / bütün açıklar / kapananlar;
> arama: misafir, onay kodu, oda no, ödeyen; sayfalı, sayım 2000'de kesilir), `GET /room-charges`
> (son çalışma, eksik gece), `POST /room-charges/run`, `POST /charges/preview`,
> `GET|POST /stays/:reservationId` (folyolar + yönlendirme + eksik oda ücreti / folyo aç),
> `PUT /stays/:id/routes`, `POST /stays/:id/room-charges`, `GET /:folioId` (toplamlar, vergi
> özeti), `GET /:folioId/items` (hizmet günü + işlenme sırası, imleçli), `GET /:folioId/payments`,
> `PATCH /:folioId` (ödeyen), `POST /:folioId/charges` (201 / aynı istek 200),
> `POST /:folioId/items/:itemId/void` (202, onaya), `/transfer`, `/split`, `/merge`, `/close`,
> `/reopen`. İzinler: `folio.view` (kat hizmetleri görmez), `folio.post` (resepsiyon, müdür,
> muhasebe), `folio.adjust` (indirim, yeniden açma — müdür, muhasebe).
>
> **Aktör (`@hotelos/billing-worker`):** giriş → folyo + erken giriş ücreti; çıkış → kalan
> geceler + geç çıkış ücreti, bakiyesi sıfır olan folyo kapanır (`folio.closed`), bakiye
> kalırsa (bakiyeyle çıkış değilse) folyo yetkilisine zil; giriş / çıkış geri alma → ücret
> düşer, folyo yeniden açılır; iptal / gelmedi → ücret, geri alınırsa düşer; gece → oda
> ücretleri; restoran / minibar → kalem. Kapalıyken iş "Folyo" modülünün manuel görevine
> düşer; personel aynı işi folyo ekranından yapar (aynı anahtar: sonradan ikinci kez yazılmaz).
>
> **Ekranlar:** `/folyolar` (görünümler, arama, gece oda ücreti şeridi + "Oda ücretlerini
> işle"), `/folyolar/:reservationId` (pencere sekmeleri, yönlendirme satırı, toplamlar,
> vergi özeti, döküm: seçim, iptal edilen üstü çizili + iptal kaydı, aktarma / kaynak izi,
> bekleyen iptal rozeti, "daha fazla"; ödemeler; harcama ekle (sunucudan canlı vergi
> önizlemesi, hazır açıklamalar, çift gönderim korumalı), iptal iste, aktar (aynı konaklama
> ya da arama ile başka konaklama), böl (ödeyen + yönlendirme), birleştir (çoklu arama),
> yönlendirme, ödeyen, kapat, yeniden aç). Rezervasyon detayında folyo kartı, çıkış
> penceresinde "işlenecek" satırları ve "Folyoyu aç", ön büro listelerinde bakiye → folyo,
> oda planı çekmecesinde toplam bakiye (bütün pencereler) + bağlantı. Onaylarda kendi
> isteğinin "Onayla" düğmesi kapalı (sebebi yazılı).
>
> **Modül 6'da değişen (çıkış):** ödenecek = folyo bakiyesi + **çıkışta işlenecekler**
> (kalan geceler, geç çıkış ücreti — vergileriyle, `pendingStayCharges`); yönlendirmeyle
> başka konaklamanın folyosuna düşecek tutar misafirin borcu değildir. **Folyo yoksa bakiye
> artık "bilinmiyor" değil sıfırdır** (işlenmiş kalem de ödeme de yok): gece ücretleri
> ödenecek sayılır. Çıkış bakiyeyi folyolar kilitliyken okur. Erken giriş ücreti girişin geri
> alınmasını engellemez. Oda planı çekmecesi artık yalnız son folyonun değil bütün
> pencerelerin bakiyesini gösteriyordu (hata düzeltildi).
>
> **2500 kişi için:** gece çalışması parça parça, tek özet olay; kalem sorgusu
> `(folioId, serviceDate, postedAt, id)` index'iyle imleçli; uzlaştırma
> `(reservationId, source, serviceDate)` index'iyle; liste `(hotelId, status, updatedAt|closedAt, id)`
> index'leri ve denormalize bakiye; çıkış yalnızca o konaklamanın folyolarını kilitler.
> Test: kurallar 22 + sözleşme 13 + aktör 14 birim; 18 folyo + güncellenen ön büro / plan /
> aktör entegrasyon testi (tüm entegrasyon 359/359).
>
> **⚠️ Canlıya alırken:** 15 canlıya çıkınca oda ücretleri folyoya işlenir ve çıkış bakiyenin
> kapanmasını ister; **ödeme girişi modül 17'de**. 17 gelene kadar çıkış ancak
> `stays.checkout_open_balance` yetkisiyle, gerekçeli yapılır — 15 ve 17'yi birlikte almak
> önerilir. Canlıdaki demo verisinde seed'in eski "toplu oda ücreti" folyoları var; gece
> çalışması geceleri ayrıca işler (çift sayım) — canlıya alırken demo folyoları temizlenmeli
> (yedekle, onayla).
>
> **Devir:**
> - **Modül 16 (fatura):** `folio.closed`'u dinle; satırlar kalemlerden (`taxLines` işlendiği
>   andaki döküm; `netAmount` / `taxAmount`), alıcı varsayılanı `payerName` yoksa misafir.
>   Faturası kesilmiş folyoyu `reopenFolio` / `reopenStayOnCheckOutRevert` içinde durdur.
> - **Modül 17 (ödeme):** `Payment` yazarken folyoyu kilitle (`lockFolios`) ve
>   `refreshFolioTotals` çağır; ödeme folyo para birimine çevrilmiş tutarla bakiyeye girer.
>   Çıkmış konaklamanın folyosu ödemeyle sıfırlanınca kapatma (`closeFolio` kuralları) sende.
>   Girişteki nakit / havale teminatı ödeme olarak (provizyon değil) burada işlenmeli
>   (`guest.checked_in.deposit`). İade ve büyük ödeme onayı: `requestApproval` (bkz. modül 11).
>   Çıkış penceresindeki "bakiye var" uyarısına ödeme ekranı bağlantısı.
> - **Modül 18 (gece kapanışı):** oda ücreti hazır: `runRoomCharges(hotelId, { night })`
>   (günü kapatmadan önce o geceyi işlemek için) — zamanlayıcı `getBusinessDate`'i izler,
>   audit iş gününü değiştirince kendiliğinden uyar.
> - **Modül 19 / 39 / 41 (minibar, restoran, oda servisi):** `minibar.consumed` /
>   `fnb.order.charged` yayınla (katalogdaki şema); kalem otelin vergi ayarıyla işlenir,
>   yönlendirmeye uyar, aynı olay ikinci kez gelse de tek yazılır.

### 16. Fatura kesme — Ali Kemal
**Gün sonu:** Kapanan folyodan tek tıkla fatura üretiliyor, PDF alınıyor, numara serisi düzgün ilerliyor.
- [x] Backend: Invoice / InvoiceLine tabloları, numara serisi (yıl-sıra), `createInvoiceFromFolio`, `cancelInvoice`
- [x] Backend: PDF üretimi (şablon: otel logosu, alıcı, kalemler, vergi dökümü)
- [x] Ekran: Faturalandırılacak folyolar listesi
- [x] Ekran: Fatura oluştur formu (alıcı tipi: kişi/şirket, vergi no, adres; kalem önizleme)
- [x] Ekran: Fatura listesi (numara, tarih, tutar, durum) + PDF indir
- [x] Ekran: İptal → onay kuyruğu
- [x] Aktör: billing-worker'a `folio.closed` → fatura taslağı kuralı

> **📌 Modül 16'nın çekirdeği modül 49 içinde kuruldu (2 Kasım 2026 — Ahmet, kullanıcı kararı):** e-Fatura / e-Arşiv faturanın
> üzerinde durduğu için fatura (tablolar, numara, kesim, PDF, iptal, ekranlar, folyo aktörü) 49 ile birlikte yazıldı. Ayrıntı ve
> genişletme noktaları aşağıda **49**'da; bu modülde kalan iş yok, 16'ya eklenecek her şey 49'un yapısını kullanmalı.

### 17. Ödeme alma — arkadaşın
**Gün sonu:** Resepsiyon nakit/kart/havale/döviz tahsilat giriyor; büyük tutarlar onaya düşüyor; kasa durumu anlık görünüyor.
- [x] Backend: Payment API (al, iade et, listele); ExchangeRate tablosu + günlük kur girişi
- [x] Backend: tutar eşiği parametresi; eşik üstü → `approval.requested`
- [x] Ekran: Ödeme al formu (folyo, yöntem, tutar, para birimi, kur, referans)
- [x] Ekran: Ön ödeme / depozito (rezervasyona bağlı)
- [x] Ekran: İade formu → onay kuyruğu
- [x] Ekran: Kasa görünümü (bugün yöntem bazında toplamlar)
- [x] Aktör: billing-worker'a `payment.received` → folyo bakiyesi güncelle kuralı

> **📌 Modül 17 tamamlandı (3 Ekim 2026 — Ahmet).**
>
> **Veri** (migration `20261003090000_payments`):
> - `Payment` genişledi: **tür** (`PAYMENT` tahsilat artı, `REFUND` iade eksi, `REVERSAL` iptal kaydı =
>   asıl satırın tersi), **durum** (`PENDING` onay bekliyor / `POSTED` işlendi / `DECLINED` işlenmedi),
>   **kaynak** (`DESK` resepsiyon, `ADVANCE` gelmeden önce ön ödeme, `CHECK_IN_DEPOSIT` giriş teminatı),
>   doğduğu konaklama (`reservationId`, birleştirmede değişmez), **folyoya giren tutar**
>   (`folioAmount` = ROUND(tutar × kur, 2) — kısıt), **kasanın günü** (`businessDate`), işlenme anı
>   (`postedAt`), tekrar işleme anahtarı (`sourceKey`, otel başına tekil), not, iptal izi
>   (`reversalOfId` tekil, `voidedAt/By/Reason`, bekleyen iptal onayı). Kısıtlar: işaret türe uyar,
>   onaysız iade ve onaysız bekleyen satır olamaz, durum izleri eksiksiz.
> - Yeni `ExchangeRate` (otel × döviz × gün tekil; 1 birim döviz = kur × otel parası).
> - Otel: `largePaymentThreshold` (0 = onay yok; ayarlar → Genel parametreler → Ödeme onayı).
> - Eski satırlar (yalnızca test verisi) silinmedi, dolduruldu.
>
> **Para kuralları:**
> - **Bakiye** = Σ kalem − Σ işlenmiş ödemenin `folioAmount`'u (onay bekleyen ve reddedilen sayılmaz).
>   `refreshFolioTotals` ve çıkışın `stayBalances`'ı buna göre güncellendi. Ödeme yazan her işlem folyoyu
>   kilitler, toplamları aynı transaction'da yeniler.
> - **Ödeme silinmez:** hatalı giriş "ödeme iptali" (onaylı, ters tutarlı iptal kaydı; kasa etkisi parayı
>   alanın kasasına yazılır), misafire geri verilen para **iade** (her zaman onaylı). İade sınırı: folyonun
>   işlenmiş net ödemesi − bekleyen iadeler (alınmamış para iade edilmez). İadesi yapılmış paranın
>   ödemesi iptal edilemez (iade karşılıksız kalırdı).
> - **Büyük ödeme:** folyo tutarı eşiğe eşit ya da büyükse satır "onay bekliyor" yazılır (`LARGE_PAYMENT`),
>   **onaylanana kadar bakiyeye ve kasaya girmez**; reddedilir / süresi dolarsa hiç işlenmez. Kullanıcının
>   kararı (3 Ekim 2026): "onaylanana kadar bekler". Onaylanınca kasanın günü onay günüdür.
> - **Dört göz:** `LARGE_PAYMENT`, `REFUND`, yeni `PAYMENT_VOID` türlerinde isteyen kendi isteğini
>   onaylayamaz (reddedebilir) — `FOLIO_VOID` ile aynı kural.
> - **Döviz:** yalnızca nakit ve havaleyle (kart folyonun parasıyla). Kur formda yazılmaz: iş gününe kadar
>   girilmiş en son kur, en fazla 3 gün eski (`EXCHANGE_RATE_STALE_DAYS`). Form gördüğü kuru gönderir;
>   değiştiyse yazılmaz (`RATE_CHANGED`). Ödeme kendi kurunu saklar. Kur yalnızca iş günü için girilir.
> - **Referans:** nakit dışı yöntemlerde zorunlu (slip / dekont / voucher / cari); kart numarasına benzeyen
>   dizi referansa ve nota yazılamaz.
> - **Birden fazla açık folyo:** konaklamaya ödeme folyo seçilmeden alınmaz (`FOLIO_REQUIRED`): tahmin
>   edilirse toplam sıfırlanır ama pencereler ters bakiyeyle açık kalır. Giriş teminatı ana pencereye düşer.
> - **Kapatma:** onay bekleyen ödeme / iade ya da ödeme iptali olan folyo kapanmaz (elle de, çıkışta da).
>
> **Giriş teminatı:** girişteki nakit / havale teminatı folyo aktörüyle ödeme olur (`CHECK_IN_DEPOSIT`,
> anahtar konaklama + giriş anı: bir kez; alan = girişi yapan; eşik üstüyse onaya gider). Kart provizyonu
> ödeme değildir. Giriş geri alınınca teminat ödemesi iptal kaydıyla düşer (onay bekleyenin isteği geri
> çekilir). **Modül 6'da değişen:** girişin geri alınmasını yalnızca resepsiyonda alınan ödeme engeller;
> ön ödeme ve giriş teminatı engellemez.
>
> **Olaylar** (`folios.changed` + yeni `cash.changed` kanalı): `payment.requested`, `.received`,
> `.refunded`, `.declined`, `.void_requested`, `.voided`, `.void_declined` (bakiye değiştirenlerde
> `stayEnded`), `exchange_rate.updated`.
>
> **API:** `POST /payments/quote` (kur, folyo tutarı, onaya gider mi), `POST /payments/folios/:folioId`
> (201 işlendi / 202 onayda / 200 aynı istek), `POST /payments/stays/:reservationId` (ön ödeme; folyo yoksa
> açılır), `POST /payments/stays/:reservationId/deposit` (teminatı elle işle), `POST /payments/folios/:folioId/refunds`
> (202), `POST /payments/:paymentId/void` (202), `GET /payments/cash/summary`, `GET /payments/cash/movements`
> (imleçli), `GET /folios/:folioId/payments` (imleçli; iade sınırı, bekleyen sayısı), `GET /exchange-rates/current`,
> `/history`, `PUT /exchange-rates/today`. İzinler: `payment.receive` (resepsiyon, müdür, muhasebe),
> `payment.refund` (aynı roller; onaylayamaz), `cash.view` (aynı roller), `exchange_rates.manage` (müdür, muhasebe).
>
> **Aktör (billing-worker):** giriş → teminat ödemesi; giriş geri alma → teminat iptali; `payment.received` /
> `.refunded` / `.voided` → konaklaması bitmiş (çıkmış, iptal, gelmedi) folyonun bakiyesi sıfırlandıysa
> **folyoyu kapatır** (`folio.closed` → fatura). Bakiye ödemeyle aynı transaction'da güncellenir; aktör
> yalnızca kapanışı yapar. İçerideki misafirin ödemeleri aktörü ilgilendirmez (`accepts`: kapalıyken de görev açılmaz).
>
> **Ekranlar:** folyoda "Ödeme al" / "İade" (canlı kur ve onay önizlemesi, çift gönderim korumalı), ödeme
> listesi (tür, durum, kaynak, döviz × kur, iptal edilen üstü çizili, "İptal iste", daha fazla), teminat şeridi
> ("Teminatı işle" / provizyon hatırlatması); rezervasyon kartında "Ön ödeme al"; çıkış penceresinde bakiye
> varken "Ödeme al" (tek açık folyoda; çok pencerede folyo ekranına yönlendirir) ve onay bekleyen ödeme satırı;
> **Kasa** (`/kasa/gun`: gün seçimi, "yalnızca benim", yöntem × döviz tahsilat / iade / iptal / net, onay
> bekleyenler, hareket listesi süzgeçli, canlı) ve **Döviz kurları** (`/kasa/kurlar`: güncel kurlar, günün
> girişi, geçmiş); ayarlarda eşik; giriş geri alma penceresinde teminat notu.
>
> **Modül 15'ten düzeltilen:** olay kataloğu `staff.alert.raised` türü `FOLIO_ATTENTION`'ı tanımıyordu —
> çıkıştan sonra kapanmayan folyo uyarısı atılamıyor, aktörün işi geri dönüyordu (canlıda da). Katalog ↔
> sözleşme eşitliğine birim testi eklendi. Çıkış sonrası uyarı artık pencere başına bakiyeyi yazıyor
> (toplam sıfır ama pencereler dengesizse ne yapılacağını söylüyor).
>
> **2500 kişi için:** kasa toplamı tek GROUP BY (`(hotelId, businessDate, postedAt, id)` index'i), hareketler
> imleçli, bekleyenler `(hotelId, status, receivedAt)`, folyo ödemeleri `(folioId, receivedAt, id)`, teminat
> `(reservationId, source)`, kur `DISTINCT ON` tekil index'le. Test: sözleşme 14 + kurallar 13 + aktör 6 birim;
> ödeme entegrasyonu 18 (eşzamanlı 10 ödeme, aynı isteğin eşzamanlı iki gönderimi, otel sınırı dahil).
>
> **⚠️ Canlıya alırken:** eşik varsayılanı 0 (onay yok) — ayarlardan girilmeli. Kurlar personelce girilir.
> Modül 15'in demo folyo temizliği hâlâ bekliyor (temizlik SQL'i artık `folioAmount` / `POSTED` ile).
>
> **Devir:**
> - **Modül 16 (fatura):** `folio.closed` artık ödemeyle sıfırlanan bitmiş konaklamada da gelir (aktör).
> - **Modül 18 (gece kapanışı):** kasa sayımı `getCashSummary(hotelId, { date })` (yöntem × döviz; nakit
>   dövizi kendi para biriminde say), kişi bazında `receivedBy` (çekmece sahibi; iptal kaydı da asıl alanın).
>   Kasanın günü işlendiği iş günüdür; gün kapanırken **onay bekleyen ödemeler** (para çekmecede, defterde
>   değil) ayrıca raporlanmalı ya da kapanış onları bekletmeli. Kurlar gece kapanışında girilebilir (`setTodayRates`).
> - **Modül 50 (sanal POS):** `VIRTUAL_POS` yöntemi ve işlem no referansı hazır; ödeme `receivePayment` ile.

### 18. Vardiya / kasa kapama (night audit) — Ali Kemal
**Gün sonu:** Gece görevlisi sihirbazı adım adım geçip günü kapatıyor; oda ücretleri işleniyor, no-show'lar düşülüyor, kasa farkı raporlanıyor.
- [ ] Backend: NightAudit, ShiftReport tabloları; `startNightAudit`, `closeDay` servisleri
- [ ] Backend: gelmeyen rezervasyonları NO_SHOW yapma, tüm dolu odalara oda ücreti basma
- [ ] Backend: günlük özet (gelir, doluluk, tahsilat) DailyStats tablosuna yazılır
- [ ] Ekran: Night audit sihirbazı (1. gelmeyenler → 2. oda ücretleri → 3. kasa sayımı → 4. fark → 5. kapat)
- [ ] Ekran: Vardiya devir formu (kasa sayımı, not) + devir raporu PDF
- [ ] Ekran: Kapanış geçmişi
- [ ] Aktör: billing-worker'a `night.audit.started` kuralı

> **Modül 3'ten not (16 Eylül 2026 — Ahmet):**
>
> - **İş günü:** şu an `lib/business-date.js` → `getBusinessDate(hotelId)` otelin
>   saat dilimindeki takvim gününü döndürüyor. Night audit gelince "gün, audit
>   kapanana kadar değişmez" kuralı **yalnızca bu fonksiyonun içine** yazılır
>   (ör. son kapanan günün ertesi). Oda listesi, arıza kayıtları, atama, geçmiş
>   tarih doğrulaması hepsi zaten bu fonksiyonu kullanıyor — başka yere dokunma.
> - **Konaklayan odalar:** gün kapanışında dolu (`occupancy = OCCUPIED`) odaların
>   kat hizmeti `DIRTY` yapılır (stayover temizliği; modül 14'ün STAYOVER görevleri
>   de buradan beslenir) → `applySystemRoomState(..., { housekeepingStatus: 'DIRTY' }, 'Gün sonu')`.
> - **Oda ücreti basarken** paydayı arızalı odalardan ayır: arızalı oda satılabilir
>   envanterde yok, hizmet dışı oda var (DailyStats doluluk hesabı için).
> - **"O gece misafir hangi odadaydı"** (17 Eylül 2026): oda değiştirmiş
>   konaklamada cevap `RoomStaySegment` (kapanmış dilimler) + açık dilimdir
>   (`[coalesce(roomSince, checkIn), checkOut)` → `roomId`). Oda ücreti ve
>   kat hizmeti raporu `reservation.roomId`'ye tek başına bakmamalı.
>   `modules/plan/rules.js` → `summarizeDays` aynı hesabı yapıyor (örnek).

> **FlexAI 2.0'dan not (3 Kasım 2026 — Ahmet):** gün kapanışı bitince bir "gün kapandı" olayı yayınla (ör. `night.audit.closed`, iş günüyle);
> 2.0'da 87 (gece müdürü), 92 (kârlılık özeti), 96 (dış muhasebe partisi) ve 104 onu dinleyecek. Günlük özet
> (DailyStats) 75 (patron uygulaması) ve 87'nin kaynağı olacak — göstergeleri 23 ile aynı tanımla yaz.

### 19. Çamaşırhane & minibar — arkadaşın
**Gün sonu:** Kat görevlisi odadan tüketilen minibar ürünlerini giriyor, çamaşır siparişi alınıyor; ikisi de folyoya otomatik yansıyor.
- [x] Backend: MinibarItem, MinibarConsumption, LaundryOrder tabloları + API
- [x] Backend: tüketim kaydı → `minibar.consumed` event → folyo kalemi
- [x] Ekran: Minibar ürün listesi + fiyat
- [x] Ekran: Oda bazlı tüketim girişi (mobil; oda seç, ürün + adet)
- [x] Ekran: Çamaşır siparişi (oda, parça listesi, teslim tarihi, durum)
- [x] Ekran: Günlük minibar / çamaşır raporu

> **📌 Modül 19 tamamlandı (4 Ekim 2026 — Ahmet).** (Başlık modül 5 commit'inde yanlışlıkla silinmişti; geri kondu.)
>
> **Veri** (migration `20261004090000_minibar_laundry`):
> - `MinibarItem` (kod otel içinde tekil — kısmi index; kategori, fiyat, odadaki standart adet, satışta / pasif, sıra),
>   `MinibarConsumption` (oda sayım **fişi**: kime yazıldı — `IN_HOUSE` / `LATE` / `NONE` kayıp, fiş no `MB-XXXXXX`,
>   iş günü, toplam, kayıp gerekçesi, istek kimliği, folyoya giden olay `eventId`) + satırlar (ürünün o anki adı / fiyatı).
> - `LaundryItem` (parça × hizmet: yıkama + ütü / kuru temizleme / yalnız ütü), `LaundryOrder` (sipariş no `LND-XXXXXX`,
>   durum alındı → yıkamada → hazır → teslim / iptal, ekspres + sipariş anındaki yüzde, ara toplam + fark = toplam,
>   teslim zamanı, alındığı / teslim edildiği iş günü, teslimde folyoya giden olay `chargeEventId`, iptal izi) + satırlar.
> - Otel: `laundryExpressPct` (varsayılan %50). Folyo kalem kaynağı: `LAUNDRY`. Kısıtlar: satır = fiyat × adet, toplam
>   tutarlı, kayıpsa konaklama yok + gerekçe var, durum izleri eksiksiz.
>
> **Kararlar (kullanıcı, 4 Ekim 2026):** çamaşır **teslimde** folyoya (iptal edilen hiç işlenmez); çıkıştan sonra bulunan
> minibar **açık folyoya geç kalem**, folyo kapandıysa folyo yetkilisine görev.
>
> **Minibar:** oda numarasıyla açılır; ekran odadaki misafiri ve **son 24 saatte odadan ayrılanları** (çıkış yapan ya da
> başka odaya taşınan — `RoomStaySegment`) gösterir. Fiş odadaki / ayrılan misafire yazılırsa `minibar.consumed` ile
> folyoya gider (folyo aktörü; minibar vergisiyle, olay iki kez gelse de tek kalem). Kimse yoksa **kayıp** (gerekçe
> zorunlu, folyoya gitmez). Seçilen misafir bu arada değiştiyse fiş yazılmaz (`STAY_CHANGED`; rezervasyon → oda kilidi).
> Aynı odaya son 24 saatteki sayımlar uyarı olarak görünür (çift giriş). Fiş silinmez, değişmez: düzeltme folyodaki kalem
> iptaliyle. Fişin durumu: işlendi / işleniyor / personele düştü (açık görev) / kayıp — ek kolon tutulmaz, kalemin anahtarı
> ve görevden okunur (sayfa başına iki sorgu).
>
> **Çamaşırhane:** sipariş içerideki misafir adına (kilit altında doğrulanır), teslim zamanı ileride ve en fazla 7 gün.
> Sayım düzeltmesi alındı / yıkamada iken; siparişteki parça **eski fiyatını korur**, yeni parça güncel fiyatla. Durum
> ileri atlanabilir, geri dönülmez; her geçiş satır kilidi + sürüm damgasıyla (aynı siparişi iki kişi teslim edip ücreti
> iki kez yazamaz — test edildi). Teslimde `laundry.charged`: parça satırları + **ekspres farkı ayrı satır**. Çıkış
> penceresi teslim edilmemiş siparişi uyarır.
>
> **Folyo (modül 15'te değişen):** `postExternalCharge` çamaşırı (`LAUNDRY`) işler; konaklama açıkça verilmiş ve misafir
> çıkmışsa **açık folyosuna geç kalem**; açık folyosu yoksa yeni folyo açmaz, `FOLIO_CLOSED` → aktörde görev.
>
> **API** (`/extras`): `GET /rooms/lookup`, `GET /minibar/items/active`, `GET /laundry/items/active`,
> `POST|GET /minibar/consumptions` (201 / aynı istek 200; günün fişleri imleçli), `GET|POST /laundry/orders` (görünüm:
> açık / geciken / teslim / iptal; oda no, sipariş no, misafir adı araması; sayfalı), `GET /laundry/orders/:id`,
> `PUT /laundry/orders/:id/lines`, `POST /laundry/orders/:id/status`, `GET /report`, `GET|POST|PUT|DELETE
> /minibar/items` ve `/laundry/items`, `GET|PUT /laundry/settings`. İzinler: `extras.view` (kat, resepsiyon, müdür,
> muhasebe), `minibar.post` ve `laundry.post` (kat, resepsiyon, müdür), `extras.manage` (müdür, muhasebe).
> Olaylar: `minibar.recorded`, `laundry.order.changed`, `extras.catalog.changed` (kanal `extras.changed`), `laundry.charged`.
>
> **Ekranlar** (`/ek-hizmetler`): **Minibar girişi** (telefon için: oda aç, büyük +/− düğmeleri, kime yazılsın, son
> sayımlar uyarısı, alt şeritte anlık toplam), **Minibar kayıtları** (gün, folyo durumu, folyoya bağlantı), **Çamaşırhane**
> panosu (görünümler, arama, geciken kırmızı, yeni sipariş / sayım / adım / teslim / iptal diyalogları, canlı),
> **Günlük rapor** (minibar yazılan / geç / kayıp, ürün ve personel; çamaşır alınan / teslim geliri / hizmet / geciken),
> **Fiyat listeleri** (minibar, çamaşır, ekspres farkı).
>
> **2500 kişi için:** fişler `(hotelId, businessDate, recordedAt, id)` imleçli; oda sayımları `(roomId, recordedAt)`;
> pano `(hotelId, status, dueAt, id)` ve `(hotelId, status, statusChangedAt, id)`; rapor tek GROUP BY'larla; sipariş no
> araması tekil index'le tam eşleşme; giriş ekranının ürün listesi satıştaki ürün sınırıyla (120 / 150); canlı tazeleme
> seyreltilmiş. Test: kurallar 9 + sözleşme 9 + aktör 3 birim; entegrasyon 11.
>
> **Devir:**
> - **Modül 14 (housekeeping):** oda temizliği görevine "minibar sayıldı" adımı bağlanabilir (`minibar.recorded`).
> - **Modül 44 (stok):** fiş satırları minibar stok çıkışıdır (`MinibarConsumptionLine`, kayıplar dahil).
> - **Modül 39 / 41 (restoran, oda servisi):** geç kalem kuralı `postExternalCharge`'da hazır (konaklama ver).

### 20. Teknik servis / arıza-bakım — Ali Kemal
**Gün sonu:** "204 klima bozuk" kaydı açılıyor, teknisyene gidiyor, oda gerekirse bakıma alınıyor, çözülünce kapanıyor.

> **Modül 14'ten not (28 Ekim 2026 — Ali Kemal):** kat görevlisinin "Sorun var"
> bildirimi `housekeeping.issue.reported` olayı yayınlıyor; şimdilik
> `modules/housekeeping/subscribers.js` bunu `'Teknik servis'` modüllü manuel
> göreve çeviriyor (izin eşlemesi `rooms.operate`). Bu modül gelince aynı
> dinleyici MaintenanceTicket açmalı ve manuel görev yolu kaldırılmalı —
> olay sözleşmesi hazır, yükte `taskId, roomId, roomNumber, note` var.
- [ ] Backend: MaintenanceTicket, MaintenancePlan tabloları + API
- [ ] Backend: arıza "oda kullanılamaz" işaretliyse odaya arıza kaydı (`RoomBlock`) aç — `blockRoom`, bitince `removeBlock`
- [ ] Ekran: Arıza listesi (oda, başlık, öncelik, durum, atanan, süre)
- [ ] Ekran: Yeni arıza formu (oda/alan, açıklama, fotoğraf, öncelik, odayı kapat mı)
- [ ] Ekran: Teknisyen görünümü (bana atananlar, başla / bitti)
- [ ] Ekran: Periyodik bakım planı (aylık kontrol listeleri, otomatik görev üretimi)

> **Modül 3'ten not (16 Eylül 2026 — Ahmet):** "MAINTENANCE" durumu kaldırıldı;
> arıza artık **tarihli kayıt** (`RoomBlock`). Odalar ekranında "Arıza kayıtları"
> penceresi (aç / listele / iptal et / bitir) çalışıyor — senin ekranın bileti
> yönetir, odayı kapatma işini aynı servise devreder:
>
> - "Odayı kapat" işaretli bilet → `blockRoom(hotelId, roomId, { type, startDate, endDate, reason })`.
>   `type`: **`OUT_OF_ORDER` (Arızalı)** oda satılamaz, envanterden düşer (klima,
>   su basması); **`OUT_OF_SERVICE` (Hizmet dışı)** kısa/kozmetik iş, envanterde
>   kalır ama misafir yerleştirilmez. Bilete `roomBlockId` sakla.
> - Bilet çözülünce → `removeBlock(hotelId, roomBlockId)`: süren kayıt bugün biter
>   ve arızalı oda **kirliye** düşer (modül 14 temizlik görevi üretir); başlamamış
>   kayıt iptal olur. Yanıttaki `mode` hangisi olduğunu söyler.
> - Odada o tarihlerde rezervasyon varsa 409 `HAS_RESERVATIONS` (örnek rezervasyonlarla);
>   arızalı kayıt overbooking yaratacaksa 409 `WOULD_OVERBOOK`. Acil arızada ekranın
>   "misafiri başka odaya taşı" adımını göstermesi gerekir (atama API'si hazır).
> - Geçmiş tarihli kayıt açılamaz (iş günü: `getBusinessDate`); çakışan iki kayıt 409 `BLOCK_OVERLAP`.
>
> **Modül 7'den ek (17 Eylül 2026):** "klima çalışmıyor" gibi misafir istekleri
> `MAINTENANCE` kategorisinde `guest.request.created` ile geliyor. Bilet açılınca
> isteği `IN_PROGRESS` yap, bilet çözülünce `DONE` (bkz. `changeRequestStatus`);
> ikisi ayrı kayıt, istek misafirin beklediği işi, bilet teknik işi anlatır.

### 21. Kayıp eşya — arkadaşın
**Gün sonu:** Bulunan eşyalar fotoğraflı kayıt altında; misafirle eşleştirilip teslim edildiği izleniyor.
- [x] Backend: LostItem API (kaydet, ara, eşleştir, teslim et)
- [x] Ekran: Bulunan eşya formu (açıklama, oda, bulan, tarih, fotoğraf)
- [x] Ekran: Liste + arama (tarih, oda, açıklama)
- [x] Ekran: Misafirle eşleştir (o tarihte o odada kim kalmış), iletişim notu
- [x] Ekran: Teslim edildi / kargo bilgisi

> **📌 Modül 21 tamamlandı (4 Ekim 2026 — Ahmet).**
>
> **Veri** (migration `20261005090000_lost_items`; başlangıç şemasındaki kullanılmayan `LostItem` taslağı yeniden
> kuruldu — tabloda kayıt varsa göç durur):
> - `LostItem`: etiket no `LF-XXXXXX` (poşete yazılır, otel içinde tekil), açıklama, kategori, **değerli**, oda ya da
>   yazılı yer (biri zorunlu), bulunma anı + iş günü, bulan (hesabı olmayan personel de olabilir), saklandığı yer,
>   durum (depoda → sahibi bulundu → teslim edildi / kapatıldı), eşleşen misafir + konaklama, teslim (elden: teslim
>   alan + kimlik görüldü; kargo: firma, takip no, adres, ücret, ödeyen), kapatma (bağış / imha / polis / hatalı kayıt
>   + gerekçe), kapanış izi, fotoğrafların silindiği an, istek kimliği. Kısıtlar: yer, eşleşme / teslim / kapatma izleri.
> - `LostItemPhoto` (dosya sunucu diskinde, kayıt veritabanında), `LostItemNote` (iletişim notu; silinmez).
> - Otel: `lostItemRetentionDays` (90), `lostItemValuableRetentionDays` (365).
>
> **Kararlar (kullanıcı, 3 Ekim 2026):** fotoğraflar **sunucu diskinde**; saklama **90 gün, değerli eşya 1 yıl**
> (ayarlanır), süresi dolan "süresi dolan" listesine düşer, yönetici gerekçeyle kapatır; kapanan eşyanın fotoğrafları
> **30 gün sonra** silinir.
>
> **Fotoğraf:** tarayıcı uzun kenarı 1600 px'e küçültür, JPEG'e çevirir (EXIF / konum düşer) ve 320 px önizleme
> üretir; sunucu türü dosyanın imzasından, boyutu sınırdan doğrular (1,5 MB / 150 KB; route gövde sınırı yalnızca bu
> uçta yükseltildi). Dosya `FILE_STORAGE_DIR` altında (`lost-items/<otel>/<id>.jpg`), statik sunulmaz: yalnızca yetkili
> oturumla API'den okunur, tarayıcı önbelleğine özel. Eşya başına en fazla 4 fotoğraf (kilit altında). Yazılamayan
> kaydın dosyası geri silinir. Saatlik iş kapanıştan 30 gün sonra fotoğrafları siler (kısmi index'le).
>
> **Eşleştirme:** eşya odada bulunduysa o sırada odada kalan (`IN_ROOM`) ve son 7 günde odadan ayrılanlar (çıkış ya da
> oda değişimi — `RoomStaySegment`), ayrılış yakınlığına göre; refakatçiler dahil; eşyadan sonra gelen aday değil.
> Ortak alanda bulunan eşyada misafir araması (ad, telefon, e-posta). Konaklama verildiyse misafir o konaklamanın
> misafiri olmalı. Eşleşme gerekçeyle kaldırılır (nota da düşer). Misafirin telefonu / e-postası ve kargo adresi
> yalnızca teslim yetkisine gösterilir.
>
> **Teslim / kapatma:** değerli eşya elden **kimlik görülmeden verilmez**; her geçiş satır kilidi + sürüm damgasıyla
> (aynı eşya iki kişiye teslim edilemez — test edildi). Kapanmış kayıt değişmez; iletişim notu her durumda yazılır.
> Çıkış penceresi misafire eşleşmiş eşyayı ve odasında bulunup eşleşmemiş eşyayı uyarır (kayıp eşyayı görebilene).
>
> **API** (`/lost-items`): `GET /` (görünüm: saklananlar / teslim bekleyen / süresi dolan / teslim edilen / kapatılan;
> arama: etiket no, oda no, açıklama, yer, misafir; kategori, değerli, tarih; sayfalı), `GET /summary`, `GET|PUT
> /settings`, `GET /owners`, `POST /` (201 / aynı istek 200), `GET|PUT /:id`, `GET /:id/candidates`,
> `POST|GET|DELETE /:id/photos[/:photoId]`, `POST /:id/match|unmatch|notes|return|dispose`. İzinler:
> `lost_items.view` (müdür, resepsiyon, kat, F&B), `lost_items.record` (aynı), `lost_items.release` (müdür,
> resepsiyon), `lost_items.manage` (müdür). Olaylar: `lost_item.recorded`, `lost_item.changed`,
> `lost_items.settings.changed` (kanal `lost-items.changed`; yükte yalnızca kimlikler).
>
> **Ekranlar** (`/kayip-esya`): liste (sayaçlar, görünümler, arama, süzgeçler, önizlemeler, canlı), eşya ekranı
> (etiket no, galeri, bilgiler, sahibi, sonuç, iletişim notları), kayıt / düzeltme formu (telefonda kamera), sahibini
> bul, teslim, kapatma, saklama süreleri.
>
> **2500 kişi için:** liste `(hotelId, status, foundAt, id)` / `(hotelId, status, closedAt, id)`; süresi dolanlar
> `(hotelId, status, valuable, businessDate)` eşiğiyle (süre kolonu yok); açıklama ve yer trigram; etiket no tekil;
> adaylar oda + tarih index'leriyle sınırlı tarama; sayfa başına kapak fotoğrafları tek sorgu; sayım sınırlı.
> Ek: oturum kapanınca / kişi değişince panelin sorgu önbelleği boşalır (ortak resepsiyon bilgisayarı).
> Test: kurallar 9 + dosya deposu 4 + sözleşme 13 + gövde sınırı 3 birim; entegrasyon 16.
>
> **Canlıya alırken:** sunucuda `FILE_STORAGE_DIR` uygulama klasörünün dışında (ör. `/home/public_html/storage`,
> sahibi www) ve yedeğe dahil edilmeli.
>
> **Devir:** modül 9 (bildirim) misafire "eşyanız bulundu" şablonu bağlayabilir (`lost_item.changed` / MATCHED);
> modül 22 (misafir kartı) misafirin eşyalarını `guestId` index'iyle gösterebilir.

### 22. CRM & misafir kartı — Ali Kemal
**Gün sonu:** Her misafirin tek profili var: geçmiş konaklamalar, tercihler, toplam harcama, notlar; mükerrer kayıtlar birleştirilebiliyor.
- [ ] Backend: Guest genişletme (GuestPreference, GuestNote tabloları), `mergeGuests` servisi
- [ ] Backend: misafir özeti API'si (konaklama sayısı, toplam harcama, son konaklama)
- [ ] Ekran: Misafir listesi + arama (ad, telefon, e-posta, etiket)
- [ ] Ekran: Misafir kartı (iletişim, kimlik, tercihler: kat / yastık / alerji; etiketler: VIP / sorunlu)
- [ ] Ekran: Konaklama geçmişi sekmesi, harcama sekmesi, notlar sekmesi
- [ ] Ekran: Birleştirme (iki kaydı seç, hangi alanlar kalacak)
- [ ] Rezervasyon formuna misafir kartı önizlemesi (tercihler görünsün)

> **Modül 7'den not (17 Eylül 2026 — Ahmet):** gelen WhatsApp mesajı misafir kartını
> telefondan buluyor (`Guest_phone_match_idx` ifade dizini + `phoneMatchScore`;
> ülke kodsuz numara `Hotel.phoneCountryCode` ile okunur). Aynı numaraya birden
> çok kart varsa en son güncellenen alınıyor. `mergeGuests` birleştirirken
> `Conversation.guestId` ve `GuestRequest.guestId`'yi de taşımalı. Misafir kartı
> ekranında telefon girişine "ülke kodu yoksa otelin kodu varsayılır" ipucu konmalı.

> **FlexAI 2.0'dan not (3 Kasım 2026 — Ahmet):** 80 (misafir tanıma) `GuestPreference`'ı kullanacak: tercihleri serbest metin
> değil **kategori + değer** olarak tut, yanına kaynak (PERSONEL / MİSAFİR / AI), güven ve son teyit tarihi koy;
> alerjiler 43'ün alerjen kodlarıyla aynı olsun. 69 (göç sihirbazı) mükerrer misafirleri aynı `mergeGuests`
> kuralıyla birleştirecek — kuralı servis fonksiyonu olarak dışa aç.

---

## 3. RAPORLAMA

### 23. Gelir raporları — arkadaşın
**Gün sonu:** Doluluk, ADR, RevPAR raporları tarih aralığına göre tablo + grafik olarak çıkıyor; geçen yılla karşılaştırma var.
- [x] Backend: MCP server paketi (read-only DB bağlantısı; tool'lar: `get_occupancy`, `get_revenue`, `run_report_query` parametrik/güvenli)
- [x] Backend: rapor SQL'leri (günlük/haftalık/aylık doluluk, ADR, RevPAR, kaynak bazlı, oda tipi bazlı)
- [x] Ekran: Rapor sayfası (tarih aralığı, gruplama seçici)
- [x] Ekran: Doluluk raporu (tablo + çizgi grafik)
- [x] Ekran: ADR / RevPAR raporu
- [x] Ekran: Kaynak ve oda tipi kırılımı (pasta / çubuk)
- [x] Ekran: Geçen yıl karşılaştırma sütunu

> **📌 Modül 23 tamamlandı (4 Ekim 2026 — Ahmet).**
>
> **Kararlar (kullanıcı, 4 Ekim 2026):** geçmiş günlerin oda geliri **folyoya işlenen** gerçekleşen gelirden (fiyat
> düzeltmeleri, oda indirimleri, iptaller dahil; iptal işlendiği güne düşer), bugün ve sonrası **rezervasyonun gece
> fiyatından eldeki**; geçen yıl **haftanın aynı günü** (364 gün önce).
>
> **Tanımlar** (`contracts/reports.js`; oda planı ve günlük durumla ortak — `countsSoldNight` / `soldNightSql`):
> satılan gece = bugün ve sonrası opsiyonlu + kesin + içerideki konaklamanın geceleri (eldeki), geçmişte yalnızca
> gerçekleşen (içeride ya da çıkmış) konaklamanın geceleri — gelmeyen misafirin gecesi "gelmedi" işaretlenmemiş olsa da
> dolu sayılmaz; satılabilir = o gece kayıtlı oda − arızalı oda (silinen oda silindiği güne kadar); ADR = oda geliri /
> satılan gece; RevPAR = oda geliri / satılabilir; gelir vergiler hariç (eldekinden dahil oda vergisi ayrılır). Erken
> giriş / geç çıkış ücreti ve iptal / gelmeme geliri ayrı sütun, ADR'ye girmez; F&B, minibar, çamaşır oda geliri değil.
> Oranlar dönem toplamlarından (oranların ortalaması alınmaz). Başka para birimindeki rezervasyon karışmaz, sayısı bildirilir.
>
> **Veri:** migration `20261006090000_revenue_reports` (`FolioItem (hotelId, serviceDate)` index'i) ve
> `20261006100000_revenue_day_stats` (`RevenueDayStat` gün × oda tipi × kaynak × para birimi özeti, `RevenueStatDay`
> işareti). Geçmiş günler özetten okunur; son 14 gün, eldeki rezervasyon ve özeti çıkmamış gün canlı (rapor her zaman
> doğru, özet yalnızca hızlandırır). Saatlik iş: son 31 kapanmış günü yeniden hesaplar, eski günleri 62'lik parçalarla
> doldurur, doldurulacak yoksa en eski parçayı yeniden hesaplar (kendini onarma).
>
> **Ölçüm** (`scripts/perf-revenue.mjs`, 1500 oda, 4 yıl / 550 bin rezervasyon, 1,1 M gece, 405 bin folyo kalemi):
> bir yıllık rapor soğuk **3,9 sn → 0,43 sn**, ±30 gün **0,66 → 0,23 sn**; rakamlar özetle ve canlıyla birebir aynı.
> Özet turu otel başına ≤ 2 sn. Canlı sorgu otelin bütün geçmişini taradığı için (rezervasyon + folyo kalemi) özet şarttı.
>
> **MCP** (`shared/mcp-server`, `@modelcontextprotocol/sdk`): genel salt okunur sunucu (yalnızca `readOnly` araç,
> girdinin tam şemayla doğrulanması, iç hatanın modele sızmaması) + otelin araçları (`modules/reports/mcp.js`):
> `get_occupancy`, `get_revenue`, `run_report_query` (yalnızca adı verilen 4 hazır rapor; serbest SQL yok). Sunucu tek
> otele bağlı (otel parametresi yok). Bütün sorgular `SET TRANSACTION READ ONLY` + süre sınırıyla; `REPORTING_DATABASE_URL`
> ile yalnızca okuma yetkili kullanıcı verilebilir (`.env.example`'da komutlar). Aynı süreçteki ajan `connectInProcess`,
> süreç dışı istemci `npm run mcp:reporting -w @hotelos/hotel-backend` (stdio).
>
> **API:** `GET /reports/revenue?from&to&groupBy` (en fazla 366 gün, en ileri iş günü + 730 gün; tek cevapta kovalar,
> toplam, oda tipi ve kaynak kırılımı, geçen yıl). İzin `reports.view` (müdür, muhasebe).
>
> **Ekran** (`/raporlar/gelir`): hazır aralıklar (bu ay, geçen ay, son 30 gün, önümüzdeki 30 gün, yılbaşından bugüne,
> son 12 ay) + özel aralık, gün / hafta / ay; dört gösterge (doluluk, ADR, RevPAR, oda geliri — geçen yıl ve değişim);
> çizgi grafik (bu dönem vurgulu, geçen yıl gri bağlam, eldeki dönem gölgeli, imleç ipucu, uç değerler; tek eksen, tek
> ölçü); tablo görünümü (toplam satırıyla); oda tipi ve kaynak kırılımı (tek renk pay çubuğu, gece, ADR, geçen yıl);
> "rakamlar nasıl hesaplanıyor" açıklaması. Telefonda taşma yok, eksen yazıları genişliğe göre seyrelir.
>
> **Test:** kurallar 10 + MCP sunucusu 3 birim; entegrasyon 7 (sınıflama, eldeki gelir, arıza, geçen yıl, kırılım, para
> birimi, otel sınırı, salt okunur işlem, MCP, özet = canlı, onarma).
>
> **Gözden geçirme (5 Ekim 2026):** (1) gelmeyen ama "gelmedi" işaretlenmemiş rezervasyonun geçmiş geceleri dolu
> sayılıyordu (otomatik gelmedi modül 18'de; o güne kadar geçmiş doluluk şişer, ADR düşerdi) — tanım oda planı, günlük
> durum (dün + haftalık seri) ve raporda ortak düzeltildi; (2) sonradan silinen oda geçmiş günlerde satılabilirden
> düşüyordu (geçmiş doluluk %100'ü aşabilirdi); (3) süre sınırını aşan rapor "beklenmeyen hata" yerine 503 + "daha kısa
> aralık" (MCP'de de görünür).
>
> **Devir:** modül 24 (doğal dil raporlama) MCP araçlarını `connectInProcess(createReportingMcpServer({ hotelId }))` ile
> kullanır; modül 25 (forecast) eldeki geceyi aynı sorgudan alabilir; modül 18 (gece kapanışı) iş günü dönünce özeti
> tetikleyebilir (`refreshHotelStats`).

### 24. Doğal dil raporlama — Ali Kemal
**Gün sonu:** Müdür "geçen ayın haftalık doluluğunu göster" yazıyor, tablo ve grafik geliyor; rapor kaydedilebiliyor.
- [ ] report-agent paketi (LangGraph; MCP tool'larını çağırır; sonuç: tablo verisi + grafik tipi önerisi + kısa yorum)
- [ ] Backend: SavedReport tablosu + API
- [ ] Ekran: Rapor sohbeti (soru kutusu, cevap: tablo + grafik + yorum)
- [ ] Ekran: "Kaydet" → kayıtlı raporlar listesi, tekrar çalıştır
- [ ] Token bütçesi + LlmUsage kaydı; agent kapalıysa "rapor talebi" manuel görevi

> **FlexAI 2.0'dan not (3 Kasım 2026 — Ahmet):** 86 (işlem yapan asistan) aynı rapor araçlarını kullanacak; araç tanımlarını
> ajandan ayrı tut (MCP sunucusunda), ajan yalnız çağırsın.

### 25. Günlük durum — forecast — arkadaşın
**Gün sonu:** Dashboard'da önümüzdeki 30 günün doluluk ve gelir tahmini görünüyor; riskli günler işaretli.
- [x] Backend: MCP `get_forecast` (mevcut rezervasyonlar + geçen yıl aynı dönem trendi)
- [x] Backend: kritik gün tespiti (doluluk < %30 veya > %95)
- [x] Ekran: 30 günlük doluluk grafiği (gerçek + tahmin ayrımı)
- [x] Ekran: Gelir tahmini kartı
- [x] Ekran: Kritik günler listesi

> **📌 Modül 25 tamamlandı (5 Ekim 2026 — Ahmet).**
>
> **Kararlar (kullanıcı, 5 Ekim 2026):** tahmin **pickup yöntemiyle** — eldeki + karşılaştırma günlerinin **aynı gün
> kala** gerçekleşen net satışı (yeni satış − iptal − gelmeyen − erken çıkış); karşılaştırma önce geçen yılın aynı
> dönemi (haftanın aynı günü 364 gün önce ± 1 hafta), yoksa son 8 haftanın aynı günleri, o da yoksa tahmin = eldeki.
> Kritik gün eşikleri **otel ayarı** (varsayılan %30 / %95; müdür tahmin kartından değiştirir, izin `forecast.manage`).
>
> **Tanımlar** (`contracts/forecast.js`): "o gün kala eldeki" = o anda açılmış, iptal / gelmedi işaretlenmemiş
> rezervasyonun gecesi (rezervasyonun açılış anı esas; düzenlemede gece satırları yeniden yazıldığı için gecenin değil).
> Pickup satılabilir odaya oranlanır (otelin oda sayısı değişse de taşınır), en az 2 örnek gerekir; artı pickup
> satılabilir odayı aşmaz, eksi pickup sıfırın altına indirmez. Sistemde kaydın olmadığı "o gün kala" anı karşılaştırılmaz
> (yoksa eldeki sıfır, pickup gerçekleşenin tamamı sanılırdı). Gelir tahmini = eldeki gece fiyatları (dahil vergi ayrılmış)
> + beklenen gece × o günün eldeki ADR'si (o gün satış yoksa pencerenin, o da yoksa geçen yılın ADR'si). Eldeki, geçen
> yıl ve satılabilir oda gelir raporunun hesabından (aynı tanımlar; başka para birimi pickup'a da karışmaz). Kritik:
> fazla satış (eldeki > satılabilir), tahmin > yüksek eşik, tahmin < düşük eşik — düşük doluluk tahmin ister
> (karşılaştırma verisi yokken uzak günün az eldekisi "riskli" sayılmaz; yüksek ve fazla satış eldekiyle de
> işaretlenir). Eşik değişikliği açık günlük durum ekranlarına canlı yansır. Günlük durumun "bu gece" doluluk kartı
> da artık sabit %40 değil otelin düşük eşiğiyle uyarır (tek eşik).
>
> **Veri:** migration `20261007090000_forecast_thresholds` (`Hotel.forecastLowOccupancyPct / forecastHighOccupancyPct`
> + CHECK 0–100, aradaki fark ≥ 5). Yeni tablo yok: tahmin `ReservationNight (hotelId, date)` ve
> `Reservation (hotelId, createdAt, id)` index'lerinden okunur.
>
> **API:** `GET /forecast?days=1..30` (`dashboard.view`; eşikler ve sürümleri cevapta), `PUT /forecast/settings`
> (`forecast.manage` — müdür; sürüm kontrollü `expectedUpdatedAt`, denetim kaydı, `forecast.settings.changed`).
> Cevap otel × iş günü × canlı sürüm anahtarıyla bir dakika önbellekte (rezervasyon / ayar değişince yeni anahtar).
> MCP: raporlama sunucusuna `get_forecast` (modül 24 ajanı da kullanır).
>
> **Ölçüm** (`scripts/perf-forecast.mjs`, 1500 oda, 4 yıl): 30 günlük tahmin soğuk **0,97 sn → 0,42–0,46 sn**
> (geçen yılın örneği yeten günlerde son haftalar okunmuyor; eldeki ile karşılaştırma okuması paralel). Önbellekli
> cevap anında.
>
> **Ekran** (günlük durum, "Önümüzdeki 30 gün"): eldeki rezervasyon dolu çubuk, tahmin kesikli çizgi (içi boş nokta),
> eşikler kesikli yatay çizgi, kritik günler eksenin üstünde şekil + renk (▼ düşük, ▲ yüksek, ! fazla satış); imleç /
> klavye ipucu (eldeki, tahmin, beklenen ±, gelir, geçen yıl, kaynak); tablo görünümü; tahminin kaynağı notu ("30 gün
> geçen yılın aynı döneminden" / veri yoksa açıklama). Gelir tahmini kartı (tahmini oda geliri = eldeki + beklenen,
> geçen yıl aynı dönem ve değişim, tahmini doluluk ve ADR). Kritik günler listesi (tür, eldeki → tahmin, ne yapılabilir,
> oda planında aç). Eşik penceresi (yalnız `forecast.manage`). Telefonda taşma / yazı çakışması yok.
>
> **Gözden geçirmede ayrıca:** modül 19 (ekspres çamaşır farkı) ve modül 21 (kayıp eşya saklama süreleri) ayar
> uçlarına da sürüm kontrolü eklendi — iki kişi aynı anda kaydederse ikincisi ilkini sessizce ezmiyordu. Üç grafik
> (haftalık doluluk, gelir raporu, tahmin) ortak `useElementWidth` kancasını kullanır.
>
> **Test:** kurallar 13 + sözleşme 2 birim; entegrasyon 5 (geçen yıl pickup'ı — sonradan açılan / sonradan iptal edilen,
> başka para birimi, otel sınırı; son haftalar ve kaydı olmayan an; veri yokken tahmin = eldeki, kritik günler, fazla
> satış; eşik izni, doğrulama, denetim, eski sürümle kayıt 409, önbelleğin olayla tazelenmesi; MCP).
>
> **Bilinen sınır:** sonradan uzatılan konaklamanın eklenen gecesi rezervasyonun açılış anından beri eldeymiş sayılır
> (pickup bir miktar az görünür). Yeni `forecast.manage` izni rol matrisini kaydetmiş otelde de rolün varsayılanını kendiliğinden alır (matris kaydedilirken o günkü katalog `Hotel.permissionCatalog`a yazılır; sonradan eklenen izin varsayılandır).
>
> **Devir:** modül 18 (gece kapanışı) otomatik "gelmedi" işaretleyince geçmiş geceler ve pickup örnekleri kendiliğinden
> düzelir; modül 24 `get_forecast`'ı MCP'den çağırır.

### 26. Rapor tasarımcısı + Excel — Ali Kemal
**Gün sonu:** Kullanıcı kendi raporunu kolon seçerek kuruyor, Excel indiriyor; Excel'den toplu misafir / fiyat yükleyebiliyor.
- [ ] Backend: ReportDefinition tablosu; kaynak tanımları (rezervasyon, folyo, misafir, ödeme) ve izin verilen kolonlar
- [ ] Backend: dinamik sorgu üretici (kolon, filtre, grupla, sırala; SQL injection'a kapalı)
- [ ] Backend: Excel export (xlsx), Excel import (misafir listesi, fiyat planı) + doğrulama raporu
- [ ] Ekran: Tasarımcı (kaynak seç → kolon sürükle → filtre ekle → önizle → kaydet)
- [ ] Ekran: Kayıtlı raporlar + çalıştır + Excel indir
- [ ] Ekran: Excel yükleme sihirbazı (dosya seç → kolon eşleştir → hataları göster → içe aktar)

### 27. Bütçe yönetimi — arkadaşın
**Gün sonu:** Yıllık bütçe ay ay giriliyor; gerçekleşenle sapma raporu çıkıyor; AI sapmayı yorumluyor.
- [x] Backend: Budget, BudgetLine tabloları + API (yıl, ay, kalem, plan tutarı)
- [x] Backend: gerçekleşen tutarları folyo / ödeme / satın alma verisinden hesaplama
- [x] Ekran: Bütçe giriş tablosu (satır kalem, sütun ay; Excel'den yükleme)
- [x] Ekran: Sapma raporu (plan, gerçek, fark, fark %; renkli)
- [x] report-agent'a `explain_variance` tool'u → yorum paragrafı

> **📌 Modül 27 tamamlandı (5 Ekim 2026 — Ahmet).**
>
> **Kararlar (kullanıcı, 5 Ekim 2026):** kapsam gelir + doluluk / ADR hedefleri + gider (gelirin ve hedeflerin
> gerçekleşeni sistemden; giderin gerçekleşeni şimdilik elle — modül 45 satın alma / 47 ön muhasebe gelince otomatik);
> AI yorumu şimdi, mevcut AI altyapısıyla; Excel otele göre şablon indir → doldur → yükle; bütçe taslak → onaylı (kilit),
> değişiklik revizeyle (önceki onaylı "eski sürüm" olarak saklanır).
>
> **Veri** (migration `20261008090000_budgets`): `Budget` (yıl × sürüm; DRAFT / APPROVED / SUPERSEDED; yıl başına tek
> taslak ve tek onaylı — kısmi tekil index), `BudgetLine` (kalem × ay plan; doluluk 0–100), `BudgetExpenseItem`
> (otelin gider kalemleri; etkin ad tekil, kaldırılan arşivlenir — açık taslaklardan düşer, onaylılarda kalır),
> `BudgetExpenseActual` (gider gerçekleşeni, hücre sürümlü), `BudgetCommentary` (AI yorumu; dönem başına tek bekleyen).
> CHECK'ler: ay, tutar, onay izi, yorum izi. İlk bütçede USALI'ye göre önerilen 7 gider kalemi eklenir.
>
> **Gerçekleşen** (yalnızca kapanmış günler): oda geliri, ek ücret, iptal geliri, satılan / satılabilir oda **gelir
> raporunun hesabından** (rapor ile bütçe aynı ayın oda gelirini hiçbir zaman farklı göstermez); restoran / minibar /
> çamaşır / diğer gelir folyo kaleminin türünden (indirim kendi vergi kategorisinin gelirinden düşer, vergi kalemi gelir
> değil); tahsilat kasa tanımıyla (işlenmiş ödeme − iade ± iptal kaydı; onay bekleyen sayılmaz); gider elle.
>
> **Sapma:** ay ya da yılbaşından seçilen aya; içinde bulunulan ayın planı kapanmış gün oranında (ekranda işaretli);
> doluluk hedefi satılabilir odayla, ADR hedefi planlanan geceyle ağırlıklı; gelirde fazlası / giderde azı olumlu (renk +
> işaret); gelir, gider ve brüt faaliyet kârı toplamı; planı olup gerçekleşeni girilmemiş gider "eksik"; oda geliri
> sapması doluluk etkisi ve fiyat etkisine ayrılır (girilen plan hedeflerle tutmuyorsa fark ayrıca). Plan yılın onaylı
> bütçesinden, yoksa taslaktan (işaretli).
>
> **AI:** `explain_variance` (raporlama MCP sunucusu; modül 24 ajanı da kullanır) + `budget-agent` (olay güdümlü:
> `budget.commentary.requested` → yorum → `budget.commentary.completed`). Model otelin ana modeli (concierge ile aynı
> ayar), günlük AI bütçesi ve kullanım kaydı ortak. Ajan kapalı / anahtar yok / bütçe doldu → istek "yazılamadı" ile
> kapanır (askıda kalmaz; 5 dk zaman aşımı son güvence); rapor yorumsuz da eksiksiz. Modele kişisel veri gitmez.
>
> **API** (`/budgets`): yıl görünümü, aç, revize, satırları kaydet (sürümlü), onayla; gider kalemleri (ekle / ad / kaldır);
> gerçekleşen gider (hücre sürümlü, gelecek ay girilmez); sapma; yorum iste / oku. İzinler `budget.view` (müdür,
> muhasebe), `budget.manage` (müdür, muhasebe), `budget.approve` (müdür). Canlı kanal `budget.changed`.
>
> **Ekran** (`/butce/plan`, `/butce/gerceklesen`, `/butce/sapma`; yıl adres çubuğunda): ızgara (gelir / hedef / nakit /
> gider grupları, gelir ve gider ara toplamı, brüt faaliyet kârı, Türkçe sayı biçimi, hücre hatası ay adıyla); Excel
> şablonu indir / yükle (kod sütunuyla eşleşir; yüklenen değer kaydedilmemiş değişiklik olarak gelir, 1 MB sınırı);
> onay ve revize pencereleri; canlı tazeleme kaydedilmemiş girişi silmez (başkası kaydettiyse uyarı); gider gerçekleşeni
> ızgarası; sapma tablosu + oda geliri ayrıştırma kartı + AI yorum kartı. Telefonda sayfa taşmaz, tablolar kendi içinde kayar.
>
> **Ölçüm** (`scripts/perf-budget.mjs`, 1500 oda, 4 yıl): yılbaşından bu yana sapma soğuk ~0,46 sn (yılın sistem
> gerçekleşeni bir kez okunur, önbellekten ay / kapsam değişimi anında).
>
> **Test:** kurallar 11 + sözleşme 6 + ajan 7 birim; entegrasyon 9 (ilk bütçe, satır / sürüm / kilit / boş onay, revize,
> gider kalemi, gerçekleşen gider, sapma — sınıflama, tahsilat, hedefler, ayrıştırma, eksik gider, otel sınırı, raporla
> aynı oda geliri —, ay içi orantı, AI yorumu sahte modelle uçtan uca + tek bekleyen + boş dönem, MCP ve izinler).
>
> **Devir:** modül 45 / 47 gelince `BudgetExpenseActual` yerine gider gerçekleşeni oradan hesaplanır (kalem eşlemesi
> gerekir); modül 24 `explain_variance`'ı MCP'den çağırır.

---

## 4. SATIŞ & DAĞITIM

### 28. Paket / pansiyon tipleri — Ali Kemal
**Gün sonu:** RO/BB/HB/FB/AI pansiyon tipleri ve tarih bazlı fiyat planları tanımlı; rezervasyon fiyatı bunlardan hesaplanıyor.
- [ ] Backend: RatePlan genişletme (oda tipi × pansiyon × tarih aralığı × fiyat, min. gece, kişi başı ek), Package tablosu
- [ ] Backend: fiyat hesaplama servisini RatePlan'a bağla (sezon çarpanı yerine plan fiyatı)
- [ ] Ekran: Pansiyon tipi tanımları
- [ ] Ekran: Fiyat planı tablosu (satır oda tipi, sütun tarih aralığı, hücre fiyat; toplu düzenleme)
- [ ] Ekran: Paket tanımı (oda + SPA + transfer gibi bileşenler, toplam fiyat)
- [ ] Rezervasyon formuna pansiyon ve paket seçimi

### 29. Kontrat & acente yönetimi — arkadaşın
**Gün sonu:** Acenteler kayıtlı, kontrat fiyatları girili; acente adına açılan rezervasyon kontrat fiyatını otomatik alıyor.
- [x] Backend: Agency, Contract, ContractRate tabloları + API
- [x] Backend: rezervasyonda acente seçiliyse kontrat fiyatı kullan; stop-sale günlerinde reddet
- [x] Ekran: Acente listesi + kart (firma, yetkili, iletişim, komisyon %, vade)
- [x] Ekran: Kontrat formu (acente, dönem, oda tipi, pansiyon, fiyat, stop-sale tarihleri)
- [x] Ekran: Acente rezervasyonları ve cari özeti (47 ile bağlanır)

> **📌 Modül 29 tamamlandı (5 Ekim 2026 — Ahmet).**
>
> **Kararlar (kullanıcı, 5 Ekim 2026):** kontrat fiyatı **oda başı gecelik** (oda tipi × pansiyon × dönem; kişi başı ek,
> tek kişi farkı, çocuk indirimi modül 28'in işi); kontratta fiyatı olmayan gece **reddedilir** (yetkili personel fiyatı
> elle girebilir; stop-sale elle fiyatla da aşılmaz); satıştaki kontratın fiyatı **denetim iziyle değişebilir** ve yalnızca
> sonradan açılan rezervasyonları etkiler; bekleyen ve onaylı rezervasyona sonradan acente atanır / değiştirilir /
> kaldırılır (geceler yeniden fiyatlanır; içerideki misafirde acente değişmez). Kontrat para birimi otelin parasıdır
> (çoklu para: modül 60).
>
> **Veri** (migration `20261009090000_agencies_contracts`): `Agency` (kod ve ad otel içinde tekil, komisyon %, vade, aktif /
> pasif; silinmez, pasife alınır), `Contract` (taslak → satışta → sonlandırıldı; **aynı acentenin aynı günü kapsayan en
> fazla bir satıştaki kontratı** — EXCLUDE kısıtı), `ContractRate` (oda tipi × pansiyon × dönem fiyatı; aynı kontratta aynı
> tip + pansiyon için dönemler çakışmaz — EXCLUDE), `ContractStopSale` (oda tipi boşsa tüm tipler; aynı kapsamda çakışmaz).
> `Reservation.agencyId` artık yabancı anahtar; `agencyCommissionPct` rezervasyon açılırken kartın oranını **kopyalar**
> (kart sonradan değişse de geçmiş rezervasyon etkilenmez; acente varsa oran da vardır — CHECK).
>
> **Fiyatlama** (`modules/agencies/sale.js`, `rules.js`): acente seçiliyse her gece o günü kapsayan satıştaki kontratın oda tipi +
> pansiyon fiyatından yazılır (iki kontrata yayılan konaklama gece gece kendi kontratından; gece dökümünde kontrat adı).
> Sebepler: `AGENCY_NOT_FOUND`, `AGENCY_PASSIVE`, `AGENCY_NO_CONTRACT`, `AGENCY_NO_RATE`, `AGENCY_STOP_SALE` (422, mesaj hangi
> geceler olduğunu söyler). Açma, grup (satır başına tip + pansiyon; biri satılamıyorsa hiçbiri açılmaz), düzenleme
> (yalnızca yeniden satılan geceler denetlenir: uzatma, pansiyon / tip / acente değişimi; eski geceler fiyatını ve
> stop-sale'den bağımsızlığını korur), iptal geri alma (pasif acente ve stop-sale engeller), fiyat önizlemesi ve
> kapasite onayı aynı kuraldan geçer. Kaynak acenteyle birlikte döner (acente → "Acente"; kaldırılınca "Resepsiyon").
> **Kilit düzeni:** rezervasyon → oda tipi → **acente** (satışta paylaşımlı, kontrat / stop-sale / kart yazımında özel):
> stop-sale yazılırken gelen rezervasyon eski durumu görüp geçemez (testle kanıtlı).
>
> **API** (`/agencies`): seçici (`reservations.manage` ya da `agencies.view`; yalnız ad / kod), liste (arama, durum,
> sayfalı), kart (sürümlü güncelle, aktif ↔ pasif), kontrat (aç, başlık, fiyat tablosunun tamamı sürümlü, satışa aç,
> sonlandır, taslağı sil), stop-sale ekle / kaldır, cari özeti, acentenin rezervasyonları (sayfalı; `agencies.view`,
> rezervasyon listesi izni gerekmez). İzinler `agencies.view` (müdür, muhasebe), `agencies.manage` (müdür). Canlı kanal
> `agencies.changed`; denetim izi kartı, kontratı, **fiyat farkını** (eklenen / kaldırılan / değişen satır) ve stop-sale'i yazar.
>
> **Ekran:** `/acenteler` (liste; kontratı olmayan aktif acente uyarılır), `/acenteler/:id` (genel, kontratlar, rezervasyonlar ve
> cari), `/acenteler/kontrat/:id` (başlık, **dönem blokları × oda tipi × pansiyon fiyat tablosu** — çok dönemde bloklar kapalı
> başlar, dönemi kopyala, hata hücreye bağlanır; kaydedilmemiş girişi canlı tazeleme silmez; stop-sale; satışa aç /
> sonlandır). Rezervasyon formunda kaynak "Acente" → aramalı acente seçici, kontrat fiyatı canlı, satılamayan tip sebebiyle
> işaretli; düzenleme penceresinde acente atama / değiştirme / kaldırma; detayda ve listede acente.
>
> **Cari özeti:** dönemde (girişe göre) satış, komisyon (açılıştaki oranla), net, iptal / gelmeme ücretleri; "cariye aktarılan" =
> folyoda "Acente / cari" yöntemiyle kapatılan tutar ve vadesi gelen kısmı (çıkış + vade günü). Acentenin yaptığı ödemelerin
> düşümü **modül 47** ile bağlanır.
>
> **Ölçüm** (`scripts/perf-agencies.mjs`, 3000 acente, 600 kontrat × 108 fiyat satırı, 82 bin acenteli rezervasyon, 550 bin
> rezervasyonlu tablo): liste 6–10 ms, seçici araması 3 ms, kontrat ekranı 7 ms, cari özeti 4 ms, acente fiyat önizlemesi
> 6 ms, acente rezervasyonu açma ~90 ms (acentesiz ~80 ms).
>
> **Test:** kurallar 13 + sözleşme 15 + ekran dönüşümleri 11 birim; entegrasyon 43 (kart, yaşam döngüsü, stop-sale,
> fiyatlama, düzenleme, geri alma, önizleme, kilit, cari, izinler, ayar korumaları).
>
> **Devir:** modül 28 pansiyon / fiyat planı gelince standart fiyat kaynağı değişir; kontrat fiyatı `priceRoomLine` içinde ayrı
> kalır (acente → kontrat, değilse standart). Modül 30 allotment'ı bu acenteye bağlar (kota, release); modül 35 komisyonu /
> prim hesabını `agencyCommissionPct` üzerinden yapar; modül 33 kanal stop-sale'i ayrıdır (otel geneli).

### 30. Grup & allotment — Ali Kemal
**Gün sonu:** Acenteye ayrılan oda kotası tanımlı; müsaitlik hesabı kotayı düşüyor; rooming list yüklenip toplu check-in yapılıyor.
- [ ] Backend: Allotment, ReservationGroup tabloları + API
- [ ] Backend: `checkAvailability`'ye allotment düşümü; serbest bırakma tarihinde kota geri açılır
- [ ] Backend: rooming list import (Excel: ad, soyad, oda tipi, tarih)
- [ ] Ekran: Allotment tanımı (acente, tarih aralığı, oda tipi, adet, release günü)
- [ ] Ekran: Kota kullanım tablosu (verilen / kullanılan / kalan)
- [ ] Ekran: Grup dosyası (grup adı, rezervasyonlar, toplu check-in, toplu folyo)

### 31. Promosyon & kupon — arkadaşın
**Gün sonu:** "Erken rezervasyon %15", "3 gece kal 1 gece bedava" gibi kurallar tanımlanıyor; kupon kodu girilince fiyat düşüyor.
- [x] Backend: Promotion, Coupon tabloları + API; kural motoru (koşul: tarih, min. gece, oda tipi, erken rezervasyon günü)
- [x] Backend: fiyat hesabına promosyon uygulama, kupon doğrulama
- [x] Ekran: Promosyon formu (ad, geçerlilik, indirim tipi, koşullar)
- [x] Ekran: Kupon kodu üretimi (adet, tek kullanımlık mı)
- [x] Ekran: Kullanım raporu
- [x] Rezervasyon formuna ve web widget'a kupon alanı (rezervasyon formu ve düzenleme; widget modül 32'de — sunucu tarafı hazır, aşağıda)

> **📌 Modül 31 tamamlandı (14 Ekim 2026 — Ahmet).**
>
> **Kararlar (kullanıcı, 14 Ekim 2026):** bir rezervasyona **tek indirim** düşer — uygun kendiliğinden promosyonlar ve
> girilen kuponun promosyonu arasından misafire en avantajlısı (kupon daha avantajlı değilse kullanılmaz, hakkı düşmez);
> **acente (kontrat) satışına promosyon da kupon da uygulanmaz**; kuponlu rezervasyon iptal edilince / gelmeyince kupon
> hakkı **geri açılır** (iptal geri alınırken kupon kilitlenip yeniden sayılır; başkası kullandıysa geri alma reddedilir);
> konaklama kısalınca (düzenleme, erken çıkış) promosyon şartı bozulursa **indirim geri alınır** (önizlemede önceden
> söylenir, folyoya fark işlenir).
>
> **Veri** (migration `20261010090000_promotions_coupons`): `Promotion` (ad otel içinde tekil; taslak → yayında ⇄ durduruldu;
> indirim: yüzde / konaklama başına tutar / "X gece kal Y gece öde"; koşullar: satış dönemi, konaklama dönemi, en az / en
> fazla gece, erken rezervasyon / son dakika günü, oda tipleri, pansiyonlar, satış kanalları — acente hiçbir zaman),
> `Coupon` (kod otel içinde tekil, büyük harf; tek / sınırlı / sınırsız kullanım; üretim kimliği). Rezervasyonda
> `promotionId`, `couponId`, `promotionTerms` (açılıştaki **kopya** + satış günü — promosyon sonradan değişse de söz
> değişmez), `discountTotal`; gecede `discount` (tutar indirimli, liste fiyatı = tutar + indirim). CHECK'ler: türle indirim
> değeri tutarlı, acente kanalı yok, kupon ↔ promosyon ↔ kopya, acente satışında ve elle fiyatta promosyon yok.
>
> **Kural motoru** (`modules/promotions/rules.js`, saf, birim testli): koşullar; indirim yalnızca konaklama dönemindeki
> gecelere — yüzde her geceye (kuruşa), tutar gecelere fiyatları oranında (kuruş kalanı tarih sırasıyla, gecelerin
> toplamını aşmaz), "X kal Y öde" her X gecede en ucuz (X − Y) gece bedava (eşit fiyatta sondaki); en avantajlı teklif
> (eşitlikte kendiliğinden — kupon hakkı harcanmaz). **Kupon kullanımı** sayaçla tutulmaz: kupon satırı kilitlenip kuponla
> açılmış geçerli rezervasyonlar sayılır (iptalde hak kendiliğinden geri açılır); her oda bir kullanım (grupta hak
> yetmezse grubun hiçbiri açılmaz). Kilit sırası: rezervasyon → oda tipi → acente → promosyon → kupon.
>
> **Nerede uygulanır:** açma, grup, kanal isteği (WhatsApp / web chat / widget; olayda `couponCode`), kapasite onayından
> açılan, fiyat önizlemesi (tip kartında liste fiyatı + indirim, kuponun durumu: uygulanıyor / daha avantajlısı var / uymuyor
> / geçersiz / hak yetmez). **Düzenleme:** fiyat, konaklama ya da pansiyon değişince kopyadaki koşullar (kopyadaki satış
> günüyle) yeniden denetlenir — tutuyorsa indirim yeni gecelere göre, tutmuyorsa kalkar (içerideki misafirin geçmiş geceleri
> dahil; fark folyoya düzeltme); kupon eklenir (mevcut indirimden avantajlıysa), indirim kaldırılır; acente atanınca ya da elle
> fiyat girilince kalkar. Yeni uç `POST /reservations/:id/preview`: düzenlemenin aynı hesabı, yazmadan. **Erken çıkış:**
> kalan gecelerle şart yeniden denetlenir. **Gelmedi ücreti:** konaklama tek geceye iner, şart o gece için denetlenir
> (bedava ilk gece ücretsiz sayılmaz). Erken giriş / geç çıkış ücreti "gecenin yüzdesi"yse gecenin liste fiyatından. AI asistanı
> fiyatı konuşmanın kanalıyla sorar (kanala özel promosyon misafire söylenen fiyatla açılan fiyatı ayırmaz). Tutar
> indirimli promosyon varken otelin para birimi değişmez.
>
> **API** (`/promotions`): liste (arama, durum, kendiliğinden / kuponla; kullanım sayıları tek ek sorguyla), kart (kullanım,
> kupon üretimleri, yayına almayı engelleyen eksikler ve uyarılar), aç / düzenle (sürümlü), yayına al / durdur, sil (hiç
> kullanılmamışsa), kupon üret (toplu rastgele — karışmayan harfler, isteğe bağlı önek — ya da tek kod; üretim başına tek denetim
> kaydı), kupon listesi (kod araması, kullanılmış / kullanılmamış, açık / kapalı, üretim), kupon kapat / aç, üretimi dışa
> aktar, kullanım raporu (satış ya da giriş gününe göre; promosyon başına geçerli / iptal, gece, liste, indirim, net, kupon;
> toplamlar), promosyonun rezervasyonları. İzinler `promotions.view` (müdür, muhasebe), `promotions.manage` (müdür);
> kupon alanı `reservations.*` içinde. Canlı kanal `promotions.changed`.
>
> **Ekran:** `/promosyonlar` (liste — kuralın okunur özeti, kullanım; kullanım raporu sekmesi), `/promosyonlar/yeni` ve kart
> (`Kurallar` — kuralın cümlesi yazarken canlı, başkası değiştirirse uyarır; `Kuponlar` — üret, Excel'e aktar, süz, kapat;
> `Kullanım`). Rezervasyon formunda kupon alanı ve tip kartında liste fiyatı / indirim; düzenleme penceresinde indirim
> bölümü (kaldır, kupon) ve yeni toplamla indirimin akıbeti; detayda promosyon, kupon, gece indirimi; çıkış penceresinde
> erken ayrılışın indirime etkisi.
>
> **Ölçüm** (`scripts/perf-promotions.mjs`; yayında 250 promosyon, 100 bin kupon, 27 bin promosyonlu rezervasyon, 550 bin
> rezervasyonlu tablo): liste 9–13 ms, kart 9 ms, kupon listesi 11–20 ms, kullanım raporu 17–21 ms, fiyat önizlemesi 14 ms
> (kuponla 16 ms), rezervasyon açma ~85 ms (promosyonsuzla aynı düzey), aynı kuponla 8 eşzamanlı rezervasyon ~560 ms.
>
> **Test:** kural motoru 27, sözleşme 10, ekran dönüşümleri 9 birim; entegrasyon 27 (yaşam döngüsü, kupon üretimi / kapatma,
> en avantajlı teklif, kupon hakkı ve iptal / geri alma, eşzamanlı tek kullanım, grup, acente / elle fiyat, kanal ve AI
> asistanı, kopya, gelmedi ücreti, uzatma / kısaltma / kupon ekleme / kaldırma, erken çıkış ve geç çıkış ücreti, önizleme,
> rapor, izinler). Demo betiği 7 promosyon ve kuralla fiyatlanmış ~900 promosyonlu rezervasyon üretir.
>
> **Devir:** **modül 32 (widget)** kupon alanını `POST /reservations/quote` (`couponCode`, `source: 'WIDGET'`; dönen
> `coupon.status`) ile gösterir, isteği `reservation.requested` olayında `couponCode` ile gönderir (uymayan / dolmuş kupon
> isteği reddeder). Modül 28 standart fiyat kaynağını değiştirince promosyon onun üstüne düşer (`priceRoomLine` → liste
> fiyatı). Modül 34 yield fiyatı da liste fiyatıdır; promosyon üstüne uygulanır. Modül 56 sadakat programı kupon üretimini
> (`createCoupons`) kullanabilir.

### 32. Online rezervasyon motoru — Ali Kemal
**Gün sonu:** Otel sitesindeki widget'tan misafir tarih seçip fiyat görüyor, bilgilerini girip rezervasyon yapıyor; chat balonu da aynı widget'ta.
- [ ] Backend: public API (müsaitlik, fiyat, rezervasyon talebi; rate limit; API key)
- [ ] Widget: ayrı küçük React uygulaması (tek script ile gömülür)
- [ ] Widget: adımlar (tarih + kişi → oda tipi + fiyat listesi → misafir bilgileri → özet → onay)
- [ ] Widget: kupon alanı, pansiyon seçimi, çoklu dil hazırlığı
- [ ] Widget: 8'deki chat balonunu içine al
- [ ] Rezervasyon `source=WIDGET` ile reservation-worker zincirine düşer, onay e-postası gider

### 33. Kanal yönetimi / Channel Manager — arkadaşın
**Gün sonu:** Müsaitlik ve fiyat değişince OTA'ya gidiyor, OTA'dan gelen rezervasyon sisteme düşüyor; oda tipleri eşleştirilmiş.
- [x] Backend: Channel, ChannelRoomMapping, ChannelSyncLog tabloları + API
- [x] Adaptör 1: iCal (Airbnb / Booking iCal export-import)
- [x] Adaptör 2: bir OTA API'si (Booking veya bir channel manager aracısı) — Channex.io
- [x] Ekran: Kanal listesi + bağlantı ayarları
- [x] Ekran: Oda tipi eşleştirme (bizim tip ↔ kanal tipi)
- [x] Ekran: Senkron logu (ne gönderildi, hata) + manuel senkron butonu, stop-sale
- [x] Aktör: channel-sync-worker paketi (`room.availability.changed` / `rate.changed` → kanala gönder; kanal webhook → `reservation.requested`) — envanter olayları + `rate.changed`; kanal rezervasyonu `channel.booking.received` ile (aşağıda)

> **📌 Modül 33 tamamlandı (15 Ekim 2026 — Ahmet).**
>
> **Kararlar (kullanıcı, 14 Ekim 2026):** OTA bağlantısı **Channex.io** üzerinden (Booking.com, Expedia, Airbnb, Agoda…
> Channex'e, biz Channex'e bağlanırız; Booking'e doğrudan bağlantı Connectivity Partner sertifikası ister). **OTA
> rezervasyonu onaylı açılır, tutarı OTA'nın tutarıdır**; yer yoksa reddedilmez — kapasite aşılarak açılır, resepsiyona
> kritik "overbooking" uyarısı düşer. **iCal'deki dolu günler rezervasyon olarak açılır** (onaylı; iCal ad / fiyat taşımaz:
> misafir "Airbnb misafiri HM…", fiyat geçici olarak sistem fiyatı ve kayıt "doğrulanmalı"); takvimden kalkan, henüz
> gelinmemiş rezervasyon iptal edilir.
>
> **Veri** (migration `20261014090000_channel_manager`): `Channel` (Channex: ortam, mülk, **şifreli** API anahtarı ve webhook
> sırrı, mülkün adı / para birimi; iCal: takvimin geldiği yer; fiyat farkı %, kaç gün ileri; taslak → senkronda ⇄ durduruldu;
> yumuşak silme), `ChannelState` (gönderim durumu ayrı tabloda: kirli pencere, tam eşitleme isteği, son işler, hata, bekleme —
> kanal ayarının sürümü arka plandaki gönderimle ilerlemez), `ChannelRoomMapping` (oda tipi ↔ Channex oda tipi ya da iCal
> takvimi; dışa aktarma belirteci), `ChannelRateMapping` (Channex fiyat planı ↔ pansiyon), `ChannelAriState` (kanala en son
> gönderilen değerler), `ChannelStopSale`, `ChannelSyncLog` (90 gün), `ChannelBooking` + `ChannelBookingRevision` (gelen
> rezervasyon kutusu), rezervasyonda `channelBookingId` / `channelRoomIndex`. CHECK'ler: türle alanlar, fark ve gün aralığı,
> kirli pencere, kapatma notu; ad otel içinde, Channex mülkü bütün kanallarda tekil (kısmi index). Uyarı türleri
> `CHANNEL_BOOKING`, `CHANNEL_SYNC`.
>
> **Gönderim (Channex):** envanter olayları (rezervasyon, iptal, giriş / çıkış, oda atama, arıza, oda envanteri) ve
> `rate.changed` (taban fiyat, sezon; modül 28 / 34 de yayınlar) kanalı **kirli işaretler** (gün penceresi birikir). Zamanlanmış
> iş (5 sn'de bir) penceredeki değerleri hesaplar — müsaitlik oda planının takviminden, fiyat taban × sezon + kanal farkı,
> stop-sale kanalın kendi kapatmaları — ve **kanala en son gönderilenle karşılaştırıp yalnızca farkı**, ardışık aynı
> değerleri tek aralıkta, **en fazla iki çağrıda** gönderir (müsaitlik oda tipine, fiyat + stop-sale fiyat planına). Kanal
> başına en sık 10 sn'de bir (Channex sınırı dakikada 10 + 10). **Tam eşitleme** (500 gün, iki çağrı): senkrona alınınca,
> eşleştirme / fiyat farkı değişince, elle ve gece (otelin saatiyle 02–05) bir kez. Hata: pencere geri işaretlenir; 429'da 1 dk,
> anahtar hatasında 30 dk, geçici hatada 30 sn × 2ⁿ (en çok 15 dk) beklenir; 3 art arda hatada / anahtar hatasında müdüre
> uyarı. Kanalın reddettiği satırlar loga "kısmen" düşer. Promosyon kanala gitmez; pansiyon farkı modül 28 ile gelir (o zamana
> kadar bir tipin bütün planları aynı fiyatı alır).
>
> **Gelen rezervasyon (Channex):** revizyon akışı dakikada bir okunur (webhook gelince hemen; webhook sırrı başlıkta, sabit
> zamanlı karşılaştırma); her revizyon **önce saklanır, sonra teyit edilir** (kart bilgisi saklanmaz). Kanal aktörü işler:
> yeni → oda başına onaylı rezervasyon (OTA tutarı elle fiyat olarak, gerekçesi kanal; pansiyon fiyat planından; misafir
> kartı; not: kanal, kod, ödeme kimde); değişiklik → bekleyen / onaylı rezervasyon güncellenir (azalan oda iptal); iptal →
> cezasız iptal (iptal eden "kanal:…"). Eski revizyon yenisinin üstüne yazılmaz; aynı rezervasyonun revizyonları sırayla.
> Yapılamayan adım (eşleşmeyen plan, içerideki / çıkmış misafir, geçmiş giriş, elle fiyatlı rezervasyonun tarihi) **"elle
> işlenmeli"** olur ve resepsiyona görev düşer (`Kanal rezervasyonu` modülü, `reservations.manage`); para birimi farkı ve
> iCal tutarı **"doğrulanmalı"**. Müdür gereğini yapınca kaydı notla kapatır. Aktör kapalıyken gönderim tetikleyicileri
> görev açmadan atlanır (actor-kit'e `skipWhenDisabled` kancası; açılınca tam eşitleme), gelen rezervasyon göreve düşer.
>
> **iCal:** dışa aktarma `/channel-ical/<belirteç>.ics` (oturumsuz, gizli belirteç; satılamayan — boş odası olmayan ya da
> stop-sale'deki — günler "dolu"; 60 sn önbellek; kendi kayıtlarımız UID sonekiyle tanınır, kanal geri yansıtsa döngü olmaz).
> İçe aktarma 15 dk'da bir: yalnızca https, özel ağa çözülen ad / yönlendirme reddedilir, 2 MB / 15 sn sınırı; Airbnb'nin
> "Not available" kapatması rezervasyon açmaz; takvim birden boş gelirse toplu iptal yapılmaz (uyarı); iptalden sonra
> yeniden görünen kayıt yeniden açılır.
>
> **API** (`/channel-manager`, `channel_manager.view` / `.manage` — müdür): kanal listesi (son senkron, eşleşme, dikkat
> sayıları), kart (eşleştirme, güncel stop-sale'ler, eksikler / uyarılar), aç / düzenle (sürümlü; bağlantı yeniden
> doğrulanır; mülk değişirse eşleştirme silinir), senkrona al / durdur, sil (durmuşken), Channex oda tipi / fiyat planı
> listesi, eşleştirme kaydı, stop-sale ekle / kaldır, elle senkron, webhook kurulumu, senkron logu (süzgeçli, ayrıntı),
> kanal rezervasyonları (süzgeç, arama) ve kapatma. Oturumsuz: `POST /webhooks/channex/:id`, `GET /channel-ical/:dosya`.
> Canlı kanal `channel-manager.changed`. Rezervasyon detayında kanal, kod ve durum.
>
> **Ekran:** `/kanallar` (liste, yeni kanal), kanal kartı: `Ayarlar` (bağlantı, webhook), `Eşleştirme` (Channex oda tipi
> ve planları; iCal takvim adresi ve kopyalanan dışa aktarma adresi), `Stop-sale`, `Senkron logu` (ayrıntı penceresi),
> `Rezervasyonlar`. Zamanlar otelin saatiyle.
>
> **Ölçüm** (`scripts/perf-channels.mjs`; 550 bin rezervasyonlu veritabanı, ufukta 99 bin, 12 oda tipi × 2 plan): 500 günlük
> değer hesabı ~0,5 sn, tam eşitleme ~0,8 sn, olay başına işaretleme 2–3 ms, 3 gecelik fark gönderimi ~60 ms, bütün ufuk farkı
> ~0,5 sn, listeler (100 bin log, 20 bin kayıt) 9–67 ms.
>
> **Test:** aktör paketi 48 (fark / aralık, iCal okuma / yazma, Channex istemcisi ve hata sınıfları, normalleştirme, olay
> yönlendirme), sözleşme 10, actor-kit +2, ekran dönüşümleri 9 birim; entegrasyon 31 (bağlantı, eksikler, tam ve fark
> gönderimi, stop-sale, fiyat, hata / 429 / anahtar, aktör kapalı, OTA yeni / overbooking / değişiklik / eski revizyon / iptal
> / çok oda / eşleşmeyen / para birimi / içerideki misafir, webhook, iCal dışa / içe / boş takvim / özel ağ, izinler, listeler,
> silme).
>
> **Bu modülde düzeltilen (modül 31):** promosyon kullanım raporu ham SQL'e saat dilimli tarih veriyordu; veritabanı oturumu
> UTC değilse (yerelde `Europe/Istanbul`) gece 00:00–03:00 satışları önceki güne sayılıyordu — `::timestamp` ile düzeltildi,
> saatten bağımsız test eklendi. Yayındaki promosyon API'den de silinemez (önce durdurulur; ekran zaten göstermiyordu —
> satışla yarışan silme rezervasyonu anlamsız bir kısıt hatasıyla düşürebilirdi).
>
> **Devir:** **modül 28** pansiyon / fiyat planı: `rate.changed` yayınlamalı; kanala giden fiyat `modules/channel-manager/ari.js`
> → `computeRoomTypeValues` (şimdilik taban × sezon). **Modül 34** yield: onaylanan fiyat `rate.changed` ile kanallara gider.
> **Modül 32** widget doğrudan satıştır (kanal değildir). Canlıya bağlanmak için otelin Channex hesabı, mülk kimliği ve API
> anahtarı gerekir (önce test ortamı; Channex PMS sertifikasyonu için kanıtlar senkron logunda: görev kimlikleri).

### 34. Dinamik fiyat / yield — Ali Kemal
**Gün sonu:** Sistem günde bir fiyat önerisi üretiyor, gerekçesiyle onaya düşüyor; onaylanınca fiyat değişip kanallara gidiyor.
- [ ] Kural tabanlı yield (worker): doluluk > %80 → +%10, < %30 ve 7 gün kaldı → −%15 (parametreler ayarlardan)
- [ ] pricing-agent paketi (günde 1 çalışır; doluluk, kalan gün, geçen yıl, etkinlik takvimi okur; öneri + gerekçe; `approval.requested`)
- [ ] Backend: PriceSuggestion tablosu; onaylanınca RatePlan güncelle → `rate.changed`
- [ ] Ekran: Öneriler listesi (tarih, oda tipi, mevcut, önerilen, gerekçe) + onayla / reddet / düzenle
- [ ] Ekran: Yield kuralları ayarı
- [ ] Ekran: Fiyat geçmişi grafiği

> **FlexAI 2.0'dan not (3 Kasım 2026 — Ahmet):** `PriceSuggestion`'ın gerekçesini serbest metnin yanında yapılandırılmış girdi
> olarak da sakla (doluluk, forecast, geçen yıl… ayrı alanlar): 90 no-show riskini, 91 rakip fiyatını bu girdilere
> ekleyecek; öneri yine onaylı kalacak.

### 35. Acente bonus / sadakat — arkadaşın
**Gün sonu:** Acentelerin satış hedefleri ve hak ettiği primler dönem sonunda raporlanıyor.
- [x] Backend: AgencyBonusRule, AgencyBonus tabloları; dönem sonu hesaplama servisi
- [x] Ekran: Bonus kuralı (acente, dönem, hedef gece/ciro, prim oranı)
- [x] Ekran: Acente puan / hedef durumu
- [x] Ekran: Hak ediş raporu (dönem sonu, onaylı)

> **📌 Modül 35 tamamlandı (15 Ekim 2026 — Ahmet).**
>
> **Kararlar (kullanıcı, 15 Ekim 2026):** üretim = dönemin içine düşen, misafirin **gerçekten kaldığı** geceler (iptal /
> gelmeyen sayılmaz; dönem sınırını aşan konaklama gece gece bölünür; eldeki geceler yalnızca tahmin); matrah = folyoya
> işlenen **vergisiz oda geliri** (gelir raporuyla aynı tanım, komisyon düşülmez; ciro hedefi de bununla ölçülür); hak ediş
> **onay kuyruğuna** gider, **dört göz** (gönderen onaylayamaz); "acente puanı" = hedefe ulaşma yüzdesi + kademe + zamana göre
> durum (ayrı puan defteri yok — misafir sadakati modül 56).
>
> **Veri** (migration `20261015090000_agency_bonus`): `AgencyBonusRule` (acente, dönem ≤ 731 gün, ölçüt gece / ciro, uygulama
> **tüm üretime** (geriye dönük) ya da **yalnız aşan kısma** (dilimli), hedef, 1–10 kademe, oda tipi süzgeci, prim tavanı;
> taslak → yürürlükte → iptal; **aynı acentenin aynı ölçütte çakışan iki yürürlükteki kuralı olamaz** — ölçüt başına EXCLUDE;
> ilerleme özeti kolonları ham SQL'le yazılır, `updatedAt`'e dokunmaz), `AgencyBonus` (kural başına tek hak ediş; kuralın hesap
> anındaki kopyası + sonuç + durum izi CHECK'i: hesaplandı → onay bekliyor → onaylandı → ödendi), `AgencyBonusLine` (hak edişin
> dayandığı rezervasyonlar **dondurulur**: rezervasyon başına dönemdeki gece ve ciro). Uyarı türü `AGENCY_BONUS`, onay türü
> `AGENCY_BONUS` (dört göz listesinde).
>
> **Hesap** (`agency-bonus/rules.js`, birim testli): eşiğe eşit üretim kademeye ulaşır; dilimli hesapta gece ölçütünün dilimi
> "dilimdeki gece × dönemin ortalama gece geliri" ile tutara çevrilir (hangi gecenin "aşan" olduğu sırasından bağımsız); prim
> yuvarlanmış dilimlerin toplamıdır (döküm toplamı primi tutar); tavan; eksi ciro sıfır. Ters kayıt **asıl gecenin gününe** yazılır
> (dönem sonra iptal edilen gece o dönemden düşer). Zamana göre durum: doğrusal beklentiye göre önünde / yakın (%10) / gerisinde.
>
> **Akış:** dönemin son gecesi kapanınca zamanlanmış iş (30 dk) hak edişi **kendisi hesaplar**, yöneticinin ziline "onaya gönderin"
> düşer; dönem içinde kademe yükselince bir kez uyarı. Onaya gönderirken **bayatlık** denetlenir (kural hesaptan sonra değiştiyse
> ya da bugünkü üretim hesaptakinden farklıysa önce yeniden hesap). Prim doğmayan dönem kuyruğa gitmeden kapanır. Ret / süre dolumu
> (7 gün) "hesaplandı"ya döner (gerekçe görünür); onaylı ama ödenmemiş hak ediş gerekçeyle yeniden açılır (sürüm artar); muhasebe
> ödendi işaretler (gün + belge no; ileri tarih ve onaydan önce olamaz), gerekçeyle geri alır. Hak edişi onaya gitmiş kural
> değiştirilemez / iptal edilemez; dönemi uzatılan kuralın taslak hak edişi silinir. Kilit: kural → hak ediş.
>
> **API** (`/agency-bonus`): özet, kurallar (liste: evre / durum / arama / hedefe ulaşma sırası; önizleme; aç / düzenle / yürürlüğe al /
> iptal / sil / hesapla), hak edişler (rapor: durum kırılımıyla; ekran: bugünkü veriyle fark; döküm sayfalı + arama; Excel parçalı;
> onaya gönder / yeniden aç / ödendi / geri al). İzinler `agency_bonus.view` (müdür, muhasebe), `.manage` (müdür), `.pay`
> (muhasebe, müdür). Canlı kanal `agency-bonus.changed`.
>
> **Ekran:** `/acente-primleri` (özet kutuları; hedef durumu: ilerleme çubuğu kademe işaretleriyle, puan, kademe, tempo; hak ediş
> raporu), kural formu (kademe satırları, okunur kademe cümleleri, **kaydetmeden önizleme**), kural ekranı (canlı: gerçekleşen,
> eldekiyle tahmin, şu ana kadarki / tahmini prim, dilim dökümü, kademe merdiveni, aylık üretim), hak ediş ekranı (rakamlar, uyarılar,
> akış, geçmiş, rezervasyon dökümü, Excel), acente kartında "Prim ve hedef" sekmesi; onay penceresinde hak edişe bağlantı.
>
> **Ölçüm** (`scripts/perf-agency-bonus.mjs`; 550 bin rezervasyon, 3000 acente, 1803 kural, 25 bin rezervasyonlu "dev tur
> operatörü"): ilerleme işi (1202 kural, tek sorgu) 0,76 sn; liste 8–16 ms; özet 4 ms; dev acentenin kural ekranı 0,36 sn; hak
> ediş hesabı 2,4 sn (ilk sürüm 4,6–6,6 sn idi; döküm `INSERT … SELECT` ile veritabanında yazılıyor); döküm sayfası 16–150 ms;
> 25 bin satır Excel 1,6 sn (10 binlik parçalar). Plan: acente index'i + gece / folyo index'leri.
>
> **Test:** kural motoru 22 + sözleşme 12 + form 7 birim; entegrasyon 27 (üretim tanımı, süzgeç, ters kayıt, işlenmemiş gece,
> eldeki, yaşam döngüsü, çakışma + eşzamanlı yürürlüğe alma, eşzamanlı hesap, bayatlık, dört göz, ret / süre dolumu, prim yok,
> ödeme / geri alma / yeniden açma, dilimli + tavan, ilerleme özeti ve kademe uyarısı, dönem sonu işi, liste / rapor / döküm,
> önizleme, izinler, otel kapsamı, bozuk tarih 400).
>
> **Yan düzeltmeler (bu modülde bulundu):** ortak `dateField` boş / bozuk tarihte durdurucu hata (öncesinde dönem denetimi
> `toISOString`'de çöküyordu: formda doğrulama sessizce duruyor, sorguda 400 yerine 500 — modül 29, 31, 33 şemaları da
> etkileniyordu); form içindeki tipsiz düğmeler formu gönderiyordu (kontrat ekranında "Değişiklikleri at" değişikliği
> **kaydediyordu**; promosyon formunda "Vazgeç" kaydediyordu; kur satırı ekle / sil ve çamaşır "Vazgeç" formu gönderiyordu) — 17,
> 19, 29, 31, 33'te düzeltildi; modül 4 ve 6 ekranlarında aynı kalıp var (Ali'nin).
>
> **Devir:** acente carisinden prim düşümü / ödeme kaydı **modül 47**; kontrat fiyatı ve fiyat planı (28) değişse de prim folyoya
> işlenen gelirden hesaplanır; misafir sadakat puanı modül 56'dır.

### 36. Call center & satış CRM — Ali Kemal
**Gün sonu:** Telefonla gelen her talep kayıtlı; teklif gönderiliyor; takip görevleri hatırlatıyor.
- [ ] Backend: Lead, CallLog, Quote tabloları + API
- [ ] Backend: teklif PDF + e-posta gönderimi (notification-worker)
- [ ] Ekran: Arama kaydı formu (arayan, telefon, talep, sonuç)
- [ ] Ekran: Fırsat panosu (yeni / teklif verildi / bekliyor / kazanıldı / kaybedildi)
- [ ] Ekran: Teklif oluştur (tarih, oda, fiyat) → gönder → kabul edilince rezervasyona çevir
- [ ] Ekran: Hatırlatmalar (bugün aranacaklar)

> **FlexAI 2.0'dan not (3 Kasım 2026 — Ahmet):** `CallLog`'a kanal (PERSONEL / SESLİ AI), kayıt referansı ve özet alanı düşün:
> 101 (sesli santral) çağrılarını ve geri arama görevlerini buraya yazacak. 90 grup değerlendirmesi teklif ekranına öneri koyacak.

### 37. Satış projeleri & banket / etkinlik — arkadaşın
**Gün sonu:** Düğün, toplantı gibi etkinlikler salon takviminde; teklif → sözleşme → fatura akışı çalışıyor.
- [x] Backend: Venue, Event, EventItem tabloları + API
- [x] Ekran: Salon tanımları (kapasite, düzen tipleri, saatlik/günlük fiyat)
- [x] Ekran: Etkinlik takvimi (salon × tarih)
- [x] Ekran: Etkinlik dosyası (müşteri, tarih, salon, kişi, düzen, ekipman, menü linki (43), fiyat) — menü bağı modül 43'te (aşağıda)
- [x] Ekran: Teklif → sözleşme (PDF) → depozito → fatura (16'ya bağlanır) — "faturaya hazır" + proforma; resmî fatura 16 / 49

> **📌 Modül 37 tamamlandı (17 Ekim 2026 — Ahmet).**
>
> **Kararlar (kullanıcı, 16 Ekim 2026):** etkinliğin **kendi hesabı** (folyo yok) ve ödemeleri kasada "Etkinlik" kaynağıyla; büyük
> tahsilat / iade / hatalı girişin iptali onay kuyruğundan, **dört göz** (onay türü `EVENT_PAYMENT`); PDF **sunucuda** (pdfkit +
> gömülü DejaVu); **sıralı opsiyon** (aynı saatte önce tutan 1. opsiyon, yalnız 1. kesinleşir, opsiyon günü geçince düşer);
> fatura tarafı **"faturaya hazır" + proforma**, resmî fatura 16 / 49'da.
>
> **Veri** (migration `20261016090000_banquet_events` + `20261017090000_banquet_same_event_holds` + `20261017100000_banquet_hold_window_index`):
> `Venue` (iki seviyeli **bölünebilir salon**: bütün → parçalar; düzen başına kapasite `VenueCapacity`; saatlik / yarım / tam gün
> fiyatı; kurulum / söküm dakikası), `EventEquipment` (stoklu), `EventClient`, `EventSettings` (opsiyon süresi, teklif geçerliliği,
> depozito %, imzalı sözleşme şartı, iptal kademeleri, sözleşme şartları), `Event` (talep → opsiyon → kesin → gerçekleşti; iptal /
> kayıp; durum izi CHECK'i), `EventSession` (salon, düzen, kişi, otelin duvar saatiyle girilen başlangıç / bitiş), `EventVenueHold`
> (oturumun **atomik salon parçası** başına tutma, kurulum / söküm dahil; **kesin tutmalar farklı etkinlikler arasında çakışamaz** —
> EXCLUDE, aynı etkinliğin arka arkaya oturumları serbest), `EventItem` (kişi başı / adetli, indirim, vergi kategorisi; tutarlar
> folyonun vergi motoruyla), `EventInstallment`, `EventPayment` (tahsilat +, iade −, iptal kaydı; tekrar gönderim anahtarı),
> `EventDocument` (teklif / sözleşme / proforma: anlık görüntü + PDF, türe göre tek güncel sürüm — kısmi tekil index), `EventSequence`
> (ETK / TKL / SZL / PRF-yıl-sıra; sürümler "TKL-2026-0007/2"). Uyarı türü `BANQUET`.
>
> **Kurallar** (`banquet/rules.js` + sözleşme, birim testli): salon kira önerisi (saat / yarım gün / gün, en ucuzu), atomik parça,
> sıra (kesin hep önde; eşit anda kimlik), ekipman tepe kullanımı (süpürme çizgisi), faturalanacak kişi = kesinleşmeden garanti
> (yoksa tahmin), gerçekleşince en çok (garanti, gerçekleşen); iptal kademesi **alt sınır** ("en az N gün kala"; politika 0 günü
> içermek zorunda — yoksa son günler bedelsiz kalıyordu); ödeme planı dağıtımı ve önerisi; tahsilat / iade kuralı (kapanmış
> dosyada kalan borçtan fazlası alınmaz ve yalnızca borcun üstündeki fazla iade edilir, alınmamış para iade edilmez, kaybedilen
> dosya borçsuz); belge kuralları (teklif satışta,
> sözleşme kesine kadar, proforma borç kesinleşince; karar günü; teklif geçerliliği).
>
> **Akış ve eşzamanlılık:** kilit sırası etkinlik → salon → ekipman. Kesinleştirme ve kesin dosyanın oturum değişikliği rezerve
> edilen salonu + atomik parçalarını kilitler, salon tanımını **kilitten sonra** yeniden okur (kapasite / pasiflik yarışı yok); sıra,
> kapasite, stok, imzalı sözleşme kilit altında denetlenir, son savunma veritabanı kısıtıdır. Salon / ekipman güncellemesi aynı
> kilitleri alır; stok, ileri tarihli kesin ayrımların altına düşürülemez. Opsiyon bırakılınca / düşünce / dosya iptal ya da kaybedilince
> sırası yükselen opsiyonun sorumlusuna, kesinleşen salonda bekleyenlere zil düşer. Tahsilat sürüm damgasını ilerletmez (açık
> formlar bozulmaz). Zamanlanmış iş (15 dk): otelin iş günüyle opsiyon dolumu (kilit altında yeniden bakar), opsiyonun son günü,
> gecikmiş taksit (günde bir), kapatılmamış kesin etkinlik hatırlatması.
>
> **API** (`/banquet`): özet, takvim (≤ 31 gün), salon uygunluğu (kim tutuyor, kaçıncı opsiyon olur, kira önerisi), salon /
> ekipman / müşteri / politika, etkinlik (liste: durum / tür / tarih / arama / benim; ekran), oturum, kalemler, ödeme planı (+ öneri),
> durum geçişleri, ödemeler (imleçli; tahsilat / iade / iptal isteği), belgeler (üret / karar / PDF). Kasa (17): özet ve hareketler
> folyo + etkinlik birleşik (aynı imleç), kaynak süzgeci. İzinler `banquet.view` (müdür, ön büro, muhasebe, F&B), `.manage`,
> `.setup` (müdür), `.payment` (müdür, ön büro, muhasebe). Canlı kanal `banquet.changed`; etkinlik ödemesi kasa kanalını da tazeler.
>
> **Ekran:** `/etkinlikler` (özet kutuları, dosya listesi), salon takvimi (salon × gün, kesin / 1. opsiyon / sırada renkleri, bütün
> salon parçalarında da görünür), yeni dosya (müşteri ara / yeni müşteri), dosya ekranı: genel, program (uygunluk önizlemeli
> oturum diyaloğu), fiyat kalemleri (tablo düzenleyici, kuruş hassasiyetli önizleme), ödemeler (plan + satırlar + tahsilat / iade /
> hatalı giriş), belgeler (üret, kabul / ret / imza, PDF); salon ve tanımlar (salonlar, ekipman, müşteriler, politika — kademe
> aralıkları okunur). Kasa ekranında etkinlik satırları ve bağlantılar; onay penceresinde etkinlik ödemesine bağlantı.
>
> **Ölçüm** (`scripts/perf-banquet.mjs`; 56 atomik salon, 34.963 etkinlik, 38.763 oturum, 36.582 tutma, 209.778 kalem, 46.199
> ödeme, 20.000 müşteri): liste 26–84 ms (derin sayfa 500 dahil), etkinlik ekranı 10–29 ms, takvim 7 gün 16 ms / 31 gün 53 ms,
> uygunluk 7 ms, özet 86–97 ms, gecikmiş taksit 44 ms, kasa özeti / hareketleri < 10 ms, dosya → oturum → kalem → opsiyon → kesin
> 0,7–1,5 sn (beş işlem), iş turu 200 opsiyon dolumu 6,9 sn. Takvim sorgusu sıralı tarıyordu → `(hotelId, endAt)` index'i (geçmiş
> birikse de tarama gelecek ufkuyla sınırlı).
>
> **Test:** kurallar 26 + PDF 3 + sözleşme 9 + form 5 birim; entegrasyon 16 (yaşam döngüsü ve tutarlar, garanti altı gerçekleşme,
> sıralı opsiyon + haberler, bölünebilir salon, kurulum / söküm aralığı, aynı etkinliğin arka arkaya oturumları, eşzamanlı dört
> kesinleştirme tek kazanan, kapasite / düzen / pasif salon, ekipman stoğu ve stok düşürme, opsiyon dolumu işi, gecikmiş taksit,
> ödemeler + dört göz + iade sınırı + iptal kaydı + tekrar gönderim + kasa birleşimi ve imleci, iptal bedeli kopyası + iade uyarısı
> + bedelli proforma, belgeler: sürüm / kabul / imzasız kesinleşmeme / eşzamanlı üretim / PDF ve izin, sürüm denetimi, izinler ve
> otel kapsamı).
>
> **Yan düzeltmeler:** `ValidationError` artık `{ fields: {...} }` ayrıntısını da formun alanlarına bağlıyor (modül 35'in alan
> hataları da yalnızca bildirimde kalıyordu).
>
> **Devir:** menü bağı **modül 43** (EventMenu etkinliğe bağlanınca kişi başı menü kalemi menüden gelir; bugün kalem serbest
> metin); resmî fatura **16 / 49** (proforma ve "faturaya hazır" sayısı hazır); etkinlik carisi / alacak takibi ön muhasebe (47).

---

## 5. F&B / POS

### 38. Menü & reçete — Ali Kemal
**Gün sonu:** Restoran menüsü ve her ürünün reçetesi tanımlı; ürün maliyeti otomatik hesaplanıyor.
- [ ] Backend: MenuCategory, MenuItem, Recipe, RecipeLine tabloları + API — **MenuCategory / MenuItem + API modül 39'da yapıldı** (aşağıdaki not); **Recipe / RecipeLine + API modül 43'te yapıldı** (aşağıdaki not)
- [ ] Backend: maliyet hesabı (reçete satırları × stok birim maliyeti) — **modül 43'te yapıldı** (malzeme kartının birim maliyetiyle; 44 hareketli ortalamayı yazar)
- [ ] Ekran: Menü grupları ve ürünler (ad, fiyat, KDV, görsel, aktif) — **görsel dışında modül 39'da yapıldı** (`/pos/tanimlar`)
- [ ] Ekran: Reçete editörü (ürün → malzeme + miktar + birim) — **modül 43'te yapıldı** (`/mutfak`)
- [ ] Ekran: Maliyet / kâr marjı tablosu — **modül 43'te yapıldı** (reçete listesi, "yalnız menü ürünleri")
- [ ] Ekran: QR menü için public JSON çıktısı (53 kullanır)

> **📌 Ali'ye not (modül 39, 20 Ekim 2026 — Ahmet):** kullanıcı kararıyla 38'in **menü kısmı** POS'la birlikte yapıldı:
> `MenuCategory` (ad, sıra, aktif, satıldığı satış noktaları — boşsa her yer) ve `MenuItem` (grup, kod, ad, açıklama, **vergi dahil**
> fiyat, vergi kategorisi, mutfak istasyonu HOT / COLD / BAR / PASTRY / NONE, aktif, sıra, "tükendi"); API `/pos/menu/categories`,
> `/pos/menu/items` (+ `/sold-out`), tanım ekranı `/pos/tanimlar`, izin `pos.setup`. Silme yok (satılan ürün pasife alınır; adisyon
> kalemi gönderildiği anki ad / fiyat / vergi / istasyonu kopyalar). **Sende kalan:** Recipe / RecipeLine, maliyet ve kâr marjı,
> ürün görseli, QR menü JSON'u — `MenuItem`'a bağlanabilir. Stok düşümü için POS `fnb.order.paid` yayınlıyor (modül 39 notu).
>
> **📌 Ali'ye not (modül 43, 27 Ekim 2026 — Ahmet):** kullanıcı kararıyla 38'in **reçete kısmı** (Recipe / RecipeLine, maliyet, reçete
> editörü, maliyet / kâr marjı tablosu) ve 44'ün **yalın stok kartı** (`StockItem`: kod, ad, grup, stok birimi, birim maliyet, alerjen)
> banket F&B ile birlikte yapıldı (modül 43 notu). Reçete satırı malzeme ya da ara reçete, fire yüzdeli; reçete restoran ürününe
> (`Recipe.menuItemId`) bağlanır. **Sende kalan:** ürün görseli, QR menü JSON'u; 44'te depo / hareket / sayım ve hareketli ortalama
> maliyetin `StockItem.unitCost`'u güncellemesi, `fnb.order.paid` ile reçeteden stok düşümü.

### 39. Restoran POS — arkadaşın
**Gün sonu:** Garson masayı açıp sipariş giriyor, adisyon kapatıyor, ödeme alıyor veya odaya yazıyor.
- [x] Backend: Table, Order, OrderLine, Check tabloları + API
- [x] Backend: adisyon bölme / ikram / indirim servisleri; "odaya yaz" → `fnb.order.charged`
- [x] Ekran: Masa planı (salon seçimi, masa kutuları: boş / dolu / hesap istiyor)
- [x] Ekran: Sipariş ekranı (dokunmatik; ürün grupları, adet, not, gönder)
- [x] Ekran: Adisyon (kalemler, böl, ikram, indirim, kapat)
- [x] Ekran: Ödeme (nakit / kart / odaya yaz; oda seçimi)
- [x] Ekran: Garson vardiya raporu
- [ ] Aktör: fnb-worker paketi (`order.placed` → mutfak; `order.paid` → stok düşümü event'i; `fnb.order.charged` → billing-worker folyo kalemi) — **kullanıcı kararı:** olaylar yayında (`fnb.order.placed`, `fnb.order.paid`; `fnb.order.charged` billing-worker'da işleniyor); paket tüketicileriyle (40 KDS, 44 stok) kurulacak

> **📌 Modül 39 tamamlandı (20 Ekim 2026 — Ahmet).**
>
> **Kararlar (kullanıcı):** 38'in menü kısmı burada (yukarıdaki not); adisyonun **kendi ödemesi** (`PosPayment`, kasada "Restoran"
> kaynağı, parayı alan garsonun vardiya kasasına); ikram / iptal / indirim **şef garson yetkisi + gerekçe**, politikadaki eşiğe eşit
> ya da üstü **dört göz** (onay türü `POS_ADJUSTMENT`); büyük tahsilat ve hatalı girişin iptali dört göz (`POS_PAYMENT`); **vardiya
> aç / kapat + nakit sayımı**; fnb-worker paketi 40 / 44 ile (olaylar şimdi).
>
> **Veri** (migration `20261018090000_restaurant_pos`): `PosOutlet` (odaya yaz açık / kapalı), `PosTable` (bölüm, kişi), `MenuCategory`,
> `MenuItem` (trigram ad araması), `PosSettings` (onay eşiği, kasa farkı uyarısı), `PosShift` (avans, beklenen / sayılan nakit,
> fark; bir garsona tek açık vardiya — kısmi tekil index), `PosCheck` (ADS-yıl-sıra; toplamlar, vergi, alınan, odaya yazılan;
> durum izi CHECK'i: kapanmışta alınan + odaya = toplam), `PosOrder` (sipariş turu, mutfak durumu 40 için `NEW`), `PosOrderLine`
> (anlık ad / fiyat / vergi / istasyon, iptal + ikram adedi, kapanış iş günü), `PosAdjustment` (ikram / iptal + zayi / indirim; onay
> izi), `PosPayment` (nakit / kart; iptal kaydı asıl satırın tersi), `PosRoomCharge` (konaklama, olay kimliği), `PosSequence`.
> Uyarı türü `POS`; izinler `pos.operate` (garson; F&B rolü), `pos.supervise` (şef garson), `pos.setup`, `pos.report` (muhasebe).
>
> **Kurallar** (`pos/rules.js`, birim testli): kalem tutarı (iptal / ikram düşülür), indirim (yüzde kuruşa, tutar ara toplamı aşmaz)
> vergi kategorilerine **kuruş kuruş** dağıtılır, vergi **kategori başına** folyonun motoruyla (dahil + hariç); **odaya yaz kalemleri**
> kategori başına brüt — folyo aynı motorla toplamı **birebir** bulur; hariç vergi (servis) kuruşu yüzünden yazılamayan tutar
> reddedilir ve en yakın iki tutar önerilir. Bölme planı (serbest adet, onay bekleyen kalem taşınmaz), vardiya kasası (avans +
> işlenmiş nakit − iptal), fark uyarısı, hesap bölüşme (kişi başı).
>
> **Akış ve eşzamanlılık:** kilit sırası vardiya → adisyon → rezervasyon. Adisyon açma, ödeme, devir, yeniden açma vardiyayı
> **paylaşımlı**, kapanış **özel** kilitler (sayım sırasında kasaya para girmez). İstek kimliği (`requestId`) adisyon, sipariş turu,
> ödeme ve odaya yazmanın anahtarı: çift dokunuş / ağ tekrarı ikinci kayıt açmaz (eşzamanlı aynı istek de). Ödeme sürüm damgasını
> ilerletmez (aynı anda sipariş giren garsonun ekranı bozulmaz). Onay bekleyen düzeltme varken ödeme alınmaz; bekleyen ödeme varken
> toplam değişmez; bekleyen iş varken adisyon kapanmaz, vardiya kapanmaz. Onaylanan düzeltme ödemeyi aşacaksa uygulanmaz (isteyene
> "uygulanamadı"). Yeniden açma: aynı iş günü, vardiya açık, odaya yazılmamış. Birleştirmede turlar devam numarasıyla taşınır.
> Zamanlanmış iş (15 dk): 16 saati geçen vardiya, 8 saati geçen adisyon → şef garsona bir kez.
>
> **Olaylar:** ekran kanalı `pos.changed` (`pos.*`); iş olayları **`fnb.order.placed`** (tur gönderildi: nokta, masa, kişi, garson,
> kalem kimliği / ad / adet / istasyon / not — 40 KDS ve fnb-worker için) ve **`fnb.order.paid`** (adisyon kapandı: ürün başına
> satılan / ikram / zayi adet — 44 stok düşümü için; yeniden açılıp kapanırsa yeniden yayınlanır, tüketici son yayını esas alır);
> odaya yaz **`fnb.order.charged`** (billing-worker kalemleri vergi kategorisiyle işler — dış harcama kalemine isteğe bağlı
> `taxCategory` eklendi, minibar / çamaşır etkilenmez).
>
> **API** (`/pos`): terminal (tek çağrı), masa planı, adisyon (liste: durum / nokta / garson / kapanış günü / numara ya da masa
> araması; ekran; aç, kişi / not, tur, hesap iste, düzeltme, böl, taşı, birleştir, devret, kapat, boş iptal, yeniden aç), ödeme ve
> iptal isteği, içerideki misafir araması, odaya yaz, vardiya (aç, benim, açık garsonlar, liste, ekran, kapat, rapor), satış raporu
> (≤ 31 gün), tanımlar. Kasa (17) üç kaynak: folyo + etkinlik + **restoran** (özet, bekleyenler, imleçli hareketler).
>
> **Ekran:** `/pos/masalar` (vardiya çubuğu, satış noktası, bölüm bölüm masa kutuları: boş / dolu / hesap istiyor, süre, tutar;
> masasız adisyonlar), adisyon ekranı `/pos/adisyon/:id` (dokunmatik menü + arama + sepet + not + gönder; turlar ve kalemler,
> kalem başına ikram / iptal + zayi; indirim; toplam ve vergi dökümü; ödeme: nakit / kart, kişi başı, hızlı nakit, para üstü; odaya
> yaz: oda / soyadı araması, yuvarlama önerisi; böl / taşı / birleştir / devret; hesap fişi ve tur başına mutfak fişi — **bilgi
> fişi**, mali ÖKC entegrasyonu kapsam dışı), adisyonlar, vardiyalar + vardiya ekranı (kasa, kapanış, fark önizlemesi, rapor,
> yazdırılabilir vardiya fişi), satış raporu, menü ve tanımlar. Kasa ekranında "Restoran" kaynağı; onay penceresinden adisyona geçiş.
>
> **Ölçüm** (`scripts/perf-pos.mjs`; 6 nokta, 420 masa, 600 ürün, ~587.000 adisyon, 1,76 milyon kalem, 300 açık adisyon): terminal
> 25 ms, masa planı 11 ms, adisyon ekranı 11 ms, liste 53–67 ms (derin sayfa 2000 dahil), numara araması 12 ms, masa adıyla arama
> 24 ms, vardiya raporu 13 ms, satış raporu 1 gün 7 ms / 31 gün 133 ms, kasa < 15 ms, aç → 20 kalem → böl → öde 384 ms. Bulunup
> düzeltilen: numara araması masa adıyla OR'lanınca tarih index'iyle bütün geçmişi tarıyordu (1,1 sn) → eşleşme kümesi ayrı
> (MATERIALIZED) + `(tableId, openedAt)` index'i; ürün kırılımı kalem tablosunu baştan sona okuyordu (616 ms) → kalemde kapanış iş
> günü + `(hotelId, businessDate)` index'i.
>
> **Test:** kurallar 16 + sözleşme 10 + ön yüz (sepet / fiş) 10 birim; entegrasyon 12 (tanımlar, vardiyasız işlem yok + tek açık
> vardiya + çift dokunuşta tek adisyon / tur, fiyat kopyası, masa durumu, arama; düzeltme eşik altı / dört göz / red / indirimin yerine
> geçmesi / ödemeyi aşan; ödeme kısmi / fazla / tekrar / eşzamanlı iki tam ödeme tek kazanan / sürüm / büyük ödeme onayı; ödeme
> iptali + yeniden açma; odaya yaz → folyo birebir, kapalı nokta, çıkmış misafir, yuvarlama önerisi; böl / taşı / birleştir / devir;
> vardiya kapanışı + fark uyarısı + rapor + kasa birleşimi + satış raporu + iş olayları; zamanlanmış iş; izinler ve otel kapsamı).
>
> **Yan düzeltmeler:** olay kataloğunda `staff.alert.raised` türlerine `POS` (eksik kalsa uyarı yazan işlem düşerdi); rapor
> tarih alanı takvimde olmayan günü ("2026-02-31") reddediyor.
>
> **Devir:** fnb-worker paketi 40 (KDS; `PosOrder.status` NEW → … ve `fnb.order.placed`) ve 44 (stok; `fnb.order.paid`) ile; reçete /
> maliyet 38; oda servisi 41 (`fnb.order.charged` ve POS servisleri hazır); mali fiş / ÖKC entegrasyonu yasal entegrasyonlarda.

### 40. Mutfak ekranı (KDS) — Ali Kemal
**Gün sonu:** Mutfaktaki tablette siparişler sırayla görünüyor, süre sayıyor, "hazır" deyince garsona haber gidiyor.
- [ ] Backend: Order durum geçişleri (NEW → PREPARING → READY → SERVED), istasyon alanı
- [ ] Backend: socket kanalı `kitchen`
- [ ] Ekran: Sipariş kartları (masa, kalemler, geçen süre; renk: yeni / hazırlanıyor / gecikti)
- [ ] Ekran: Kart butonları (Başla / Hazır), istasyon filtresi (sıcak / soğuk / bar)
- [ ] Ekran: Garson tarafında "hazır" bildirimi

> **📌 Ali için not (41'den, Ahmet):** oda servisi turları da `fnb.order.placed` ile gelir; yükte yeni, isteğe bağlı iki alan var:
> `roomNumber` (teslim edilecek oda) ve `deliverAt` (istenen teslim anı; hemen ise boş) — kartta "Oda 412 · 07:30" gösterilebilir.
> Oda servisi siparişinin adımı (`pos/room-service.js` → `advanceOrder`) adisyonun turlarını **yalnızca ileri** taşır
> (`NEW → PREPARING → READY`, teslimde `SERVED`); KDS de ilerletirse çakışmaz. İptal edilen oda servisi siparişinin kalemleri iptal
> düzeltmesiyle düşer, tur durumu değişmez — KDS tamamen iptal edilmiş turu göstermemeli. Tepsi ücreti kalemi istasyonu `NONE`
> (mutfağa gitmez). Planlı (kahvaltı) sipariş zamanı gelene kadar **tur yazılmaz**; mutfak ekranı yalnızca düşmüş turu görür.

### 41. Oda servisi — arkadaşın
**Gün sonu:** Odaya sipariş giriliyor, mutfağa düşüyor, teslim edilince folyoya yazılıyor.
- [x] Backend: Order'a `roomId` + teslim durumu; `fnb.order.charged` → folyo
- [x] Ekran: Oda servisi sipariş formu (oda, ürünler, not, teslim saati)
- [x] Ekran: Teslim listesi (hazır siparişler, teslim edildi)
- [x] Misafir tarafı: QR menüden sipariş (53 ile birleşir) — **kullanıcı kararı:** imzalı bağlantı, QR, misafir uçları ve sözleşme
  burada; misafirin gördüğü sayfa 53'te

> **📌 Modül 41 tamamlandı (27 Ekim 2026 — Ahmet).**
>
> **Kararlar (kullanıcı):** sipariş başına **sabit tepsi ücreti** (politika; 0 = yok; adisyonda ayrı "Oda servisi ücreti" kalemi,
> vergisi FNB, şef garson ikram edebilir); teslimde varsayılan **odaya yaz**, misafir isterse **kapıda nakit / kart** (götürenin
> kasasına, bölünebilir); misafir QR: **uç + sözleşme şimdi, sayfa 53'te**; ek kapsam: **tepsi toplama takibi**, **istekten
> siparişe** (modül 7), **kahvaltı kartı** (ileri saatli toplu sipariş + hazırlık listesi). QR görseli için kütüphane:
> `qrcode-generator` (MIT, bağımlılıksız; bağımsız çözümleyiciyle — jsQR — gerçek uzunlukta bağlantı okundu).
>
> **Veri** (migration `20261025090000_room_service`): `PosOutlet.kind` (salon / **oda servisi** — masasız, odaya yazmaya açık;
> CHECK), `MenuItem.system` + gizli sistem grubu (tepsi ücreti; tanım ekranında ve terminalde görünmez, düzenlenmez), politika
> alanları (tepsi ücreti, teslim hedefi, hazırlık payı, tepsi uyarısı, misafir siparişi açık mı), **`RoomServiceOrder`** (OS-yıl-sıra;
> kaynak personel / misafir QR / misafir isteği; durum REQUESTED → SCHEDULED → RECEIVED → PREPARING → READY → ON_THE_WAY →
> DELIVERED, CANCELLED / REJECTED; adisyon 1:1; kalem kopyası JSON; teslim hedefi; adım damgaları ve götüren; tepsi; uyarı damgaları;
> durum izi CHECK'leri), **`RoomServiceLink`** (konaklama + oda, rastgele değer; konaklamada tek geçerli bağlantı — kısmi tekil
> index). İstek başına aynı anda tek bitmemiş sipariş (kısmi tekil index; teslimden sonra yeniden açılan istek yeniden çevrilir). İndeksler: pano (durum + hedef), planlı (durum + düşme anı), hazırlık
> (teslim anı), tepsi (kısmi), geçmiş (tarih), oda numarası, numara ve misafir adı (trigram).
>
> **Kurallar** (contracts `room-service.js` + `pos/room-service-rules.js`, birim testli): geçişler (mutfak adımları atlanabilir, yoldan
> hazıra geri), zamanlama (hemen: düşüş + hedef; ileri saatli: teslim − hazırlık payında düşer, o an geçmişse hemen), istenen anın
> sınırları (≥ 10 dk, ≤ 3 gün, çıkış gününden sonra değil), süreler (mutfak / bekleme / yol / toplam, zamanında mı), **tepsi takibi
> 24 saatlik pencere** (sonrası oda temizliğiyle toplanmış sayılır; liste sonsuza büyümez), kapı ödemesi planı (fazla / ödenmemiş
> kalan reddedilir), planlı siparişin düşeceği vardiya (girenin, yoksa oda servisi noktasının en erken açılmış vardiyası), hazırlık
> listesi (15 dk aralık, ürün toplamı; notlu kalem ayrı). Saatler formda **otelin duvar saati** (tarayıcının dilimi yanlışsa kayma yok).
>
> **Akış ve eşzamanlılık:** kilit sırası vardiya → adisyon → sipariş → rezervasyon → istek / bağlantı (`locks.js`). Mutfağa düşüş
> (hemen sipariş, kabul, planlının zamanı) masasız adisyon + tur + tepsi ücreti kalemi açar; restoranın tur yazımı ortak çekirdeğe
> alındı (`addOrderRound`), ödeme / odaya yaz da (`takePayment`, `postRoomCharge`). **Teslim tek transaction:** kapı ödemeleri +
> kalanın odaya yazılması + adisyonun kapanması + turların servis edildisi + isteğin tamamlanması. Teslimden önce adisyon ekranında
> ödeme / odaya yaz / kapat yok; oda servisi adisyonu bölünmez, taşınmaz, birleşmez (`room-service-guards.js`); tur eklenebilir (hazır
> sipariş mutfağa döner, yoldakine eklenmez). İptal: mutfak başladıysa şef garson ve zayi; planlı adisyonsuz. Kabulde kalemler
> değiştirilebilir (tükenen ürün), misafir sipariş verdikten sonra oda değiştirdiyse düşüşte **şimdiki oda** yazılır. Personel
> işlemleri sürümle; istek kimliğiyle çift dokunuşta tek kayıt (teslim dahil). Dakikalık iş: zamanı gelen planlıyı düşürür (vardiya
> yoksa bir kez uyarı), konaklaması bitenin mutfağa düşmemişini iptal eder / mutfaktaki için uyarı, 5 dk kabul bekleyen misafir
> siparişi, gecikme, toplanmayan tepsi — her sipariş her uyarıyı bir kez alır (damga ham SQL'le: ekrandaki sürüm bozulmaz).
>
> **Misafir QR:** bağlantı `/misafir/oda-servisi/<kimlik>.<imza>` — imza JWT sırrından türetilen anahtarla HMAC (veritabanı okunsa da
> üretilemez); yenileme / iptal eskisini öldürür; **oda değişince ve çıkışta kendiliğinden geçersiz**. Uçlar oturumsuz
> (`/public/room-service/:token` menü, `/orders` durum, `POST /orders` sipariş, `POST /orders/:id/cancel` kabulden önce iptal); IP başına
> hız sınırı (dakikada menü 60, durum 120, yazma 10), önbelleksiz, yönlendirmede belirteç sızmaz; misafir siparişi politikada açıksa,
> konaklamada en fazla 3 açık, kabul bekler; kimse kabul etmezse teslim hedefini 30 dk aşınca kendiliğinden reddedilir (misafir
> "zamanında kabul edilemedi; oda servisini arayın" görür, şef garsona bilgi). İşlem kaydına "misafir · oda …" yazılır. Personelin
> zili: yeni misafir siparişi.
>
> **Olaylar:** ekran `pos.room_service.changed` (`pos.changed` kanalı); mutfak `fnb.order.placed` (+ `roomNumber`, `deliverAt`); folyo
> `fnb.order.charged` (kalem adı "Oda Servisi · OS-…"); stok `fnb.order.paid` (iptalde zayi). İstek `guest.request.updated`.
>
> **API** (`/pos/room-service`): pano, sipariş (liste: durum grubu / kaynak / gün / arama; ekran; aç; kabul; ret; mutfağa gönder; adım;
> teslim; iptal), hazırlık listesi, tepsiler + toplu toplama, rapor (≤ 31 gün), konaklamanın bağlantısı (oku / ver-yenile / iptal).
> İzinler: `pos.operate` (sipariş, adım, teslim), `pos.supervise` (mutfaktakini iptal), `pos.report` (rapor), tepsi ve bağlantı için
> `pos.operate` ya da `requests.manage` (kat hizmetleri, ön büro).
>
> **Ekran:** Restoran → **Oda servisi** (pano: onay bekleyen / mutfakta / hazır / yolda, hedefe kalan süre ve gecikme, planlı ve tepsi
> sayaçları, vardiya çubuğu; hazırlık listesi — yarın varsayılan, yazdırılır; geçmiş; rapor), yeni sipariş (konaklama araması, menü,
> hemen / ileri saat — yarın sabah kısayolları, tepsi, not; istekten açılınca dolu), sipariş ekranı (zaman izi, hesap, teslim fişi,
> işlemler, QR), teslim penceresi (kapıda nakit / kart, para üstü, kalan odaya önizlemesi), **Toplanacak tepsiler** (menüde; kat
> görevlisi de), istek detayında **Siparişe çevir**, rezervasyonda **Oda servisi bağlantısı** (QR + basılı oda kartı), tanımlarda
> nokta türü ve oda servisi politikası. Adisyon ekranı oda servisi adisyonunu tanır (bant, gizlenen işlemler).
>
> **Ölçüm** (`scripts/perf-room-service.mjs`; ≈219.600 sipariş, 110 açık, 400 kahvaltı kartı, 120 tepsi; restoranın 587.000 adisyonu
> üstünde): pano 25 ms, sipariş ekranı 7 ms, geçmiş 31 ms (derin sayfa 3000: 53 ms), oda / numara / ad araması 12 / 8 / 17 ms,
> hazırlık listesi (400) 40 ms, tepsi listesi 10 ms, rapor bugün 9 ms / 31 gün 28 ms, dakikalık iş 8 ms, misafir menüsü 18 ms,
> misafir siparişi 58 ms, sipariş → hazır → yolda → teslim (kapıda + odaya) 384 ms. Ölçümle düzeltilenler: tepsi listesinin sınırsız
> büyümesi (24 saat penceresi; pano 92 → 25 ms, iş 119 → 8 ms), raporda ciro sorgusunun 1,7 milyon kalem / 587.000 adisyonu taraması
> (ciro kapanış iş gününe göre, satış raporuyla aynı taban; 480 → 28 ms).
>
> **Testler:** contracts oda servisi (geçiş, zamanlama, sınırlar, süreler, tepsi penceresi, şemalar), backend kuralları, ön yüz
> yardımcıları + QR + fişler; entegrasyon 11 senaryo (tanımlar, hemen sipariş → folyo birebir, kapı ödemesi, planlı + zamanlayıcı +
> gece oda değişikliği, misafir QR + imza + sınır + hız sınırı + eşzamanlı siparişler, istekten siparişe, iptal / zayi / tur ekleme,
> uyarılar + tepsi, geçmiş + rapor, izinler + otel kapsamı + eşzamanlı teslim / kabul-ret). Demo: son 7 gün, bugünün panosu, yarının
> kahvaltı kartları, misafir QR siparişi, siparişe çevrilmiş istek.
>
> **Yan düzeltmeler:** (1) Ekranların otel bağlamı yeni uçtan: `GET /settings/hotel/context` (ad, kod, para birimi, saat dilimi,
> varsayılan pansiyon, bugün) oturum açmış her personele açık; `useHotelToday`, kabuk, ana sayfa ve dokuz ekran buna geçti. Tam otel
> kaydı yalnız ayar yetkilisine açık olduğundan F&B, kat hizmetleri ve ön büro her sayfada 403 alıyor, saatleri **tarayıcının saat
> dilimiyle** görüyordu (oda servisinin kahvaltı saatleri için kritik). (2) İstek günlüğünde yoldaki belirteç maskelenir (oda servisi
> bağlantısı, kanal iCal'i). (3) Adisyon toplam kartında eksik React anahtarı.
>
> **53 için (misafir sayfası):** yol `ROOM_SERVICE_GUEST_PATH` (`/misafir/oda-servisi/:token`); veri `GET /public/room-service/:token`
> (otel, oda, misafirin adı, sipariş açık mı, tepsi ücreti, teslim hedefi, oda servisi noktalarının menüsü, son 24 saatin
> siparişleri), durum için `GET …/orders` (sık tazeleme), sipariş `POST …/orders` (`publicRoomServiceOrderSchema`; teslim saati otelin
> duvar saati), iptal `POST …/orders/:id/cancel`. Hata kodları: `LINK_EXPIRED` (yenilenmiş / oda değişmiş / çıkış), `GUEST_ORDERING_CLOSED`,
> `GUEST_ORDER_LIMIT`, 404 (bağlantı yok), 429 (hız). QR üretimi `lib/qr.js` (`qrSvg`).
>
> **44 için (stok, Ali):** `fnb.order.paid` kalemlerinde tepsi ücreti (`MenuItem.system = TRAY_CHARGE`) de satılmış görünür; reçetesi
> yoktur, stok düşümünde sistem ürünleri atlanmalı.
>
> **Modül 53'ten not (4 Kasım 2026 — Ahmet):** misafir uçlarının hız sınırı IP başına değil **bağlantı başına** (aynı sayılar), üstünde
> portal uçlarıyla ortak IP tavanı (3.000 / dk; `lib/guest-rate-limit.js`): otel Wi-Fi'ında tek NAT adresinden çıkan misafirler
> birbirinin kotasını yiyordu. Entegrasyon testi yeni anlama göre güncellendi.

### 42. Online paket sipariş — Ali Kemal
**Gün sonu:** Dışarıdan gelen paket siparişler aynı POS zincirinden geçiyor; kurye ataması ve teslim takibi var.
- [ ] Backend: Order `source=ONLINE`, DeliveryInfo tablosu (adres, telefon, kurye, durum)
- [ ] Ekran: Dış sipariş formu (müşteri, adres, ürünler, ödeme tipi)
- [ ] Ekran: Sipariş panosu (hazırlanıyor / yolda / teslim)
- [ ] Ekran: Kurye atama
- [ ] (opsiyonel) Public sipariş sayfası

### 43. Banket F&B planlaması — arkadaşın
**Gün sonu:** Etkinliğin menüsü seçiliyor; kişi sayısına göre malzeme ihtiyacı ve maliyet çıkıyor.
- [x] Backend: EventMenu tablosu; reçeteden kişi sayısına göre malzeme hesaplama
- [x] Ekran: Etkinlik menüsü seçimi (set menü, kişi başı fiyat)
- [x] Ekran: Malzeme ihtiyaç listesi (satın alma talebine çevir → 45) — talep tablosu 45'in şekliyle burada kuruldu (aşağıda)
- [x] Ekran: Mutfak üretim planı (gün / saat)

> **📌 Modül 43 tamamlandı (27 Ekim 2026 — Ahmet).**
>
> **Kararlar (kullanıcı, 27 Ekim 2026):** 38'in **reçete kısmı** ve 44'ün **yalın stok kartı** (`StockItem`) burada kuruldu (39'daki menü
> emsali); set menü **katalog + etkinlikte uyarlama** (katalog kopyalanır, etkinlikte değişir, katalog sonradan değişse de dosya
> bozulmaz); **satın alma talebi tablosu 45'in şekliyle şimdi** (talep + satır + numara serisi; teklif / sipariş / mal kabul 45'te).
>
> **Veri** (migration `20261028090000_banquet_fnb`): `StockItem` (kod, ad — harf duyarsız tekil, grup, stok birimi, KDV hariç birim
> maliyet + maliyet damgası, alerjenler — 14 grup CHECK'li), `Recipe` (yemek: porsiyon / ara ürün: kg-L-adet — CHECK; istasyon; **servisten
> önce hazırlık süresi** 0–3 gün; restoran ürününe tek bağ), `RecipeLine` (malzeme **ya da** ara reçete — tam biri CHECK, kendini
> içeremez; net miktar + birim + **fire %**), `BanquetMenu` / `…Course` / `…Dish` (kurs türü **hepsi / seçmeli**, kişi başı porsiyon),
> `EventMenu` (oturumun öğünü, servis anı, kendi kişisi ya da etkinliğinki, fiyat / indirim / vergi, mutfak notu, **mutfağa kesinleşme**
> izi CHECK'li) / `…Course` / `…Dish` (seçmelide sabit kişi; boş = kalan), `EventItem.eventMenuId` (menünün fiyat kalemi, tekil),
> `EventSettings.overproductionPct` (%0–30) ve `menuFinalizeDays` (0–60), `PurchaseRequest` (STR-yıl-sıra, açık / iptal, iptal izi CHECK)
> / `PurchaseRequestLine` (malzeme × etkinlik, stok birimi kopyası, ihtiyaç günü, talep anındaki birim maliyet), `PurchaseSequence`.
>
> **Kurallar** (contracts `recipes.js` / `banquet-fnb.js` + `recipes/rules.js` / `banquet/fnb-rules.js`, birim testli): birim aileleri ve
> çevrim (kg↔g, L↔ml; aileler arası yok), brüt = net ÷ (1 − fire), reçetenin malzemeye açılması (ara ürünler dahil, her malzemenin
> **servisten kaç dakika önce** gerektiği), maliyet (önbellekli) ve alerjen, döngü / derinlik (≤ 4 seviye), **hazırlanacak porsiyon** =
> servis edilen kişi × kişi başı porsiyon × (1 + fazla hazırlık), yukarı — **tam sayı aritmetiği** (0,3 × 350 = 105, 106 değil),
> seçmeli kurs dağılımı (sabitler + bir "kalan"; aşım / tutmama sorunu), satın alma yuvarlaması (kg / L binde bir, g / ml / adet tam),
> etkinlik × malzeme ihtiyacı (etkinlik düzeyinde yuvarlanır; **eksik etkinlik başına** — bir etkinliğe fazla istenen başka etkinliğin
> eksiğini kapatmaz, teslim günü farklı olabilir), talebin etkinliklere dağıtımı (erken ihtiyaç önce; fazlası en erken ihtiyaca),
> üretim görevleri (yemek servisten süresi kadar önce, ara ürün onu kullananın başlangıcından önce; aynı ara ürün birleşir).
>
> **Akış ve eşzamanlılık:** reçete kaydı **otel başına danışma kilidiyle** (A'ya B, aynı anda B'ye A eklenemez — testli), kullanılan
> reçetenin verim ailesi değişemez, banket menüsündeki yemek ara ürüne çevrilemez, kullanılan malzemenin birim ailesi değişemez.
> Etkinlik menüsü yazımları **etkinlik kilidi + dosya sürümüyle**; menü kaydı fiyat kalemini yazar ve toplamları aynı transaction'da
> yeniden hesaplar; kalem tablosu menü kalemine dokunmaz. Kesinleştirme yalnız kesin dosyada ve sorunsuz menüde; kesin menü değişmez /
> kalkmaz, **gerekçeyle yeniden açılır**. Satın alma talebi kapsamdaki etkinlikleri **kimlik sırasıyla kilitler**, eksiği kilit altında
> yeniden hesaplar; ekranın gördüğü eksik tutmazsa açılmaz (`NEEDS_CHANGED` — aynı eksik iki kez talep edilemez, testli). Kilit sırası:
> reçete grafiği → reçete → malzeme; etkinlik → satın alma talebi.
>
> **Mutfağa haber** (talep açabilenlere, zil): menü kesinleşti; kesin menü yeniden açıldı (talep edilmiş satır varsa söylenir);
> oturum kayınca kesin menünün servisi kaydı (menüler aynı farkla kayar, oturum dışına taşan sınıra çekilir); faturalanacak kişi
> değişti (kişiyi izleyen kesin menü varsa); kesin etkinlik iptal edildi ve açık talebi var. **İş** (banket turu, 15 dk): ilk gününe
> politikadaki gün kalan kesin etkinliğin kesinleşmemiş menüsü sorumluya bir kez.
>
> **Belge:** teklif / sözleşmede menünün içeriği (kurs, yemek — menüdeki adıyla, seçmelide kişiler, **alerjenler**); proformada fiyat
> kalemi yeter. Eski anlık görüntüler bozulmaz.
>
> **API:** `/recipes` (liste — maliyet / kâr marjı, ekran — satır brütü ve maliyeti, kullanıldığı yerler; yaz; **kaydetmeden maliyet
> önizlemesi**; seçici; menü ürünü seçici; `/stock-items`), `/banquet/menus` (katalog), `/banquet/events/:id/fnb` (menü sekmesi),
> `/banquet/events/:id/menus` (+ `/finalize`, `/reopen`), `/banquet/fnb/needs` (≤ 31 gün, olası dahil, malzeme dökümü),
> `/banquet/fnb/production` (≤ 7 gün, istasyon), `/purchasing/requests` (liste — numara / malzeme araması, etkinlik, ihtiyaç günü;
> ekran; banket ihtiyacından aç; iptal). İzinler yeni: `recipes.view` (müdür, F&B, muhasebe), `recipes.manage` (müdür; şef için
> matristen), `purchasing.view` (müdür, F&B, muhasebe), `purchasing.request` (müdür, F&B). **Maliyet alanları yalnız
> `recipes.view` olana döner** (sunucuda; ön büro menüyü görür, maliyeti görmez — testli). Canlı kanallar `recipes.changed`,
> `purchasing.changed`; banket kanalına `banquet.menu.changed` ve `MENUS` değişikliği.
>
> **Ekran:** Mutfak (`/mutfak`): reçeteler (maliyet, KDV hariç satış, **gıda maliyeti %** — %30 / %38 eşikleri, alerjen, yalnız menü
> ürünleri süzgeci), reçete ekranı (satırlar, birim seçici aileyle sınırlı, canlı maliyet önizlemesi, kâr marjı, kullanıldığı
> yerler; görme yetkisinde salt okunur), malzeme kartları. Etkinlikler: **Set menüler** (katalog, kişi başı maliyet — seçmelide en pahalı
> seçenekle), **Malzeme ihtiyacı** (gruba göre — kasap / manav…, kesin / olası / talep / eksik / mutfakta olmalı günü, etkinlik dökümü,
> grup süzgeciyle talebe çevir, A4 çıktı), **Mutfak planı** (gün → saat → istasyon görevleri, taslak menü işareti, A4 çıktı — işaret
> kutulu). Dosyada **Menü** sekmesi (katalogdan başla, seçmelide canlı "kalan", porsiyon planı, maliyet / gıda maliyeti, kesinleştir /
> yeniden aç, malzeme ihtiyacı ve talebe çevir, açılmış talepler); kalem tablosunda menü kalemleri salt okunur; politikada fazla
> hazırlık payı ve menü kesinleştirme süresi. Satın alma (`/satin-alma/talepler`): liste, talep ekranı (malzeme × etkinlik dökümü),
> gerekçeli iptal, A4 çıktı.
>
> **Ölçüm** (`scripts/perf-banquet-fnb.mjs`; 1.500 malzeme, 3.000 reçete, 60 set menü, banket ölçüm etkinliklerinde 44.681 menü, 20.000
> talep — 200.290 satır): reçete listesi / ekranı / önizleme / seçici 13–21 ms, malzeme
> listesi 5 ms, set menü listesi (maliyetli) 55 ms, etkinliğin menü sekmesi 67 ms, **ihtiyaç 7 gün 151 ms**, 31 gün (473 etkinlik, 725
> menü, 1.500 malzeme, olası dahil) 1,1 sn, **üretim planı 1 gün 165 ms** / 7 gün (2.531 görev) 0,5 sn, talepler 4–20 ms (numara / malzeme
> adı araması ~100 ms, derin sayfa 700 19 ms), talep ekranı 8 ms, menü kaydet → kesinleştir → yeniden aç → kaldır 0,42 sn, yarının et
> grubunu talebe çevirme 134 ms. Ölçümle düzeltilen: 31 günlük ihtiyaç 2,6 sn → 1,1 sn, 7 gün 0,6 → 0,15 sn, 1 günlük plan 0,69 → 0,17
> sn — reçete grafiği ve planlama menüleri düz SQL'le (Prisma'nın iç içe kurulumu yerine), reçete başına önbellekli "birim ihtiyaç"
> (yemek başına yeniden açılmaz), ihtiyaç günü aynı an için bir kez biçimlenir (90 bin `Intl` çağrısı ~0,5 sn'ydi), üretim planı
> penceresi sabit 12 gün yerine otelin en uzun hazırlık süresinden; talep listesinde malzeme araması önce malzemeyi trigram index'iyle
> bulur. Sorgu planları index'te (aralığın menüleri 2,8 ms, talep edilmiş miktarlar 8,6 ms, talep listesi 0,06 ms). Not: ölçüm
> verisi kötümser — 725 menü 2.400 yemekten rastgele 2.800 reçeteyi açıyor; gerçek banket yemeği sayısı yüzlerle.
>
> **Test:** kurallar 19 (önbellekli birim ihtiyacı = açılım, yuvarlama gürültüsü dahil) + F&B kuralları 7 + sözleşme 13 + ön yüz 8 birim; entegrasyon 14 (malzeme adı / birim ailesi, reçete maliyet / fire /
> ara ürün / önizleme = kayıt, birim uyumu, döngü / derinlik / **eşzamanlı döngü**, pasif malzeme, menü ürünü bağı ve kâr marjı, set menü
> maliyeti, etkinlik menüsü — elle hesaplanmış porsiyon / malzeme / 86.334,11 maliyet / %18,7, kalem tablosunun menü kalemini koruması,
> servis saati / oturum / otel kapsamı / sürüm, kesinleştirme kilidi ve mutfak haberleri — saat kayması, kişi değişimi, yeniden açma,
> teklif belgesinde menü, aralık ihtiyacı kesin / olası, satın alma dağıtımı / numara / eksik değişti / **eşzamanlı aynı eksik** / iptal /
> iptal edilen etkinlik haberi, üretim planı saatleri, hatırlatma işi, izinler ve maliyet gizliliği).
>
> **Yan düzeltmeler:** sözleşme dizininde `export *` çakışması adı sessizce düşürüyordu (yeni `MAX_LINE_QUANTITY` rezervasyonunkini
> görünmez yaptı, talep notu istek notunun sınırına düştü) — adlar ayrıldı, **dizin denetimi testi** eklendi (her yıldızlı modülün her
> adı index'ten aynı değerle gelmeli; bilinen tek zararsız tekrar gerekçeli istisna); kenar çubuğunda alt bağlantı `end` bayrağını yok sayıyordu (üst sayfa alt sayfada da seçili görünürdü);
> diyalog kabuğuna geniş boy (`xl`).
>
> **Devir:** 44 — `StockItem` hazır: depo / hareket / sayım ve **hareketli ortalama maliyet** (birim maliyeti günceller) eklenir; reçete
> satırları stoktan düşüm için hazır. 45 — talep tablosu hazır: durumları (onay / siparişe döndü) ve kaynakları (elle, stoktan öneri)
> genişletir; teklif / sipariş / mal kabul; banket talepleri satır başına etkinliğiyle gelir (siparişte malzeme başına birleştirilir).
> 53 — QR menü JSON'u (38'in kalanı) reçeteden alerjeni alabilir.

---

## 6. STOK & SATIN ALMA

### 44. Stok & maliyet analizi — Ali Kemal
**Gün sonu:** Depodaki her ürünün miktarı ve hareketli ortalama maliyeti izleniyor; satılan yemek reçeteden stoğu düşüyor; sayım farkları görünüyor.
- [ ] Backend: Warehouse, StockItem, StockMovement, StockCount tabloları + API
- [ ] Backend: hareketli ortalama maliyet hesabı (her girişte güncelle)
- [ ] Backend: transfer, fire, sayım düzeltme servisleri
- [ ] Ekran: Depo tanımları
- [ ] Ekran: Stok kartları (ürün, birim, mevcut, min. seviye, ortalama maliyet)
- [ ] Ekran: Hareket listesi + manuel hareket formu
- [ ] Ekran: Sayım ekranı (fiziksel gir, fark listesi, onayla)
- [ ] Ekran: Maliyet raporu (ürün / reçete bazlı)
- [ ] Aktör: inventory-worker paketi (`order.paid` → reçete satırlarını düş; stok < min → `purchase.request.suggested`)

> **📌 Ali'ye not (modül 43, 27 Ekim 2026 — Ahmet):** `StockItem` tablosu ve API'si (`/recipes/stock-items`, izin `recipes.manage`)
> modül 43'te kuruldu; depo / hareket / sayım ve hareketli ortalama maliyet bunun **üstüne** eklenir (birim maliyeti siz yazarsınız;
> `costUpdatedAt` damgası var). Malzemenin birim ailesi reçetede kullanılırken değişemez (kg ↔ L). Satın alma talebi (45) satırları
> `StockItem`'a bağlı.
>
> **📌 Ali'ye not (modül 45, 29 Ekim 2026 — Ahmet):** mal kabulde stok gerçekten girsin diye **stok çekirdeği 45'te kuruldu** (Ahmet'in
> kararı; senin 44'üne zemin): `Warehouse` (otelde tek varsayılan, pasif olamaz; stoklu depo pasife alınamaz), `StockLevel` (depo ×
> malzeme mevcudu), `StockMovement` (değişmez; işaretli miktar, birim maliyet, hareket sonrası mevcut ve ortalama — şimdilik tek tür
> `RECEIPT`), `StockItem.onHand` (depoların toplamı) ve `minLevel`. **Hareketli ortalama** `src/modules/stock/rules.js`
> (`movingAverageCost`, `applyReceipts`; birim testli) ve giriş `src/modules/stock/movements.js` → `postStockIn` (sıra: sipariş →
> depo → malzeme kartı kilidi; depo satırı tek ifadede upsert). Senin ekleyeceklerin: `StockMovementKind`'a çıkış / transfer / fire /
> sayım türleri ve `postStockOut` benzeri bir yazıcı (çıkış ortalamayı değiştirmez, yalnız miktarı), `StockCount`, sayım / transfer /
> fire ekranları, maliyet raporu, reçeteden düşüm (`order.paid`). Hazır ekranlar: `/stok` (mevcut + depo dağılımı + yoldaki +
> minimum + değer), `/stok/hareketler`, `/stok/depolar`; API `/stock/*`, izinler `stock.view` / `stock.manage`, kanal
> `stock.changed`. **Minimum altı önerisi** satın almada (`/purchasing/suggestions`): senin `purchase.request.suggested` aktörün
> buradan ya da `createRequest` (kaynak `STOCK`) ile talep açabilir. Kural: elde stok varken malzemenin maliyeti elle değişmez;
> stok hareketi / açık talep / açık siparişi olan malzemenin birimi değişmez.

### 45. Satın alma — arkadaşın
**Gün sonu:** Talep → teklif karşılaştırma → sipariş → mal kabul zinciri kayıtlı; mal kabulde stok otomatik giriyor.
- [x] Backend: Supplier, PurchaseRequest, PurchaseQuote, PurchaseOrder, GoodsReceipt tabloları + API — **PurchaseRequest (+ satır, numara serisi) modül 43'te kuruldu** (banket ihtiyacından talep, liste, ekran, iptal); durumlar / kaynaklar burada genişler
- [x] Backend: sipariş tutarı eşik üstü → `approval.requested`; mal kabul → stok girişi + tedarikçi borcu event'i
- [x] Ekran: Tedarikçi kartları
- [x] Ekran: Talep formu (talep eden, ürün, miktar, ihtiyaç tarihi) + otomatik önerilen talepler listesi
- [x] Ekran: Teklif karşılaştırma (tedarikçi × fiyat × termin)
- [x] Ekran: Sipariş (onaylı) + PDF
- [x] Ekran: Mal kabul / irsaliye (gelen miktar, fark, depo)

> **✅ Modül 45 tamamlandı (29 Ekim 2026 — Ahmet).** Kararlar (kullanıcı): **satır bazında kazanan** (her malzeme kendi en uygun
> teklifinden; tedarikçi başına ayrı sipariş); **stok çekirdeği burada** (44'ün zemini — yukarıdaki Ali notu).
>
> **Zincir:** talep (banket 43 / elle / minimum stok önerisi) → **açık satırlar** malzeme başına birleşir → **teklif turu** (TKT-yıl-sıra;
> ekran gördüğü toplamı gönderir, sunucu talepleri kilitleyip yeniden toplar — tutmazsa `LINES_CHANGED`) → tedarikçi **teklifleri**
> (turda tedarikçi başına tek; termin, geçerlilik, KDV hariç fiyat + KDV %0/1/10/20; her kayıt turun sürüm damgasını ilerletir) →
> **kazanan** (en uygun = ihtiyaca yetişen → fiyat → termin → önce girilen; ucuz ama geç teklif önerilmez; en uygun dışı seçim gerekçe
> ister; süresi dolmuş teklif / pasif tedarikçi seçilmez) → **sipariş** (SAS; KDV satırda yuvarlı; KDV dahil tutar politika eşiğinde /
> üstündeyse `PURCHASE_ORDER` onayına — dört göz, 3 gün içinde karar yoksa reddedilmiş sayılır; red / iptal satırları tura döndürür) →
> **mal kabul** (MKB; irsaliye no tedarikçi başına tek; kalan kadar — tartılan malzemede +%5; eksik kapatma) → **stok girer** (depo satırı,
> toplam mevcut, hareketli ortalama, hareket kaydı) + `purchase.goods.received` (vade = kabul günü + tedarikçi vadesi; 47 dinler).
> Talep durumu satırlarından türer (açık → teklif / siparişte → siparişe döndü); tur kapatılınca siparişe dönmemiş satırlar talebe döner.
>
> **Eşzamanlılık:** kilit sırası tur → sipariş → talep (kimlik sıralı) → depo → malzeme kartı; aynı satırlara iki tur, aynı tura iki
> kazanan, aynı siparişe iki mal kabul testli (biri geçer, diğeri `LINES_CHANGED` / `STALE_WRITE`). Veritabanı kısıtları: tek varsayılan
> depo, tedarikçi adı / vergi no tekil, teslim alınan ≤ sipariş (+%5), siparişli tur satırı bırakılamaz, onay bekleyen siparişin onayı var…
>
> **API:** `/purchasing` (talepler + elle talep, `/suggestions`, `/open-lines`, `/rounds` (+ teklif kaydet / çıkar, tedarikçi önerisi,
> kazanan, kapat), `/orders` (+ PDF, iptal, eksik kapat, `/receipts`), `/receipts`, `/suppliers`, `/settings`), `/stock` (özet, mevcut,
> minimum, hareketler, depolar). İzinler yeni: `purchasing.manage` (müdür), `purchasing.receive` (müdür, F&B), `stock.view` (müdür,
> muhasebe, F&B), `stock.manage` (müdür). Onay türü `PURCHASE_ORDER` (isteyen kendi siparişini onaylayamaz). Kanal `stock.changed`.
>
> **Ekran:** `/satin-alma` sekmeli: talepler (+ yeni talep), min. stok önerileri (seçip talep aç), açık satırlar (sayfalar arası seçim →
> teklif turu), teklif turları ve **karşılaştırma matrisi** (tedarikçi × fiyat × termin; en uygun yeşil, geç uyarısı, satır bazında seçim,
> gerekçe, tedarikçi başına toplam ve "onaya gider" işareti), siparişler (gecikti işareti) ve sipariş ekranı (PDF, mal kabul penceresi —
> depo, irsaliye, gelen / fark, eksik kapat, canlı tutar; iptal; eksik kapat), mal kabuller, tedarikçiler + satın alma politikası;
> `/stok` (özet kutuları, depo dağılımı, yoldaki, minimum düzenleme), hareketler, depolar. Onay ekranından siparişe bağlantı.
>
> **Ölçüm** (`scripts/perf-purchasing.mjs`; 43'ün 1.500 malzeme / 20.000 talep (~200.000 satır, ~170.000'i açık) verisine ek 200 tedarikçi,
> 2.000 tur, 320.000 teklif satırı, 5.000 sipariş, 8.000 mal kabul, 64.000 hareket): listeler / ekranlar 2–40 ms (karşılaştırma 40 satır × 4
> teklif 21 ms, sipariş ekranı 11 ms, hareketler derin sayfa 15 ms, stok özeti 3 ms), min. stok önerisi 26 ms, açık satırlar 14–78 ms
> (filtreli) / 0,47 sn (filtresiz ilk sayfa, 170.000 açık satır — uç senaryo), tur aç (40 malzeme, ~3.000 talep satırı) 0,63 sn, teklif
> kaydet ~0,1 sn, kazanan → sipariş 0,25 sn, mal kabul (25 satır, stok + ortalama) 0,11 sn. Ölçümle düzeltilen: **tur açma 13,3 sn → 0,6 sn**
> (talep durumu talep başına güncelleme + olay yerine tek ifade), **öneriler 1,7 sn → 26 ms** (önce talep süzülüp malzeme başına bir kez
> toplanır), açık satırlar sayım + sayfa tek toplamada (0,63 → 0,47 sn). Planlar index'te.
>
> **Test:** satın alma + stok kuralları 38 birim (tutar / KDV yuvarlama, birleştirme, kazanan planı — geç teklif, gerekçe, süresi dolmuş,
> pasif; mal kabul sınırı, durumlar, öneri, hareketli ortalama — elle hesaplı); entegrasyon 5 (zincirin tamamı elle hesaplanmış sayılarla
> — 10.491,38 / 4.280,48 / vade / 409,6225 ortalama / 12.370,60 değer; dört göz ve red → tura dönüş → yeniden seçim → onay; iptal ve tur
> kapatma; eşzamanlı tur / kazanan / mal kabul; öneri, depo kuralları, birim / maliyet koruması; izinler, otel kapsamı, PDF). 43 ve POS
> entegrasyon testleri yeniden geçti.
>
> **Yan düzeltmeler:** banket PDF çizimi ortak `lib/pdf-writer.js`'e taşındı (sipariş PDF'i de kullanır); malzeme kartında elde stok
> varken maliyet alanı kilitli; demo sıfırlaması demo kayıtlarına dayanan (personelin sunumda açtığı) satın alma belgelerini de siler.
>
> **Demo** (`scripts/demo-purchasing.mjs`, `demo-data.mjs` çağırır): politika (25.000 TRY eşik), 4 depo, 8 tedarikçi (biri pasif),
> ödül gecesinin turu → 6 sipariş (biri onay bekliyor, biri eksik kapatıldı, biri kısmen teslim), düğünün kazanan bekleyen turu
> (canlı seçim için; ucuz ama geç teklif dahil), tereyağında hareketli ortalama, açık bar talebi, karışık minimum seviyeler.
>
> **Devir:** 44 — stok çekirdeği hazır (yukarıdaki not). 47 — `purchase.goods.received` (tutarlar, vade, tedarikçi) cariye işlenir;
> `Supplier` kartı (vergi no / daire, vade) cari kartın temeli.

### 46. Demirbaş & amortisman — Ali Kemal
**Gün sonu:** Otelin sabit kıymetleri barkodlu kayıtlı; konumları, garanti bitişleri ve amortisman tablosu görünüyor.
- [ ] Backend: Asset, AssetMovement, Depreciation tabloları + API; amortisman hesabı (doğrusal)
- [ ] Ekran: Demirbaş kartı (barkod, ad, kategori, konum/oda, alış tarihi, tutar, garanti bitiş, zimmet)
- [ ] Ekran: Barkod etiketi yazdırma
- [ ] Ekran: Sayım (barkod okut, eksikleri listele)
- [ ] Ekran: Amortisman tablosu (yıllık)
- [ ] Ekran: Garantisi bitecekler uyarısı

---

## 7. MUHASEBE / ERP

### 47. Ön muhasebe — arkadaşın
**Gün sonu:** Acente / tedarikçi / şirket carileri, kasa, banka, çek-senet tek yerde; faturalar ve tahsilatlar otomatik cariye işliyor.
- [x] Backend: Account (cari), AccountTransaction, CashRegister, BankAccount, Cheque tabloları + API — `LedgerAccount` / `LedgerEntry`,
  kasa ve banka tek tabloda (`TreasuryAccount` türlü) + `TreasuryMovement`, `Instrument` (çek / senet) + `InstrumentMovement`, `AccountingVoucher`
  (+ satır), `TreasuryMapping`, `AccountingSettings`, `AccountingSequence` (numara serileri)
- [x] Ekran: Cari kartlar + ekstre (borç / alacak / bakiye)
- [x] Ekran: Kasa hareketleri (giriş / çıkış, açıklama)
- [x] Ekran: Banka hesapları + hareketler
- [x] Ekran: Çek / senet portföyü (vade, durum, tahsil / ciro / karşılıksız)
- [x] Ekran: Tahsilat / ödeme fişi
- [x] Aktör: accounting-worker paketi (`invoice.issued` → cari alacak; `payment.received` → kasa/banka; `goods.received` → tedarikçi borç)
  — fatura modülü (16 / 49) yok: `invoice.issued` sözleşmesi tanımlı, alacak operasyondan doğuyor (aşağıda)

> **✅ Modül 47 tamamlandı (30 Ekim 2026 — Ahmet).** Kararlar (kullanıcı): **alacak operasyondan** — "Acente / cari" ve voucher folyo
> aktarımı, gerçekleşen / iptal bedelli etkinlik; `invoice.issued` sözleşmesi tanımlı, fatura gelince numara mevcut cari harekete bağlanır
> (ikinci alacak yazılmaz). **Ödemede cari seçimi** — ödeme penceresinde "Acente / cari" ve voucher için cari seçilir, varsayılan
> rezervasyonun acentesi. **Başlangıç gününden** — o günden (dahil) sonraki belgeler otomatik işlenir, öncesi açılış bakiyesiyle.
>
> **Otomatik akış (aktör `accounting-worker`):** ön büro tahsilatı / iadesi / iptali → eşlemedeki kasaya / bankaya (kanal × yöntem × para
> birimi; döviz nakit döviz kasası yoksa otel parasına çevrilip kaynak döviz + kurla) ya da seçilen cariye borç (vade = gün + cari
> vadesi); etkinlik tahsilatı → kasa / banka + etkinlik müşterisinin carisinden düşer; etkinlik bedeli ve acente primi **fark kaydıyla**
> eşitlenir (iptal bedeline düşen etkinlikte düzeltme farkı, geri alınan primde ters fark); restoran / oda servisi ödemesi → restoran
> eşlemesi; mal kabul (45) → tedarikçiye KDV dahil alacak, vade siparişin vadesi. Her kayıt **kaynak belgeden** okunur ve otel başına
> tekil kaynak anahtarıyla yazılır (tekrar işlemek iki kayıt açmaz). Eşleme eksikse iş "Ön muhasebe" manuel görevine düşer; ayarlardaki
> **eşitleme** eksikleri dönem için işler (20 sn süre sınırı, kalan kesin sayıyla döner, yeniden çalıştırınca kaldığı yerden sürer; aynı
> hata tek satırda sayılır).
>
> **Fişler:** tahsilat (kasa / banka satırları + alınan çek / senet), ödeme (kasa / banka + verilen çek + **ciro**), virman, kasa / banka
> giriş-çıkış, açılış (cari / kasa / banka; başlangıç gününden bir gün önce tarihli, hesap başına tek). Ödeme toplamı eşiğe eşit /
> üstündeyse `ACCOUNTING_PAYMENT` onayı (dört göz; onay anında kasa yeterliliği yeniden denetlenir). İptal ters kayıtla, fiş tarihli;
> fişin açtığı çek ilk durumunda olmalı. **Kasa eksiye düşmez** (elle çıkış ve iptal), banka düşebilir.
> **Çek / senet:** portföy → tahsile ver → tahsil / karşılıksız / iade; verilen → ödendi / karşılıksız; ciro edilen döndüğünde ciro
> edilene alacak. **Yaşlandırma** FIFO (bakiyeyi en yeni hareketler kapatır), dilimler vadeye göre (vadesi gelmemiş / 1–30 / 31–60 / 61–90 / 90+).
>
> **Eşzamanlılık:** kilit sırası fiş → cari → kasa / banka → çek / senet (her grup kimlik sırasıyla); bakiyeler satır kilidi altında
> ham SQL artırımıyla. Testli yarışlar: aynı belgeye dört eşzamanlı eşitleme tek kayıt, aynı kasadan iki çıkıştan biri geçer, aynı çek
> iki fişte ciro edilemez, onay beklerken harcanan kasa onayda yakalanır, aynı istek kimliği tek fiş. Veritabanı kısıtları: hareketin
> tek tarafı, bakiye = borç − alacak, kart bağı türle uyumlu, kasada banka bilgisi yok, onay bekleyen fişin onayı var, hesap başına tek
> açılış, çek durumu yönle uyumlu, ciro / tahsil izi, IBAN tekil, çek numarası (yön × tür × banka) iptal edilmemişlerde tekil.
>
> **API:** `/accounting` — `accounts` (+ `picker`, `aging`, `link`, `:id`, `:id/statement`), `treasury` (+ `:id`, `:id/movements`),
> `vouchers` (+ `opening`, `:id`, `:id/void`), `instruments` (+ `:id`, `:id/actions`), `settings` (+ `mappings`), `sync`. İzinler yeni:
> `accounting.view` / `accounting.manage` (müdür, muhasebe), `accounting.setup` (müdür; tanımlar, eşleme, başlangıç, açılış, fiş iptali).
> Cari seçici ödeme penceresinde ön büroya açık. Onay türü `ACCOUNTING_PAYMENT`. Kanal `accounting`; olaylar `accounting.*` (7) + `invoice.issued`.
>
> **Ekran:** `/muhasebe` sekmeli: **cariler** (alacağımız / borcumuz kutuları, tür / bakiye / durum süzgeci, sıra) ve **cari kartı**
> (bakiye, yaşlandırma, açık çekler, açılış, ekstre — devir, yürüyen bakiye, dönem toplamı, imleçle sayfa), **yaşlandırma** raporu,
> **kasa / banka** (hesap kutuları + seçilenin hareketleri, kaynak süzgeci; giriş / çıkış / virman), **çek / senet** portföyü (satırdan
> işlem), **fişler** (+ fiş ekranı, iptal) ve fiş penceresi (canlı toplam, çek satırları, ciro seçimi), **ayarlar** (başlangıç + eşik,
> tahsilat eşlemesi, eksik kayıtları eşitle). Ödeme penceresinde "Acente / cari" / voucher için cari alanı; onay ekranında fiş ayrıntısı.
>
> **Ölçüm** (`scripts/perf-accounting.mjs`; 25.201 cari, 600.719 cari hareketi — 20 "dev" acentede 10.000'er —, 12 kasa / banka ve
> 502.940 hareket, 30.205 fiş, 8.030 çek / senet; üç yıl): cari listesi 12–50 ms (derin sayfa 500 dahil), seçici 33 ms, dev cari kartı
> 18 ms, ekstre 9–10 ms (20 sayfa zinciri 0,12 sn), yaşlandırma alacak (16.456 borçlu cari) 0,68 sn / borç 0,19 sn / acente 0,24 sn,
> hareketler 29–44 ms (20 sayfa 0,15 sn), fiş ve çek listeleri 9–32 ms, tahsilat fişi (kasa + 2 çek) ~0,1 sn, ödeme 64 ms, virman 54 ms,
> iptal 72 ms, restoran ödemesinin kaydı 39 ms, eşitleme boş gün 69 ms / birikmiş belge başına 29 ms. Ölçümle düzeltilen:
> **yaşlandırma 2,15 → 0,68 sn** (cari başına LATERAL okuma + kısmi kapsayan index'ler `LedgerEntry_debit_fifo_idx` / `_credit_fifo_idx`,
> ayrı migration; özet sayfadan ayrı — sayfa aralık dışındayken de toplam doğru), **imleçli sayfa** yalnız açılış bakiyesini hesaplar
> (20 sayfa: ekstre 0,39 → 0,12 sn, hareketler 1,17 → 0,15 sn), **eşitleme** belge başına 94 → 29 ms (bağlam ve eşleme bir kez) +
> süre sınırı (30 günlük ~24.000 belgelik birikim tek istekte 194 sn sürüyordu) + taramalar sıralı (paralel tarama havuzda yeni
> bağlantı açtırıp boş günü 2 sn'ye çıkarıyordu).
>
> **Test:** sözleşme 16 birim (eşleme çözümü, fiş etkisi / dengesi, çek durum makinesi, yaşlandırma dilimleri — elle hesaplı, dönem
> kuralları); aktör 7 birim; entegrasyon 19 (ön büro → kasa / banka / acente carisi + vade, acentesiz cari seçimi ve dört gözlü iptalin
> ters kaydı, dövizli nakit, eşleme yokken manuel görev → eşitleme, süre sınırı ve kaldığı yerden devam, başlangıç günü; etkinlik
> tahsilatı + bedel + iptal bedeline düzeltme, restoran ve iptali, mal kabul vadesi, prim onayı / geri alınması; açılış, tahsilat
> (nakit + çek), ciro + nakit ödeme, virman, kasa yetmezliği, iptal; dört göz; çek yolculuğu; ekstre / hareketler devir + yürüyen
> bakiye + imleç ve FIFO yaşlandırma elle hesaplanmış dilimlerle; eşzamanlı yarışlar; izinler, otel kapsamı, IBAN). Bütün backend
> birim (618), sözleşme (474), ön yüz (71) testleri ve derlemesi, tam entegrasyon seti (634 / 634) geçti.
>
> **Yan düzeltmeler:** ödeme servisi seçilen cariyi (`ledgerAccountId`) saklar, iptal satırına taşır; "Acente / cari" ödemesinde
> referans artık zorunlu değil (cari seçimi yeterli). **Demo sıfırlaması onarıldı** — çamaşır / minibar siparişleri, konaklama
> parçaları, rezervasyon misafirleri, folyo yönlendirmeleri ve faturalar silinmediği için sıfırlama yabancı anahtarda düşüyordu (cuma
> günkü canlı demo yüklemesini de kırardı); ters kayıtlar önce, folyo aktarım / birleştirme bağları boşaltılarak siliniyor. Katalogda
> sözleşme testleri artık sayılıyor (her modülde `x.js` yanındaki `x.test.js`; önceden bütün modüllerde 0 görünüyordu).
>
> **Demo** (`scripts/demo-accounting.mjs`, `demo-data.mjs` çağırır): başlangıç 30 gün önce, ödeme fişi eşiği 75.000 TRY; 7 kasa / banka
> (döviz kasaları, POS bankası) açılışlarıyla, ön büro / etkinlik / restoran eşlemesi, 4 şirket carisi (acentesiz "Acente / cari"
> ödemeleri bunlara bağlı), cari açılışları (vadesi geçmiş borçlar yaşlandırmayı doldurur); dönemin bütün ödemeleri, mal kabulleri,
> primleri ve etkinlik bedelleri eşitlemeyle işlenir (süre sınırına takılırsa kalan kalmayana kadar tekrar); tahsilat (havale, çek),
> ödeme (biri eşik üstü — onay bekliyor; biri alınan çekin cirosuyla; biri firma çekiyle), virman, masraf çıkışı; çekler tahsilde / tahsil
> edilmiş / ciro edilmiş / ödenecek.
>
> **Devir:** 16 / 49 — `invoice.issued` yükündeki `ledgerSourceKey` ile mevcut cari hareket fatura numarasına bağlanır; folyosuz
> fatura `INVOICE` kaynağıyla yazılır (**49'da kuruldu:** bağ `LedgerEntry.invoiceNumber` kolonuyla, `postings.syncInvoice`; `reference`
> değişmez). 48 — cari ve kasa / banka hareketleri yevmiye fişlerinin kaynağı (kaynak türü + anahtarı fiş
> kuralına eşlenir). 44 / 27 — gider gerçekleşeni mal kabul ve ödeme fişlerinden okunabilir. Kasa sayımı / gün sonu kapanışı 18 ile.

### 48. Genel muhasebe — Ali Kemal
**Gün sonu:** Tek Düzen Hesap Planı yüklü; her satış / tahsilat otomatik yevmiye fişi oluyor; mizan çıkıyor.
- [ ] Backend: ChartOfAccounts (ağaç), Journal, JournalLine tabloları + API; Tek Düzen seed
- [ ] Backend: otomatik fiş kuralları tablosu (event tipi → borç hesap / alacak hesap)
- [ ] Backend: mizan sorgusu (tarih aralığı, hesap bazlı borç / alacak / bakiye)
- [ ] Ekran: Hesap planı ağacı + hesap ekle
- [ ] Ekran: Fiş listesi + manuel fiş girişi (borç = alacak kontrolü)
- [ ] Ekran: Mizan
- [ ] Ekran: Otomatik fiş kuralları ayarı
- [ ] Aktör: accounting-worker'a fiş üretim kuralları

> **FlexAI 2.0'dan not (3 Kasım 2026 — Ahmet):** 93 (USALI) her hesabı bir USALI satırına / departmana, 96 (dış muhasebe
> aktarımı) hedef programın hesap koduna eşleyecek. Hesabın departmanını (oda, F&B, diğer, dağıtılmamış) tutabilecek
> yer bırak; e-Defter (49'un kalanı) bu modülden sonra.

> **Modül 51'den not (3 Kasım 2026 — Ahmet):** bordro 47'ye cari tarafını yazıyor (kaynak `PAYROLL` / `PAYROLL_PAYMENT`, anahtar
> `PAYROLL:<bordro>:<personel|SGK|TAX|BES|GARN:…>`); yevmiye fişinde gider tarafı (departmana göre 740 / 760 / 770 personel giderleri, SGK işveren payı,
> Hazine indirimi) `payroll.run.approved` olayından ve `PayrollEntry` toplamlarından kurulur.

### 49. e-Fatura / e-Arşiv / e-Defter — arkadaşın
**Gün sonu:** Faturalar özel entegratör üzerinden GİB'e gidiyor, durumu izleniyor; e-Defter aylık dosyası üretiliyor.
- [x] Backend: EInvoiceConfig, EInvoiceLog tabloları; entegratör adaptörü (1 firma ile başla) — `InvoiceSettings`, `InvoiceLog`,
  `InvoiceDocument`; adaptör sözleşmesi + **test entegratörü** (firma henüz belli değil — kullanıcı kararı; gerçek adaptör devirde)
- [x] Backend: UBL XML üretimi, gönderim, durum sorgulama; alıcı mükellef mi kontrolü (e-Fatura / e-Arşiv ayrımı)
- [ ] Backend: e-Defter aylık yevmiye / kebir dosyası — **48'den sonraya bırakıldı** (kullanıcı kararı: e-Defter yevmiyeden üretilir)
- [x] Ekran: Entegratör ayarları (hesap, test / canlı)
- [x] Ekran: Fatura listesine "GİB durumu" kolonu + gönder / tekrar gönder
- [ ] Ekran: e-Defter aylık üretim + indirme — **48'den sonra**

> **✅ Modül 49 tamamlandı — e-Defter hariç (2 Kasım 2026 — Ahmet).** Kararlar (kullanıcı): **16'nın çekirdeği burada** (fatura ile
> e-belge birlikte), **entegratör henüz belli değil** (adaptör sözleşmesi + test ortamı; canlı ortam gerçek adaptörle açılır),
> **e-Defter 48'den sonra**.
>
> **Akış:** folyo kapanınca folyo aktörü (`billing-worker`, `folio.closed`) taslak açar; etkinlik (gerçekleşmiş ya da iptal bedeli
> kesinleşmiş) ve serbest fatura (cariye) taslağı ekrandan. Satırlar folyo kalemlerinden gelir grubuna göre (iptaller düşülmüş, indirim
> satır iskontosu, açıklamada hizmet dönemi), vergi kalemin kayıtlı dökümünden (`taxLines`). Alıcı: folyo cariye aktarıldıysa cari
> (şahıs carisi kişi alıcı), değilse misafir; adres ve kimlik aynı alıcının son faturasından. **Kesim:** kaynak yeniden okunur
> (değiştiyse taslak yenilenir, kesim durur) → mükellef sorgusu (24 sa önbellek, işlem dışında) → e-Fatura (kayıtlı + posta kutusu) ya
> da e-Arşiv → seri × yıl numarası (satır kilidi, boşluksuz) → UBL-TR belgesi (SHA-256 ile donar) → gönderim sırası; hepsi tek işlemde.
> **Gönderici:** `FOR UPDATE SKIP LOCKED` üstlenme, 4 eşzamanlı, tur başına ≤ 200; geçici hata 1 dk / 5 dk / 15 dk / 1 sa / 4 sa sonra,
> hak bitince "gönderilemedi" + personel uyarısı; kalıcı hata / GİB reddi "reddedildi" + uyarı; durum sorgusu gönderimden 30 sn sonra,
> 4 eşzamanlı, 7 gün; 5 dk'dan uzun "gönderiliyor" sıraya döner. **İptal** dört gözle (`INVOICE_CANCEL`; onay beklerken gönderim durur):
> GİB'e ulaşmamışsa yerelde, e-Arşiv entegratörden, e-Fatura GİB portal referansıyla. **Ön muhasebe:** folyo / etkinlik faturasının
> numarası mevcut cari harekete yazılır (`LedgerEntry.invoiceNumber`, iptalde silinir); serbest fatura vadeli alacak, iptali fatura
> tarihli ters kayıt (muhasebe aktörü `invoice.issued` / `invoice.cancelled`).
>
> **GİB kuralları:** KDV 0015 ve konaklama vergisi 0059 KDV hariç bedel üzerinden (biri ötekinin matrahına girmez); vergisiz satır %0 +
> 351 muafiyet kodu; numara 3 karakter seri + yıl + 9 hane, ETTN ayrı; yabancı kişi 11111111111 (uyruk + pasaport notta), **yurt
> dışındaki şirket 2222222222** (kendi vergi no notta) — ikisi de her zaman e-Arşiv; karekod GİB Karekod Kılavuzu v1.1 anahtarlarıyla;
> fatura günü otelin takvim günü; yasal süre hizmetten sonra 7 gün (VUK 231/5). `UBL_TR_CUSTOMIZATION_ID = 'TR1.2'` tek sabitte —
> entegratörün doğrulayıcısıyla teyit edilmeli (TR1.2 / TR1.2.1).
>
> **Veri** (migration `20261101090000_invoicing`, `…100000_invoice_alert_kind`, `…110000_ledger_invoice_number`,
> `…120000_invoice_start_date`, `…130000_invoice_foreign_company`): eski boş `Invoice` yerine `Invoice` (kaynak, durum, e-belge
> alanları, alıcı JSON + liste kolonları, iptal izi), `InvoiceLine`, `InvoiceDocument`, `InvoiceLog`, `InvoiceSettings` (satıcı,
> seriler, **faturalama başlangıcı**, entegratör, ortam), `InvoiceTaxCode`, `InvoiceSequence`, `TestTaxpayer`, `TaxpayerLookup`;
> `LedgerEntry.invoiceNumber`; `StaffAlertKind.INVOICE`. Kısıtlar: kaynak bağı, taslakta numara / e-belge yok, kesilmişte numara / tür /
> gün / alıcı / durum var, numara biçimi, iptal izleri, toplamlar (belge ve satır), seri ve ortam (canlı + test entegratörü olmaz),
> vergi kodu 0015 / 0059; folyo ve etkinlik başına tek geçerli fatura (kısmi tekil index); sıra / sorgu / gönderiliyor için kısmi
> index'ler, alıcı adında trigram.
>
> **Faturalama başlangıcı:** otelin saatiyle gece yarısından; öncesinde kapanan folyo / etkinlik önceki sistemde faturalanmış sayılır
> (kuyruğa girmez, taslağı açılırsa uyarı). Ayar yokken kuyruk boş ("Faturalama başlamadı"). Canlıya çıkışta otellerin geçmiş
> folyoları bir anda "süresi geçmiş" görünmesin diye eklendi; başlangıç bugünden sonra olamaz, ileri alınırsa ekran aradakilerin
> kuyruktan çıkacağını söyler.
>
> **API ve izinler:** `/invoices` — liste (+ `folioId` / `eventId`), `invoiceables`, taslak `POST` / `PUT` / `DELETE`, `:id/issue`,
> `:id/resend`, `:id/cancel`, `:id/copy`, `:id/pdf`, `settings` (+ `test-taxpayers`). Yeni izinler: `invoices.view` / `invoices.issue`
> (müdür, muhasebe, ön büro), `invoices.manage` (müdür, muhasebe: serbest fatura, satır düzenleme, iptal isteği), `invoices.setup`
> (müdür). Onay türü `INVOICE_CANCEL`; uyarı türü `INVOICE`; kanal `invoices`; olaylar `invoice.issued` (genişledi),
> `invoice.cancelled`, `invoice.changed`, `invoice.settings.changed`.
>
> **Ekran:** `/faturalar` sekmeli — **faturalanacaklar** (folyo / etkinlik, 7 gün – 1 yıl, süresi geçenler, arama; yasal süre rozeti),
> **taslaklar**, **kesilenler** (gönderilemedi / reddedildi / sonuç bekleniyor / iptal onayı kutuları, süzgeçler, tekrar gönder,
> serbest fatura penceresi), **ayarlar** (satıcı, başlangıç, seriler, otomatik taslak, entegratör, vergi kodu eşlemesi, test
> mükellefleri). **Fatura ekranı:** taslakta alıcı formu (kişi / şirket / yabancı kişi / yabancı şirket), "Kesmeden önce" eksik
> listesi, yasal süre, başlangıç uyarısı, satırlar ve vergi dökümü; kesilmişte e-belge kutusu (ETTN, posta kutusu, son cevap), zaman
> çizelgesi, PDF, iptal / yeni taslak. Folyo ve etkinlik ekranında fatura kutusu; onay ekranında fatura bağlantısı.
>
> **Ölçüm** (`scripts/perf-invoicing.mjs`; 150.000 kapanmış folyo, 123.000 fatura, 120.000 satır, 360.000 zaman çizelgesi satırı; üç
> yıl): liste 3–34 ms (derin sayfa 500 dahil), arama 66–101 ms, ayrıntı 14 ms, faturalanacaklar 30 gün 21 ms / 1 yıl 82 ms / süresi
> geçenler 89 ms / etkinlik 31 ms, taslak 44 ms, alıcı 31 ms, kesim 60 ms, PDF 106 ms, gönderici 200 belge 1,03 sn, durum turu 200
> belge 0,46 sn. Ölçümle düzeltilen: **faturalanacaklar 1 yıl 577 → 82 ms, süresi geçenler 973 → 89 ms** (yalın kimlik kümesi + sayım,
> ayrıntı yalnız sayfa için; "süresi geçen" için yakın günlerin kalemlerine anti-join), durum turu sıralı yerine 4 eşzamanlı. En kötü:
> bir yıl hiç fatura kesilmemiş 30.000 folyoda iki harfli arama 0,29 sn.
>
> **Test:** sözleşme 19 birim (satır kurma ve gruplama, toplamlar, vergi dökümü, TCKN / VKN, alıcı denetimi — yabancı kişi / şirket,
> belge türü, numara, karekod, yazıyla tutar, yasal süre, ayar şeması); UBL 5 birim (öğe sırası, tutar tutarlılığı, yabancı alıcılar,
> kaçış); aktör testleri (folyo aktörü taslak, muhasebe aktörü bağ); entegrasyon 14 (folyo faturası uçtan uca + PDF, cari alıcı ve
> e-Fatura + numaranın cariye bağı / iptalde çözülmesi, e-Arşiv iptal yolları, yabancı kişi, **yurt dışındaki şirket ve türün
> hatırlanması**, geçici hata / hak bitimi / tekrar gönderim, GİB reddi, serbest fatura alacağı + ters kaydı, **şahıs carisi kişi
> alıcı**, etkinlik + iptal bedeli, kaynak değişince yenileme, eşzamanlı 8 kesim boşluksuz + tek taslak, **faturalama başlangıcı**
> (saat dilimi sınırı), izinler ve otel kapsamı). Backend birim 624, sözleşme 494, aktörler 101, ön yüz 71 ve derleme geçti.
>
> **Yan düzeltmeler:** demo folyo kalemleri vergi dökümüyle (`chargeLine`, `taxLines`) — eskiden dökümsüzdü, fatura eksik vergili
> kesilirdi (artık `INVOICE_TAX_BREAKDOWN` ile durur); **demo otelin vergileri** gerçek düzene getirildi (KDV %10 oda + yiyecek-içecek,
> konaklama vergisi %2 oda, KDV %20 minibar / çamaşır / spa / diğer; dahil fiyat değişmedi); demo carilerin, banket müşterilerinin ve
> yurt içi acentelerin vergi numaraları geçerli denetim haneli; denetim kaydına muhasebe ve fatura varlık etiketleri; folyo ve ödeme
> servisinin yeniden açma yolu fatura bekçisini çağırıyor. Ham SQL'de zaman parametresi `sqlTimestamp`, gün `::date` (çıplak `Date`
> oturumun saat dilimiyle 3 saat kayıyordu — test yakaladı).
>
> **Demo** (`scripts/demo-invoicing.mjs`, `demo-data.mjs` çağırır): test ortamı, seriler DMF / DMA, faturalama başlangıcı iki hafta
> önce; vergi kodları eşli; bütün şirketler test mükellefi (biri "posta kutusu yok" → ret); son üç günden eski folyoların faturası
> **kapanış gününde** kesilmiş ve GİB'de tamamlanmış (numara sırası tarih sırasıyla aynı), en eski ikisi bilerek gecikmiş, son günlerin
> folyoları otomatik taslakta (yarısının alıcısı eksik); yurt dışındaki acentelere yabancı şirket faturası; bir etkinlik ve bir
> serbest fatura; birkaç fatura bugün kesilmiş ve sonuç bekliyor; onay kuyruğunda bir iptal isteği.
>
> **Devir:** **48** — kesilen / iptal edilen faturalar yevmiye fişlerinin kaynağı; **e-Defter** (aylık yevmiye / kebir dosyası ve ekranı)
> 48'den sonra burada açık. **Gerçek entegratör** — `providers/` altına `send` / `status` / `cancel` / `checkTaxpayer` adaptörü, CustomizationID
> teyidi, canlı ortam. **Döviz faturası** — otel parası TRY değilse kesim durur. **e-Arşiv e-posta gönderimi** entegratör adaptörüyle.
> **Canlıya alırken:** 5 migration + `npm install` (`qrcode-generator`); her otel ayarlarda satıcı ve faturalama başlangıcını girmeli
> (girene kadar kuyruk boş).

> **Modül 55 döneminden not (10 Kasım 2026 — Ahmet):** **toplu fatura** (kullanıcı kararı: iki adım). Faturalanacaklardan seçilenlere
> toplu taslak (`POST /invoices/batch-drafts`; alıcısı eksik taslak işaretlenir), taslaklardan alıcısı tamam olanlara toplu kesim
> (`POST /invoices/batch-issue`; her taslak tek kesimin kuralıyla, açılış sırasıyla numara). En fazla 100 kayıt; istek 20 sn bütçeyle
> durur, kalanlar `pending` döner, ekran ilerleme göstererek kendiliğinden devam eder (`useBatchRunner`). Taslak listesi alıcı eksiklerini
> döner (`buyerProblems`), sayfa 100 satır. Entegrasyon testleri: sıra, alıcı eksik, bayat sürüm, bütçe, çift seçim; toplu taslakta
> kapanmamış / olmayan folyo.

### 50. Sanal POS / ödeme geçidi — Ali Kemal
**Gün sonu:** Misafire ödeme linki gönderiliyor veya widget'ta kartla ödeme yapılıyor; sonuç otomatik folyoya düşüyor.
- [ ] Backend: PaymentGatewayConfig, PaymentTransaction tabloları; sağlayıcı adaptörü (iyzico veya PayTR)
- [ ] Backend: ödeme linki üret, 3D Secure akışı, webhook → `payment.received`
- [ ] Ekran: Sağlayıcı ayarları
- [ ] Ekran: "Ödeme linki gönder" (rezervasyon / folyo üzerinden; e-posta / WhatsApp ile)
- [ ] Widget'a kart ödeme adımı
- [ ] Ekran: İşlem listesi (başarılı / başarısız / iade)

> **FlexAI 2.0'dan not (3 Kasım 2026 — Ahmet):** 84 provizyon (al, artır, kapat, serbest bırak), kart token'ı ve ters ibraz
> bildirimi isteyecek; sağlayıcı arayüzünü bunları sonradan ekleyebilecek biçimde kur (49'un `providers/` deseni:
> ortak arayüz + TEST adaptörü). Kart numarası hiçbir tabloda tutulmaz.

> **Modül 53'ten not (4 Kasım 2026 — Ahmet):** online check-in'de "kartla ön ödeme" ve portal ana sayfasında "kartla ödeme" pasif bekliyor
> (`portalOverview` → `features.payOnline`). 50 gelince provizyon / ödeme bağlantısı buradan açılır; misafirin seçtiği ödeme tercihi
> `OnlineCheckin.paymentPreference`'ta.

### 51. Personel & bordro — arkadaşın
**Gün sonu:** Personel kartları kayıtlı; aylık bordro hesaplanıp çıktı alınıyor.
- [x] Backend: Employee, Payroll, PayrollLine tabloları + API; brüt → net hesabı (SGK, vergi dilimi parametrik)
- [x] Ekran: Personel listesi + kart (kimlik, pozisyon, departman, işe giriş, maaş, IBAN)
- [x] Ekran: Aylık bordro hesapla (ek ödeme / kesinti gir → hesapla → onayla)
- [x] Ekran: Bordro PDF / toplu çıktı

> **✅ Modül 51 tamamlandı (3 Kasım 2026 — Ahmet).** Kararlar (kullanıcı): ücret kişi bazında brüt ya da net anlaşmalı (net → brüt
> çözümü en küçük brütü bulur); çıktılar bordro listesi, pusula, departman icmali, banka dosyası ve müşavir tablosu; onaylanan bordro
> ön muhasebeye (47) kendiliğinden düşer; kapsamda avans, icra / nafaka ve BES kesintileri, çıkış bordrosu (kıdem, ihbar, kullanılmayan
> izin), servis payı dağıtımı ve çalışan bazında teşvikler.
>
> **Hesap motoru** (`payroll/engine.js`, saf, kuruş tamsayı): 30 gün esası; prime esas kazanç taban–tavan arası; SGK işçi / işsizlik /
> işveren payları, emekliye SGDP; 5510 Hazine indirimi (2 puan, imalatta 5) teşviksiz ve tüm kollara tabi çalışana; gelir vergisi
> birikmiş matrah üzerinden dilimli; asgari ücret GV / DV istisnası kişinin kendi birikmiş asgari ücret matrahıyla; engellilik indirimi;
> yemek ve yol istisnaları; kesinti sırası BES → nafaka → icra (ilk dosya, netin dörtte biri) → avans → diğer. Kıdem yalnız damga
> vergili (tavanlı), ihbar GV + DV (SGK yok), izin ücreti tam tabi.
>
> **Yasal parametreler:** 2026'nın üç seti kaynaklı katalogda (1 Ocak; 17 Nisan yemek SGK istisnası; 1 Temmuz kıdem tavanı); ay, ayın
> son günü yürürlükteki setle hesaplanır. Kaydedilen set "teyitsiz" başlar; teyitsiz setle hesaplanan bordro onaya gidemez; onaylı ya da
> onaydaki bordronun seti değişmez, teyidi kaldırılmaz.
>
> **Akış:** puantaj (200 satıra kadar tek kayıt) ve kalemler → hesap → onaya gönder (dört göz, `PAYROLL` onay türü) → onayda avans
> taksitleri ve icra / nafaka kesilenleri kesinleşir → ödeme (banka: banka hesabından + IBAN dosyası; elden: yalnız kasadan; tarih
> bugünü geçemez; kasa eksiye düşmez). Onaylı ay kilitli, düzeltme fark bordrosuyla. İşten çıkış önizlemeli (kıdem, ihbar ya da ihbar
> kesintisi, izin ücreti kalemleri), geri alınabilir.
>
> **Muhasebe (47):** tahakkuk ay sonu tarihli — personel carisine net ücret (avans mahsubu dahil), SGK / vergi dairesi / BES / icra ve
> nafaka dosyası carilerine; ödeme kasa / banka çıkışı ve personel carilerine borç (cari kapanır). Kaynak anahtarlarıyla idempotent;
> 250 kişilik parçalar, parça başına toplu cari açma ve tek seferde hareket + bakiye yazımı. Gider tarafı 48'de.
>
> **API ve izinler:** `/payroll` — `employees` (+ `termination` önizleme / kayıt / geri alma, `incentives`, `advances`, `garnishments`),
> `openings` (yıl içi matrah devri), `departments`, `attendance`, `items`, `service-charge`, `runs` (+ `calculate`, `submit`, `pay`,
> `entries`, `export` banka / müşavir, `pdf` bordro / pusula), `settings`, `parameters` (+ `catalog`, `verify`), `elements`. Yeni izinler
> `employees.view` / `employees.manage`, `payroll.view` / `payroll.manage` / `payroll.pay` / `payroll.setup`; ücret, IBAN, avans ve
> kesintiler yalnız bordro görüntüleme izniyle görünür. Olaylar `employee.changed`, `payroll.run.changed`, `payroll.run.approved`,
> `payroll.settings.changed`; kanal `payroll`.
>
> **Ekran:** `/personel` (liste; kart: kimlik ve iş, ücret, avanslar, icra ve nafaka, teşvikler, matrah devri, işten çıkış), `/bordro`
> sekmeli — bordrolar, puantaj ve kalemler, servis payı, ayarlar (parametre setleri, işyeri, departmanlar, kalemler); `/bordro/:id`
> (toplamlar, departman icmali, çıktılar, satırlar, pusula penceresi, ödemeler).
>
> **Ölçüm** (`scripts/perf-payroll.mjs`; 2.500 personel, bir yıl): listeler 7–14 ms, kart 12 ms, puantaj 200 satır 0,41 sn, hesap 2.500
> kişi 3,6 sn, dışa aktarım 0,30–0,40 sn, bordro PDF 2.500 satır 5,0 sn, pusula 500 sayfa 4,0 sn, onay 149 ms, ödeme 173 ms.
> Ölçümle düzeltilen: **muhasebe aktarımı 60,5 → 6,2 sn** (toplu cari açma, `createMany`, hesap başına tek bakiye güncellemesi).
>
> **Test:** motor birim testleri resmî tablolarla (asgari ücretli neti 28.075,50, işveren maliyeti 40.214,03 / indirimsiz 40.874,63,
> dilim geçişi, tavan, emekli, engellilik, istisnalar, net → brüt, kesinti sırası, kıdem / ihbar / izin); entegrasyon: teyit kapısı,
> dört göz, ay kilidi, onayda kesinleşme, muhasebe tahakkuku ve ödemesi, elden ödemenin kasadan, eşzamanlı hesap, fark bordrosu,
> işten çıkış, servis payı, izinler, otel kapsamı. Tam paket: entegrasyon 670/670, backend birim 657, sözleşme 522, ön yüz 80, derleme.
>
> **Demo** (`scripts/demo-payroll.mjs`, `demo-data.mjs` çağırır): 45 personel, 8 departman; Ocak–Ekim onaylı ve ödenmiş, Ekim'e fark
> bordrosu, Kasım hesaplanmış; avans, icra (dosya tutarında tamamlanan), nafaka, BES, servis payı.
>
> **Devir:** **52** — `Employee` ortak kayıt; İK puantajı `PayrollAttendance`'a yazar (kaynak `TIMESHEET`). **48** — bordro
> tahakkukunun gider tarafı (personel gideri, SGK işveren payı). **94** — MUHSGK (muhtasar ve prim hizmet) beyan verisi bordro
> satırlarından. **Canlıya alırken:** 1 migration; bordro ayarlarında işyeri ve sektör girilmeli, parametre setleri teyit edilmeli.

### 52. İK — Ali Kemal
**Gün sonu:** İzin talepleri onaylanıyor, vardiya çizelgesi yapılıyor, puantaj tutuluyor, özlük belgeleri saklanıyor.
- [ ] Backend: Leave, Shift, Timesheet, EmployeeDocument tabloları + API; izin bakiye hesabı
- [ ] Ekran: İzin talebi (personel) + onay (yönetici) → onay kuyruğu
- [ ] Ekran: İzin bakiyeleri
- [ ] Ekran: Haftalık vardiya çizelgesi (departman × gün)
- [ ] Ekran: Puantaj (giriş / çıkış, mesai)
- [ ] Ekran: Özlük belgeleri (yükle, süre takibi)

> **Modül 51'den not (3 Kasım 2026 — Ahmet):** `Employee`, `Department` ve `PayrollAttendance` 51'de kuruldu; İK aynı personel kaydını
> kullanır (ikinci personel tablosu açılmaz). Puantaj ekranı 51'in `PayrollAttendance` satırına kaynak `TIMESHEET` ile yazmalı; onaylı
> bordronun ayı kilitlidir (`PAYROLL_MONTH_LOCKED`), düzeltme 51'in fark bordrosuyla. İzin bakiyesi 51'in işten çıkışındaki
> "kullanılmayan izin" günlerine kaynak olur.

> **FlexAI 2.0'dan not (3 Kasım 2026 — Ahmet):** 88 (işgücü planlama) `Shift`'e öneri yazacak: vardiyayı departman × gün × saat
> aralığı × kişi olarak tut; yasal dinlenme ve haftalık saat sınırını kural fonksiyonu olarak dışa aç. 76 puantajı
> telefondan (QR + konum) girecek; 78 stajyerlere `INTERN` rolüyle süreli hesap açacak.

---

## 8. MİSAFİR DENEYİMİ

### 53. Temassız uygulamalar — arkadaşın
**Gün sonu:** Misafir gelmeden telefonundan check-in yapıyor, QR ile menüden sipariş veriyor, portalda folyosunu görüyor.
- [x] Backend: OnlineCheckin, GuestPortalSession tabloları; token'lı public linkler — oturum tablosu yerine rezervasyona bağlı imzalı `GuestPortalLink`
- [x] Misafir portalı (ayrı küçük React app): rezervasyonum, online check-in formu (kimlik, imza, kart), folyom, istek gönder, chat (8) — kart adımı 50 gelince (kullanıcı kararı)
- [x] QR menü sayfası (38'deki menü JSON'u; sipariş → 41) — **41'den hazır:** imzalı bağlantı + QR, misafir uçları ve sözleşme
  (bkz. 41 notu "53 için"); burada yalnızca misafirin gördüğü sayfa yapılır
- [x] Ekran (personel): online check-in yapanlar listesi, onayla → 6'daki check-in
- [x] Dijital anahtar butonu (62 tamamlanınca aktif) — portalda yerinde, pasif

> **FlexAI 2.0'dan not (3 Kasım 2026 — Ahmet):** portal 2.0'da başka modüllerin sayfalarını da taşıyacak: upsell (83), tesis
> rezervasyonu (99), hediye çeki (84), konaklama ortası nabız (81). Portalı sayfa eklenebilir (yol + menü kaydı) kur.

> **✅ Modül 53 tamamlandı (4 Kasım 2026 — Ahmet).** Kararlar (kullanıcı): her yetişkin için kimlik bilgisi + **zorunlu belge
> fotoğrafı** (açık rıza, saklama süresi sonunda otomatik silme); davet **otomatik + elle** (girişten N gün önce 9'un kanallarıyla;
> rezervasyondan kopyala / QR / yeniden gönder); portal **TR + EN + DE + RU**; kart adımı **50 gelince** (şimdilik ödeme tercihi + pasif
> "kartla ön ödeme"; kart numarası hiçbir yerde tutulmaz).
>
> **Bağlantı:** `/misafir/p/<kimlik>.<imza>` — rezervasyona bağlı, JWT sırrından türetilen anahtarla HMAC (41'den ayrı bağlam), sabit
> zamanlı karşılaştırma; rezervasyonda tek geçerli bağlantı (kısmi tekil index), yenileme eskisini iptal eder; iptal / gelmedi ve
> çıkıştan 14 gün sonra kapanır. Misafir uçları `/public/portal/:token` oturumsuz, `no-store` / `no-referrer`, belirteç istek günlüğünde
> maskeli. Hız sınırı **bağlantı başına**, üstünde IP tavanı (3.000 / dk; `lib/guest-rate-limit.js`, 41'in oda servisi uçlarıyla ortak):
> otel Wi-Fi'ı misafirleri tek NAT adresinden çıkarır, yalnız IP'ye göre sınır lobideki misafirleri birbirine kilitlerdi.
>
> **Online check-in:** girişten `checkinOpenDays` (7) gün önce açılır; yetişkin refakatçi ≤ yetişkin − 1, çocuk ≤ çocuk; yetişkine en az
> bir, kişi başına en fazla iki belge fotoğrafı (telefonda küçültülür, EXIF düşer; misafire geri gösterilmez — yalnız sayısı ve maskeli
> numara); kurallar + KVKK + fotoğraf rızası + ticari ileti tercihi + parmakla imza (PNG, sürümlü). Gönderim rezervasyon kilidi ve
> sürümle; işlem kaydına kimlik numarası yazılmaz; resepsiyon ziline `ONLINE_CHECKIN` uyarısı. Durumlar: inceleme bekliyor → onaylandı /
> düzeltme istendi (sebep misafire görünür, misafirin dilini gösteren alan) → giriş yapıldı (`guest.checked_in`; geri almada onaylıya
> döner). Misafir onaydan sonra değiştirirse yeniden incelemeye düşer.
>
> **KVKK:** belge fotoğrafları çıkıştan (gelmeyende girişten) `documentRetentionDays` (7) gün sonra, bağlanmayan yükleme 48 saat sonra
> silinir; silinince kayıttaki kimlik numarası / doğum tarihi kopyası da temizlenir (ad, belge türü, uyruk, imza kalır).
>
> **Davet (9):** yeni tetikleyici `CHECKIN_INVITE` (`{portalLinki}`; TR / EN e-posta + SMS şablonu; kurulmuş otelde ilk davet şablonları
> yükler, silineni geri getirmez); iş 30 dk'da bir, otel başına 100'lük parçalar, 60 sn bütçe; elle gönderim 10 dk'da bir. Portal adresi
> (`publicBaseUrl`) ya da davetin gidebileceği açık kanal + etkin şablon yoksa tur başlamaz. Davet bir kanala satır açılınca "gitti"
> sayılır (iletişimsiz misafirde harcanmaz, bilgi eklenince sonraki turda gider); personelin iptal ettiği / yenilediği bağlantıya otomatik
> davet gitmez (elle gönderilir). Adaylar `[hotelId, status, checkIn, id]` indeksiyle imleçli; ayıklama parça içinde `IN` ile.
>
> **Folyo (misafire):** yalnız misafirin ödediği pencereler — şirket / acente penceresi (`payerName` dolu; kontrat fiyatı) gösterilmez,
> yalnız varlığı söylenir. Ödeme satırı folyonun para biriminde ve işaretli (iade / iptal eksi, iptal "Ödeme iptali"); dövizli ödemenin
> kendi tutarı altında.
>
> **Misafir uygulaması:** panelden ayrı Vite girişi (`frontend/guest`, `vite.guest.config.js`), `/misafir/` altında, `dist/misafir`'e
> derlenir (yayın adımı aynı). Sayfa kaydı `PORTAL_PAGES` (2.0 sayfaları bir satırla). Zod / sözleşme paketini taşımaz (104 KB gzip);
> sınırlar ve belge numarası kuralı `guest/src/limits.js`, sözleşmeyle testle bağlı. Sunucu derin bağlantıyı tanımazsa panelin
> `index.html`'i misafiri `/misafir/index.html?p=` ile yönlendirir (nginx ayarı gerekmez). Oda servisi sayfası 41'in uçlarıyla; portal
> içerideki misafire oda bağlantısını kendisi verir. Web sohbeti (8) kanal açıksa ve portal adresi izinliyse portalda.
>
> **Personel:** Ön büro → Online check-in (liste: giriş günü, durum sayıları, arama; inceleme penceresi: kişiler, belge fotoğrafları,
> imza, onaylar, onay / düzeltme, "Girişi yap"), portal ayarları (adres, günler, saklama, dört dilde karşılama / kurallar / KVKK metni,
> eksik dil ve sohbet uyarısı), rezervasyon ayrıntısında portal kartı (bağlantı, QR, davet, yenile / iptal, online check-in durumu).
> Giriş penceresi (6) online check-in'le dolu açılır.
>
> **API ve izinler:** `/guest-portal` — `settings`, `online-checkins` (+ `by-reservation`, `documents`, `signature`, `approve`, `reject`),
> `links/:reservationId` (+ `invite`); `/public/portal/:token` — ana sayfa, `check-in` (+ `photos`), `folio`, `requests`, `room-service`.
> İzinler `guest_portal.view` / `.manage` (müdür, ön büro), `guest_portal.setup` (müdür). Olaylar `online_checkin.changed`,
> `guest_portal.link.changed`, `guest_portal.settings.changed`; kanal `guest-portal.changed`.
>
> **Ölçüm** (`scripts/perf-guest-portal.mjs`; 550.500 rezervasyonlu otelde 30.000 bağlantı, 18.000 online check-in, 36.000 belge): liste
> 31–54 ms, arama 29–50 ms, ayrıntı 8 ms, misafir ana sayfa 19 ms, form 7 ms, fotoğraf 22 ms, gönderim 90 ms, davet turu (e-posta
> kanalı açık, gerçek bildirim satırı) 60 sn bütçede 1.399 davet, kalan 183 sonraki turda (~43 ms / davet, arka planda), silme turu
> 34 ms. Ölçümle düzeltilen: **liste 0,2–0,3 sn → 30–50 ms** (giriş günü kayıtta, indeksli;
> `reservation.updated` ile eşitlenir), **arama 0,9–1,8 sn → 30–50 ms** (onay kodu + adlar kayıtta, trigram), davet işi tur başına
> 100'le sınırlıyken zaman bütçeli döngü.
>
> **Demo** (`scripts/demo-guest-portal.mjs`, `demo-data.mjs` çağırır; adres `DEMO_PORTAL_URL`): 4 günün varışlarına bağlantı + davet,
> yarısına online check-in (bekleyen / onaylı / düzeltme), son girişlerde tamamlanmış; geçerli TC kimlik / pasaport; belge ve imza
> `scripts/assets/` altındaki "örnek belge" görselleri (gerçek kişi yok).
>
> **Testler:** entegrasyon (gerçek PostgreSQL, bütün suite) 680 / 680; backend birim 660, sözleşme 531, ön yüz 83 — hepsi geçti; iki
> derleme temiz. Öz incelemede bulunup testle kapatılan: belirtecin istek günlüğüne açık yazılması, IP başına hız sınırı (otel
> Wi-Fi'ı), acente penceresinin misafire görünmesi, dövizli / iade / iptal ödemenin yanlış yazılması, iletişimsiz misafirde davetin
> harcanması, iptal edilen bağlantıya otomatik davet, davet sorgusunun bütün otellerin kayıtlarını taraması.
>
> **Canlıya alırken:** 4 migration; yeni paket yok (`npm run build` iki uygulamayı derler); her otel portal ayarlarında adresi girip
> kaydetmeli (otomatik davet için), web sohbetinin izinli adreslerine portal adresini eklemeli; demo için yeniden yükleme.

### 54. Misafir yorum entegrasyonu + duygu analizi — Ali Kemal
**Gün sonu:** Google / Booking yorumları sisteme düşüyor; AI olumlu-olumsuz ve konu etiketi veriyor, cevap öneriyor; trend grafiği var.
- [ ] Backend: Review, ReviewAnalysis tabloları; yorum çekme (API varsa) + manuel / Excel yükleme
- [ ] insight-agent paketi (toplu çalışır: duygu, konu etiketi, önerilen cevap, anomali: "temizlik şikâyeti bu hafta 3 kat arttı")
- [ ] Ekran: Yorum listesi (kaynak, puan, duygu, konu; filtre)
- [ ] Ekran: Yorum detayı + önerilen cevap → düzenle → gönder / kopyala
- [ ] Ekran: Trend grafiği (haftalık duygu, konu dağılımı)
- [ ] Anomali → yöneticiye bildirim

> **FlexAI 2.0'dan not (3 Kasım 2026 — Ahmet):** insight-agent'ın çıktısını şemalı yaz (duygu puanı, konu, departman, dil):
> 80 (tercih çıkarma), 81 (konaklama içi duygu) ve 102 (kalite skoru) aynı ajanı ve şemayı kullanacak.
>
> **Modül 55'ten not (10 Kasım 2026 — Ahmet):** `shared/agents/insight-agent` kuruldu (55'in anket yorumları için): şemalı JSON çıktı
> (ton `POSITIVE/NEUTRAL/NEGATIVE/MIXED`, konu `SURVEY_TOPICS` listesinden en fazla 5, tek cümle Türkçe özet; dönem özetinde tema / pay /
> alıntı / öneri), ayrıştırma listeyle sınırlı (`prompt.js`: `parseAnalysis`, `parseInsight`), kişisel veri istemde yok. Yorum siteleri için
> yeni olay adıyla (`review.analysis.requested` gibi) handler eklenir; istemler kaynaktan bağımsız. Konu listesi `contracts/surveys.js`.

### 55. Anket & memnuniyet — arkadaşın
**Gün sonu:** Check-out'tan 1 gün sonra anket gidiyor; cevaplar toplanıyor; NPS ve AI özeti görünüyor.
- [x] Backend: Survey, SurveyQuestion, SurveyResponse tabloları + API; public cevap sayfası — **+ SurveyInvitation, SurveyAnswer, SurveyFollowUp(+Note), SurveyInsight, SurveySettings**; misafir sayfası `/misafir/a/:token` (53'ün misafir uygulamasında)
- [x] Backend: `guest.checked_out` + 1 gün → notification-worker anket linki gönderir — **zamanlanmış iş (15 dk) + 9'un kanalları; kullanıcı kararı: ara anket de (girişin ertesi günü)**
- [x] Ekran: Anket tasarımı (sorular, tip: puan / çoktan seçmeli / açık) — **+ NPS, dört dil, sıralama, arşiv**
- [x] Ekran: Cevaplar listesi + NPS skoru — **+ NPS raporu (eğilim, soru / bölüm puanı, cevap oranı) ve takip ekranları**
- [x] insight-agent özeti (açık uçlu cevapların ana temaları) — **+ her yoruma ton / konu etiketi**

> **✅ Modül 55 tamamlandı (10 Kasım 2026 — Ahmet).** Kararlar (kullanıcı): **çıkış sonrası + kısa ara anket**; düşük puanda **uyarı +
> takip kaydı**; yorum bağlantıları **herkese** (yalnız memnunlara göstermek Google kurallarına aykırı).
>
> **Anketler:** otelde tür başına bir anket (çıkış sonrası, ara anket), ilk okunuşta dört dilde varsayılan sorularla kurulur. Soru tipleri NPS
> (tek), 1–5 puan, seçenekli (tekli / çoklu), açık uçlu; konu (rapordaki bölüm), zorunluluk, dört dilde metin (eksik dil Türkçeye düşer,
> ekranda uyarı). Tasarım anketin `version`'ıyla iyimser kilitli; cevaplanmış soru silinmez (arşiv), tipi değişmez, cevaplanmış seçenek
> kaldırılamaz. Soru başına cevap sayısı tasarım ekranında 1.000'de kesilir ("1.000+").
>
> **Gönderim:** zamanlanmış iş 15 dk'da bir; çıkış sonrası çıkış anının otel günü + `postStayDelayDays`, saat `postStaySendHour`'dan
> (en fazla 2 gün geç); ara anket girişin ertesi günü `midStaySendHour`'dan, en az `midStayMinNights` gece, ayrılış gününe değil. Aynı
> misafire aynı tür `minDaysBetweenSurveys` günden sık değil, aynı turda aynı misafirin iki odası tek anket. Davet bir kanala satır
> açılınca "gitti" sayılır (iletişimsiz / kanal kapalıysa silinir, sonraki turda yeniden); kanal + şablon ya da portal adresi yoksa tur
> başlamaz. Zaman gerçek saat (gece kapanışına bağlı değil). Bildirim tetikleyicileri `SURVEY_POST_STAY` / `SURVEY_MID_STAY`
> (`{anketLinki}`; TR / EN e-posta + SMS şablonu; kurulmuş otelde ilk turda yüklenir).
>
> **Misafir:** `/misafir/a/<kimlik>.<imza>` (HMAC, anket bağlamı; anket ekranları personele göstermez, giden iletinin metni bildirim geçmişinde durur);
> bağlantı `linkValidDays` gün. Dört dil, uyruğa göre. Davet başına tek cevap (tekil kısıt); zorunlu / aralık / seçenek denetimi alan alan;
> anket bu arada değiştiyse sorular yenilenir. Bitince puandan bağımsız Google / TripAdvisor bağlantısı. Açık anket portal (53) ana
> sayfasında kutu. Uçlar bağlantı başına hız sınırlı (okuma 30, yazma 5 / dk) + ortak IP tavanı, belirteç günlükte maskeli.
>
> **Düşük puan:** NPS ≤ `lowNpsThreshold` (6) ya da bir puan ≤ `lowRatingThreshold` (2) → cevapla aynı işlemde takip kaydı + zil
> (`SURVEY_LOW_SCORE`; ara ankette kritik). Hedef içeride 2, çıkmışta 48 saat; üstlen / devret / bırak, görüşme ve not (değişmez),
> sonuç + açıklamayla kapanış (veritabanı kısıtı), yeniden aç. İşlem kaydına yorum metni yazılmaz.
>
> **Rapor:** NPS ve dağılımı, cevap oranı (davet / açılan / cevaplanan), puan ortalaması, haftalık / aylık eğilim (cevap sayısıyla), soru
> başına ortalama + dağılım, seçenek sayıları, bölüm puanları, AI konu / ton dökümü, takip özeti.
>
> **AI (insight-agent, `shared/agents/insight-agent`):** yorumlu cevap AI açıksa ton + en fazla 5 konu + tek cümle (şemalı JSON, listeyle
> sınırlanır, yalnız bekleyen cevaba yazılır, 30 dk'da yazılmazsa "etiketlenemedi"); dönem özeti (en yeni 150 yorum; tema, pay, alıntı, en
> fazla 3 öneri; aynı dönem için bekleyen tek istek; `surveys.setup`). Model ad, onay kodu, iletişim görmez. Otelin ana modeli
> (`conciergeModel`); AI kapalıysa her şey AI'sız çalışır.
>
> **API ve izinler:** `/surveys` — `settings`, `design/:kind` (+ `questions`, `order`, `remove`, `restore`), `responses`, `report`,
> `insights`, `follow-ups` (+ `assignees`, `assign`, `notes`, `resolve`, `reopen`); `/public/survey/:token`. İzinler
> `surveys.view` / `.follow_up` (müdür, ön büro), `surveys.setup` (müdür). Olaylar `survey.*`; kanal `surveys.changed`.
>
> **Ölçüm** (`scripts/perf-surveys.mjs`; 2 yıl: 150.000 davet, 60.000 cevap, 534.000 cevap satırı): rapor 30 gün / 1 yıl 151 / 183 ms,
> listeler 9–18 ms, ayrıntı 9 ms, takip 15 ms, tasarım 7 ms, misafir formu 9 ms, gönderim 86 ms, AI girdisi 193 ms, davet turu 400 çıkışta
> 19 sn (arka planda). Ölçümle düzeltilen: **1 yıllık rapor 0,4–0,6 sn → 0,18 sn** (puan dökümü ve davet sayımı yalnız indeksten,
> seçenek dökümü yalnız seçenekli soruların satırlarından), **tasarım 0,2 sn → 7 ms** (sayım 1.000'de kesilir).
>
> **Testler:** entegrasyon tam suite 691 / 691 (anket 9), backend birim 660, sözleşme 543, ön yüz 83, insight-agent 8.
>
> **Demo** (`scripts/demo-surveys.mjs`, `demo-data.mjs` çağırır): son 60 günün çıkışlarına davet, ~%34 cevap (lüks otel NPS dağılımı),
> dört dilde yorumlar ve `demo` modelli AI etiketleri, son günlerin ara anketleri, takipler (kapanmış / ilgilenilen / açık), dönem özeti.
>
> **Canlıya alırken:** 2 migration (`20261110090000_surveys`, `20261110100000_survey_report_indexes`); yeni çalışma alanı paketi
> `@hotelos/insight-agent` → `npm install`; otel anket ayarından anketleri açar (bağlantı tabanı portal adresi, kanal + şablon gerekir);
> demo için yeniden yükleme.

### 56. Sadakat programı — Ali Kemal
**Gün sonu:** Misafir her konaklamada puan kazanıyor, seviyesi yükseliyor, puanla indirim alıyor.
- [ ] Backend: LoyaltyProgram, LoyaltyAccount, LoyaltyTransaction tabloları; puan kazanma kuralı (`folio.closed` → harcama × oran)
- [ ] Ekran: Program kuralları (puan oranı, seviyeler, seviye avantajları)
- [ ] Ekran: Misafir kartına "puan / seviye" kutusu (22)
- [ ] Ekran: Puan harcama (rezervasyonda indirim olarak kullan)
- [ ] Portala (53) puan görünümü

### 57. SPA & spor salonu randevu — arkadaşın
**Gün sonu:** Masaj / hamam / PT randevuları terapist takviminde; ücret folyoya yansıyor.
- [ ] Backend: SpaService, Therapist, SpaAppointment tabloları + API; çakışma kontrolü
- [ ] Ekran: Hizmet listesi (süre, fiyat, gereken terapist)
- [ ] Ekran: Randevu takvimi (terapist × saat)
- [ ] Ekran: Randevu formu (misafir / dışarıdan, hizmet, terapist, saat) → folyo kalemi
- [ ] Portaldan (53) randevu alma

---

## 9. YASAL & ENTEGRASYON

### 58. Emniyet kimlik bildirimi (KBS) — Ali Kemal
**Gün sonu:** Her check-in sonrası misafir bilgisi KBS'ye otomatik gidiyor; hata olursa listede görünüp tekrar gönderiliyor.
- [ ] Backend: KbsConfig, KbsLog tabloları; KBS web servis adaptörü
- [ ] Backend: `guest.checked_in` → bildirim gönder (worker kuralı); `guest.checked_out` → çıkış bildirimi
- [ ] Ekran: KBS ayarları (tesis kodu, kullanıcı)
- [ ] Ekran: Bildirim logu (başarılı / hatalı, tekrar gönder)
- [ ] Check-in formunda KBS için zorunlu alan kontrolü

> **Modül 53'ten not (4 Kasım 2026 — Ahmet):** online check-in her yetişkinin belge türü / numarası / uyruğu / doğum tarihini toplar;
> giriş penceresi bunlarla dolar, KBS bildirimi girişin kaydından gider (online check-in'in kendisi bildirilmez). Belge fotoğrafları
> KBS'ye gitmez, saklama süresi sonunda silinir.

### 59. Kimlik / pasaport okuma (OCR) — arkadaşın
**Gün sonu:** Check-in'de kimliğin fotoğrafı çekilince ad, soyad, TC / pasaport no, doğum tarihi otomatik doluyor.
- [ ] Backend: OCR servisi bağlantısı (MRZ okuma; bulut API veya kütüphane)
- [ ] Ekran: Check-in formunda "Kimlik tara" butonu (kamera / dosya)
- [ ] Ekran: Okunan alanları göster → onayla → forma yaz
- [ ] Kimlik görselini misafir kaydına ekle (KVKK: süre sonunda sil)

> **FlexAI 2.0'dan not (3 Kasım 2026 — Ahmet):** son maddeyi başlamadan yeniden düşün — öneri: görüntü **saklanmasın**, yalnız
> makine okunur satır (MRZ) alanları alınsın ve okuma bitince görüntü silinsin; kayda alanlar + "kimlikten okundu"
> işareti yazılır (KVKK riski neredeyse sıfır). Telefon modu (personel misafirin yanında) ve kiosk modu (misafir
> kendisi) aynı okuma bileşenini kullanır (73'ün kamera bileşeni). Karar 59'a başlarken.

> **Modül 53'ten not (4 Kasım 2026 — Ahmet):** online check-in belge fotoğrafları (`OnlineCheckinDocument`, yalnız personel uçlarından)
> OCR'ın doğal girdisi: okunan alanlar misafirin yazdıklarıyla karşılaştırılıp inceleme penceresinde uyarı olabilir. Fotoğraflar saklama
> süresinde silinir; OCR süre dolmadan çalışmalı.

### 60. Çoklu dil & çoklu para birimi — Ali Kemal
**Gün sonu:** Arayüz TR / EN arasında geçiyor; fiyatlar seçilen para biriminde görünüyor; günlük kur otomatik geliyor.
- [ ] Frontend: i18n altyapısı (çeviri dosyaları, dil seçici, tarih / sayı formatı)
- [ ] Tüm mevcut ekranların metinlerini çeviri anahtarına taşıma
- [ ] Backend: ExchangeRate günlük çekme (TCMB), kur geçmişi
- [ ] Ekran: Para birimi seçici; fiyat gösterimlerinde dönüşüm
- [ ] Fatura ve widget'ta döviz desteği

### 61. Webhook & açık API — arkadaşın
**Gün sonu:** Dış sistemler API key ile bağlanıyor; istedikleri event'i kendi URL'lerine alıyor; dokümantasyon sayfası var.
- [ ] Backend: ApiKey, WebhookSubscription, WebhookDelivery tabloları + API
- [ ] Backend: public REST API (rezervasyon, müsaitlik, misafir; rate limit); OpenAPI dokümanı
- [ ] Backend: webhook gönderici (event → URL; imza; tekrar deneme)
- [ ] Ekran: API key yönetimi
- [ ] Ekran: Webhook abonelikleri + teslimat logu
- [ ] Doküman sayfası (Swagger UI)

> **FlexAI 2.0'dan not (3 Kasım 2026 — Ahmet):** anahtarları kapsamlı (scope) kur ve bir "uygulama" kavramı bırak: 86 uzaktan
> MCP istemcilerini (OAuth 2.1) buradan kaydedecek; 100 (acente portalı) ve 85'in webhook eylemi bu altyapıyı kullanacak.

### 62. Donanım entegrasyonları — Ali Kemal
**Gün sonu:** Check-in'de kapı kartı kodlanıyor, oda telefonu açılıyor; check-out'ta kapanıyor; POS cihazından ödeme sonucu geliyor.
- [ ] Backend: Device, DeviceLog tabloları; ortak adaptör arayüzü (`encodeKey`, `revokeKey`, `openLine`, `closeLine`, `chargeCard`)
- [ ] Adaptör: 1 kapı kilidi markası
- [ ] Adaptör: 1 santral
- [ ] Adaptör: 1 POS cihazı
- [ ] Ekran: Cihaz tanımları + bağlantı testi
- [ ] Check-in / check-out akışına cihaz adımları; hata olursa manuel görev

> **FlexAI 2.0'dan not (3 Kasım 2026 — Ahmet):** cihaz çerçevesi 2.0'da iki tür daha taşıyacak: 74 yazarkasa (ÖKC, GMP3: fiş
> bas, iptal, Z raporu) ve 89 oda yönetim sistemi (GRMS: sensör olayları, klima / sahne komutları). Adaptör arayüzünü
> sabit yöntem listesi yerine yetenek (capability) bazlı kur; cihaz olayları durum değişince yazılsın, ham akış değil.
> 101 (sesli santral) çağrı devri için santral adaptörünü kullanacak.

> **Modül 53'ten not (4 Kasım 2026 — Ahmet):** portal ana sayfasında "Dijital anahtar" kutusu pasif bekliyor (`features.digitalKey`);
> anahtar, içerideki konaklamanın odasına ve portal bağlantısına bağlanmalı (oda değişince / çıkışta geçersiz).

### 63. Multi-tenant zincir konsolu — arkadaşın
**Gün sonu:** Zincir yöneticisi birden çok oteli tek panelden görüyor; otel arası geçiş yapıyor; zincir raporu alıyor.
- [ ] Backend: HotelGroup, UserHotel tabloları; kullanıcı → birden çok otel yetkisi
- [ ] Backend: zincir raporu (oteller karşılaştırmalı doluluk / gelir)
- [ ] Ekran: Otel listesi + yeni otel ekleme sihirbazı (ayarlar 1'i kopyala)
- [ ] Ekran: Üst barda otel seçici
- [ ] Ekran: Zincir dashboard'u
- [ ] Ekran: Merkezi kullanıcı yönetimi

> **FlexAI 2.0'dan not (3 Kasım 2026 — Ahmet):** `HotelGroup` / `UserHotel` 2.0'da üç yerde kullanılacak: 75 (sahip birden
> çok oteli görür), 77 (Akademi sınıfı = eğitim otelleri grubu), 104 (karşılaştırma kümeleri). "Yeni otel sihirbazı"nı
> servis fonksiyonu olarak dışa aç: 69 (göç) ve 77 (eğitim oteli kurulumu) aynı fonksiyonu çağıracak.

---

## 10. DİKEY PAKETLER

Hepsi aynı çekirdeği kullanır. Her paket: kendi manifest'i, birkaç ek tablo, birkaç ekran, "oda" kavramının yeniden adlandırılması.

### 64. Apart / rezidans — Ali Kemal
**Gün sonu:** Daireler uzun dönem kiralanıyor, aylık fatura ve aidat kesiliyor, sayaç okuması giriliyor.
- [ ] Oda → daire; uzun dönem sözleşme tablosu
- [ ] Aylık otomatik faturalama (kira + aidat + sayaç)
- [ ] Sayaç okuma ekranı (elektrik / su)
- [ ] Kiracı portalı (53'ün uyarlaması)

### 65. Yurt yönetimi — arkadaşın
**Gün sonu:** Öğrenciler yatak bazında kayıtlı; dönemlik ücret, veli bilgisi, giriş-çıkış ve yemek listesi çalışıyor.
- [ ] Oda → yatak; öğrenci kartı (veli, okul)
- [ ] Dönemlik kayıt ve taksitli ücret
- [ ] Giriş / çıkış kontrolü (kart okuyucu veya manuel)
- [ ] Haftalık yemek listesi ekranı

### 66. Devremülk — Ali Kemal
**Gün sonu:** Malikler ve dönem hakları kayıtlı; dönem takası ve aidat takibi yapılıyor.
- [ ] Oda → hisse / dönem; malik kartı
- [ ] Hak sahipliği takvimi (hangi hafta kimin)
- [ ] Dönem takas talebi + onay
- [ ] Aidat tahakkuk ve tahsilat

### 67. Marina — arkadaşın
**Gün sonu:** Bağlama yerleri iskele bazında tanımlı; tekneler sözleşmeyle bağlanıyor; elektrik-su ve kara hizmetleri faturalanıyor.
- [ ] Oda → bağlama yeri (iskele, no, boy / en sınırı); tekne kartı (ad, boy, en, bayrak, sahip)
- [ ] Bağlama sözleşmesi (günlük / aylık / sezonluk) → rezervasyon çekirdeği
- [ ] İskele planı ekranı (5'in uyarlaması)
- [ ] Sayaç (elektrik / su) okuma → folyo
- [ ] Kara hizmetleri (çekme, indirme, yıkama) → folyo kalemi

### 68. Klinik — Ali Kemal
**Gün sonu:** Hasta kartı, randevu, hekim takvimi ve tedavi faturası aynı çekirdek üstünde çalışıyor (`clinic/` paketi).
- [ ] Oda → muayene odası / yatak; hasta kartı (22'nin uyarlaması)
- [ ] Hekim takvimi + randevu (57'nin uyarlaması)
- [ ] Tedavi planı ve seans takibi
- [ ] Fatura (16) ve ödeme (17) aynen kullanılır

---

# FLEXAI 2.0

Tarih: 3 Kasım 2026
1–68 bittikten sonra başlar. Ortak mimari, yeni yapı taşları, roller, onay türleri, olay alanları ve yol
haritası: **[FLEXAI-2.0.md](FLEXAI-2.0.md)**. Paylaşım aynı: **tek numaralar = arkadaşın, çift numaralar = Ali Kemal.**

2.0'da her modülün başında iki satır daha var:
- **Önkoşul:** başlamadan bitmiş olması gereken modüller. "varsa" = isteğe bağlı bağ (yoksa o parça sonra bağlanır).
- **Aktör:** işi yürüten worker / ajan / geçit (yoksa "manuel" ya da "sistem").

2.0'ın her modülünde geçerli (tek tek yazılmadı): dış bağlantı `providers/` adaptörü + TEST adaptörü (49'un
deseni), sırlar `secret-box`'ta; yapay zekâ özelliği bütçeli (`LlmUsage`) ve yapay zekâsız yoluyla; yan etkili
yapay zekâ işi önizleme + kullanıcı onayıyla; yeni özellik bayrak (72) arkasında; yeni kişisel veri alanı
veri envanterine (71) saklama süresiyle; 5 sn'den uzun iş uzun iş çerçevesinde (69).

---

## 11. SAĞLAM ZEMİN

### 69. Göç sihirbazı — arkadaşın
**Gün sonu:** Başka bir PMS'ten (önce Elektraweb) gelen dosyalar sihirbazla içeri alınıyor; misafir, gelecek rezervasyon, içerideki konaklama, açık folyo bakiyesi, cari bakiye ve kontratlar geliyor; kaynak toplamlarıyla bizim toplamlar kuruşu kuruşuna tutmadan "canlıya al" açılmıyor.
**Önkoşul:** 26, 29, 47, 63 · **Aktör:** sistem (uzun iş)
- [ ] Altyapı: **uzun iş çerçevesi** — `BackgroundJob` (tür, otel, durum, ilerleme, imleç, son hata, deneme), üstlenme `FOR UPDATE SKIP LOCKED`, süre bütçeli tur + kaldığı yerden devam, iptal; ilerleme `jobs.changed` kanalından. Genel yazılır: 77, 88, 90, 91, 92, 96, 104 kullanır
- [ ] Backend: `MigrationProject`, `MigrationFile` (şifreli saklanır, proje kapanınca 30 gün sonra silinir), `MigrationMapping` (kaynak kod → bizim kayıt: oda tipi, pansiyon, vergi, acente, ödeme tipi), `MigrationRecord` (kaynak kimlik → bizim kimlik; tekrar çalıştırmada aynı kayıt güncellenir, ikinci kez açılmaz)
- [ ] Adaptör: kaynak biçimleri (`detect`, `readBatch`, `mapRow`) — Elektraweb dışa aktarım dosyaları + genel Excel/CSV şablonu (26'nın sihirbazıyla aynı kolon eşleştirme bileşeni)
- [ ] Aktarım sırası: ayarlar (oda tipi, oda, vergi, sezon, pansiyon) → acente + kontrat → misafir (TCKN / pasaport / telefon ile mükerrer birleştirme, 22'nin `mergeGuests` kuralı) → gelecek rezervasyonlar (`reservations/service.js` üzerinden, envanter kilidiyle; tabloya doğrudan yazılmaz) → içerideki konaklamalar → açık folyolar (devir bakiyesi kalemi) → cari bakiyeler (47 açılış fişi) → çek / senet
- [ ] Prova: hiçbir şey yazmadan doğrulama raporu (hatalı satır, eşleşmeyen kod, kapasite aşımı, geçmiş tarihli açık rezervasyon, para birimi)
- [ ] Mutabakat: kaynak / hedef kayıt sayısı, gelecek oda-gece, açık folyo toplamı, cari bakiye toplamı — para birimi bazında; fark sıfır değilse "canlıya al" kapalı
- [ ] Kesme günü: son gün delta aktarımı, kanal yöneticisi (33) kısa süreli durdurulur ve tam senkronlanır; canlıya alma onay türü `MIGRATION_COMMIT` (dört göz)
- [ ] Ekran: Sihirbaz (proje → dosya yükle → eşleştir → prova → mutabakat → canlıya al), aktarım geçmişi, satır bazında hata raporu (Excel)
- [ ] Ölçek: 300k misafir + 50k gelecek rezervasyon tek projede; 500'lük partiler, kesintide kaldığı yerden; perf betiği
- [ ] Test: mutabakat hesabı, mükerrer misafir eşleştirme, tekrar çalıştırmada çift kayıt olmaması

### 70. Kesintisiz çalışma — Ali Kemal
**Gün sonu:** Sunucu tamamen kaybolsa da otel en fazla 15 dakikalık veri kaybıyla ve 1 saat içinde başka sunucuda ayağa kalkıyor; her ay yedek otomatik açılıp sınanıyor; internet kesilince ön büro gelen, konaklayan, giden ve oda durumu listelerini görmeye ve yazdırmaya devam ediyor.
**Önkoşul:** 63 · **Aktör:** sistem
- [ ] Sürekli yedek: PostgreSQL WAL arşivi + günlük tam yedek, başka bölgedeki nesne depolamaya, şifreli, 35 gün (hedef RPO ≤ 15 dk); dosya deposu (`FILE_STORAGE_DIR`: PDF, fotoğraf, belge) aynı hedefe
- [ ] Felaket kurtarma kitabı: boş sunucuya kurulum betiği (altyapı kodu), adım adım geri yükleme, hedef RTO ≤ 1 saat
- [ ] Geri yükleme tatbikatı: her ay otomatik — yedek ayrı makinede açılır, sağlık ve tutarlılık sorguları koşar, sonuç platforma raporlanır; başarısızlık alarm
- [ ] İki uygulama süreci + yedek sunucu (akış replikasyonu): süreç içi kayıtların envanteri ve paylaşılan yere taşınması — realtime odaları (socket adaptörü), kanal kaydı (`lib/channels.js`), zamanlanmış işlerin tek süreçte koşması (lider seçimi / danışma kilidi)
- [ ] Çevrimdışı ön büro: tarayıcı 5 dakikada bir "acil durum anlık görüntüsü" (gelenler, konaklayanlar, gidenler, oda durumu, açık bakiyeler) alır; oturum anahtarıyla şifreli, 24 saatte kendini siler; bağlantı yokken salt okuma + yazdırma
- [ ] Acil durum çıktısı: tahliye listesi (oda, misafir, kişi sayısı, özel ihtiyaç) tek tıkla, çevrimdışı da
- [ ] Ekran: Sistem sağlığı (son yedek, son tatbikat, replikasyon gecikmesi) — yalnız ADMIN
- [ ] Test: iki süreçli entegrasyon testi (olay bir kez işlenir, socket haberi iki süreçten de gelir)

### 71. Güvenlik ve kimlik — arkadaşın
**Gün sonu:** Personel iki adımlı doğrulamayla giriş yapıyor; zincir kendi kurumsal hesabıyla (SSO) bağlanabiliyor; aktif oturumlar görülüp uzaktan kapatılabiliyor; FlexAI ekibi otel verisine yalnız otelin onayıyla ve süreli erişiyor; bağımsız sızma testinin bulguları kapalı.
**Önkoşul:** 2 · **Aktör:** sistem
- [ ] 2FA: TOTP + yedek kodlar; rol bazında zorunluluk (otel ayarı; ADMIN, MANAGER, ACCOUNTING, OWNER için varsayılan zorunlu)
- [ ] SSO: OpenID Connect (Google Workspace, Microsoft Entra); kullanıcı e-postayla eşleşir, rol ve izin yine bizde
- [ ] Oturumlar: cihaz, IP, son görülme; uzaktan kapatma; parola politikası; başarısız girişte artan bekleme ve kilit
- [ ] Socket kimliği: realtime el sıkışmasında JWT doğrulaması (bugünkü "istemcinin söylediği e-posta" sınırı kapanır), otel ve izin odaları token'dan
- [ ] Hassas işlemde yeniden doğrulama: kullanıcı/rol değişikliği, API anahtarı (61), toplu dışa aktarım
- [ ] Platform hesabı: FlexAI ekibi için ayrı giriş alanı; otel verisine **süreli destek erişimi** — otel ADMIN'i onaylar, salt okuma, 2 saat, her istek denetim kaydında; 72 ve 79 bunu kullanır
- [ ] KVKK teknik altyapı: kişisel veri envanteri (tablo, alan, amaç, saklama süresi), süresi dolanı silen imha işi + tutanak, veri sahibi başvurusu (erişim / silme) iş akışı; toplu kişisel veri dışa aktarımı onay türü `DATA_EXPORT` (dört göz)
- [ ] Güvenlik olayları: giriş, 2FA, yetki değişikliği, dışa aktarım ayrı akış; anormal desen (mesai dışı toplu misafir listesi indirme, çok sayıda başarısız giriş) → `staff.alert.raised`
- [ ] Bağımsız sızma testi + bulguların kapanışı; bağımlılık taraması derleme hattında
- [ ] Ekran: Güvenlik ayarları, oturumlarım, güvenlik olayları, KVKK başvuruları
- [ ] Olaylar: `security.login.failed`, `security.session.revoked`, `security.access.granted` (destek erişimi)

### 72. Gözlem, yayın ve paketleme — Ali Kemal
**Gün sonu:** Bir hata müşteri fark etmeden ekibe düşüyor; herkese açık durum sayfası var; yeni bir özellik önce tek otelde, sonra yüzde yüzde, sonra herkese açılıyor; her yayında kullanıcı "yenilikler"i görüyor. Her modül katalogda; bir otele istenen modüller ya da hazır bir paket verilebiliyor, lisansı olmayan modül o otelde görünmüyor ve çalışmıyor.
**Önkoşul:** 71 · **Aktör:** sistem
- [ ] Metrikler: istek süresi ve hata oranı (uç bazında), outbox birikmesi, aktör gecikmesi ve hata oranı, kuyruk uzunlukları, LLM harcaması, yedek gecikmesi; uyarı kuralları
- [ ] Ön yüz hata yakalama: tarayıcı hatası kullanıcı/otel/ekran bağlamıyla, kişisel veri maskeli
- [ ] Durum sayfası: bileşen bazında (uygulama, kanal yöneticisi, e-Fatura, WhatsApp, ödeme, telefon), olay geçmişi, abonelik
- [ ] Özellik bayrakları: `FeatureFlag` (anahtar, açıklama, varsayılan), `HotelFeature` (otel bazında aç/kapa, yüzde açılış); backend `isEnabled(hotelId, key)` önbellekli; ön yüz `useFeature`; bayrak değişince `feature.changed` ile önbellek tazelenir
- [ ] Yayın kapısı: hata oranı eşik üstündeyse yeni bayrak açılamaz; bayrak açıldıktan sonra hata sıçrarsa otomatik geri kapatma önerisi
- [ ] Sürüm notları: yayın başına rol bazlı "Yenilikler" penceresi; 79'un yardım makalesine bağlanır
- [ ] Ekran (platform): bayrak yönetimi, otel bazlı açılış durumu, metrik panoları
- [ ] **Modül kataloğu** (genel yapı taşı): `ModuleCatalog` — her modülün anahtarı, adı, bağımlılıkları (ör. 74 → 39), izin grupları, menüleri, aktörleri, uç önekleri; 1–68 geriye dönük kataloğa girer (izin gruplarından türetilir)
- [ ] **Paket ve lisans:** `Package` (modüller + fiyat kuralı: oda başı / ay, sabit, kullanıcı başı, en az tutar, kurulum), `HotelSubscription` (paket + ek modüller, dönem, deneme süresi); bağımlılığı eksik modül lisanslanamaz
- [ ] **Lisans kapısı:** backend `hasModule(hotelId, key)` önbellekli — lisanssız modülün uçları 403 `MODULE_NOT_LICENSED`, menüsü gizli (`useModule`), aktörü o otel için çalışmaz, olay dinleyicisi o oteli atlar; diğer modüller bozulmaz
- [ ] Kullanım ölçümü: oda sayısı, aktif kullanıcı, LLM harcaması, SMS / WhatsApp adedi — otel başına aylık (paket fiyatının girdisi)
- [ ] Ekran (platform): paket tasarımı, otel aboneliği, kullanım; otel tarafında "paketim" (salt okuma)
- [ ] Test: bağımlılık kontrolü, lisans kapısının uç / aktör / olay düzeyinde çalışması

### 73. Mobil temel — arkadaşın
**Gün sonu:** FlexAI telefona uygulama gibi kuruluyor; anlık bildirim geliyor; parmak izi / yüzle açılıyor; bağlantı gidince son veriler görünüyor, yazılan iş kaybolmuyor; patron ve personel uygulamaları bu kabuğun üstüne kuruluyor.
**Önkoşul:** 71, 9 · **Aktör:** notification-worker (PUSH kanalı)
- [ ] `hotel/mobile`: ayrı küçük React (Vite) uygulaması, PWA (manifest, service worker), `@hotelos/ui` ve `@hotelos/hotel-contracts`'ı paylaşır; rol bazlı açılış ekranı (OWNER → patron, HOUSEKEEPING → kat, FNB → garson…)
- [ ] Anlık bildirim: Web Push (VAPID; iOS ana ekran uygulaması dahil); `PushSubscription` (kullanıcı, cihaz, son görülme); notification-worker'a `PUSH` kanalı; zil haberleri (StaffAlert) kullanıcı tercihine göre push'a da; sessiz saatler
- [ ] Biyometrik açılış: WebAuthn cihaz kaydı + süreli yenileme anahtarı (71'in 2FA'sını karşılar)
- [ ] Çevrimdışı: okuma önbelleği (sürüm etiketiyle), yazma kuyruğu `requestId` ile; bağlantı gelince sırayla gönderim, 409 çakışması kullanıcıya gösterilir; para işlemi (ödeme, iade) çevrimdışı yapılamaz
- [ ] Ortak bileşenler: kamera / QR / barkod okuyucu, fotoğraf yükleme (sıkıştırılmış), imza alanı
- [ ] Ekran: Cihazlarım, bildirim tercihleri
- [ ] Mağaza: PWA yeterli değilse aynı kodla Capacitor sarmalayıcı (karar noktası)

### 74. Yazarkasa (ÖKC) ve e-Adisyon — Ali Kemal
**Gün sonu:** Restorana dışarıdan gelen müşterinin hesabı kapanınca yeni nesil yazarkasadan mali fiş çıkıyor (ya da e-Arşiv kesiliyor); oda hesabına aktarılan adisyonda fiş çıkmıyor (belge folyodan, 49'dan); gün sonu Z raporu vardiya kasasıyla mutabık; fiş iptali yalnız onayla.
**Önkoşul:** 39, 49, 62 · **Aktör:** fnb-worker (mali fiş kuralı) + 62'nin cihaz aktörü
- [ ] Backend: `FiscalDevice` (62'nin `Device`'ına bağlı; outlet, seri no, departman eşlemesi), `FiscalReceipt` (adisyon, fiş no, Z no, tutar, KDV kırılımı, durum), `FiscalDayClose`
- [ ] Adaptör: GMP3 ile 1 ÖKC markası + TEST — `printReceipt`, `voidReceipt`, `zReport`, `status`
- [ ] Kural: hangi ödeme mali belge ister — nakit / kart → ÖKC fişi veya e-Arşiv (49), oda hesabı → belge yok, ikram → belge yok ama kayıt var; KDV oranları ÖKC departmanlarına eşlenir
- [ ] Cihaz yanıt vermezse adisyon "fiş bekliyor" kalır, kasiyer görür, sessizce geçilmez; alternatif e-Arşiv yolu (ayar)
- [ ] e-Adisyon: kapsamdaki işletmede adisyon açılış/kapanış bildirimi — 49'un sağlayıcı arayüzüne yöntem (kapsam kararı)
- [ ] Fiş iptali: aynı gün ve onay türü `FISCAL_VOID` (dört göz)
- [ ] Gün sonu: Z raporu ↔ 39'un `PosShift` kapanışı; fark → `staff.alert.raised`
- [ ] Ekran: Cihazlar ve durumları, fiş listesi (yeniden bas, iptal iste), Z raporu geçmişi
- [ ] Olaylar: `fiscal.receipt.printed`, `fiscal.receipt.failed`, `fiscal.day.closed`
- [ ] Test: belge türü kuralı (ödeme türü × müşteri türü), KDV departman eşlemesi

---

## 12. SAHİP VE OKUL

### 75. Patron uygulaması — arkadaşın
**Gün sonu:** Otel sahibi telefonunu açınca bütün otellerinin bugünkü doluluğunu, gelirini, kasasını, bütçe sapmasını, forecast'ini ve yorum puanını görüyor; onay bekleyen büyük işleri oradan onaylıyor; kritik bir olay olunca bildirim alıyor; pazartesi sabahı haftalık sahip raporu e-postasında.
**Önkoşul:** 73, 63, 11, 18, 23, 25, 27, 54 (varsa) · **Aktör:** notification-worker
- [ ] Rol `OWNER` (Sahip): varsayılan salt okuma + `approvals.decide` + `owner.view`; misafir kişisel verisi maskeli (ayarla açılabilir)
- [ ] Backend: sahip özeti (otel başına bugün / dün / ay / yıl: doluluk, ADR, RevPAR, oda ve toplam gelir, tahsilat, açık alacak, kasa, bütçe sapması, 30 gün forecast, yorum puanı) — 18'in günlük özeti ve 23'ün tablolarından, 5 dk önbellekli
- [ ] Çoklu otel: 63'ün `UserHotel`'i; zincir toplamı ve otel karşılaştırması
- [ ] Onaylar: bekleyen onaylar, ayrıntı, onayla / reddet (dört göz kuralı aynen); push'tan derin bağlantı
- [ ] Uyarı abonelikleri: eşik bazlı (forecast doluluğu < %X, kasa farkı > Y, kötü yorum, büyük iptal, overbooking, sistem uyarısı) → push; sessiz saatler; `owner.alert.raised`
- [ ] Haftalık sahip raporu PDF'i (pdf-writer) e-postayla, pazartesi 08:00 otelin saatiyle
- [ ] Ekran (mobil): Bugün, Gelir, Onaylar, Uyarılar, Oteller; büyük rakam + trend + geçen yıl; karanlık mod
- [ ] Ölçek: 20 otelli zincirde özet < 300 ms (özet tablolar; otel başına ayrı sorgu döngüsü yok)

### 76. Personel mobil uygulaması — Ali Kemal
**Gün sonu:** Kat görevlisi, teknisyen, garson ve vardiya şefi işlerini telefondan yapıyor: görev alıp bitiriyor, fotoğraf ekliyor, minibar giriyor, barkodla sayım yapıyor, vardiyaya giriş yapıyor; bağlantı kopsa da iş kaybolmuyor.
**Önkoşul:** 73 (aynı aşamada; bitmeden başlamaz), 14, 19, 20, 21, 39, 41, 44, 46, 52 · **Aktör:** mevcut aktörler
- [ ] Kat hizmetleri: görevlerim (14), başla / bitir, "sorun var" (fotoğraflı → 20), minibar (19), kayıp eşya kaydı (21)
- [ ] Teknik servis: bana atananlar (20), başla / bitir, parça kullanımı (44 stok çıkışı), periyodik kontrol listesi
- [ ] Garson: masa / adisyon (39), siparişi mutfağa gönder (40), oda servisi teslimi (41)
- [ ] Sayım: barkodla stok sayımı (44), demirbaş sayımı (46)
- [ ] Vardiya: giriş-çıkış (52 puantaj; QR + konum doğrulamalı), izin talebi (52), bordro pusulası (51)
- [ ] Çevrimdışı: görev bitirme, minibar, sayım çevrimdışı yazılabilir; ödeme çevrimdışı kapalı
- [ ] Ekran: role göre sekmeler, büyük dokunma alanları, tek elle kullanım, personelin kendi dili (60)

### 77. FlexAI Akademi — arkadaşın
**Gün sonu:** Eğitmen bir sınıf açıyor; her öğrenciye gerçekçi verili, sıfırlanabilir bir eğitim oteli kuruluyor; öğrenci senaryoları (overbooking, grup girişi, gece kapanışı, şikâyet) çözüyor; sistem ne yaptığını olay ve denetim kaydından okuyup puanlıyor ve nedenini yazıyor; başaran öğrenci QR ile doğrulanan sertifika alıyor.
**Önkoşul:** 63, 69 (uzun iş), 10, 8, 71 · **Aktör:** academy-worker (puanlama) + rol yapma ajanı (concierge altyapısı)
- [ ] Ayrı kurulum: aynı kod `ACADEMY_MODE` ile; bütün dış adaptörler TEST'e kilitli, giden mesaj kapalı, canlı otellerin veritabanına hiçbir yol yok
- [ ] Backend: `AcademyClass` (eğitmen, dönem, ders), `AcademyEnrollment` (öğrenci → eğitim oteli), `Scenario` (başlangıç tohumu, hedefler, puan anahtarı, süre), `ScenarioAttempt`, `Certificate` (kod, seviye, tarih)
- [ ] Eğitim oteli: demo veri betikleriyle tohumlanır (uzun iş), "sıfırla" ve "senaryo başlangıcına götür"
- [ ] Puanlama: hedefler olay kaydı + denetim kaydı üzerinde kural (ör. overbooking: misafir başka odaya taşındı, folyo doğru, `OVERBOOKING` onayı gerekçeli); kısmi puan + açıklamalı geri bildirim
- [ ] Rol yapma: yapay zekâ "zor misafir"i senaryo kişiliğiyle oynar (önce yazılı, 101'den sonra sesli); öğrencinin cevabı rubrikle puanlanır (nezaket, çözüm, kurala uygunluk); öğrenci başına token bütçesi
- [ ] Senaryo kütüphanesi (ilk 20): rezervasyon, grup + rooming list, giriş-çıkış, folyo bölme, ödeme / iade, gece kapanışı, overbooking, oda değişikliği, kayıp eşya, şikâyet, kat planı, POS adisyon, oda servisi, banket teklifi, e-Fatura, KBS hatası, acente kontratı, kupon, bütçe, kasa farkı
- [ ] Eğitmen paneli: sınıf ilerlemesi, öğrenci bazında deneme geçmişi, ödev (senaryo + son tarih), not çıktısı (Excel)
- [ ] Sertifika: seviyeler (Ön Büro 1/2, F&B, Gelir Yönetimi…), herkese açık QR doğrulama sayfası (yalnız ad + seviye + tarih)
- [ ] Rol `INSTRUCTOR` (Eğitmen) + öğrenci; üniversite SSO'su (71)
- [ ] Olaylar: `academy.attempt.completed`, `certificate.issued`

### 78. Staj ve kariyer ağı — Ali Kemal
**Gün sonu:** Okul stajyerleri otellerle eşleştiriyor; stajyer otelde süreli ve kısıtlı bir hesapla çalışıyor, yetkisi olmayan işi yapınca istek mentoruna düşüyor; staj defteri dijital tutulup otelce onaylanıyor; dönem sonunda değerlendirmeler ve sertifikalar öğrencinin izniyle mezun havuzunda otellerin işe alımına açılıyor.
**Önkoşul:** 77 (aynı aşamada; bitmeden başlamaz), 52, 63, 71 · **Aktör:** manuel
- [ ] Backend: `InternshipProgram` (okul, dönem, kontenjan), `InternshipPlacement` (öğrenci, otel, departman, tarih aralığı, mentor), `InternshipLog` (günlük defter), `InternshipEvaluation`
- [ ] Eşleştirme: otel kontenjanı + departman ihtiyacı ↔ öğrenci tercihi + Akademi sertifikası (77); öneri listesi, son karar okul + otel
- [ ] Rol `INTERN` (Stajyer): staj bitince hesap otomatik pasif
- [ ] **Denetimli işlem** (genel yapı taşı): izin çözümüne "denetimli" kip — yetkisi olmayan işi (iade, iptal, fiyat değişikliği, indirim) yapınca istek mentorun onayına düşer, onay türü `SUPERVISED_ACTION`; deneme süresindeki personel için de kullanılabilir
- [ ] Staj defteri: günlük giriş (yaptığı işler denetim kaydından önerilir: "bugün 14 giriş yaptın"), mentor onayı, okul biçiminde PDF
- [ ] Değerlendirme formları (otel → öğrenci, öğrenci → otel); okul için otel bazında staj memnuniyeti
- [ ] Mezun havuzu: öğrencinin açık rızasıyla profil + sertifikalar + değerlendirmeler; otel İK'sı (52) ilan açar, havuzdan davet eder
- [ ] Ekran: Okul paneli, otel staj paneli, öğrenci ekranları (mobil, 73)
- [ ] Olaylar: `internship.placement.changed`, `internship.log.approved`

### 79. Uygulama içi yardım ve destek — arkadaşın
**Gün sonu:** Her ekranda "bu ekran ne yapar, nasıl yapılır" yardımı ve kısa videolar var; yardım asistanı yardım içeriğinden kaynak göstererek cevap veriyor; kullanıcı destek talebini ekran bağlamıyla tek tıkla açıyor; destek ekibi otelin onayıyla süreli erişimle sorunu görüyor.
**Önkoşul:** 71, 72, 77 · **Aktör:** assistant-agent (ilk sürüm: yalnız yardım içeriği)
- [ ] Yardım içeriği: ekran anahtarına bağlı makaleler (Markdown, sürümlü), Akademi senaryolarıyla aynı kaynaktan; arama
- [ ] İlk kullanım turları: rol bazlı adım adım; boş durum ekranlarında "nasıl başlarım"
- [ ] **Bilgi bankası altyapısı** (genel yapı taşı): belge → parça → gömme + Türkçe tam metin, karma arama, kaynak gösteren cevap, belge erişim listesi; sunucuya pgvector eklentisi. 86 otel belgeleri için kullanır
- [ ] `assistant-agent` ilk sürüm: yalnız yardım içeriğinden cevap, otel verisine erişim yok; bilmiyorsa "destek talebi aç" önerir; bütçe + LlmUsage
- [ ] Destek talebi: `SupportTicket` (otel, kullanıcı, ekran, tarayıcı, son hatalar (72), isteğe bağlı ekran görüntüsü), durum, öncelik, yanıt süresi
- [ ] Süreli destek erişimi (71) talep ekranından istenir; otel ADMIN'i onaylar
- [ ] Ekran: Yardım merkezi, taleplerim; platform tarafında destek kuyruğu
- [ ] Olaylar: `support.ticket.changed`

---

## 13. LÜKS MİSAFİR DENEYİMİ

### 80. Misafir tanıma ve kişiselleştirme — Ali Kemal
**Gün sonu:** Misafir ikinci kez geldiğinde otel onu tanıyor: tercihleri (yastık, kat, alerji, özel gün) geliş hazırlığına otomatik görev olarak düşüyor; yapay zekâ mesajlardan ve notlardan yeni tercih öneriyor, personel onaylamadan karta yazılmıyor; her sabah gelen VIP ve tekrar gelen misafirlerin brifingi hazır.
**Önkoşul:** 22, 7, 8, 14, 19, 41, 43, 56, 54/55 (varsa) · **Aktör:** insight-agent (tercih çıkarma) + guest-experience-worker (geliş hazırlığı)
- [ ] Tercih sözlüğü: 22'nin `GuestPreference`'ı kategori sözlüğüyle (oda, yastık, kat, minibar, yiyecek, alerji, özel gün, iletişim dili, hitap), kaynak (PERSONEL / MİSAFİR / AI), güven, son teyit; alerjiler 43'ün alerjen sözlüğüyle aynı kodlar
- [ ] Tercih çıkarma: insight-agent mesaj (7), istek, not, anket (55), yorumdan (54) aday tercih çıkarır → öneri kuyruğu; onaylanan karta yazılır, reddedilen bir daha önerilmez
- [ ] VIP: `VipCode` (seviye, kural: sadakat 56 seviyesi, harcama, yönetim notu), rezervasyonda görünür
- [ ] Geliş hazırlığı (geliş −1 gün, `guest-experience-worker`): tercih ve VIP'e göre görev üret — oda seçimi önerisi (3), amenity siparişi (41 / 19), kat hizmeti notu (14), karşılama kartı; `guest.arrival.prepared`
- [ ] Sabah brifingi: bugün gelen VIP ve tekrar gelenler, tercihler, geçmiş şikâyetler (81 gelince), özel günler — ekran + PDF + push (75 / 76)
- [ ] Kişiselleştirilmiş iletişim: mesaj ve e-postada misafirin dili ve hitabı (60)
- [ ] KVKK: alerji / sağlık özel nitelikli veri — açık rıza alanı + ayrı izin `guests.sensitive.view`; tercihlerin saklama süresi
- [ ] Ekran: Misafir kartında "Tanıma" sekmesi, öneri kuyruğu, VIP geliş panosu
- [ ] Olaylar: `guest.preference.suggested`, `guest.preference.changed`, `guest.arrival.prepared`

### 81. Servis kurtarma (misafir ilişkileri) — arkadaşın
**Gün sonu:** Konaklama sırasında memnuniyetsizlik (mesajdaki olumsuz ton, tekrarlanan istek, geciken görev, çözülmemiş arıza, düşük ara anket) misafir ilişkileri panosuna düşüyor; olay kaydı açılıyor, sorumlusu ve süresi var; telafi (ikram, indirim, yükseltme) onayla veriliyor ve maliyeti tutuluyor; açık olayı olan misafir çıkışa gelince ön büro uyarılıyor.
**Önkoşul:** 7, 8, 11, 14, 15, 20, 55, 80 (varsa) · **Aktör:** guest-experience-worker (sinyal kuralları) + insight-agent (duygu)
- [ ] Rol `GUEST_RELATIONS` (Misafir ilişkileri); izinler `recovery.view`, `recovery.manage`
- [ ] Sinyaller: konaklama içi mesajda olumsuz duygu (insight-agent), aynı istek ikinci kez, istek süresi aşıldı (7), arıza çözülmedi (20), ara anket ≤ 3 (55), oda değişikliği isteği; her sinyal ayrı kural, ayrı açılıp kapanır
  - *55'ten hazır (10 Kasım 2026):* `survey.response.submitted` (`kind`, `npsScore`, `lowScore`), ara anket (girişin ertesi günü) ve düşük puan takibi (`SurveyFollowUp`: üstlenen, görüşme notları, sonuç); olay kaydı bu takiple birleştirilmeli (iki ayrı iş listesi olmasın).
- [ ] Backend: `GuestIncident` (konaklama, kategori, departman, ciddiyet, durum, sorumlu, süre), `IncidentAction`, `Compensation` (tür, tutar ve maliyet, folyo kalemi bağlantısı)
- [ ] Telafi: folyoya indirim / ikram (15'in düzeltme yolu), oda yükseltme (3), ücretsiz hizmet; eşik üstü tutar onay türü `SERVICE_RECOVERY` (dört göz)
- [ ] Kapanış: misafire takip mesajı (8), memnuniyet sorusu; açık olayla çıkışta ön büroya uyarı
- [ ] Analiz: departman / oda / konu bazında olay sıklığı; tekrar eden sorun listesi (102 bunu DÖF kaynağı olarak okur)
- [ ] Ekran: Misafir ilişkileri panosu (konaklayanların nabzı renkli), olay ayrıntısı, aylık telafi maliyeti raporu; canlı kanal `recovery.changed`
- [ ] Olaylar: `guest.incident.opened`, `guest.incident.changed`, `guest.incident.closed`

### 82. Concierge ve butler masası — Ali Kemal
**Gün sonu:** Concierge misafir adına dış restoran, tur ve transfer rezervasyonu yapıyor, komisyonunu takip ediyor; uçuş numarası girilen misafirin iniş saati izleniyor, rötar olunca transfer ve oda hazırlığı kendiliğinden güncelleniyor; süit misafirine butler atanıyor, talepler butlerin telefonuna düşüyor.
**Önkoşul:** 7, 8, 14, 36, 47, 76, 80 · **Aktör:** guest-experience-worker (uçuş saati kuralı)
- [ ] Backend: `ConciergeVendor` (restoran, tur, transfer, kiralama; komisyon oranı, iletişim, cari bağlantısı 47), `ConciergeBooking` (misafir, tedarikçi, tarih/saat, kişi, durum, ücret, folyoya yansır mı, komisyon), `TransferBooking` (uçuş no, terminal, araç, şoför, saat)
- [ ] Adaptör: uçuş verisi (TEST + 1 sağlayıcı) — tahmini iniş, rötar; değişince `guest.arrival.eta_changed` → kat önceliği (14) ve transfer saati
- [ ] Komisyon: tedarikçi carisi (47) üzerinden aylık komisyon alacağı
- [ ] Butler: süit / VIP konaklamaya butler atama, butlerin görev akışı (76), misafirin butlere doğrudan mesajı (8'in kanalı)
- [ ] Şehir rehberi: otelin önerileri çok dilli; 53 portalında ve concierge ajanının `get_hotel_info` aracında
- [ ] Ekran: Concierge masası (bugünün dış rezervasyonları ve transferleri), tedarikçiler, butler panosu
- [ ] Olaylar: `concierge.booking.changed`, `guest.arrival.eta_changed`

### 83. Upsell ve oda özelliği satışı — arkadaşın
**Gün sonu:** Gelişten 3 gün önce misafire kendi dilinde, fiyatı doluluğa göre hesaplanmış yükseltme, erken giriş, geç çıkış ve paket teklifleri gidiyor; misafir portaldan seçip ödüyor; deniz manzarası, yüksek kat gibi oda özellikleri ayrı fiyatla garanti satılabiliyor; ön büro girişte hangi misafire ne önereceğini görüyor.
**Önkoşul:** 3, 4, 14, 15, 25, 28, 50, 53, 80 (varsa) · **Aktör:** guest-experience-worker (teklif zamanlaması)
- [ ] Oda özellikleri: `RoomAttribute` (manzara, kat, bağlantılı oda, köşe, balkon), `RoomAttributePrice`; garanti edilen özellik oda atamasında (3) kısıt — ihlal eden atama reddedilir
- [ ] Teklif motoru: `UpsellOffer` (tür, fiyat, geçerlilik), `UpsellOrder`; yükseltme fiyatı üst oda tipinin müsaitliği ve forecast'e (25) göre; dolması beklenen günde teklif yok
- [ ] Erken giriş / geç çıkış: o günün kat planı (14) ve gelen / giden yüküne göre satılabilir saat
- [ ] Gönderim: geliş −3 gün mesaj (8 / e-posta; hizmet mesajı sınıfında değilse İYS izni), portal sayfası (53), girişte ön büro önerisi
- [ ] Kabul: kartla (50) ya da folyoya; rezervasyon değişikliği `reservations/service.js` üzerinden (envanter kilidi, fiyat gece gece)
- [ ] Personel primi: kim ne sattı raporu
- [ ] Rapor: teklif / kabul oranı, ek gelir, oda tipi ve kanal bazında
- [ ] Ekran: Teklif kuralları, upsell panosu; misafir sayfası (53)
- [ ] Olaylar: `upsell.offer.sent`, `upsell.order.changed`
- [ ] Test: yükseltme fiyatı kuralı, özellik garantili atama kısıtı

### 84. Ödeme güvencesi, hediye çeki ve üyelik — Ali Kemal
**Gün sonu:** Girişte karttan provizyon alınıyor, harcama arttıkça artırılıyor, çıkışta kapanıyor; kart bilgisi bizde değil sağlayıcıda (token) duruyor; itiraz edilen ödemenin dosyası tek tıkla hazır; hediye çeki online satılıyor, oda, spa ve restoranda harcanıyor; dışarıdan spa / spor üyeliği satılıyor ve aidat otomatik yenileniyor.
**Önkoşul:** 50, 15, 17, 39, 53, 57, 59 · **Aktör:** billing-worker (provizyon kuralları)
- [ ] Provizyon: `PaymentAuthorization` (kart token'ı, tutar, durum: alındı / artırıldı / kapandı / serbest), girişte tutar kuralı (gece × fiyat + günlük harcama limiti), limite yaklaşınca artırım ya da ön büroya uyarı; izin `payment.authorize`
- [ ] Token: kart numarası bizde hiç tutulmaz; rezervasyon garantisi token'la
- [ ] Ters ibraz: sağlayıcı bildirimi → dosya (rezervasyon, imzalı kayıt kartı 53/59, folyo, giriş-çıkış saatleri, mesajlar) PDF; son tarih takibi
- [ ] Hediye çeki: `GiftCard` (kod, bakiye, son kullanma, kapsam: oda / spa / restoran), online satış (50), harcama POS (39) / folyo (15) / spa (57) ödeme türü; muhasebede alınan avans, harcanınca gelir (47)
- [ ] Üyelik: `Membership` (plan, dönem, aile üyeleri, giriş hakları), aidat tahsilatı token'la otomatik yenileme
- [ ] Bakiye düzeltmesi onay türü `GIFT_CARD_ADJUST` (dört göz)
- [ ] Ekran: Provizyonlar, itirazlar, hediye çekleri, üyelikler
- [ ] Olaylar: `payment.authorization.changed`, `gift_card.changed`, `membership.changed`
- [ ] Test: provizyon tutarı ve artırım kuralı, hediye çeki bakiyesi (eşzamanlı harcama kilidi)

---

## 14. OTONOM OPERASYON

### 85. Otomasyon stüdyosu — arkadaşın
**Gün sonu:** Otel yöneticisi kod yazmadan "şu olunca, şu koşulda, şunu yap" kuralı kuruyor (ör. "VIP girişinde müdüre bildirim + odaya meyve"); misafir yolculuğu mesajları (geliş öncesi, konaklama ortası, çıkış sonrası) aynı yerden yönetiliyor; her kural önce geçmiş olaylara karşı provada deneniyor, yayına onayla çıkıyor.
**Önkoşul:** 9, 11, 12, 22, 61 · **Aktör:** automation-worker
- [ ] Backend: `AutomationRule` (tetik, koşullar, eylemler, sürüm, durum), `AutomationRun` (olay, kural sürümü, sonuç, süre); tetik yalnız katalogdaki olaylar + zamanlı tetik (geliş −N gün, çıkış +N gün)
- [ ] Koşul dili: beyana dayalı JSON (alan, işleç, değer) — kod çalıştırmaz; alan listesi olayın zod şemasından üretilir
- [ ] Eylemler (beyaz liste): bildirim / mesaj (9 / 8, şablonla), görev (12 manuel görev, 14, 20), etiket (22), webhook (61), folyoya kalem (yalnız onaylı); eylem ilgili servisin kendisini çağırır, kural motoru veriye doğrudan yazmaz
- [ ] `automation-worker`: döngü koruması (kuralın ürettiği olay aynı kuralı tetiklemez, zincir derinliği ≤ 3), kural başına saatlik çalışma sınırı, kural hatası diğer kuralları durdurmaz
- [ ] Prova: son 30 günün olaylarına karşı "kaç kez çalışırdı" + örnek kayıtlar
- [ ] Yayın: yeni / değişen kural onay türü `AUTOMATION_RULE` (dört göz); sürüm geçmişi, geri al
- [ ] Yolculuk şablonları: geliş öncesi (online check-in 53, upsell 83, transfer 82), konaklama ortası nabız (81), çıkış sonrası anket (55) ve yorum daveti (memnunsa platforma, değilse 81'e); İYS izni olmayana pazarlama mesajı gitmez
- [ ] Ekran: Kural listesi, görsel düzenleyici (tetik → koşul → eylem), çalışma geçmişi, prova sonucu
- [ ] Olaylar: `automation.rule.changed`, `automation.run.failed`
- [ ] Test: koşul değerlendirici, döngü koruması

### 86. İşlem yapan yapay zekâ asistanı ve uzaktan MCP — Ali Kemal
**Gün sonu:** Personel uygulamanın içinde asistana Türkçe yazıyor; asistan otelin kendi prosedürlerinden kaynak göstererek cevap veriyor, doğru ekranı açıyor, raporu getiriyor ve kullanıcının yetkisiyle iş yapıyor (rooming list Excel'inden grup rezervasyonu taslağı, toplu oda bloğu); yan etkili her iş önce önizleme ve kullanıcı onayıyla, türü varsa onay kuyruğundan geçiyor. Yönetici aynı araçlara Claude veya ChatGPT'den bağlanabiliyor.
**Önkoşul:** 24, 61, 79, 11, 26, 29, 30 · **Aktör:** assistant-agent (79'un ajanı genişler)
- [ ] Araçlar iki sınıf: okuma (23/24'ün raporlama MCP araçları + kayıt arama) ve eylem (beyaz liste, servis çağırır); her araç bir izin ister; çağrı kullanıcının kimliği ve izinleriyle — ajan kullanıcıdan fazla yetki taşımaz
- [ ] Eylem protokolü: ajan önce plan + önizleme üretir (ne değişecek, kaç kayıt), kullanıcı onaylar, servis çalışır; türü olan işler (`BULK_PRICE_CHANGE`, `OVERBOOKING`…) onay kuyruğuna; denetim kaydında "asistan aracılığıyla" işaretli
- [ ] Bilgi bankası: otelin belgeleri (prosedür, SOP, sözleşme, menü) 79'un altyapısıyla; cevap kaynak gösterir; belge erişimi role göre; izin `knowledge.manage`
- [ ] Dosyadan iş: rooming list (Excel / PDF) → 30'un grup rezervasyonu taslağı; kontrat PDF'i → 29 fiyat tablosu taslağı; hep taslak, insan onaylar
- [ ] Gezinme: "yarın gelen grupları aç" → doğru sayfa + süzgeç
- [ ] Uzaktan MCP: 23'ün MCP sunucusu Streamable HTTP + OAuth 2.1; istemci kaydı 61'in uygulama yönetiminden; araç seti kullanıcının izinleriyle sınırlı; önce yalnız okuma, eylem araçları ayrı açılır
- [ ] Güvenlik: belge veya misafir mesajındaki talimat eylem tetikleyemez (eylem yalnız kullanıcının kendi isteğinden); kişisel veri maskesi; ajan bütçesi + LlmUsage
- [ ] Ekran: Asistan çekmecesi (her ekranda), sohbet geçmişi, bilgi bankası yönetimi, MCP bağlantıları
- [ ] Olaylar: `assistant.action.requested`, `assistant.action.completed`

### 87. Yapay zekâ gece müdürü ve sabah brifingi — arkadaşın
**Gün sonu:** Her gece gün kapanışından sonra sistem bütün oteli tarıyor: kontrat altı satılmış gece, sıfır fiyatlı gece, dengesiz folyo, açık bakiyeyle çıkış, kasa farkı, açık kalmış provizyon, iptal sıçraması, overbooking riski, kanal senkron hatası; bulduklarını önem sırasıyla, kanıtına bağlantıyla ve "ne yapmalı" önerisiyle genel müdüre sabah 07:00'de tek sayfa brifing olarak gönderiyor.
**Önkoşul:** 15, 17, 18, 23, 25, 27, 29, 33, 75, 80 (varsa), 84 (varsa) · **Aktör:** night-manager-agent
- [ ] Kontrol kütüphanesi (deterministik, her biri ayrı test): fiyat (kontrat / plan altı satış, sıfır fiyat, para birimi hatası), folyo (açık bakiyeyle çıkış, negatif bakiye, iptal ama ödemeli), kasa (vardiya farkı, iade yoğunluğu), envanter (overbooking riski, bloklu oda + rezervasyon, uzun süre arızalı oda), dağıtım (senkron hatası, stop-sale tutarsızlığı), gelir (forecast ve bütçe sapması)
- [ ] Backend: `OpsCheck` (anahtar, eşik, açık / kapalı), `OpsFinding` (kontrol, önem, kanıt bağlantısı, durum: yeni / incelendi / çözüldü / yanlış alarm), `OpsBriefing`
- [ ] **Özet tabloları** (genel yapı taşı): gün kapanışında güncellenen günlük göstergeler; 92, 93, 104 bunlardan okur, 75'in özeti de bunlara geçer
- [ ] `night-manager-agent`: gün kapanışı olayıyla (18) çalışır; kontroller deterministik, LLM yalnız önceliklendirme özeti ve öneri metni; LLM yoksa brifing şablon metinle yine çıkar
- [ ] Gün içi: kritik bulgu anında `staff.alert.raised` + sahip push'u (75)
- [ ] Geri bildirim: "yanlış alarm" işaretlenen kontrol için eşik önerisi; kontrol başına isabet oranı ekranda
- [ ] Brifing: bugün (gelen / giden / VIP), dün (gelir, bütçe, kasa), riskler, bulgular — ekran + PDF + e-posta + 75
- [ ] Ekran: Bulgular (kanıta tıklayınca kayıt), kontrol ayarları, brifing arşivi; canlı kanal `ops.changed`
- [ ] Olaylar: `ops.finding.raised`, `ops.briefing.ready`

### 88. İşgücü planlama — Ali Kemal
**Gün sonu:** Doluluk tahmininden yarın ve gelecek hafta her departmanda kaç kişi-saat gerektiği hesaplanıyor (kat hizmeti oda kredisinden, ön büro giriş-çıkış yükünden, F&B kuver tahmininden, banketten); vardiya çizelgesi bu ihtiyaca göre öneriliyor; kat görevlilerine günün odaları dengeli dağıtılıyor; plan ile gerçekleşen ve personel maliyeti / dolu oda raporlanıyor.
**Önkoşul:** 14, 25, 37, 39, 51, 52, 82 (varsa) · **Aktör:** sistem (uzun iş) + housekeeping-worker (dağıtım önerisi)
- [ ] Standartlar: `LaborStandard` (departman, iş birimi, süre — ör. çıkış odası 35 dk, konaklama odası 20 dk, giriş 4 dk, kuver 6 dk), sabit kadro; otel ayarı
- [ ] İhtiyaç: forecast (25) + gelen / giden + banket (37) + POS kuver tahmini (39) → departman × gün × vardiya saat ihtiyacı; `LaborDemand`
- [ ] Çizelge önerisi: 52'nin `Shift`'ine öneri — izinler, haftalık saat sınırı, art arda çalışma günü, yasal dinlenme; yönetici düzenler, yayınlar
- [ ] Kat dağıtımı: günün odaları kredi + kat + öncelik (VIP, erken giriş, uçuş saati 82) ile görevlilere dengeli; 14'ün atama ekranına öneri
- [ ] Gerçekleşen: puantaj (52) ve iş süreleri (14) → verimlilik (görevli başı oda, dk / oda)
- [ ] Rapor: personel maliyeti / dolu oda, departman bazında plan-gerçekleşen
- [ ] Ekran: İhtiyaç takvimi, çizelge önerisi, verimlilik
- [ ] Test: ihtiyaç hesabı, çizelge kısıtları (dinlenme, haftalık sınır)

### 89. Akıllı oda ve enerji — arkadaşın
**Gün sonu:** Oda yönetim sistemi (GRMS) bağlı: misafir odada değilken klima kısılıyor, çıkış yapılan oda tasarruf kipine geçiyor; "rahatsız etmeyin" ve "odamı temizleyin" kat hizmetine düşüyor; minibar sensörü tüketimi teyide düşürüyor; cihaz alarmı arıza kaydı açıyor; sayaçlardan enerji ve su tüketimi dolu oda başına raporlanıyor.
**Önkoşul:** 6, 14, 19, 20, 62 · **Aktör:** 62'nin cihaz aktörü + room-worker
- [ ] Adaptör: 62'nin cihaz çerçevesine GRMS (1 marka + TEST) — olaylar (varlık sensörü, DND / MUR, kapı, pencere, minibar kapağı, cihaz alarmı) ve komutlar (klima ayar noktası, karşılama sahnesi, tasarruf kipi)
- [ ] Olay tasarrufu: yalnız durum değişince yazılır (`room.sensor.changed`); ham akış saklanmaz
- [ ] Kurallar: giriş → karşılama sahnesi; boş oda + açık pencere → klima kapalı; çıkış → tasarruf kipi; DND → 14 görevi ertele; MUR → öncelik artır
- [ ] Minibar sensörü → 19'a "doğrulanmamış tüketim", kat görevlisi teyit eder (teyitsiz folyoya yazılmaz)
- [ ] Cihaz alarmı (klima arızası, su kaçağı) → 20'ye arıza kaydı
- [ ] Enerji: `MeterReading` (elektrik, su, doğalgaz; sayaç / alan / oda), otomatik ya da elle okuma; dolu oda başı tüketim, dış sıcaklığa göre düzeltilmiş karşılaştırma; 103'e veri
- [ ] Ekran: Sensörlü oda haritası, enerji panosu, kural ayarları
- [ ] Ölçek: 2500 oda × dakikalık sensör olayı — değişim bazlı yazım, oda başı son durum tablosu

---

## 15. GELİR VE KÂRLILIK

### 90. No-show tahmini ve grup değerlendirme — Ali Kemal
**Gün sonu:** Her rezervasyonun gelmeme ve iptal olasılığı hesaplanıyor ve nedeni gösteriliyor; oda tipi bazında güvenli overbooking miktarı öneriliyor; gelen grup talebinin bireysel satışı ne kadar ittiği hesaplanıp "al / alma / en az şu fiyatla al" önerisi veriliyor.
**Önkoşul:** 4, 25, 30, 33, 34, 36 · **Aktör:** sistem (model eğitimi uzun işte) + pricing-agent
- [ ] **Model çerçevesi** (genel yapı taşı): `DemandModel` (otel, tür, sürüm, özellikler, katsayılar, backtest metrikleri, durum); haftalık eğitim uzun işte; yeni sürüm backtest'te eskisinden kötüyse yayına çıkmaz
- [ ] No-show / iptal modeli: açıklanabilir (lojistik regresyon) — kanal, acente, rezervasyon önceliği, konaklama süresi, garanti, ülke, sezon, misafirin geçmişi; `ReservationRisk` (olasılıklar, ana sebepler)
- [ ] Overbooking önerisi: oda tipi × gün beklenen boşalma − risk payı (walk maliyeti ayarı); 34'ün ekranına öneri — otomatik değil, `OVERBOOKING` onayı aynen
- [ ] Walk planı: anlaşmalı oteller ve maliyet
- [ ] Grup değerlendirme: talep (tarih, oda, fiyat, F&B, banket) → forecast'e göre yerinden edilen bireysel gelir, grubun toplam katkısı, öneri ve en düşük kabul fiyatı; 30 ve 36'nın teklif ekranına
- [ ] Ekran: Riskli rezervasyonlar (ön büro: depozito iste / teyit ara), overbooking önerileri, grup değerlendirme, model başarımı
- [ ] Olaylar: `risk.scores.refreshed`
- [ ] Test: overbooking önerisi hesabı, displacement hesabı

### 91. Rakip fiyat izleme — arkadaşın
**Gün sonu:** Seçilen rakip otellerin (10'a kadar) gelecek 365 günlük fiyatı ve müsaitliği her gün geliyor; tabloda pazarın en düşük / en yüksek / ortalaması ve bizim farkımız görünüyor; 34'ün fiyat önerisi bu veriyi de kullanıyor; rakip fiyatında sert değişiklik olunca uyarı geliyor.
**Önkoşul:** 25, 33, 34, 60 · **Aktör:** rate-shop-worker + pricing-agent
- [ ] Adaptör: lisanslı rakip fiyat veri sağlayıcısı (TEST + 1); OTA sayfası kazımak yok (kullanım koşulları)
- [ ] Backend: `CompSet` (rakipler, ağırlık), `RateShopSnapshot` (rakip, giriş tarihi, oda / pansiyon, fiyat, para birimi, müsait mi, çekiliş zamanı)
- [ ] Normalizasyon: oda tipi ve pansiyon eşlemesi (standart oda + kahvaltı kıyası), vergi dahil / hariç, para birimi (60)
- [ ] Analiz: gün bazında en düşük / en yüksek / ortalama / medyan, bizim sıramız, rakip müsaitliği (pazar doluyor sinyali), sert değişim uyarısı
- [ ] 34'e girdi: pricing-agent gerekçesine rakip verisi eklenir; öneri yine onaylı
- [ ] Ekran: Fiyat tablosu (gün × otel), grafik, uyarılar, Excel çıktısı
- [ ] Ölçek: 10 rakip × 365 gün × 3 oda tipi ≈ 11k satır / gün / otel — tarih bölümlemeli tablo, 400 günden eskisi özetlenir
- [ ] Olaylar: `rate_shop.snapshot.received`, `rate_shop.change.detected`

### 92. Kontrat ve pansiyon kârlılığı — Ali Kemal
**Gün sonu:** Her acente / kontrat, oda tipi ve pansiyon için gece başı net katkı görülüyor: oda geliri − komisyon ve bonus − pansiyonun gerçek F&B maliyeti − değişken maliyetler (kat hizmeti, enerji, amenity, kart komisyonu); "hangi kontrat bize zarar ettiriyor" tek ekranda; yeni kontrat pazarlığında simülasyon yapılabiliyor.
**Önkoşul:** 28, 29, 35, 39, 44, 87, 88, 89, 90 · **Aktör:** accounting-worker (gece özeti)
- [ ] Maliyet sürücüleri: `CostDriver` — pansiyon başına kişi-gün F&B maliyeti (44 tüketimi + 39 açık büfe / her şey dahil sayımı), kat hizmeti dk × saat ücreti (88), enerji / oda-gece (89), amenity, kart komisyonu, acente komisyonu ve bonusu (35)
- [ ] Her şey dahil maliyeti: outlet tüketimi kişi-gün başına (yetişkin / çocuk eşdeğeri), pansiyon tiplerine dağıtım
- [ ] Kârlılık özeti: `ProfitabilityFact` (kontrat × oda tipi × pansiyon × gün) — gün kapanışında; ekran ham folyo kalemine inmez
- [ ] Simülasyon: yeni fiyat / komisyon / allotment ile beklenen katkı (90'ın displacement'ıyla)
- [ ] Ekran: Kontrat kârlılık tablosu, pansiyon maliyet trendi, simülatör
- [ ] Olaylar: `profitability.refreshed`
- [ ] Test: maliyet dağıtımı, gece başı katkı hesabı

### 93. USALI kâr-zarar ve sahip raporu — arkadaşın
**Gün sonu:** Genel muhasebe (48) hesapları USALI departmanlarına eşlenmiş; oda, F&B, diğer gelir merkezleri ve dağıtılmamış giderler için departman kâr-zararı, GOP ve GOPPAR aylık ve yıl içi, bütçe ve geçen yılla karşılaştırmalı çıkıyor; sahip / yatırımcı paketi tek tıkla PDF ve Excel.
**Önkoşul:** 23, 27, 44, 46, 48, 51 · **Aktör:** accounting-worker + budget-agent (yorum)
- [ ] Eşleme: `UsaliMapping` (hesap → USALI satırı / departman), USALI'nin güncel baskısına göre şablon; eşlenmemiş hesap uyarısı; kural: mizan toplamı = USALI toplamı (fark 0 değilse rapor "eksik eşleme" işaretli)
- [ ] Dağıtım anahtarları: ortak giderlerin departmanlara dağıtımı (m², personel, gelir payı)
- [ ] İstatistikler: dolu oda, satılabilir oda (23 ile aynı tanım), kuver, personel sayısı (51)
- [ ] Raporlar: departman P&L, özet P&L, GOP / GOPPAR, flow-through, bütçe (27) ve geçen yıl sapması, yıl içi toplam
- [ ] Sahip paketi: aylık PDF (yönetim yorumu + budget-agent yorumu) ve Excel; 75'te özet
- [ ] Ay kapanışı kontrol listesi: tahakkuk, amortisman (46), stok sayımı (44) yapılmadan rapor "ön" işaretli
- [ ] Ekran: Eşleme, P&L, sahip paketi
- [ ] Test: eşleme bütünlüğü (toplam = toplam), dağıtım anahtarı hesabı

---

## 16. UYUM VE FİNANS OTOMASYONU

### 94. Uyum merkezi — Ali Kemal
**Gün sonu:** Otelin bütün yasal yükümlülükleri tek takvimde: KBS bildirimleri, e-belgeler, konaklama vergisi ve turizm payı beyanı, KDV için veri, KVKK (VERBİS, saklama ve imha, veri sahibi başvuruları), İYS izinleri, Bakanlık istatistikleri, belge ve ruhsat süreleri; yaklaşan son tarih uyarıyor, beyan verisi sistemden hazır geliyor.
**Önkoşul:** 9, 47, 48, 49, 58, 71, 85 · **Aktör:** compliance-worker
- [ ] Backend: `ComplianceObligation` (tür, dönem, son tarih kuralı, sorumlu), `ComplianceFiling` (dönem, hazırlanan veri, durum, kanıt dosyası)
- [ ] Konaklama vergisi ve turizm payı: dönem matrahı 49'un fatura vergi satırlarından; beyan taslağı + kesilen faturalarla mutabakat
- [ ] KBS: 58'in kaydından hatalı / bekleyen bildirimler; günlük mutabakat (konaklayan sayısı = bildirilen)
- [ ] KVKK: 71'in veri envanteri, imha işi ve tutanakları, veri sahibi başvurusu (30 gün süre takibi), VERBİS kaydı bilgisi
- [ ] İYS: ticari ileti izinlerinin İYS ile eşitlenmesi; izinsiz alıcıya pazarlama mesajı engeli (9, 85)
- [ ] Belge / ruhsat takibi: turizm işletme belgesi, yangın, gıda, asansör, havuz analizleri… süre + dosya + hatırlatma
- [ ] Bakanlık istatistikleri: aylık konaklama istatistiği (ülke × gece) hazır çıktı; elektronik gönderim varsa adaptör
- [ ] Ekran: Uyum takvimi, yükümlülük ayrıntısı, KVKK paneli
- [ ] Olaylar: `compliance.deadline.due`, `compliance.filing.changed`
- [ ] Test: vergi matrahı hesabı ve fatura mutabakatı, son tarih kuralları

> **Modül 51'den not (3 Kasım 2026 — Ahmet):** MUHSGK verisi `PayrollEntry` / `PayrollLine`'da hazır: kişi bazında prim günü, eksik gün
> nedeni (puantaj), prime esas kazanç, SGK paylarının dökümü, GV matrahı, hesaplanan / istisna / ödenecek GV ve DV, teşvik indirimi.
> Beyan taslağı onaylı aylık + fark bordrolarının toplamı olmalı.

### 95. Gelen e-belge ve üçlü eşleştirme — arkadaşın
**Gün sonu:** Tedarikçiden gelen e-Fatura ve e-İrsaliye entegratörden otomatik çekiliyor; sipariş (45), mal kabul ve fatura satır satır eşleşiyor; fiyat / miktar farkı varsa fatura bloke ve satın almanın önünde; eşleşen fatura ön muhasebeye (47) borç olarak düşüyor; ticari faturaya 8 gün içinde kabul / red veriliyor.
**Önkoşul:** 45, 47, 48, 49 · **Aktör:** 49'un gönderici deseninde gelen kutusu işi + inventory-worker
- [ ] 49'un sağlayıcı arayüzüne gelen kutusu: `listInbound`, `fetchInbound`, `respond` (kabul / red, ticari senaryo); TEST adaptörü
- [ ] Backend: `InboundDocument` (tür, gönderen VKN, numara, UUID, tutarlar, XML, PDF), `InboundLine`, `MatchResult`
- [ ] Eşleştirme: tedarikçi (VKN → 45'in Supplier'ı), sipariş referansı, satır (stok kartı eşlemesi; öğrenen eşleme tablosu), tolerans (fiyat %, miktar); e-İrsaliye → 45'in mal kabul taslağı
- [ ] Farklar: fiyat farkı / eksik teslim / siparişsiz fatura → satın alma kararına; kabulde 47'ye kayıt, maliyet 44'e
- [ ] Ticari fatura yanıtı: 8 gün sınırı takibi, red gerekçesi
- [ ] Muhasebe: tedarikçi borcu + KDV (47), fiş (48)
- [ ] Ekran: Gelen kutusu, eşleştirme (sipariş – irsaliye – fatura yan yana), farklar
- [ ] Olaylar: `edoc.inbound.received`, `edoc.inbound.matched`
- [ ] Test: eşleştirme toleransları, satır eşlemesi

### 96. Dış muhasebe aktarımı — Ali Kemal
**Gün sonu:** Muhasebesini Logo, Mikro, Netsis veya Luca'da tutmaya devam eden otel; satış, tahsilat, fatura, cari ve kasa hareketlerini hesap eşlemesiyle o programın içe aktarma biçiminde alıyor; aynı kayıt iki kez aktarılmıyor; parti toplamları bizim toplamlarla mutabık.
**Önkoşul:** 47, 48, 49 · **Aktör:** accounting-worker + sistem (uzun iş)
- [ ] Adaptörler: Logo, Mikro, Netsis, Luca (dosya biçimi ya da API) + TEST
- [ ] Eşleme: bizim hesap / kanal / vergi / departman → hedef hesap kodu; cari eşleme (VKN)
- [ ] Aktarım partisi: `ExportBatch` (dönem, kapsam, kayıt listesi, durum, dosya); aktarılan kayıt işaretlenir, bir daha gitmez; düzeltme ters kayıtla
- [ ] Mutabakat: parti toplamı = kaynak toplamı (para birimi bazında); fark varsa parti kapalı
- [ ] Zamanlama: gün kapanışından sonra otomatik parti ya da elle
- [ ] Ekran: Eşleme, partiler (indir / yeniden üret), hata raporu
- [ ] Olaylar: `accounting.export.completed`
- [ ] Test: bir kaydın bir kez aktarılması, parti mutabakatı

### 97. Banka mutabakatı — arkadaşın
**Gün sonu:** Bütün banka hesaplarının hareketleri (ekstre dosyası ya da banka toplayıcısı) içeri geliyor; vergi no, IBAN, açıklama ve tutar kurallarıyla carilere ve hesaplara otomatik eşleşiyor; eşleşmeyenler kuyruğa düşüyor; POS yatışlarında komisyon ve bloke ayrışıyor; banka bakiyesi ile defter bakiyesi her gün mutabık.
**Önkoşul:** 17, 47, 50 · **Aktör:** bank-sync-worker + accounting-worker
- [ ] İçe alma: Excel / CSV / MT940 ekstre + toplayıcı adaptörü (TEST + 1)
- [ ] Backend: `BankStatement`, `BankStatementLine` (tekrar yüklemede aynı satır tanınır: tarih + tutar + referans parmak izi), `BankMatchRule` (VKN / IBAN / anahtar kelime / tutar aralığı → cari / hesap), `BankMatch`
- [ ] Eşleştirme: tam (tutar + referans), kurallı, yapay zekâ önerisi (açıklamadan cari tahmini; personel onaylar); kısmi ve çoklu (bir havale → birden çok fatura)
- [ ] POS: sanal / fiziksel POS gün sonu ↔ banka yatışı, komisyon ve bloke günü ayrımı
- [ ] Muhasebe: onaylanan eşleşme 47'de tahsilat / ödeme hareketi; eşik üstü `ACCOUNTING_PAYMENT` aynen
- [ ] Mutabakat: banka bakiyesi vs defter, açıklanamayan fark listesi
- [ ] Ekran: Ekstreler, eşleştirme kuyruğu, kurallar, mutabakat
- [ ] Olaylar: `bank.statement.imported`, `bank.match.confirmed`
- [ ] Test: parmak izi tekrarı, kısmi / çoklu eşleştirme tutarları, POS komisyon ayrımı

---

## 17. RESORT VE DAĞITIM

### 98. Tur operatörü bağlantısı — Ali Kemal
**Gün sonu:** Tur operatörlerinden rezervasyonlar API'yle, diğerlerinden e-postayla gelen voucher'lar yapay zekâyla okunarak operatör rezervasyonu ekranına düşüyor; kontrat fiyatı, stop-sale ve kontenjan kontrolünden geçen otomatik kesinleşiyor, geçmeyen nedeniyle bekliyor; aynı voucher iki kez açılmıyor; değişiklik ve iptal de aynı yoldan geliyor.
**Önkoşul:** 4, 29, 30, 33 · **Aktör:** tour-operator-sync-worker + voucher-reader-agent
- [ ] Adaptörler: 1–2 operatör API'si + TEST; e-posta kanalı (shared/channels `email-gateway` gelen kutusu)
- [ ] `voucher-reader-agent`: e-posta gövdesi ve eki (PDF / Excel) → zod şemalı voucher (isimler, tarihler, oda, pansiyon, fiyat, voucher no); düşük güvenli alanlar işaretli; bütçe + LlmUsage; ajan kapalıysa elle giriş formu
- [ ] Backend: `OperatorBooking` (kaynak, voucher no, sürüm, ham veri, durum: YENİ / KONTROL / BEKLİYOR / AKTARILDI / REDDEDİLDİ), `OperatorBookingRevision`
- [ ] Kontroller: kontrat fiyatıyla (29) fark (tolerans), stop-sale, allotment (30), mükerrer (operatör + voucher no; isim + tarih benzerliği), çocuk yaşı kuralları
- [ ] Aktarım: geçen → `reservations/service.js` (33'teki kanal rezervasyonu gibi); fiyat farkı kabulü onay türü `OPERATOR_PRICE` (dört göz); değişiklik / iptal revizyon olarak
- [ ] `tour-operator-sync-worker`: `channel-sync-worker` deseni — tarama, tekrar deneme, eşitleme kaydı
- [ ] Ekran: Operatör rezervasyonları (durum sekmeleri, fark ayrıntısı), operatör bağlantıları, e-posta okuma geçmişi; canlı kanal `operator-bookings.changed`
- [ ] Olaylar: `operator.booking.received`, `operator.booking.changed`
- [ ] Test: fiyat toleransı, mükerrer tespiti

### 99. Tesis ve aktivite rezervasyonu — arkadaşın
**Gün sonu:** Misafir à la carte restoran, şezlong / kabana, mini kulüp ve aktivitelerini portaldan, uygulamadan ya da resepsiyondan ayırtıyor; her şey dahil konaklama hakları (kaç à la carte hakkı) otomatik uygulanıyor; masa ve kabana planının doluluğu canlı; gelmeyen misafirin rezervasyonu düşüyor ve ücreti kurala göre folyoya yansıyor.
**Önkoşul:** 15, 28, 39, 53, 57, 80 (varsa) · **Aktör:** guest-experience-worker (no-show, hak kuralı)
- [ ] Backend: `Facility` (tür: restoran / kabana / şezlong alanı / mini kulüp / aktivite; kapasite, saat dilimleri), `FacilitySlot`, `FacilityBooking` (konaklama ya da dış misafir, kişi, durum, no-show), `StayEntitlement` (pansiyon hakları)
- [ ] Kapasite ve çakışma: slot kilidi (envanter kilidi deseni); aynı misafir aynı saatte iki yerde olamaz
- [ ] Haklar: 28'in pansiyon tanımına hak kuralı (konaklama başı N à la carte); aşan kullanım ücretli (folyo 15)
- [ ] Mini kulüp: çocuk giriş-çıkışı, alerji (80), teslim alan kişinin doğrulanması
- [ ] "Şu anda ne var": günün aktiviteleri ve yer durumu — 53 portalında, concierge ajanının aracında
- [ ] Ekran: Tesis takvimi / planı, rezervasyon listesi, hostes ekranı (bugünün masaları); canlı kanal `facilities.changed`
- [ ] Olaylar: `facility.booking.changed`
- [ ] Test: kapasite / çakışma kuralı, hak sayımı

### 100. Acente B2B portalı — Ali Kemal
**Gün sonu:** Acente kendi kullanıcısıyla portala giriyor; kontrat fiyatlarıyla müsaitlik görüp rezervasyon yapıyor; rezervasyonlarını, faturalarını, cari ekstresini ve bonus / hedef durumunu (35) görüyor; otel aynı portalda acentelere kampanya duyuruyor.
**Önkoşul:** 29, 30, 35, 47, 49, 50, 61, 71 · **Aktör:** reservation-worker (mevcut zincir)
- [ ] Ayrı kimlik alanı: `PartnerAccount` (acente), `PartnerUser` (2FA zorunlu); personel JWT'sinden ayrı imza ve kapsam; yalnız kendi acentesinin verisi
- [ ] Rezervasyon: kontrat fiyatı (29) + allotment (30) ile müsaitlik; rezervasyon `reservations/service.js` üzerinden (kaynak acente portalı); değişiklik / iptal kontrat koşullarıyla
- [ ] Finans: cari ekstre (47), fatura PDF'leri (49), ödeme linki (50)
- [ ] Bonus: hedef ilerlemesi, kademe, hak edişler (35)
- [ ] Duyuru / kampanya: otel → seçili acentelere
- [ ] Portal: ayrı küçük React uygulaması; otel tarafında acente kullanıcı yönetimi (`partners.manage`)
- [ ] Olaylar: `partner.user.changed`

### 101. Sesli yapay zekâ santral — arkadaşın
**Gün sonu:** Otelin telefonunu yapay zekâ 7/24 açıyor; arayanın dilinde konuşuyor; canlı müsaitlik ve fiyat verip rezervasyon talebi alıyor, ödeme linkini SMS / WhatsApp ile gönderiyor; bilmediği konuda tahmin etmiyor, çağrıyı nöbetçi personele aktarıyor; her çağrının özeti ve (izinle) kaydı misafir kartına ve çağrı kaydına düşüyor.
**Önkoşul:** 8, 36, 50, 62, 79, 80, 86 · **Aktör:** voice-gateway + concierge-agent
- [ ] `voice-gateway` (shared/channels): telefon (SIP) sağlayıcı adaptörü (TEST + 1), gerçek zamanlı ses akışı; konuşma modeline `VOICE` kanalı
- [ ] Konuşma: konuşma tanıma → concierge-agent'ın araçları (`check_availability`, `request_reservation`, `get_hotel_info`) → ses; hedef gecikme < 1 sn (gerçek zamanlı ses modeli kararı)
- [ ] Bilgi sınırı: yalnız otelin onaylı bilgisi (8'in otel bilgisi + 86'nın bilgi bankası); bilinmeyen → aktarma
- [ ] Devir: nöbetçi listesine canlı aktarma (62 santral); aktarılamazsa geri arama görevi (36'nın `CallLog`'u)
- [ ] Ödeme linki görüşme sırasında (50)
- [ ] KVKK: çağrı başında aydınlatma, kayıt saklama süresi, kayıt kapatma seçeneği; özet + metin `CallLog`'a
- [ ] Bütçe: dakika + token maliyeti LlmUsage'a; günlük üst sınır aşılınca çağrı doğrudan personele
- [ ] Ekran: Çağrı geçmişi (özet, dinle, metin), santral ayarları (saatler, diller, devir listesi)
- [ ] Olaylar: `voice.call.started`, `voice.call.ended`, `voice.call.transferred`

---

## 18. KALİTE, ÇEVRE, AĞ

### 102. Kalite ve standart denetimi — Ali Kemal
**Gün sonu:** Otel lüks hizmet standartlarını, HACCP ve iş güvenliği kontrol listelerini sisteme tanımlıyor; denetçi telefondan fotoğraflı denetim yapıyor; uymayan madde DÖF (düzeltici-önleyici faaliyet) olarak sorumluya ve süreye bağlanıyor; prosedürler sürümlü, onaylı yayınlanıyor ve okundu onayı toplanıyor.
**Önkoşul:** 20, 52, 54, 55, 76, 81, 86, 89 (varsa) · **Aktör:** insight-agent (skor) + notification-worker (süre hatırlatma)
- [ ] Standartlar: `QualityStandard` (kütüphane: lüks hizmet, HACCP, İSG, havuz, yangın), `Checklist`, `ChecklistItem` (ağırlık, kritik mi)
- [ ] Denetim: `QualityAudit` (iç / gizli müşteri / yasal), mobilde yürütme (76: fotoğraf, not, puan), çevrimdışı
- [ ] DÖF: `CorrectiveAction` (kaynak: denetim / 81 olayı / 54 yorum / 20 tekrarlayan arıza), kök neden, sorumlu, son tarih, etkinlik kontrolü
- [ ] Doküman yönetimi: `ControlledDocument` (SOP, prosedür, form), sürüm, onay akışı (hazırlayan → kontrol → onay), personel okundu onayı, yapay zekâyla taslak (86'nın bilgi bankasına girer)
- [ ] HACCP kayıtları: sıcaklık ölçümleri (elle ya da 89 sensörü), sapma → DÖF
- [ ] Skor kartları: departman kalite skoru (denetim + 54 / 55 duygu + 81 olay)
- [ ] Ekran: Denetim takvimi, denetim yürütme (mobil), DÖF panosu, doküman merkezi
- [ ] Olaylar: `quality.audit.completed`, `quality.action.changed`

### 103. Sürdürülebilirlik — arkadaşın
**Gün sonu:** Enerji, su, atık ve kimyasal tüketimi aylık izleniyor; karbon ayak izi konaklama-gece başına hesaplanıyor; Bakanlığın sürdürülebilir turizm belgelendirmesi ve GSTC kriterleri için kanıt dosyası hazırlanıyor; misafir isterse konaklamasının karbonunu dengeleme bedelini ödüyor ve QR'lı sertifikasını alıyor.
**Önkoşul:** 44, 45, 50, 89, 102 (aynı aşamada; bitmeden başlamaz) · **Aktör:** manuel + dengeleme adaptörü
- [ ] Veri: 89'un sayaçları, atık kayıtları (tür, kg), kimyasal (44 stok çıkışı), satın alma (45: yerel tedarikçi oranı)
- [ ] Karbon: emisyon faktörleri tablosu (yıllık, kaynaklı), kapsam 1 / 2 / 3 ayrımı, konaklama-gece başı
- [ ] Belgelendirme: kriter listesi (GSTC + Bakanlık programı) ↔ kanıt (102 dokümanı, ölçüm, fotoğraf); eksik kriter raporu
- [ ] Hedef ve trend: yıllık hedef, aylık ilerleme, 75'te özet
- [ ] Misafir dengelemesi: konaklama karbonu, dengeleme sağlayıcı adaptörü (TEST + 1), bedel folyoya ya da online (50), QR'lı sertifika (77'nin doğrulama sayfası)
- [ ] Ekran: Sürdürülebilirlik panosu, kriter / kanıt, rapor PDF
- [ ] Olaylar: `sustainability.reading.recorded`
- [ ] Test: karbon hesabı (faktör × tüketim, kapsam ayrımı)

### 104. Anonim pazar karşılaştırması — Ali Kemal
**Gün sonu:** Katılmayı seçen otel kendini bölgesindeki benzer otellerle karşılaştırıyor: doluluk, ortalama fiyat, RevPAR, kanal dağılımı, iptal oranı — indeks ve sıra olarak; veri yalnız geçmiş ve toplulaştırılmış (gelecek fiyat ve doluluk paylaşılmıyor); hiçbir otel tek başına tanınamıyor.
**Önkoşul:** 23, 25, 63, 72, 87, 94 · **Aktör:** sistem (uzun iş)
- [ ] Katılım: otel ayarı + sözleşme onayı; karşılıklılık (katılmayan karşılaştırma göremez)
- [ ] Küme: bölge + segment + oda sayısı aralığı; en az 5 otel ve hiçbir otel kümenin %40'ından fazla ağırlıkta değil; şart sağlanmazsa küme gösterilmez
- [ ] Veri: `BenchmarkFact` (otel, gün, gösterge) yalnız kapanmış günler, en az 1 gün gecikmeli, 87'nin özet tablolarından; gelecek fiyat ve eldeki doluluk (OTB) yok
- [ ] Hesap: doluluk, fiyat ve RevPAR indeksleri (MPI, ARI, RGI), sıra (kademeli), trend
- [ ] Hukuk: rekabet hukuku görüşü alınmadan açılmaz (karar noktası); açılış bayrakla (72)
- [ ] Ekran: Karşılaştırma panosu, aylık rapor, 75'te özet
- [ ] Olaylar: `benchmark.refreshed`
- [ ] Test: küme şartları (en az 5, %40 kuralı), indeks hesabı
