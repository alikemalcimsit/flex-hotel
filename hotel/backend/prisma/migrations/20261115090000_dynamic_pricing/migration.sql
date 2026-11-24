-- Modül 34: Dinamik fiyat / yield management.
-- PriceSuggestion: kural ya da pricing-agent üretir, M11 onayına düşer.
-- PriceAdjustment: onaylanan gece hassasiyetli çarpan; standart satış fiyatının
-- (plan/sezon) üstüne uygulanır — acente kontratı, paket, elle fiyat etkilenmez.

-- CreateEnum
CREATE TYPE "PriceSuggestionSource" AS ENUM ('RULE', 'AGENT');
CREATE TYPE "PriceSuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "PriceSuggestion" (
  "id"             TEXT NOT NULL,
  "hotelId"        TEXT NOT NULL,
  "roomTypeId"     TEXT NOT NULL,
  "startDate"      DATE NOT NULL,
  "endDate"        DATE NOT NULL,
  "multiplier"     DECIMAL(6,3) NOT NULL,
  "currentPrice"   DECIMAL(12,2) NOT NULL,
  "suggestedPrice" DECIMAL(12,2) NOT NULL,
  "reason"         TEXT NOT NULL,
  "inputs"         JSONB NOT NULL DEFAULT '{}',
  "source"         "PriceSuggestionSource" NOT NULL,
  "status"         "PriceSuggestionStatus" NOT NULL DEFAULT 'PENDING',
  "approvalId"     TEXT,
  "decidedBy"      TEXT,
  "decidedAt"      TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PriceSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PriceSuggestion_approvalId_key" ON "PriceSuggestion"("approvalId");
CREATE INDEX "PriceSuggestion_hotelId_status_startDate_idx" ON "PriceSuggestion"("hotelId", "status", "startDate");
CREATE INDEX "PriceSuggestion_hotelId_roomTypeId_startDate_endDate_idx" ON "PriceSuggestion"("hotelId", "roomTypeId", "startDate", "endDate");

-- CreateTable
CREATE TABLE "PriceAdjustment" (
  "id"           TEXT NOT NULL,
  "hotelId"      TEXT NOT NULL,
  "roomTypeId"   TEXT NOT NULL,
  "date"         DATE NOT NULL,
  "multiplier"   DECIMAL(6,3) NOT NULL,
  "suggestionId" TEXT,
  "createdBy"    TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PriceAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PriceAdjustment_hotelId_roomTypeId_date_key" ON "PriceAdjustment"("hotelId", "roomTypeId", "date");
CREATE INDEX "PriceAdjustment_hotelId_date_idx" ON "PriceAdjustment"("hotelId", "date");

-- AddForeignKey
ALTER TABLE "PriceSuggestion" ADD CONSTRAINT "PriceSuggestion_hotelId_fkey"
  FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceSuggestion" ADD CONSTRAINT "PriceSuggestion_roomTypeId_fkey"
  FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceSuggestion" ADD CONSTRAINT "PriceSuggestion_approvalId_fkey"
  FOREIGN KEY ("approvalId") REFERENCES "Approval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceAdjustment" ADD CONSTRAINT "PriceAdjustment_hotelId_fkey"
  FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceAdjustment" ADD CONSTRAINT "PriceAdjustment_roomTypeId_fkey"
  FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceAdjustment" ADD CONSTRAINT "PriceAdjustment_suggestionId_fkey"
  FOREIGN KEY ("suggestionId") REFERENCES "PriceSuggestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────── Veri bütünlüğü ───────────────
--
-- Son savunma hattı (servis aynı kuralları önce denetler). Çarpan emniyet
-- aralığı insan/LLM hatasına karşı: bir onay fiyatı yarıdan aşağı indiremez,
-- üç katından yukarı çıkaramaz.

ALTER TABLE "PriceSuggestion"
  ADD CONSTRAINT "PriceSuggestion_period_valid" CHECK ("endDate" >= "startDate" AND ("endDate" - "startDate") < 90),
  ADD CONSTRAINT "PriceSuggestion_multiplier_range" CHECK ("multiplier" >= 0.5 AND "multiplier" <= 3),
  ADD CONSTRAINT "PriceSuggestion_prices_valid" CHECK ("currentPrice" > 0 AND "suggestedPrice" > 0),
  ADD CONSTRAINT "PriceSuggestion_decision_trail" CHECK (
    ("status" = 'PENDING' AND "decidedBy" IS NULL AND "decidedAt" IS NULL)
    OR ("status" <> 'PENDING' AND "decidedAt" IS NOT NULL)
  );

ALTER TABLE "PriceAdjustment"
  ADD CONSTRAINT "PriceAdjustment_multiplier_range" CHECK ("multiplier" >= 0.5 AND "multiplier" <= 3);
