-- Modül 28: Paket / pansiyon tipleri.
-- RatePlan (oda tipi × pansiyon × dönem sabit fiyat) kişi başı ek fiyatla
-- genişletilir ve çakışma kısıtı alır; Package (oda + ek hizmet demeti) tablosu
-- eklenir; rezervasyona paket bağlanır.

-- ─────────────── RatePlan genişletme ───────────────

ALTER TABLE "RatePlan"
  ADD COLUMN "baseOccupancy"  INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "extraAdultRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "childRate"      DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "RatePlan_hotelId_roomTypeId_boardType_startDate_endDate_idx"
  ON "RatePlan"("hotelId", "roomTypeId", "boardType", "startDate", "endDate");
CREATE INDEX "RatePlan_hotelId_deletedAt_idx" ON "RatePlan"("hotelId", "deletedAt");

-- CreateTable
CREATE TABLE "Package" (
  "id"           TEXT NOT NULL,
  "hotelId"      TEXT NOT NULL,
  "code"         TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "description"  TEXT,
  "boardType"    "BoardType" NOT NULL DEFAULT 'BB',
  "nightlyPrice" DECIMAL(12,2) NOT NULL,
  "components"   JSONB NOT NULL DEFAULT '[]',
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  "deletedAt"    TIMESTAMP(3),

  CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Package_hotelId_code_idx" ON "Package"("hotelId", "code");
CREATE INDEX "Package_hotelId_deletedAt_idx" ON "Package"("hotelId", "deletedAt");

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN "packageId" TEXT;
CREATE INDEX "Reservation_packageId_idx" ON "Reservation"("packageId");

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_hotelId_fkey"
  FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────── Veri bütünlüğü ───────────────
--
-- Prisma kısmi index, EXCLUDE ve CHECK ifade edemez; bunlar son savunma hattıdır
-- (servis aynı kuralları yazmadan önce denetler, eşzamanlı iki istek yarışırsa
-- veritabanı reddeder). btree_gist zaten kurulu (settings modülü migration'ı).

-- Fiyat planı: pozitif fiyat, geçerli dönem, kişi başı ek tutarlar negatif değil,
-- en az bir gece.
ALTER TABLE "RatePlan"
  ADD CONSTRAINT "RatePlan_price_valid" CHECK ("price" > 0 AND "price" <= 100000000),
  ADD CONSTRAINT "RatePlan_period_valid" CHECK ("endDate" >= "startDate"),
  ADD CONSTRAINT "RatePlan_extras_valid" CHECK ("extraAdultRate" >= 0 AND "childRate" >= 0),
  ADD CONSTRAINT "RatePlan_occupancy_valid" CHECK ("baseOccupancy" BETWEEN 1 AND 20),
  ADD CONSTRAINT "RatePlan_min_stay_valid" CHECK ("minStay" IS NULL OR "minStay" BETWEEN 1 AND 365);

-- Aynı oda tipi + pansiyon için **yayındaki** (silinmemiş) planların dönemleri
-- çakışmaz: bir geceye tek plan düşsün, fiyat belirsiz olmasın. Silinmiş planlar
-- çakışabilir (geçmiş kayıt). daterange timestamp sütunlardan ::date ile üretilir.
ALTER TABLE "RatePlan" ADD CONSTRAINT "RatePlan_no_overlap"
  EXCLUDE USING gist (
    "hotelId" WITH =,
    "roomTypeId" WITH =,
    "boardType" WITH =,
    daterange("startDate"::date, "endDate"::date, '[]') WITH &&
  ) WHERE ("deletedAt" IS NULL);

-- Paket: kod biçimi (acente koduyla aynı kural), ad boş değil, pozitif fiyat.
ALTER TABLE "Package"
  ADD CONSTRAINT "Package_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9._-]{1,19}$'),
  ADD CONSTRAINT "Package_name_not_blank" CHECK (length(btrim("name")) >= 2),
  ADD CONSTRAINT "Package_price_valid" CHECK ("nightlyPrice" > 0 AND "nightlyPrice" <= 100000000);

-- Kod otel içinde tekil (yalnızca yayındaki paketler arasında); silinen paketin
-- kodu yeniden kullanılabilir.
CREATE UNIQUE INDEX "Package_hotelId_code_active_key"
  ON "Package"("hotelId", "code") WHERE ("deletedAt" IS NULL);
