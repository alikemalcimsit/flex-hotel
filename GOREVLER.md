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
- [ ] Backend: gerçek login (e-posta + şifre → JWT + refresh), logout, refresh, `/me`
- [ ] Backend: User CRUD API'leri (ekle, düzenle, pasife al, şifre sıfırla)
- [ ] Backend: izin listesi tanımı (örn. `reservation.create`, `folio.view`, `invoice.cancel`) ve rol → izin eşlemesi
- [ ] Backend: `requirePermission('...')` hook'u; her route'a eklenir
- [ ] Ekran: Login sayfasını gerçek API'ye bağla (çatıdaki sahte girişi değiştir)
- [ ] Ekran: Kullanıcı listesi + form (ad, e-posta, rol, aktif)
- [ ] Ekran: Rol → izin matrisi (satır rol, sütun izin, checkbox)
- [ ] Frontend: sidebar menüleri ve butonlar izne göre gizlenir

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
- [ ] Backend: `createReservation` servisi (müsaitlik kontrolü, fiyat hesabı: taban fiyat × sezon çarpanı × gece, onay kodu üretimi)
- [ ] Backend: `updateReservation`, `cancelReservation`, `markNoShow` servisleri
- [ ] Backend: overbooking kuralı (kapasite aşımında reddet veya onaya gönder)
- [ ] Backend: Guest oluştur/eşleştir (telefon/e-posta ile mevcut misafiri bul)
- [ ] Backend: listeleme API'si (filtre: tarih aralığı, durum, kaynak, misafir adı)
- [ ] Ekran: Rezervasyon listesi (tablo, filtre, durum rozeti)
- [ ] Ekran: Yeni rezervasyon formu (misafir ara/yeni, tarih, kişi, oda tipi, pansiyon, fiyat önizleme, not)
- [ ] Ekran: Rezervasyon detayı (bilgiler, durum geçmişi, iptal butonu, folyo linki)
- [ ] Ekran: Grup rezervasyon (tek formda birden fazla oda satırı)
- [ ] Ekran: Bekleyen liste (yer yoksa "listeye al", yer açılınca uyarı)
- [ ] Aktör: reservation-worker paketi (`reservation.requested` → servis → `reservation.created` / `reservation.rejected`)

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

### 5. Oda planı / takvim — arkadaşın
**Gün sonu:** Resepsiyon, tüm odaları ve rezervasyonları tek takvimde görüyor; tıklayınca detay açılıyor.
- [x] Backend: takvim verisi API'si (tarih aralığı → odalar + o aralıktaki rezervasyonlar)
- [x] Ekran: Takvim ızgarası (satır oda, sütun gece; rezervasyon renkli bar; arıza kayıtları tarih aralığında; satır başında doluluk + kat hizmeti)
- [x] Ekran: 7 / 14 / 30 günlük pencere, bugüne git, tarih seçici, kat–tip–durum filtreleri
- [x] Ekran: Bara tıkla → rezervasyon detay çekmecesi (misafir, konaklama, folyo bakiyesi, işlemler)
- [x] Ekran: Oda bekleyen rezervasyonlar şeridi (ızgarada görünmeyen talep) + otomatik ata
- [x] Frontend: socket ile canlı güncelleme; bağlantı kopunca "canlı değil" rozeti ve periyodik tazeleme
- [x] Sürükle-bırak ile **oda** değiştirme (içerideki misafir dahil, onaylı)
- [ ] Ekran: Boş hücreye tıkla → o oda ve tarihle yeni rezervasyon formu — **modül 4 bekleniyor**
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
> event bus'ı socket.io'ya köprülüyor; `hotel:<hotelId>` odasına `inventory.changed`
> kanalından **yalnızca "şu değişti" haberi** düşüyor (veri değil — socket'te henüz
> kimlik doğrulama yok). Panel tarafında `lib/useLiveChannel.js` (oda planı için
> `useLiveInventory` sarmalayıcısı) bu haberi alıp
> ilgili react-query anahtarlarını tazeliyor; olaylar 400 ms geciktirilerek
> toplanıyor (tek işlem birden çok event yayınlar). Activity Feed aynı köprüye
> ikinci bir kanal ekleyerek bağlanabilir.

### 6. Check-in / Check-out — Ali Kemal
**Gün sonu:** Misafir gelince tek tıkla giriş, giderken tek tıkla çıkış yapılıyor; oda durumu ve folyo otomatik değişiyor.
- [ ] Backend: `checkIn(reservationId)` servisi (oda atanmış mı, kimlik bilgisi var mı kontrolü → CHECKED_IN → `guest.checked_in`)
- [ ] Backend: `checkOut(reservationId)` servisi (folyo bakiyesi 0 mı kontrolü → CHECKED_OUT → `guest.checked_out`)
- [ ] Backend: erken giriş / geç çıkış ücreti parametresi
- [ ] Ekran: Bugün gelecekler listesi (rezervasyon, oda, durum) + "Check-in" butonu → kısa form (kimlik no, uyruk, plaka, kart/depozito)
- [ ] Ekran: Bugün gidecekler listesi + "Check-out" butonu → bakiye gösterimi, bakiye varsa ödeme ekranına yönlendir
- [ ] Ekran: Konaklayanlar listesi (şu an içeride kim var)
- [x] Aktör: room-worker'a `guest.checked_in` → dolu, `guest.checked_out` → boş + kirli kuralları — **modül 3'te yapıldı**

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

