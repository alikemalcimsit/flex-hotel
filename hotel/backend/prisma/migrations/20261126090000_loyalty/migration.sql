-- Modül 56: sadakat programı — ayar, misafir hesabı, puan hareketleri; LOYALTY zili.

-- CreateEnum
CREATE TYPE "LoyaltyAccountStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "LoyaltyTransactionKind" AS ENUM ('EARN', 'EARN_REVERSAL', 'REDEEM', 'REDEEM_REVERSAL', 'EXPIRE', 'ADJUST');

-- AlterEnum
ALTER TYPE "StaffAlertKind" ADD VALUE 'LOYALTY';

-- CreateTable
CREATE TABLE "LoyaltySettings" (
    "hotelId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "programName" TEXT NOT NULL DEFAULT 'Sadakat programı',
    "spendPerPoint" DECIMAL(12,2) NOT NULL DEFAULT 10,
    "pointValue" DECIMAL(12,4) NOT NULL DEFAULT 0.5,
    "minRedeemPoints" INTEGER NOT NULL DEFAULT 100,
    "maxRedeemPct" INTEGER NOT NULL DEFAULT 50,
    "expiryMonths" INTEGER NOT NULL DEFAULT 24,
    "autoEnroll" BOOLEAN NOT NULL DEFAULT true,
    "excludeLedgerPaid" BOOLEAN NOT NULL DEFAULT true,
    "earnOnSpa" BOOLEAN NOT NULL DEFAULT true,
    "tiers" JSONB NOT NULL DEFAULT '[]',
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltySettings_pkey" PRIMARY KEY ("hotelId")
);

-- CreateTable
CREATE TABLE "LoyaltyAccount" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "LoyaltyAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "tierCode" TEXT,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "qualifyingPoints" INTEGER NOT NULL DEFAULT 0,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enrolledBy" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyTransaction" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "LoyaltyTransactionKind" NOT NULL,
    "points" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL DEFAULT 0,
    "expiresOn" DATE,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "consumed" JSONB NOT NULL DEFAULT '[]',
    "reservationId" TEXT,
    "folioId" TEXT,
    "folioItemId" TEXT,
    "description" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyAccount_guestId_key" ON "LoyaltyAccount"("guestId");

-- CreateIndex
CREATE INDEX "LoyaltyAccount_hotelId_status_tierCode_idx" ON "LoyaltyAccount"("hotelId", "status", "tierCode");

-- CreateIndex
CREATE INDEX "LoyaltyAccount_hotelId_balance_idx" ON "LoyaltyAccount"("hotelId", "balance");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyAccount_hotelId_number_key" ON "LoyaltyAccount"("hotelId", "number");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_accountId_createdAt_idx" ON "LoyaltyTransaction"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_accountId_remaining_expiresOn_idx" ON "LoyaltyTransaction"("accountId", "remaining", "expiresOn");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_hotelId_expiresOn_idx" ON "LoyaltyTransaction"("hotelId", "expiresOn");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_hotelId_sourceType_sourceId_idx" ON "LoyaltyTransaction"("hotelId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyTransaction_hotelId_sourceKey_key" ON "LoyaltyTransaction"("hotelId", "sourceKey");

-- AddForeignKey
ALTER TABLE "LoyaltySettings" ADD CONSTRAINT "LoyaltySettings_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lot kalanı 0..puan arasında (yalnız artı harekette); hareket sıfır olamaz; ayar aralıkları.
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_remaining" CHECK ("remaining" >= 0 AND (("points" < 0 AND "remaining" = 0) OR ("points" > 0 AND "remaining" <= "points")));
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_points_nonzero" CHECK ("points" <> 0);
ALTER TABLE "LoyaltySettings" ADD CONSTRAINT "LoyaltySettings_ranges" CHECK ("spendPerPoint" > 0 AND "pointValue" > 0 AND "minRedeemPoints" >= 1 AND "maxRedeemPct" BETWEEN 1 AND 100 AND "expiryMonths" BETWEEN 0 AND 120);
