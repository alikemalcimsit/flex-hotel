-- Modül 18: Gün kapanış (night audit). NightAudit başından beri boş iskeleydi;
-- durumlu hale getiriyoruz ve kasa/özet için iki tablo ekliyoruz.

-- Durum enum'u
CREATE TYPE "NightAuditStatus" AS ENUM ('IN_PROGRESS', 'CLOSED');

-- NightAudit: durum + başlangıç/kapanış izi + kapanışın yaptığı iş özeti
ALTER TABLE "NightAudit"
  ADD COLUMN "status" "NightAuditStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  ADD COLUMN "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "startedBy" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "noShowCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "roomChargeStays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "roomChargeTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- startedBy zorunlu ama varsayılansız (geçici varsayılanı kaldır); closedBy artık opsiyonel (IN_PROGRESS)
ALTER TABLE "NightAudit" ALTER COLUMN "startedBy" DROP DEFAULT;
ALTER TABLE "NightAudit" ALTER COLUMN "closedBy" DROP NOT NULL;

-- Kasa sayımı ShiftReport'a taşındı
ALTER TABLE "NightAudit"
  DROP COLUMN "cashCounted",
  DROP COLUMN "cashExpected",
  DROP COLUMN "difference";

CREATE INDEX "NightAudit_hotelId_status_idx" ON "NightAudit"("hotelId", "status");

-- ShiftReport: vardiya devri / kasa sayımı
CREATE TABLE "ShiftReport" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "nightAuditId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "counts" JSONB NOT NULL DEFAULT '[]',
    "expectedTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "countedTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "variance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "handedOverBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShiftReport_nightAuditId_key" ON "ShiftReport"("nightAuditId");
CREATE INDEX "ShiftReport_hotelId_date_idx" ON "ShiftReport"("hotelId", "date");

-- DailyStats: günlük özet (doluluk, gelir, ADR, RevPAR, tahsilat)
CREATE TABLE "DailyStats" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "roomsSellable" INTEGER NOT NULL,
    "roomsSold" INTEGER NOT NULL,
    "occupancyPct" DECIMAL(5,2) NOT NULL,
    "roomRevenue" DECIMAL(14,2) NOT NULL,
    "adr" DECIMAL(14,2) NOT NULL,
    "revpar" DECIMAL(14,2) NOT NULL,
    "collections" DECIMAL(14,2) NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyStats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyStats_hotelId_day_key" ON "DailyStats"("hotelId", "day");

ALTER TABLE "ShiftReport" ADD CONSTRAINT "ShiftReport_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShiftReport" ADD CONSTRAINT "ShiftReport_nightAuditId_fkey" FOREIGN KEY ("nightAuditId") REFERENCES "NightAudit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DailyStats" ADD CONSTRAINT "DailyStats_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
