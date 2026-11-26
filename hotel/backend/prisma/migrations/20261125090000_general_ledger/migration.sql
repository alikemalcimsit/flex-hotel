-- Modül 48: genel muhasebe — Tek Düzen hesap planı, yevmiye fişi ve satırı, otomatik fiş kuralları;
-- ön muhasebe hareketlerinin fiş bağı, dönem kilidi, kasa / banka giriş-çıkış fişinde karşı hesap.

-- CreateEnum
CREATE TYPE "GlAccountClass" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COST', 'EXPENSE', 'OFF_BALANCE');

-- CreateEnum
CREATE TYPE "GlDepartment" AS ENUM ('ROOMS', 'FNB', 'OTHER', 'UNDISTRIBUTED');

-- CreateEnum
CREATE TYPE "JournalEntryType" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('FOLIO_PAYMENT', 'FOLIO_TRANSFER', 'EVENT_PAYMENT', 'EVENT_CHARGE', 'POS_PAYMENT', 'SPA_PAYMENT', 'GOODS_RECEIPT', 'AGENCY_BONUS', 'INVOICE', 'VOUCHER', 'OPENING', 'INSTRUMENT', 'PAYROLL', 'PAYROLL_PAYMENT', 'EMPLOYEE_ADVANCE', 'DAILY_REVENUE', 'MANUAL', 'REVERSAL');

-- CreateEnum
CREATE TYPE "JournalRuleSource" AS ENUM ('TREASURY', 'LEDGER_TYPE', 'LEDGER_ACCOUNT', 'GUEST_LEDGER', 'REVENUE', 'VAT_OUTPUT', 'VAT_INPUT', 'PURCHASE', 'AGENCY_BONUS', 'PAYROLL_EXPENSE', 'PAYROLL_LIABILITY', 'INSTRUMENT', 'TREASURY_IN', 'TREASURY_OUT', 'OPENING', 'FX_GAIN', 'FX_LOSS');

-- AlterTable
ALTER TABLE "AccountingSettings" ADD COLUMN     "glChartSeededAt" TIMESTAMP(3),
ADD COLUMN     "glLockedThrough" DATE;

-- AlterTable
ALTER TABLE "AccountingVoucher" ADD COLUMN     "glAccountId" TEXT;

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "journalEntryId" TEXT;

-- AlterTable
ALTER TABLE "TreasuryMovement" ADD COLUMN     "journalEntryId" TEXT;

-- CreateTable
CREATE TABLE "GlAccount" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "class" "GlAccountClass" NOT NULL,
    "department" "GlDepartment",
    "isPostable" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "JournalEntryType" NOT NULL,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'POSTED',
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "source" "JournalSource" NOT NULL,
    "sourceId" TEXT,
    "sourceKey" TEXT,
    "total" DECIMAL(16,2) NOT NULL,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "requestId" TEXT,
    "reversalOfId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "debit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "ledgerAccountId" TEXT,
    "treasuryAccountId" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalRule" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "source" "JournalRuleSource" NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "accountId" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GlAccount_hotelId_parentId_code_idx" ON "GlAccount"("hotelId", "parentId", "code");

-- CreateIndex
CREATE INDEX "GlAccount_hotelId_isActive_code_idx" ON "GlAccount"("hotelId", "isActive", "code");

-- CreateIndex
CREATE UNIQUE INDEX "GlAccount_hotelId_code_key" ON "GlAccount"("hotelId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reversalOfId_key" ON "JournalEntry"("reversalOfId");

-- CreateIndex
CREATE INDEX "JournalEntry_hotelId_date_id_idx" ON "JournalEntry"("hotelId", "date", "id");

-- CreateIndex
CREATE INDEX "JournalEntry_hotelId_source_sourceId_idx" ON "JournalEntry"("hotelId", "source", "sourceId");

-- CreateIndex
CREATE INDEX "JournalEntry_hotelId_status_createdAt_idx" ON "JournalEntry"("hotelId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_hotelId_number_key" ON "JournalEntry"("hotelId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_hotelId_sourceKey_key" ON "JournalEntry"("hotelId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_hotelId_requestId_key" ON "JournalEntry"("hotelId", "requestId");

-- CreateIndex
CREATE INDEX "JournalLine_hotelId_accountId_date_idx" ON "JournalLine"("hotelId", "accountId", "date");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_date_entryId_idx" ON "JournalLine"("accountId", "date", "entryId");

-- CreateIndex
CREATE INDEX "JournalLine_ledgerAccountId_idx" ON "JournalLine"("ledgerAccountId");

-- CreateIndex
CREATE INDEX "JournalLine_treasuryAccountId_idx" ON "JournalLine"("treasuryAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalLine_entryId_sortOrder_key" ON "JournalLine"("entryId", "sortOrder");

-- CreateIndex
CREATE INDEX "JournalRule_accountId_idx" ON "JournalRule"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalRule_hotelId_source_key_key" ON "JournalRule"("hotelId", "source", "key");

-- CreateIndex
CREATE INDEX "LedgerEntry_hotelId_journalEntryId_date_idx" ON "LedgerEntry"("hotelId", "journalEntryId", "date");

-- CreateIndex
CREATE INDEX "TreasuryMovement_hotelId_journalEntryId_date_idx" ON "TreasuryMovement"("hotelId", "journalEntryId", "date");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingVoucher" ADD CONSTRAINT "AccountingVoucher_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlAccount" ADD CONSTRAINT "GlAccount_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlAccount" ADD CONSTRAINT "GlAccount_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_treasuryAccountId_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "TreasuryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalRule" ADD CONSTRAINT "JournalRule_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalRule" ADD CONSTRAINT "JournalRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Fiş satırının tek tarafı dolu, iki taraf da eksi olamaz; fiş toplamı eksi olamaz; hesap derinliği sınırlı.
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_single_side" CHECK ("debit" >= 0 AND "credit" >= 0 AND (("debit" = 0) <> ("credit" = 0)));
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_total_nonnegative" CHECK ("total" >= 0);
ALTER TABLE "GlAccount" ADD CONSTRAINT "GlAccount_depth_range" CHECK ("depth" BETWEEN 0 AND 5);
-- İptal edilen fişin iptal izi dolu; işlenmiş fişin izi boş.
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_void_trail" CHECK (("status" = 'VOIDED') = ("voidedAt" IS NOT NULL));
