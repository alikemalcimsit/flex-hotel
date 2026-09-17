-- Modül 1 (Ayarlar).
--
-- Bu migration üç şey yapıyor:
--   1. Otel parametrelerini gevşek `settings` JSON'undan tipli kolonlara taşıyor
--   2. Soft-delete ile çakışan unique kısıtları kısmi (partial) hâle getiriyor
--   3. Sezon çakışmasını uygulama kodundan alıp veritabanı kısıtına gömüyor

-- ─────────────── 1. Otel parametreleri ───────────────

ALTER TABLE "Hotel" ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "checkInTime" TEXT NOT NULL DEFAULT '14:00',
ADD COLUMN     "checkOutTime" TEXT NOT NULL DEFAULT '12:00',
ADD COLUMN     "defaultBoardType" "BoardType" NOT NULL DEFAULT 'BB',
ADD COLUMN     "cancellationPolicyDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cancellationPolicyPenaltyPct" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- Mevcut kurulumlarda JSON içindeki check-in/out saatleri varsa yeni kolonlara taşı.
-- Eski `settings` alanı silinmedi; şemada modellenmemiş serbest ayarlar için rezerve.
UPDATE "Hotel"
SET "checkInTime" = COALESCE("settings" ->> 'checkInTime', "checkInTime"),
    "checkOutTime" = COALESCE("settings" ->> 'checkOutTime', "checkOutTime");

-- İptal politikası ya tamamen kapalıdır ya da iki alanı da doludur.
-- Yarım politika sessizce hiçbir şey yapmaz.
ALTER TABLE "Hotel" ADD CONSTRAINT "Hotel_cancellation_policy_coherent"
  CHECK (
    ("cancellationPolicyDays" = 0 AND "cancellationPolicyPenaltyPct" = 0)
    OR ("cancellationPolicyDays" > 0 AND "cancellationPolicyPenaltyPct" > 0)
  );

-- ─────────────── 2. Denetim izi (audit) ───────────────

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_hotelId_entity_entityId_idx" ON "AuditLog"("hotelId", "entity", "entityId");
CREATE INDEX "AuditLog_hotelId_createdAt_idx" ON "AuditLog"("hotelId", "createdAt");
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_hotelId_fkey"
  FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────── 3. Soft-delete uyumlu benzersizlik ───────────────
--
-- Düz unique index, soft-delete edilmiş satırı da "var" sayar: "STD" oda tipini
-- silen kullanıcı bir daha "STD" kodunu kullanamaz ve listede görmediği bir
-- kayıt yüzünden çıkışsız bir hata alır. Kısmi index yalnızca silinmemiş
-- satırlara bakar.
--
-- Not: Prisma kısmi unique index'i şemada ifade edemiyor; bu yüzden ilgili
-- modellerde `@@unique` yerine `@@index` var. Prisma'nın `findUnique`/`upsert`
-- bileşik anahtarları bu tablolarda kullanılamaz — `findFirst` kullanın.

DROP INDEX "RoomType_hotelId_code_key";
CREATE UNIQUE INDEX "RoomType_hotelId_code_active_key"
  ON "RoomType"("hotelId", "code") WHERE "deletedAt" IS NULL;
CREATE INDEX "RoomType_hotelId_code_idx" ON "RoomType"("hotelId", "code");
CREATE INDEX "RoomType_hotelId_deletedAt_idx" ON "RoomType"("hotelId", "deletedAt");

DROP INDEX "Room_hotelId_number_key";
CREATE UNIQUE INDEX "Room_hotelId_number_active_key"
  ON "Room"("hotelId", "number") WHERE "deletedAt" IS NULL;
CREATE INDEX "Room_hotelId_number_idx" ON "Room"("hotelId", "number");
CREATE INDEX "Room_hotelId_deletedAt_idx" ON "Room"("hotelId", "deletedAt");

-- ─────────────── 4. Sezon değişmezleri ───────────────

CREATE INDEX "Season_hotelId_startDate_endDate_idx" ON "Season"("hotelId", "startDate", "endDate");
CREATE INDEX "Season_hotelId_deletedAt_idx" ON "Season"("hotelId", "deletedAt");
CREATE INDEX "Tax_hotelId_deletedAt_idx" ON "Tax"("hotelId", "deletedAt");

ALTER TABLE "Season" ADD CONSTRAINT "Season_date_order" CHECK ("endDate" >= "startDate");

-- Aynı otelde iki sezon aynı güne düşemez: o gün için hangi fiyat çarpanının
-- geçerli olduğu belirsiz kalır ve sistem sessizce yanlış fiyat hesaplar.
--
-- Bu kural uygulama kodunda da var (kullanıcıya anlaşılır mesaj vermek için),
-- ama garantiyi veritabanı veriyor: hatalı bir kod yolu, elle atılan SQL veya
-- ileride yazılacak bir modül bile çakışan sezon yaratamaz.
--
-- Aralık `[]` (iki uçtan kapalı): 1-10 Haziran ile 10-20 Haziran çakışır.
-- btree_gist, PostgreSQL 13'ten beri "trusted" bir eklentidir; veritabanı
-- sahibi superuser olmadan da kurabilir. Sunucuda `postgresql-contrib`
-- paketinin kurulu olması gerekir.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Season" ADD CONSTRAINT "Season_no_overlap"
  EXCLUDE USING gist (
    "hotelId" WITH =,
    tsrange("startDate", "endDate", '[]') WITH &&
  ) WHERE ("deletedAt" IS NULL);