### 7. Misafir mesajları / istek takibi — arkadaşın
**Gün sonu:** Personel, misafirlerle yapılan tüm chat/WhatsApp konuşmalarını görüyor, gerekirse elle cevaplıyor; misafir istekleri görev olarak takip ediliyor.
- [x] Backend: Conversation / Message API'leri (liste, detay, mesaj gönder, okundu işaretle)
- [x] Backend: GuestRequest (istek) tablosu + API (tip: havlu, oda servisi, uyandırma; durum)
- [x] Ekran: Konuşma listesi (kanal ikonu, misafir, son mesaj, okunmamış sayısı)
- [x] Ekran: Konuşma detayı (balonlar; AI cevapları etiketli; elle cevap kutusu)
- [x] Ekran: "Manuele al" butonu (concierge bu konuşmaya karışmaz)
- [x] Ekran: İstekler listesi (oda, istek, durum, atanan) + tamamla
- [x] Frontend: yeni mesaj gelince socket ile anlık güncelleme + ses/rozet
- [ ] Gerçek kanal trafiği (WhatsApp / web chat) — **modül 8 bekleniyor**; ekran ve sözleşme hazır

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
- [ ] Web chat widget'ı (siteye gömülen balon; socket ile mesaj gönder/al)
- [ ] webchat-gateway paketi (widget mesajı → `guest.message.received`; `guest.message.reply` → widget'a)
- [ ] whatsapp-gateway paketi (Meta Cloud API webhook doğrulama, gelen mesaj → event, giden mesaj → API)
- [ ] router-agent paketi (küçük model; intent: rezervasyon / soru / şikâyet / diğer → `guest.intent.detected`)
- [ ] concierge-agent paketi (LangGraph grafiği; tool'lar: `check_availability`, `request_reservation`, `get_hotel_info`; konuşma geçmişi + rolling summary; misafir "evet" demeden rezervasyon talebi basmaz)
- [ ] Prompt caching + günlük token bütçesi + LlmUsage kaydı
- [ ] Bütçe aşımı veya agent kapalıysa konuşma manuel göreve düşer (7'deki ekrana)
- [ ] Uçtan uca demo: chat → rezervasyon → oda → onay mesajı, Activity Feed'de izlenir

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
- [ ] Backend: Notification, NotificationTemplate, ChannelConfig tabloları + API
- [ ] Backend: kanal adaptörleri (SMTP e-posta, SMS sağlayıcı, WhatsApp gönderim, uygulama içi)
- [ ] Ekran: Şablon listesi + editör (değişkenler: {misafirAdi}, {odaNo}, {tarih})
- [ ] Ekran: Kanal ayarları (SMTP bilgileri, SMS API key, WhatsApp token)
- [ ] Ekran: Gönderim geçmişi (kanal, alıcı, durum, hata, tekrar gönder)
- [ ] Frontend: üst barda zil ikonu, personel bildirimleri listesi
- [ ] Aktör: notification-worker paketi (`notification.send.requested` → gönder → `notification.sent/failed`; `reservation.created` → onay şablonu; `room.assigned` → oda bilgisi şablonu)

> **Modül 7'den not (17 Eylül 2026 — Ahmet):** personel bildirimi için hazır
> event'ler: `guest.request.created` (`requestId, category, priority, roomId`),
> `guest.request.updated`, `guest.message.received`. Yeni mesaj sesi ve tercihi
> şimdilik `frontend/src/lib/inboxSound.js`'te; zil / bildirim tercihleri gelince oraya
> taşınabilir. Misafire giden WhatsApp mesajının **teslimi** modül 8'in geçidinde
> (bkz. modül 8 notu) — bildirim merkezinin WhatsApp adaptörü aynı geçidi kullanmalı,
> ikinci bir gönderici kurulmamalı. Hazır cevap şablonları gelince mesaj kutusuna eklenecek.

### 10. Aktör Activity Feed + audit log — Ali Kemal
**Gün sonu:** Admin, sistemde olan biteni canlı izliyor: hangi aktör hangi event'i işledi, ne kadar sürdü, hata var mı; bir rezervasyonun tüm zincirini tek tıkla görüyor.
- [ ] Backend: ActivityLog ve EventLog listeleme API'si (filtre: aktör, event, seviye, tarih, correlationId)
- [x] Backend: AuditLog (kullanıcı hangi kaydı değiştirdi; servis katmanında otomatik yazım) — **modül 1'de yapıldı**
- [ ] Backend: socket.io `activity` kanalı (her log satırı anlık yayınlanır)
- [ ] Ekran: Canlı akış (liste, otomatik kaydırma, duraklat)
- [ ] Ekran: Filtre çubuğu (aktör, event adı, seviye, tarih)
- [ ] Ekran: Zincir görünümü (correlationId seç → adımlar sıralı, süreleriyle)
- [ ] Ekran: Kullanıcı audit listesi (kim, ne zaman, hangi kayıt, eski/yeni değer)

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
- [ ] Backend: Approval CRUD + `grant` / `deny` API'leri
- [ ] Backend: `approval.granted` yayınlanınca PendingAction'daki event tekrar bus'a verilir
- [ ] Backend: süre dolan onaylar EXPIRED olur (zamanlayıcı)
- [ ] Ekran: Bekleyen onaylar listesi (tip, özet, isteyen aktör, tutar, süre)
- [ ] Ekran: Onay detayı (veri, gerekçe) + Onayla / Reddet + not
- [ ] Ekran: Geçmiş onaylar
- [ ] Frontend: yeni onay gelince üst barda sayaç + socket bildirimi

### 12. Aktör yönetim paneli — Ali Kemal
**Gün sonu:** Admin, aktörleri tek ekrandan açıp kapatıyor; kapalı aktörün işleri "manuel görevler"de listeleniyor; LLM agent'ların token harcaması görünüyor.
- [ ] Backend: `GET /actors` (manifest + durum), `enable` / `disable` API'leri
- [ ] Backend: ManualTask listeleme / tamamlama API'si
- [ ] Backend: LlmUsage günlük özet API'si
- [ ] Ekran: Aktör listesi (ad, tip, paket, durum, switch)
- [ ] Ekran: Aktör detay paneli (açıklama, dinlediği / yayınladığı event'ler, onay gerektiren aksiyonlar, retry politikası)
- [ ] Ekran: LLM agent kartı (model, günlük bütçe, bugünkü kullanım çubuğu, tahmini maliyet)
- [ ] Ekran: Manuel görevler listesi (modül, başlık, orijinal event, "tamamla")

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
> ekranı, LLM bütçe kartı ve onay akışı (Approval/PendingAction — modül 11).

### 13. Günlük durum ekranı — arkadaşın
**Gün sonu:** Müdür sabah tek ekrana bakıp günü anlıyor: doluluk, gelecek/gidecek, gelir, bekleyen işler.
- [ ] Backend: `GET /dashboard/today` (doluluk %, gelecek/gidecek sayısı, dolu/boş oda, kirli oda, arızalı oda, bugünkü gelir, ADR)
      — doluluk % paydası **satılabilir oda** (toplam − arızalı); hizmet dışı paydadan düşmez
- [ ] Backend: `GET /dashboard/week` (7 günlük doluluk serisi)
- [ ] Ekran: KPI kartları (6 kart)
- [ ] Ekran: Haftalık doluluk çizgi grafiği
- [ ] Ekran: Bugün gelecekler / gidecekler kısa listesi (6'ya link)
- [ ] Ekran: Bekleyen işler kutusu (onaylar, manuel görevler, açık arızalar)

---

## 2. ÖN BÜRO (operasyon + para)

### 14. Housekeeping / kat hizmetleri — Ali Kemal
**Gün sonu:** Check-out olan oda otomatik temizlik listesine düşüyor, kat görevlisine atanıyor, telefondan "temizledim" deyince oda tekrar satılabilir oluyor.
- [ ] Backend: HousekeepingTask CRUD, atama, tamamlama, inspection API'leri
- [ ] Backend: her sabah konaklayan odalar için STAYOVER görevi üreten zamanlayıcı
- [ ] Ekran: Günlük temizlik listesi (oda, tip, öncelik, atanan, durum)
- [ ] Ekran: Toplu atama (kat görevlisi seç, odaları işaretle)
- [ ] Ekran: Mobil görünüm (büyük butonlar: Başladım / Bitti / Sorun var)
- [ ] Ekran: Kat şefi kontrol ekranı (temizlenen odayı onayla → CLEAN → INSPECTED)
- [ ] Ekran: Oda durum haritası (kat kat, renkli kutular)
- [ ] Aktör: housekeeping-worker paketi (`guest.checked_out` → CHECKOUT_CLEAN görevi; `housekeeping.task.completed` → kat hizmeti CLEANING→CLEAN)

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
- [ ] Backend: Folio / FolioItem API'leri (aç, kalem ekle, kalem iptal, kapat)
- [ ] Backend: `splitFolio`, `mergeFolios`, `transferItem` servisleri
- [ ] Backend: bakiye hesabı (kalemler − ödemeler), vergi dahil/hariç
- [ ] Ekran: Folyo detayı (kalem tablosu, toplam, ödenen, bakiye)
- [ ] Ekran: Harcama ekle formu (tip, açıklama, tutar, adet, vergi)
- [ ] Ekran: Bölme (kalemleri iki folyoya dağıt), birleştirme (grup), transfer
- [ ] Ekran: Kalem iptali → onay kuyruğuna gider
- [ ] Aktör: billing-worker paketi (`guest.checked_in` → folyo aç; gece → oda ücreti kalemi; `fnb.order.charged` / `minibar.consumed` → kalem; `guest.checked_out` → bakiye kontrolü)

### 16. Fatura kesme — Ali Kemal
**Gün sonu:** Kapanan folyodan tek tıkla fatura üretiliyor, PDF alınıyor, numara serisi düzgün ilerliyor.
- [ ] Backend: Invoice / InvoiceLine tabloları, numara serisi (yıl-sıra), `createInvoiceFromFolio`, `cancelInvoice`
- [ ] Backend: PDF üretimi (şablon: otel logosu, alıcı, kalemler, vergi dökümü)
- [ ] Ekran: Faturalandırılacak folyolar listesi
- [ ] Ekran: Fatura oluştur formu (alıcı tipi: kişi/şirket, vergi no, adres; kalem önizleme)
- [ ] Ekran: Fatura listesi (numara, tarih, tutar, durum) + PDF indir
- [ ] Ekran: İptal → onay kuyruğu
- [ ] Aktör: billing-worker'a `folio.closed` → fatura taslağı kuralı

### 17. Ödeme alma — arkadaşın
**Gün sonu:** Resepsiyon nakit/kart/havale/döviz tahsilat giriyor; büyük tutarlar onaya düşüyor; kasa durumu anlık görünüyor.
- [ ] Backend: Payment API (al, iade et, listele); ExchangeRate tablosu + günlük kur girişi
- [ ] Backend: tutar eşiği parametresi; eşik üstü → `approval.requested`
- [ ] Ekran: Ödeme al formu (folyo, yöntem, tutar, para birimi, kur, referans)
- [ ] Ekran: Ön ödeme / depozito (rezervasyona bağlı)
- [ ] Ekran: İade formu → onay kuyruğu
- [ ] Ekran: Kasa görünümü (bugün yöntem bazında toplamlar)
- [ ] Aktör: billing-worker'a `payment.received` → folyo bakiyesi güncelle kuralı

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
**Gün sonu:** Kat görevlisi odadan tüketilen minibar ürünlerini giriyor, çamaşır siparişi alınıyor; ikisi de folyoya otomatik yansıyor.
- [ ] Backend: MinibarItem, MinibarConsumption, LaundryOrder tabloları + API
- [ ] Backend: tüketim kaydı → `minibar.consumed` event → folyo kalemi
- [ ] Ekran: Minibar ürün listesi + fiyat
- [ ] Ekran: Oda bazlı tüketim girişi (mobil; oda seç, ürün + adet)
- [ ] Ekran: Çamaşır siparişi (oda, parça listesi, teslim tarihi, durum)
- [ ] Ekran: Günlük minibar / çamaşır raporu

### 20. Teknik servis / arıza-bakım — Ali Kemal
**Gün sonu:** "204 klima bozuk" kaydı açılıyor, teknisyene gidiyor, oda gerekirse bakıma alınıyor, çözülünce kapanıyor.
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
- [ ] Backend: LostItem API (kaydet, ara, eşleştir, teslim et)
- [ ] Ekran: Bulunan eşya formu (açıklama, oda, bulan, tarih, fotoğraf)
- [ ] Ekran: Liste + arama (tarih, oda, açıklama)
- [ ] Ekran: Misafirle eşleştir (o tarihte o odada kim kalmış), iletişim notu
- [ ] Ekran: Teslim edildi / kargo bilgisi

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

---

## 3. RAPORLAMA

### 23. Gelir raporları — arkadaşın
**Gün sonu:** Doluluk, ADR, RevPAR raporları tarih aralığına göre tablo + grafik olarak çıkıyor; geçen yılla karşılaştırma var.
- [ ] Backend: MCP server paketi (read-only DB bağlantısı; tool'lar: `get_occupancy`, `get_revenue`, `run_report_query` parametrik/güvenli)
- [ ] Backend: rapor SQL'leri (günlük/haftalık/aylık doluluk, ADR, RevPAR, kaynak bazlı, oda tipi bazlı)
- [ ] Ekran: Rapor sayfası (tarih aralığı, gruplama seçici)
- [ ] Ekran: Doluluk raporu (tablo + çizgi grafik)
- [ ] Ekran: ADR / RevPAR raporu
- [ ] Ekran: Kaynak ve oda tipi kırılımı (pasta / çubuk)
- [ ] Ekran: Geçen yıl karşılaştırma sütunu

### 24. Doğal dil raporlama — Ali Kemal
**Gün sonu:** Müdür "geçen ayın haftalık doluluğunu göster" yazıyor, tablo ve grafik geliyor; rapor kaydedilebiliyor.
- [ ] report-agent paketi (LangGraph; MCP tool'larını çağırır; sonuç: tablo verisi + grafik tipi önerisi + kısa yorum)
- [ ] Backend: SavedReport tablosu + API
- [ ] Ekran: Rapor sohbeti (soru kutusu, cevap: tablo + grafik + yorum)
- [ ] Ekran: "Kaydet" → kayıtlı raporlar listesi, tekrar çalıştır
- [ ] Token bütçesi + LlmUsage kaydı; agent kapalıysa "rapor talebi" manuel görevi

### 25. Günlük durum — forecast — arkadaşın
**Gün sonu:** Dashboard'da önümüzdeki 30 günün doluluk ve gelir tahmini görünüyor; riskli günler işaretli.
- [ ] Backend: MCP `get_forecast` (mevcut rezervasyonlar + geçen yıl aynı dönem trendi)
- [ ] Backend: kritik gün tespiti (doluluk < %30 veya > %95)
- [ ] Ekran: 30 günlük doluluk grafiği (gerçek + tahmin ayrımı)
- [ ] Ekran: Gelir tahmini kartı
- [ ] Ekran: Kritik günler listesi

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
- [ ] Backend: Budget, BudgetLine tabloları + API (yıl, ay, kalem, plan tutarı)
- [ ] Backend: gerçekleşen tutarları folyo / ödeme / satın alma verisinden hesaplama
- [ ] Ekran: Bütçe giriş tablosu (satır kalem, sütun ay; Excel'den yükleme)
- [ ] Ekran: Sapma raporu (plan, gerçek, fark, fark %; renkli)
- [ ] report-agent'a `explain_variance` tool'u → yorum paragrafı

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
- [ ] Backend: Agency, Contract, ContractRate tabloları + API
- [ ] Backend: rezervasyonda acente seçiliyse kontrat fiyatı kullan; stop-sale günlerinde reddet
- [ ] Ekran: Acente listesi + kart (firma, yetkili, iletişim, komisyon %, vade)
- [ ] Ekran: Kontrat formu (acente, dönem, oda tipi, pansiyon, fiyat, stop-sale tarihleri)
- [ ] Ekran: Acente rezervasyonları ve cari özeti (47 ile bağlanır)

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
- [ ] Backend: Promotion, Coupon tabloları + API; kural motoru (koşul: tarih, min. gece, oda tipi, erken rezervasyon günü)
- [ ] Backend: fiyat hesabına promosyon uygulama, kupon doğrulama
- [ ] Ekran: Promosyon formu (ad, geçerlilik, indirim tipi, koşullar)
- [ ] Ekran: Kupon kodu üretimi (adet, tek kullanımlık mı)
- [ ] Ekran: Kullanım raporu
- [ ] Rezervasyon formuna ve web widget'a kupon alanı

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
- [ ] Backend: Channel, ChannelRoomMapping, ChannelSyncLog tabloları + API
- [ ] Adaptör 1: iCal (Airbnb / Booking iCal export-import)
- [ ] Adaptör 2: bir OTA API'si (Booking veya bir channel manager aracısı)
- [ ] Ekran: Kanal listesi + bağlantı ayarları
- [ ] Ekran: Oda tipi eşleştirme (bizim tip ↔ kanal tipi)
- [ ] Ekran: Senkron logu (ne gönderildi, hata) + manuel senkron butonu, stop-sale
- [ ] Aktör: channel-sync-worker paketi (`room.availability.changed` / `rate.changed` → kanala gönder; kanal webhook → `reservation.requested`)

### 34. Dinamik fiyat / yield — Ali Kemal
**Gün sonu:** Sistem günde bir fiyat önerisi üretiyor, gerekçesiyle onaya düşüyor; onaylanınca fiyat değişip kanallara gidiyor.
- [ ] Kural tabanlı yield (worker): doluluk > %80 → +%10, < %30 ve 7 gün kaldı → −%15 (parametreler ayarlardan)
- [ ] pricing-agent paketi (günde 1 çalışır; doluluk, kalan gün, geçen yıl, etkinlik takvimi okur; öneri + gerekçe; `approval.requested`)
- [ ] Backend: PriceSuggestion tablosu; onaylanınca RatePlan güncelle → `rate.changed`
- [ ] Ekran: Öneriler listesi (tarih, oda tipi, mevcut, önerilen, gerekçe) + onayla / reddet / düzenle
- [ ] Ekran: Yield kuralları ayarı
- [ ] Ekran: Fiyat geçmişi grafiği

### 35. Acente bonus / sadakat — arkadaşın
**Gün sonu:** Acentelerin satış hedefleri ve hak ettiği primler dönem sonunda raporlanıyor.
- [ ] Backend: AgencyBonusRule, AgencyBonus tabloları; dönem sonu hesaplama servisi
- [ ] Ekran: Bonus kuralı (acente, dönem, hedef gece/ciro, prim oranı)
- [ ] Ekran: Acente puan / hedef durumu
- [ ] Ekran: Hak ediş raporu (dönem sonu, onaylı)

### 36. Call center & satış CRM — Ali Kemal
**Gün sonu:** Telefonla gelen her talep kayıtlı; teklif gönderiliyor; takip görevleri hatırlatıyor.
- [ ] Backend: Lead, CallLog, Quote tabloları + API
- [ ] Backend: teklif PDF + e-posta gönderimi (notification-worker)
- [ ] Ekran: Arama kaydı formu (arayan, telefon, talep, sonuç)
- [ ] Ekran: Fırsat panosu (yeni / teklif verildi / bekliyor / kazanıldı / kaybedildi)
- [ ] Ekran: Teklif oluştur (tarih, oda, fiyat) → gönder → kabul edilince rezervasyona çevir
- [ ] Ekran: Hatırlatmalar (bugün aranacaklar)

### 37. Satış projeleri & banket / etkinlik — arkadaşın
**Gün sonu:** Düğün, toplantı gibi etkinlikler salon takviminde; teklif → sözleşme → fatura akışı çalışıyor.
- [ ] Backend: Venue, Event, EventItem tabloları + API
- [ ] Ekran: Salon tanımları (kapasite, düzen tipleri, saatlik/günlük fiyat)
- [ ] Ekran: Etkinlik takvimi (salon × tarih)
- [ ] Ekran: Etkinlik dosyası (müşteri, tarih, salon, kişi, düzen, ekipman, menü linki (43), fiyat)
- [ ] Ekran: Teklif → sözleşme (PDF) → depozito → fatura (16'ya bağlanır)

---

## 5. F&B / POS

### 38. Menü & reçete — Ali Kemal
**Gün sonu:** Restoran menüsü ve her ürünün reçetesi tanımlı; ürün maliyeti otomatik hesaplanıyor.
- [ ] Backend: MenuCategory, MenuItem, Recipe, RecipeLine tabloları + API
- [ ] Backend: maliyet hesabı (reçete satırları × stok birim maliyeti)
- [ ] Ekran: Menü grupları ve ürünler (ad, fiyat, KDV, görsel, aktif)
- [ ] Ekran: Reçete editörü (ürün → malzeme + miktar + birim)
- [ ] Ekran: Maliyet / kâr marjı tablosu
- [ ] Ekran: QR menü için public JSON çıktısı (53 kullanır)

### 39. Restoran POS — arkadaşın
**Gün sonu:** Garson masayı açıp sipariş giriyor, adisyon kapatıyor, ödeme alıyor veya odaya yazıyor.
- [ ] Backend: Table, Order, OrderLine, Check tabloları + API
- [ ] Backend: adisyon bölme / ikram / indirim servisleri; "odaya yaz" → `fnb.order.charged`
- [ ] Ekran: Masa planı (salon seçimi, masa kutuları: boş / dolu / hesap istiyor)
- [ ] Ekran: Sipariş ekranı (dokunmatik; ürün grupları, adet, not, gönder)
- [ ] Ekran: Adisyon (kalemler, böl, ikram, indirim, kapat)
- [ ] Ekran: Ödeme (nakit / kart / odaya yaz; oda seçimi)
- [ ] Ekran: Garson vardiya raporu
- [ ] Aktör: fnb-worker paketi (`order.placed` → mutfak; `order.paid` → stok düşümü event'i; `fnb.order.charged` → billing-worker folyo kalemi)

### 40. Mutfak ekranı (KDS) — Ali Kemal
**Gün sonu:** Mutfaktaki tablette siparişler sırayla görünüyor, süre sayıyor, "hazır" deyince garsona haber gidiyor.
- [ ] Backend: Order durum geçişleri (NEW → PREPARING → READY → SERVED), istasyon alanı
- [ ] Backend: socket kanalı `kitchen`
- [ ] Ekran: Sipariş kartları (masa, kalemler, geçen süre; renk: yeni / hazırlanıyor / gecikti)
- [ ] Ekran: Kart butonları (Başla / Hazır), istasyon filtresi (sıcak / soğuk / bar)
- [ ] Ekran: Garson tarafında "hazır" bildirimi

### 41. Oda servisi — arkadaşın
**Gün sonu:** Odaya sipariş giriliyor, mutfağa düşüyor, teslim edilince folyoya yazılıyor.
- [ ] Backend: Order'a `roomId` + teslim durumu; `fnb.order.charged` → folyo
- [ ] Ekran: Oda servisi sipariş formu (oda, ürünler, not, teslim saati)
- [ ] Ekran: Teslim listesi (hazır siparişler, teslim edildi)
- [ ] Misafir tarafı: QR menüden sipariş (53 ile birleşir)

### 42. Online paket sipariş — Ali Kemal
**Gün sonu:** Dışarıdan gelen paket siparişler aynı POS zincirinden geçiyor; kurye ataması ve teslim takibi var.
- [ ] Backend: Order `source=ONLINE`, DeliveryInfo tablosu (adres, telefon, kurye, durum)
- [ ] Ekran: Dış sipariş formu (müşteri, adres, ürünler, ödeme tipi)
- [ ] Ekran: Sipariş panosu (hazırlanıyor / yolda / teslim)
- [ ] Ekran: Kurye atama
- [ ] (opsiyonel) Public sipariş sayfası

### 43. Banket F&B planlaması — arkadaşın
**Gün sonu:** Etkinliğin menüsü seçiliyor; kişi sayısına göre malzeme ihtiyacı ve maliyet çıkıyor.
- [ ] Backend: EventMenu tablosu; reçeteden kişi sayısına göre malzeme hesaplama
- [ ] Ekran: Etkinlik menüsü seçimi (set menü, kişi başı fiyat)
- [ ] Ekran: Malzeme ihtiyaç listesi (satın alma talebine çevir → 45)
- [ ] Ekran: Mutfak üretim planı (gün / saat)

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

### 45. Satın alma — arkadaşın
**Gün sonu:** Talep → teklif karşılaştırma → sipariş → mal kabul zinciri kayıtlı; mal kabulde stok otomatik giriyor.
- [ ] Backend: Supplier, PurchaseRequest, PurchaseQuote, PurchaseOrder, GoodsReceipt tabloları + API
- [ ] Backend: sipariş tutarı eşik üstü → `approval.requested`; mal kabul → stok girişi + tedarikçi borcu event'i
- [ ] Ekran: Tedarikçi kartları
- [ ] Ekran: Talep formu (talep eden, ürün, miktar, ihtiyaç tarihi) + otomatik önerilen talepler listesi
- [ ] Ekran: Teklif karşılaştırma (tedarikçi × fiyat × termin)
- [ ] Ekran: Sipariş (onaylı) + PDF
- [ ] Ekran: Mal kabul / irsaliye (gelen miktar, fark, depo)

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
- [ ] Backend: Account (cari), AccountTransaction, CashRegister, BankAccount, Cheque tabloları + API
- [ ] Ekran: Cari kartlar + ekstre (borç / alacak / bakiye)
- [ ] Ekran: Kasa hareketleri (giriş / çıkış, açıklama)
- [ ] Ekran: Banka hesapları + hareketler
- [ ] Ekran: Çek / senet portföyü (vade, durum, tahsil / ciro / karşılıksız)
- [ ] Ekran: Tahsilat / ödeme fişi
- [ ] Aktör: accounting-worker paketi (`invoice.issued` → cari alacak; `payment.received` → kasa/banka; `goods.received` → tedarikçi borç)

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

### 49. e-Fatura / e-Arşiv / e-Defter — arkadaşın
**Gün sonu:** Faturalar özel entegratör üzerinden GİB'e gidiyor, durumu izleniyor; e-Defter aylık dosyası üretiliyor.
- [ ] Backend: EInvoiceConfig, EInvoiceLog tabloları; entegratör adaptörü (1 firma ile başla)
- [ ] Backend: UBL XML üretimi, gönderim, durum sorgulama; alıcı mükellef mi kontrolü (e-Fatura / e-Arşiv ayrımı)
- [ ] Backend: e-Defter aylık yevmiye / kebir dosyası
- [ ] Ekran: Entegratör ayarları (hesap, test / canlı)
- [ ] Ekran: Fatura listesine "GİB durumu" kolonu + gönder / tekrar gönder
- [ ] Ekran: e-Defter aylık üretim + indirme

### 50. Sanal POS / ödeme geçidi — Ali Kemal
**Gün sonu:** Misafire ödeme linki gönderiliyor veya widget'ta kartla ödeme yapılıyor; sonuç otomatik folyoya düşüyor.
- [ ] Backend: PaymentGatewayConfig, PaymentTransaction tabloları; sağlayıcı adaptörü (iyzico veya PayTR)
- [ ] Backend: ödeme linki üret, 3D Secure akışı, webhook → `payment.received`
- [ ] Ekran: Sağlayıcı ayarları
- [ ] Ekran: "Ödeme linki gönder" (rezervasyon / folyo üzerinden; e-posta / WhatsApp ile)
- [ ] Widget'a kart ödeme adımı
- [ ] Ekran: İşlem listesi (başarılı / başarısız / iade)

### 51. Personel & bordro — arkadaşın
**Gün sonu:** Personel kartları kayıtlı; aylık bordro hesaplanıp çıktı alınıyor.
- [ ] Backend: Employee, Payroll, PayrollLine tabloları + API; brüt → net hesabı (SGK, vergi dilimi parametrik)
- [ ] Ekran: Personel listesi + kart (kimlik, pozisyon, departman, işe giriş, maaş, IBAN)
- [ ] Ekran: Aylık bordro hesapla (ek ödeme / kesinti gir → hesapla → onayla)
- [ ] Ekran: Bordro PDF / toplu çıktı

### 52. İK — Ali Kemal
**Gün sonu:** İzin talepleri onaylanıyor, vardiya çizelgesi yapılıyor, puantaj tutuluyor, özlük belgeleri saklanıyor.
- [ ] Backend: Leave, Shift, Timesheet, EmployeeDocument tabloları + API; izin bakiye hesabı
- [ ] Ekran: İzin talebi (personel) + onay (yönetici) → onay kuyruğu
- [ ] Ekran: İzin bakiyeleri
- [ ] Ekran: Haftalık vardiya çizelgesi (departman × gün)
- [ ] Ekran: Puantaj (giriş / çıkış, mesai)
- [ ] Ekran: Özlük belgeleri (yükle, süre takibi)

---

## 8. MİSAFİR DENEYİMİ

### 53. Temassız uygulamalar — arkadaşın
**Gün sonu:** Misafir gelmeden telefonundan check-in yapıyor, QR ile menüden sipariş veriyor, portalda folyosunu görüyor.
- [ ] Backend: OnlineCheckin, GuestPortalSession tabloları; token'lı public linkler
- [ ] Misafir portalı (ayrı küçük React app): rezervasyonum, online check-in formu (kimlik, imza, kart), folyom, istek gönder, chat (8)
- [ ] QR menü sayfası (38'deki menü JSON'u; sipariş → 41)
- [ ] Ekran (personel): online check-in yapanlar listesi, onayla → 6'daki check-in
- [ ] Dijital anahtar butonu (62 tamamlanınca aktif)

### 54. Misafir yorum entegrasyonu + duygu analizi — Ali Kemal
**Gün sonu:** Google / Booking yorumları sisteme düşüyor; AI olumlu-olumsuz ve konu etiketi veriyor, cevap öneriyor; trend grafiği var.
- [ ] Backend: Review, ReviewAnalysis tabloları; yorum çekme (API varsa) + manuel / Excel yükleme
- [ ] insight-agent paketi (toplu çalışır: duygu, konu etiketi, önerilen cevap, anomali: "temizlik şikâyeti bu hafta 3 kat arttı")
- [ ] Ekran: Yorum listesi (kaynak, puan, duygu, konu; filtre)
- [ ] Ekran: Yorum detayı + önerilen cevap → düzenle → gönder / kopyala
- [ ] Ekran: Trend grafiği (haftalık duygu, konu dağılımı)
- [ ] Anomali → yöneticiye bildirim

### 55. Anket & memnuniyet — arkadaşın
**Gün sonu:** Check-out'tan 1 gün sonra anket gidiyor; cevaplar toplanıyor; NPS ve AI özeti görünüyor.
- [ ] Backend: Survey, SurveyQuestion, SurveyResponse tabloları + API; public cevap sayfası
- [ ] Backend: `guest.checked_out` + 1 gün → notification-worker anket linki gönderir
- [ ] Ekran: Anket tasarımı (sorular, tip: puan / çoktan seçmeli / açık)
- [ ] Ekran: Cevaplar listesi + NPS skoru
- [ ] insight-agent özeti (açık uçlu cevapların ana temaları)

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

### 59. Kimlik / pasaport okuma (OCR) — arkadaşın
**Gün sonu:** Check-in'de kimliğin fotoğrafı çekilince ad, soyad, TC / pasaport no, doğum tarihi otomatik doluyor.
- [ ] Backend: OCR servisi bağlantısı (MRZ okuma; bulut API veya kütüphane)
- [ ] Ekran: Check-in formunda "Kimlik tara" butonu (kamera / dosya)
- [ ] Ekran: Okunan alanları göster → onayla → forma yaz
- [ ] Kimlik görselini misafir kaydına ekle (KVKK: süre sonunda sil)

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

### 62. Donanım entegrasyonları — Ali Kemal
**Gün sonu:** Check-in'de kapı kartı kodlanıyor, oda telefonu açılıyor; check-out'ta kapanıyor; POS cihazından ödeme sonucu geliyor.
- [ ] Backend: Device, DeviceLog tabloları; ortak adaptör arayüzü (`encodeKey`, `revokeKey`, `openLine`, `closeLine`, `chargeCard`)
- [ ] Adaptör: 1 kapı kilidi markası
- [ ] Adaptör: 1 santral
- [ ] Adaptör: 1 POS cihazı
- [ ] Ekran: Cihaz tanımları + bağlantı testi
- [ ] Check-in / check-out akışına cihaz adımları; hata olursa manuel görev

### 63. Multi-tenant zincir konsolu — arkadaşın
**Gün sonu:** Zincir yöneticisi birden çok oteli tek panelden görüyor; otel arası geçiş yapıyor; zincir raporu alıyor.
- [ ] Backend: HotelGroup, UserHotel tabloları; kullanıcı → birden çok otel yetkisi
- [ ] Backend: zincir raporu (oteller karşılaştırmalı doluluk / gelir)
- [ ] Ekran: Otel listesi + yeni otel ekleme sihirbazı (ayarlar 1'i kopyala)
- [ ] Ekran: Üst barda otel seçici
- [ ] Ekran: Zincir dashboard'u
- [ ] Ekran: Merkezi kullanıcı yönetimi

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
