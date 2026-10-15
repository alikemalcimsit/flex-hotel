-- Modül 35: acente bonusu / hedef primi (kural, dönem sonu hak edişi, hak ediş satırları).
-- Tablolar Prisma'nın ürettiği; altta veritabanı kuralları (CHECK, EXCLUDE) elle.

-- Personel uyarısı türü
ALTER TYPE "StaffAlertKind" ADD VALUE IF NOT EXISTS 'AGENCY_BONUS';

-- CreateEnum
CREATE TYPE "AgencyBonusMetric" AS ENUM ('NIGHTS', 'REVENUE');

-- CreateEnum
CREATE TYPE "AgencyBonusMode" AS ENUM ('WHOLE', 'EXCESS');

-- CreateEnum
CREATE TYPE "AgencyBonusRuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgencyBonusStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID');

-- CreateTable
CREATE TABLE "AgencyBonusRule" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "metric" "AgencyBonusMetric" NOT NULL,
    "mode" "AgencyBonusMode" NOT NULL,
    "target" DECIMAL(14,2) NOT NULL,
    "tiers" JSONB NOT NULL,
    "roomTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxBonus" DECIMAL(12,2),
    "currency" TEXT NOT NULL,
    "notes" TEXT,
    "status" "AgencyBonusRuleStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "progressNights" INTEGER NOT NULL DEFAULT 0,
    "progressRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "progressScore" DECIMAL(9,2) NOT NULL DEFAULT 0,
    "reachedTier" INTEGER NOT NULL DEFAULT 0,
    "progressAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyBonusRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyBonus" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "status" "AgencyBonusStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "metric" "AgencyBonusMetric" NOT NULL,
    "mode" "AgencyBonusMode" NOT NULL,
    "target" DECIMAL(14,2) NOT NULL,
    "tiers" JSONB NOT NULL,
    "roomTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxBonus" DECIMAL(12,2),
    "currency" TEXT NOT NULL,
    "ruleUpdatedAt" TIMESTAMP(3) NOT NULL,
    "nights" INTEGER NOT NULL,
    "revenue" DECIMAL(14,2) NOT NULL,
    "scorePct" DECIMAL(9,2) NOT NULL,
    "tierIndex" INTEGER NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "capped" BOOLEAN NOT NULL DEFAULT false,
    "slices" JSONB NOT NULL,
    "reservationCount" INTEGER NOT NULL,
    "missingPostings" INTEGER NOT NULL DEFAULT 0,
    "calculatedAt" TIMESTAMP(3) NOT NULL,
    "calculatedBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "submittedBy" TEXT,
    "submitNote" TEXT,
    "approvalId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "decisionNote" TEXT,
    "paidAt" DATE,
    "paidBy" TEXT,
    "paidRecordedAt" TIMESTAMP(3),
    "paymentRef" TEXT,
    "paymentNote" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedBy" TEXT,
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyBonus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyBonusLine" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "bonusId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "nights" INTEGER NOT NULL,
    "revenue" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "AgencyBonusLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgencyBonusRule_hotelId_agencyId_startDate_idx" ON "AgencyBonusRule"("hotelId", "agencyId", "startDate");

-- CreateIndex
CREATE INDEX "AgencyBonusRule_hotelId_status_endDate_id_idx" ON "AgencyBonusRule"("hotelId", "status", "endDate", "id");

-- CreateIndex
CREATE INDEX "AgencyBonusRule_hotelId_status_progressScore_id_idx" ON "AgencyBonusRule"("hotelId", "status", "progressScore", "id");

-- CreateIndex
CREATE INDEX "AgencyBonusRule_name_trgm_idx" ON "AgencyBonusRule" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "AgencyBonus_ruleId_key" ON "AgencyBonus"("ruleId");

-- CreateIndex
CREATE INDEX "AgencyBonus_hotelId_status_periodEnd_id_idx" ON "AgencyBonus"("hotelId", "status", "periodEnd", "id");

