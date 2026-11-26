-- CreateEnum
CREATE TYPE "ExchangeRateSource" AS ENUM ('MANUAL', 'TCMB');

-- CreateEnum
CREATE TYPE "ExchangeRateKind" AS ENUM ('FOREX_BUYING', 'FOREX_SELLING', 'BANKNOTE_BUYING', 'BANKNOTE_SELLING');

-- AlterTable
ALTER TABLE "ExchangeRate" ADD COLUMN     "bulletinDate" DATE,
ADD COLUMN     "source" "ExchangeRateSource" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "foreignCurrency" TEXT,
ADD COLUMN     "foreignRate" DECIMAL(12,6),
ADD COLUMN     "foreignRateDate" DATE,
ADD COLUMN     "foreignTotal" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "displayCurrency" TEXT,
ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'tr';

-- CreateTable
CREATE TABLE "ExchangeRateSettings" (
    "hotelId" TEXT NOT NULL,
    "autoFetch" BOOLEAN NOT NULL DEFAULT false,
    "rateKind" "ExchangeRateKind" NOT NULL DEFAULT 'FOREX_BUYING',
    "currencies" TEXT[] DEFAULT ARRAY['USD', 'EUR', 'GBP']::TEXT[],
    "lastFetchAt" TIMESTAMP(3),
    "lastFetchOk" BOOLEAN,
    "lastMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ExchangeRateSettings_pkey" PRIMARY KEY ("hotelId")
);

-- AddForeignKey
ALTER TABLE "ExchangeRateSettings" ADD CONSTRAINT "ExchangeRateSettings_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Kurallar
ALTER TABLE "User" ADD CONSTRAINT "User_locale" CHECK ("locale" IN ('tr', 'en'));
-- Taslakta yalnız para birimi seçilir; kur ve karşılık kesimde yazılır.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_foreign" CHECK (("foreignRate" IS NULL OR ("foreignCurrency" IS NOT NULL AND "foreignRate" > 0 AND "foreignTotal" IS NOT NULL)));
