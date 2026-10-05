-- Modül 29: acente ve kontrat yönetimi (acente kartı, kontrat, oda tipi × pansiyon × dönem fiyatları, stop-sale).

-- CreateEnum
CREATE TYPE "AgencyStatus" AS ENUM ('ACTIVE', 'PASSIVE');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ENDED');

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "agencyCommissionPct" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "Agency" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "taxOffice" TEXT,
    "taxNumber" TEXT,
    "commissionPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "paymentTermDays" INTEGER NOT NULL DEFAULT 0,
    "status" "AgencyStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "endedAt" TIMESTAMP(3),
    "endedBy" TEXT,
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractRate" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "boardType" "BoardType" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractStopSale" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "roomTypeId" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractStopSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Agency_hotelId_status_name_idx" ON "Agency"("hotelId", "status", "name");

-- CreateIndex
CREATE INDEX "Contract_hotelId_agencyId_status_startDate_endDate_idx" ON "Contract"("hotelId", "agencyId", "status", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "Contract_hotelId_status_endDate_idx" ON "Contract"("hotelId", "status", "endDate");

-- CreateIndex
CREATE INDEX "ContractRate_contractId_roomTypeId_boardType_startDate_endD_idx" ON "ContractRate"("contractId", "roomTypeId", "boardType", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "ContractRate_hotelId_roomTypeId_idx" ON "ContractRate"("hotelId", "roomTypeId");

-- CreateIndex
CREATE INDEX "ContractStopSale_contractId_startDate_endDate_idx" ON "ContractStopSale"("contractId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "ContractStopSale_hotelId_roomTypeId_idx" ON "ContractStopSale"("hotelId", "roomTypeId");

-- Reservation.agencyId bu modüle kadar hiçbir kodun yazmadığı, ilişkisiz bir kolondu: bağ kurulmadan
-- önce olası artık değerler temizlenir (yoksa yabancı anahtar kurulamaz).
UPDATE "Reservation" SET "agencyId" = NULL WHERE "agencyId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agency" ADD CONSTRAINT "Agency_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractRate" ADD CONSTRAINT "ContractRate_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractRate" ADD CONSTRAINT "ContractRate_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractRate" ADD CONSTRAINT "ContractRate_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractStopSale" ADD CONSTRAINT "ContractStopSale_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractStopSale" ADD CONSTRAINT "ContractStopSale_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractStopSale" ADD CONSTRAINT "ContractStopSale_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────── Veri bütünlüğü ───────────────
--
-- Prisma kısmi index, ifade index'i, EXCLUDE ve CHECK ifade edemez; bunlar son
-- savunma hattıdır (servis aynı kuralları yazmadan önce denetler, eşzamanlı iki
-- istek yarışırsa veritabanı reddeder).

-- Acente: kod ve ad otel içinde tekil (ad büyük / küçük harf duyarsız); aramada trigram.
CREATE UNIQUE INDEX "Agency_hotelId_code_key" ON "Agency"("hotelId", "code");
CREATE UNIQUE INDEX "Agency_hotelId_name_key" ON "Agency"("hotelId", lower("name"));
CREATE INDEX "Agency_name_trgm_idx" ON "Agency" USING gin ("name" gin_trgm_ops);
CREATE INDEX "Agency_code_trgm_idx" ON "Agency" USING gin ("code" gin_trgm_ops);

ALTER TABLE "Agency"
  ADD CONSTRAINT "Agency_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9._-]{1,19}$'),
  ADD CONSTRAINT "Agency_name_not_blank" CHECK (length(btrim("name")) >= 2),
  ADD CONSTRAINT "Agency_commission_range" CHECK ("commissionPct" BETWEEN 0 AND 100),
  ADD CONSTRAINT "Agency_term_range" CHECK ("paymentTermDays" BETWEEN 0 AND 365);

-- Kontrat: dönem (iki uç dahil, en fazla 1100 gün), para birimi, durum izi.
-- Durum izi: taslakta aktifleştirme / sonlandırma izi yok; aktifte aktifleştirme var;
-- sonlandırılmışta ikisi de ve sebep var.
ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_period_valid" CHECK ("endDate" >= "startDate" AND ("endDate" - "startDate") < 1100),
  ADD CONSTRAINT "Contract_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "Contract_name_not_blank" CHECK (length(btrim("name")) >= 2),
  ADD CONSTRAINT "Contract_status_trail" CHECK (
    ("status" = 'DRAFT' AND "activatedAt" IS NULL AND "activatedBy" IS NULL AND "endedAt" IS NULL AND "endedBy" IS NULL AND "endReason" IS NULL)
    OR ("status" = 'ACTIVE' AND "activatedAt" IS NOT NULL AND "activatedBy" IS NOT NULL AND "endedAt" IS NULL AND "endedBy" IS NULL AND "endReason" IS NULL)
    OR ("status" = 'ENDED' AND "activatedAt" IS NOT NULL AND "activatedBy" IS NOT NULL AND "endedAt" IS NOT NULL AND "endedBy" IS NOT NULL AND "endReason" IS NOT NULL)
  );

-- Acentenin aynı günü kapsayan en fazla bir aktif kontratı olur (fiyat belirsizliği olmasın).
-- Taslaklar çakışabilir (yenileme hazırlanırken).
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_one_active_per_day"
  EXCLUDE USING gist (
    "agencyId" WITH =,
    daterange("startDate", "endDate", '[]') WITH &&
  ) WHERE ("status" = 'ACTIVE');

-- Fiyat satırı: pozitif fiyat, geçerli dönem; aynı kontratta aynı oda tipi + pansiyon için
-- dönemler çakışmaz. (Satırın kontrat döneminin içinde olması çapraz tablo kuralıdır:
-- kontrat satırı kilitliyken servis denetler.)
ALTER TABLE "ContractRate"
  ADD CONSTRAINT "ContractRate_price_valid" CHECK ("price" > 0 AND "price" <= 100000000),
  ADD CONSTRAINT "ContractRate_period_valid" CHECK ("endDate" >= "startDate");

ALTER TABLE "ContractRate" ADD CONSTRAINT "ContractRate_no_overlap"
  EXCLUDE USING gist (
    "contractId" WITH =,
    "roomTypeId" WITH =,
    "boardType" WITH =,
    daterange("startDate", "endDate", '[]') WITH &&
  );

-- Stop-sale: geçerli dönem; aynı kapsamda (aynı oda tipi ya da "tüm tipler") çakışmaz.
ALTER TABLE "ContractStopSale"
  ADD CONSTRAINT "ContractStopSale_period_valid" CHECK ("endDate" >= "startDate"),
  ADD CONSTRAINT "ContractStopSale_reason_length" CHECK ("reason" IS NULL OR length("reason") <= 200);

ALTER TABLE "ContractStopSale" ADD CONSTRAINT "ContractStopSale_no_overlap"
  EXCLUDE USING gist (
    "contractId" WITH =,
    (COALESCE("roomTypeId", '')) WITH =,
    daterange("startDate", "endDate", '[]') WITH &&
  );

-- Rezervasyon: acente varsa açılıştaki komisyon yüzdesi de vardır (ve tersi).
ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_agency_commission" CHECK (
    ("agencyId" IS NULL) = ("agencyCommissionPct" IS NULL)
    AND ("agencyCommissionPct" IS NULL OR "agencyCommissionPct" BETWEEN 0 AND 100)
  );

-- Acentenin rezervasyonları ve cari özeti (yalnızca acenteli satırlar index'lenir).
CREATE INDEX "Reservation_agency_stay_idx" ON "Reservation"("hotelId", "agencyId", "checkIn", "id")
  WHERE "agencyId" IS NOT NULL AND "deletedAt" IS NULL;