-- CreateIndex
CREATE INDEX "AgencyBonus_hotelId_periodEnd_id_idx" ON "AgencyBonus"("hotelId", "periodEnd", "id");

-- CreateIndex
CREATE INDEX "AgencyBonus_hotelId_agencyId_periodEnd_idx" ON "AgencyBonus"("hotelId", "agencyId", "periodEnd");

-- CreateIndex
CREATE INDEX "AgencyBonus_approvalId_idx" ON "AgencyBonus"("approvalId");

-- CreateIndex
CREATE INDEX "AgencyBonusLine_bonusId_revenue_id_idx" ON "AgencyBonusLine"("bonusId", "revenue", "id");

-- CreateIndex
CREATE INDEX "AgencyBonusLine_bonusId_nights_id_idx" ON "AgencyBonusLine"("bonusId", "nights", "id");

-- CreateIndex
CREATE INDEX "AgencyBonusLine_reservationId_idx" ON "AgencyBonusLine"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyBonusLine_bonusId_reservationId_key" ON "AgencyBonusLine"("bonusId", "reservationId");

-- AddForeignKey
ALTER TABLE "AgencyBonusRule" ADD CONSTRAINT "AgencyBonusRule_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyBonusRule" ADD CONSTRAINT "AgencyBonusRule_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyBonus" ADD CONSTRAINT "AgencyBonus_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyBonus" ADD CONSTRAINT "AgencyBonus_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AgencyBonusRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyBonus" ADD CONSTRAINT "AgencyBonus_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyBonus" ADD CONSTRAINT "AgencyBonus_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "Approval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyBonusLine" ADD CONSTRAINT "AgencyBonusLine_bonusId_fkey" FOREIGN KEY ("bonusId") REFERENCES "AgencyBonus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyBonusLine" ADD CONSTRAINT "AgencyBonusLine_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────── Veritabanı kuralları (elle) ───────────────

-- Kural: ad, dönem (iki uç dahil, en fazla 731 gün), hedef (gece ölçütünde tam sayı), kademeler
-- (1–10), oda tipi süzgeci, tavan, para birimi, ilerleme özeti ve durum izi. Taslak silinir;
-- iptal yalnızca yürürlüğe girmiş kuralda olur (gerekçeli).
ALTER TABLE "AgencyBonusRule"
  ADD CONSTRAINT "AgencyBonusRule_name_not_blank" CHECK (length(btrim("name")) >= 2),
  ADD CONSTRAINT "AgencyBonusRule_period_valid" CHECK ("endDate" >= "startDate" AND ("endDate" - "startDate") < 731),
  ADD CONSTRAINT "AgencyBonusRule_target_valid" CHECK ("target" > 0 AND ("metric" <> 'NIGHTS' OR "target" = trunc("target"))),
  ADD CONSTRAINT "AgencyBonusRule_tiers_shape" CHECK (jsonb_typeof("tiers") = 'array' AND jsonb_array_length("tiers") BETWEEN 1 AND 10),
  ADD CONSTRAINT "AgencyBonusRule_room_types" CHECK ("roomTypeIds" IS NOT NULL AND cardinality("roomTypeIds") <= 100),
  ADD CONSTRAINT "AgencyBonusRule_max_bonus" CHECK ("maxBonus" IS NULL OR "maxBonus" > 0),
  ADD CONSTRAINT "AgencyBonusRule_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "AgencyBonusRule_progress_valid" CHECK ("progressNights" >= 0 AND "progressScore" >= 0 AND "reachedTier" BETWEEN 0 AND 10),
  ADD CONSTRAINT "AgencyBonusRule_status_trail" CHECK (
    ("status" = 'DRAFT' AND "activatedAt" IS NULL AND "activatedBy" IS NULL AND "cancelledAt" IS NULL AND "cancelledBy" IS NULL AND "cancelReason" IS NULL)
    OR ("status" = 'ACTIVE' AND "activatedAt" IS NOT NULL AND "activatedBy" IS NOT NULL AND "cancelledAt" IS NULL AND "cancelledBy" IS NULL AND "cancelReason" IS NULL)
    OR ("status" = 'CANCELLED' AND "activatedAt" IS NOT NULL AND "cancelledAt" IS NOT NULL AND "cancelledBy" IS NOT NULL AND "cancelReason" IS NOT NULL)
  );

