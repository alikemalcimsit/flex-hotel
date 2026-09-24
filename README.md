# HotelOS (flex-hotel)

Otonom aktör ağıyla çalışan otel yönetim sistemi. Modül sırası: `MODUL-SIRASI.md`. Görev listesi: `GOREVLER.md`.

## 1. Sunucuda veritabanı kurulumu (bir kere, Ubuntu)

`postgresql-contrib` şart: sezon çakışmasını engelleyen kısıt `btree_gist`
eklentisini kullanıyor (PostgreSQL 13'ten beri "trusted", veritabanı sahibi
superuser olmadan kurabiliyor).

```bash
sudo apt install postgresql postgresql-contrib
sudo -u postgres psql
```
```sql
CREATE USER hotelos WITH PASSWORD 'GUCLU_SIFRE';
CREATE DATABASE hotelos OWNER hotelos;
\q
```

Dışarıdan bağlantı için:
- `/etc/postgresql/*/main/postgresql.conf` → `listen_addresses = '*'`
- `/etc/postgresql/*/main/pg_hba.conf` → sonuna sadece ikinizin IP'si için satır: `host hotelos hotelos SENIN_IP/32 md5`
- `sudo systemctl restart postgresql`
- Firewall: `sudo ufw allow from SENIN_IP to any port 5432`

## 2. Geliştirici bilgisayarında (Mac ve Windows)