-- Aynı acentenin aynı ölçütte (gece / ciro) aynı günü kapsayan en fazla bir yürürlükteki kuralı
-- olur: aynı üretime aynı türden iki prim ödenmesin. Farklı ölçütte iki kural (sezon gece primi +
-- yıllık ciro primi) birlikte yürürlükte olabilir. Taslaklar çakışabilir (yenisi hazırlanırken).
ALTER TABLE "AgencyBonusRule" ADD CONSTRAINT "AgencyBonusRule_one_active_nights"
  EXCLUDE USING gist ("agencyId" WITH =, daterange("startDate", "endDate", '[]') WITH &&)
  WHERE ("status" = 'ACTIVE' AND "metric" = 'NIGHTS');
ALTER TABLE "AgencyBonusRule" ADD CONSTRAINT "AgencyBonusRule_one_active_revenue"
  EXCLUDE USING gist ("agencyId" WITH =, daterange("startDate", "endDate", '[]') WITH &&)
  WHERE ("status" = 'ACTIVE' AND "metric" = 'REVENUE');

-- Hak ediş: dönem, sonuç rakamları (eksi olmaz), tutar tutarlılığı (tavan, brüt ≥ ödenecek,
-- "tavana takıldı" işareti), para birimi ve durum izi.
ALTER TABLE "AgencyBonus"
  ADD CONSTRAINT "AgencyBonus_period_valid" CHECK ("periodEnd" >= "periodStart"),
  ADD CONSTRAINT "AgencyBonus_figures_valid" CHECK (
    "nights" >= 0 AND "revenue" >= 0 AND "scorePct" >= 0 AND "tierIndex" BETWEEN 0 AND 10
    AND "reservationCount" >= 0 AND "missingPostings" >= 0 AND "revision" >= 1
  ),
  ADD CONSTRAINT "AgencyBonus_amount_valid" CHECK (
    "amount" >= 0 AND "grossAmount" >= "amount" AND "capped" = ("amount" < "grossAmount")
    AND ("maxBonus" IS NULL OR "amount" <= "maxBonus")
  ),
  ADD CONSTRAINT "AgencyBonus_room_types" CHECK ("roomTypeIds" IS NOT NULL),
  ADD CONSTRAINT "AgencyBonus_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "AgencyBonus_status_trail" CHECK (
    ("status" = 'DRAFT' AND "submittedAt" IS NULL AND "submittedBy" IS NULL AND "approvalId" IS NULL
      AND "approvedAt" IS NULL AND "approvedBy" IS NULL AND "paidAt" IS NULL AND "paidBy" IS NULL AND "paymentRef" IS NULL)
    OR ("status" = 'PENDING_APPROVAL' AND "submittedAt" IS NOT NULL AND "submittedBy" IS NOT NULL AND "approvalId" IS NOT NULL
      AND "approvedAt" IS NULL AND "approvedBy" IS NULL AND "paidAt" IS NULL AND "paidBy" IS NULL AND "paymentRef" IS NULL)
    OR ("status" = 'APPROVED' AND "approvedAt" IS NOT NULL AND "approvedBy" IS NOT NULL
      AND "paidAt" IS NULL AND "paidBy" IS NULL AND "paymentRef" IS NULL)
    OR ("status" = 'PAID' AND "approvedAt" IS NOT NULL AND "approvedBy" IS NOT NULL
      AND "paidAt" IS NOT NULL AND "paidBy" IS NOT NULL AND "paymentRef" IS NOT NULL AND "paidRecordedAt" IS NOT NULL)
  );

-- Hak ediş satırı: gece eksi olamaz.
ALTER TABLE "AgencyBonusLine" ADD CONSTRAINT "AgencyBonusLine_nights_valid" CHECK ("nights" >= 0);