Gereksinim: Node.js 22 veya üstü (https://nodejs.org).

1. `.env.example` dosyasını `.env` adıyla kopyala, `DATABASE_URL` satırını doldur.
2. Komutlar:

```bash
npm install
npm run db:migrate     # tabloları oluşturur
npm run db:seed        # demo verisi
npm run dev            # backend + frontend birlikte
```

- Backend: http://localhost:3000/health
- Frontend: http://localhost:5173 (admin@hotel.local / admin123)
- Veritabanı arayüzü: `npm run db:studio`

Sadece birini açmak için: `npm run dev:backend` veya `npm run dev:frontend`.

## 3. Testler

```bash
npm test
```

Veritabanı gerektirmeyen birim testleri (saf iş kuralları, doğrulama şemaları,
para aritmetiği, HTTP katmanı) çalışır.

Veritabanına inen davranışlar (soft-delete, optimistic lock, sezon çakışması
kısıtı, audit ve event kayıtları) ayrı çalışır ve **boş bir test veritabanı**
ister — testler tabloları temizler, geliştirme veritabanınızı vermeyin:

```bash
DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy -w @hotelos/hotel-backend
# Test veritabanını UTC dışı bir saat dilimine alın: ham SQL'in oturum saat
# diliminden bağımsız olduğunu testler böylece doğrular (bkz. lib/sql-time.js).
psql "$TEST_DATABASE_URL" -c "ALTER DATABASE hotelos_test SET timezone = 'Europe/Istanbul'"
TEST_DATABASE_URL=postgresql://... npm run test:integration -w @hotelos/hotel-backend
```

## Klasörler

- `shared/` → sektörden bağımsız çekirdek (core, actor-kit, ui, auth, channels, agents, workers, mcp-server)
- `hotel/` → otel paketi (contracts, frontend, backend, agents, workers)
- `clinic/` → gelecek sektör paketi (boş)
- `web/` → FlexAI kurumsal tanıtım sitesi. HotelOS ürününün parçası değil,
  bağımsız bir Vite/React uygulaması (workspaces listesine dahil değil —
  kendi `node_modules`'ü için `web/` içinde ayrıca `npm install` gerekir).
  `npm run dev` (kendi klasöründen) → http://localhost:5173 (varsayılan Vite
  portu; HotelOS frontend'iyle aynı anda çalıştırırken `-- --port 5183` gibi
  farklı bir port verin).

Kurallar: sadece JavaScript (ESM), TypeScript yok. Backend modülleri
`hotel/backend/src/modules/`, sayfalar `hotel/frontend/src/pages/`.

Test politikası: yaygın test yazmıyoruz, ama **yanlış hesaplayınca sessizce
yanlış para tahsil eden** kod (fiyat, müsaitlik, bakiye, çakışma kuralları)
test edilir.

## ⚠️ `prisma db push` KULLANMAYIN

Şema dosyasında ifade edilemeyen üç tür kısıt doğrudan migration SQL'inde tanımlı:
kısmi unique index'ler (`RoomType.code`, `Room.number` — yalnızca silinmemiş satırlar),
CHECK kısıtları (iptal politikası tutarlılığı, sezon tarih sırası) ve sezon
çakışmasını engelleyen EXCLUDE kısıtı.

`prisma db push` şemayı temel alıp veritabanını ona benzetmeye çalışır; şemada
görünmeyen bu kısıtları **uyarı vermeden siler**. Sonuç: çakışan sezonlar,
tekrar kullanılamayan kodlar ve sessizce yanlış fiyat hesapları.

Şema değişikliği için her zaman `npm run db:migrate` kullanın.

## Modüller arası sözleşmeler

- **Para ve oranlar string taşınır.** `Number()` ile çarpmayın;
  `@hotelos/core`'daki `money.js` fonksiyonlarını kullanın.
- **Doğrulama tek kaynaktan.** Zod şemaları `@hotelos/hotel-contracts` içinde;
  sunucu ve React formu aynısını kullanır.
- **`findUnique` yerine `findFirst`.** Soft-delete filtresi Prisma extension'ı
  olarak otomatik uygulanıyor ama `findUnique` bundan muaf.
- **Ayar verisini doğrudan Prisma'dan okumayın.** `modules/settings/service.js`
  içindeki cache'li "sıcak okuma" fonksiyonlarını kullanın.
- **"Bugün" otelin günüdür.** `lib/business-date.js` → `getBusinessDate(hotelId)`;
  sunucu saatiyle (`new Date()`) hesaplanan gün İstanbul'da gece yarısından
  sonra dünü gösterir.
- **Envanteri azaltan yazmalar kilitlenir.** `lib/locks.js` → önce oda tipleri,
  sonra odalar, id'ye göre sıralı (`SELECT ... FOR UPDATE`). Farklı sırayla
  kilitleyen iki işlem birbirini kilitler.
- **Oda durumunu doğrudan yazmayın.** Doluluk yalnızca giriş-çıkış akışıyla
  (`applySystemRoomState`), oda değişikliği `changeRoom` ile değişir; kat
  hizmeti `PATCH /rooms/:id/housekeeping`.
- **Canlı ekranlar socket'ten haber alır, veri almaz.** `lib/realtime.js`
  yalnızca "şu otelde şu değişti" yayınlar; panel kendi sorgusunu tazeler.
  Socket kimliği henüz istemcinin söylediği e-posta (`x-actor` gibi), yük taşımayın.
- **Haber yalnızca ilgilenene gider.** Kanal haberi o ekranı açık tutan
  panellere (`hotel:<id>:ch:<kanal>`, istemci `subscribe` ile katılır), zil
  haberi muhatabına (`...:user:<id>` / `...:perm:<izin>`). Yeni bir canlı ekran
  `useLiveChannel` ile abone olur; otelin tamamına `hotelRoom` üzerinden
  yayın yapmayın.
- **Rezervasyon yazmaları envanter kilidiyle.** `modules/reservations/service.js`: oda tipi kilidi →
  aynı transaction'da müsaitlik → yaz. Rezervasyonu doğrudan `tx.reservation.create/update` ile
  yazmayın; fiyat gece gece (`ReservationNight`), denetim izi ve olaylar birlikte yazılır. Tekrar
  gönderim anahtarı `requestId`; durum kuralı `reservationActionError` (contracts).
- **Giriş / çıkış yalnızca ön büro servisinden.** `modules/front-desk/service.js`: durumu
  `CHECKED_IN` / `CHECKED_OUT` yapan tek yer (kimlik, oda, ücret, bakiye denetimi ve olaylar
  birlikte). İçerideki kaydın `checkedInAt`'i, çıkmışın iki zamanı da zorunlu (kısıt). Saat
  hesabı otelin saatine göre (`hotelClock`), sunucunun değil. Kimlik numarası listede ve denetim
  izinde maskeli (`maskIdNumber`).
- **Onay gerektiren iş kendi kendine yapılmaz.** Aktör `ctx.requireApproval({ action,
  … })` der (`action` bildirgedeki `requiresApproval`'da olmalı); servis
  `modules/approvals/service.js → requestApproval(tx, stage, …)` çağırır. Onaylanan
  olay bus'a **yeniden verilmez**; yalnızca isteyen aktöre `ctx.approval` ile döner
  (diğer aktörler işi ikinci kez yapmasın). HTTP'den onay açan uç yoktur.
