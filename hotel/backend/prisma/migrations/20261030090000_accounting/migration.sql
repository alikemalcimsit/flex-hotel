-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('AGENCY', 'SUPPLIER', 'COMPANY', 'PERSON', 'OTHER');

-- CreateEnum
CREATE TYPE "LedgerSource" AS ENUM ('OPENING', 'FOLIO_TRANSFER', 'EVENT_CHARGE', 'EVENT_PAYMENT', 'GOODS_RECEIPT', 'AGENCY_BONUS', 'VOUCHER', 'INSTRUMENT', 'INVOICE');

-- CreateEnum
CREATE TYPE "TreasuryKind" AS ENUM ('CASH', 'BANK');

-- CreateEnum
CREATE TYPE "TreasurySource" AS ENUM ('OPENING', 'FOLIO_PAYMENT', 'EVENT_PAYMENT', 'POS_PAYMENT', 'VOUCHER', 'INSTRUMENT');

-- CreateEnum
CREATE TYPE "TreasuryChannel" AS ENUM ('FRONT_DESK', 'BANQUET', 'POS');

-- CreateEnum
CREATE TYPE "AccountingVoucherType" AS ENUM ('COLLECTION', 'PAYMENT', 'TRANSFER', 'TREASURY_IN', 'TREASURY_OUT', 'OPENING');

-- CreateEnum
CREATE TYPE "AccountingVoucherStatus" AS ENUM ('POSTED', 'PENDING_APPROVAL', 'DECLINED', 'VOIDED');

-- CreateEnum
CREATE TYPE "VoucherLineKind" AS ENUM ('TREASURY', 'CHEQUE_IN', 'CHEQUE_OUT', 'ENDORSE');

-- CreateEnum
CREATE TYPE "InstrumentKind" AS ENUM ('CHEQUE', 'NOTE');

-- CreateEnum
CREATE TYPE "InstrumentDirection" AS ENUM ('RECEIVED', 'ISSUED');

-- CreateEnum
CREATE TYPE "InstrumentStatus" AS ENUM ('PORTFOLIO', 'AT_BANK', 'COLLECTED', 'ENDORSED', 'BOUNCED', 'RETURNED', 'OUTSTANDING', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InstrumentAction" AS ENUM ('RECEIVE', 'ISSUE', 'DEPOSIT', 'WITHDRAW', 'COLLECT', 'ENDORSE', 'BOUNCE', 'RETURN', 'PAY', 'CANCEL');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "ledgerAccountId" TEXT;

-- CreateTable
CREATE TABLE "AccountingSettings" (
    "hotelId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "paymentApprovalAmount" DECIMAL(14,2) NOT NULL DEFAULT 50000,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingSettings_pkey" PRIMARY KEY ("hotelId")
);

-- CreateTable
CREATE TABLE "AccountingSequence" (
    "hotelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AccountingSequence_pkey" PRIMARY KEY ("hotelId","kind","year")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "agencyId" TEXT,
    "supplierId" TEXT,
    "eventClientId" TEXT,
    "taxOffice" TEXT,
    "taxNumber" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "paymentTermDays" INTEGER NOT NULL DEFAULT 0,
    "balance" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "debitTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "creditTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "lastEntryOn" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dueDate" DATE,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "sourceType" "LedgerSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "voucherId" TEXT,
    "instrumentId" TEXT,
    "reversalOfId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryAccount" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "kind" "TreasuryKind" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "bankName" TEXT,
    "branch" TEXT,
    "iban" TEXT,
    "accountNumber" TEXT,
    "balance" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "lastMovementOn" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreasuryAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryMovement" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "treasuryAccountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "ledgerAccountId" TEXT,
    "originalAmount" DECIMAL(14,2),
    "originalCurrency" TEXT,
    "exchangeRate" DECIMAL(12,6),
    "sourceType" "TreasurySource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "voucherId" TEXT,
    "instrumentId" TEXT,
    "reversalOfId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasuryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryMapping" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "channel" "TreasuryChannel" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT '',
    "treasuryAccountId" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreasuryMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingVoucher" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "AccountingVoucherType" NOT NULL,
    "status" "AccountingVoucherStatus" NOT NULL DEFAULT 'POSTED',
    "date" DATE NOT NULL,
    "ledgerAccountId" TEXT,
    "treasuryAccountId" TEXT,
    "targetTreasuryAccountId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "openingSide" TEXT,
    "dueDate" DATE,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "requestId" TEXT NOT NULL,
    "approvalId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "postedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "declinedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "AccountingVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingVoucherLine" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "kind" "VoucherLineKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "treasuryAccountId" TEXT,
    "instrumentId" TEXT,
    "instrumentKind" "InstrumentKind",
    "number" TEXT,
    "bankName" TEXT,
    "branch" TEXT,
    "drawer" TEXT,
    "dueDate" DATE,

    CONSTRAINT "AccountingVoucherLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "kind" "InstrumentKind" NOT NULL,
    "direction" "InstrumentDirection" NOT NULL,
    "status" "InstrumentStatus" NOT NULL,
    "number" TEXT NOT NULL,
    "bankName" TEXT,
    "branch" TEXT,
    "drawer" TEXT,
    "issueDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "endorsedToAccountId" TEXT,
    "treasuryAccountId" TEXT,
    "voucherId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstrumentMovement" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "action" "InstrumentAction" NOT NULL,
    "fromStatus" "InstrumentStatus",
    "toStatus" "InstrumentStatus" NOT NULL,
    "date" DATE NOT NULL,
    "treasuryAccountId" TEXT,
    "ledgerAccountId" TEXT,
    "voucherId" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstrumentMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_agencyId_key" ON "LedgerAccount"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_supplierId_key" ON "LedgerAccount"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_eventClientId_key" ON "LedgerAccount"("eventClientId");

-- CreateIndex
CREATE INDEX "LedgerAccount_hotelId_type_isActive_name_idx" ON "LedgerAccount"("hotelId", "type", "isActive", "name");

-- CreateIndex
CREATE INDEX "LedgerAccount_hotelId_isActive_balance_idx" ON "LedgerAccount"("hotelId", "isActive", "balance");

-- CreateIndex
CREATE INDEX "LedgerAccount_name_trgm_idx" ON "LedgerAccount" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_hotelId_code_key" ON "LedgerAccount"("hotelId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_reversalOfId_key" ON "LedgerEntry"("reversalOfId");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_date_createdAt_id_idx" ON "LedgerEntry"("accountId", "date", "createdAt", "id");

-- CreateIndex
CREATE INDEX "LedgerEntry_hotelId_sourceType_sourceId_idx" ON "LedgerEntry"("hotelId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "LedgerEntry_hotelId_date_id_idx" ON "LedgerEntry"("hotelId", "date", "id");

-- CreateIndex
CREATE INDEX "LedgerEntry_voucherId_idx" ON "LedgerEntry"("voucherId");

-- CreateIndex
CREATE INDEX "LedgerEntry_instrumentId_idx" ON "LedgerEntry"("instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_hotelId_sourceKey_key" ON "LedgerEntry"("hotelId", "sourceKey");

-- CreateIndex
CREATE INDEX "TreasuryAccount_hotelId_kind_isActive_name_idx" ON "TreasuryAccount"("hotelId", "kind", "isActive", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryAccount_hotelId_code_key" ON "TreasuryAccount"("hotelId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryMovement_reversalOfId_key" ON "TreasuryMovement"("reversalOfId");

-- CreateIndex
CREATE INDEX "TreasuryMovement_treasuryAccountId_date_createdAt_id_idx" ON "TreasuryMovement"("treasuryAccountId", "date", "createdAt", "id");

-- CreateIndex
CREATE INDEX "TreasuryMovement_hotelId_sourceType_sourceId_idx" ON "TreasuryMovement"("hotelId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "TreasuryMovement_hotelId_date_id_idx" ON "TreasuryMovement"("hotelId", "date", "id");

-- CreateIndex
CREATE INDEX "TreasuryMovement_voucherId_idx" ON "TreasuryMovement"("voucherId");

-- CreateIndex
CREATE INDEX "TreasuryMovement_instrumentId_idx" ON "TreasuryMovement"("instrumentId");

-- CreateIndex
CREATE INDEX "TreasuryMovement_ledgerAccountId_idx" ON "TreasuryMovement"("ledgerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryMovement_hotelId_sourceKey_key" ON "TreasuryMovement"("hotelId", "sourceKey");

-- CreateIndex
CREATE INDEX "TreasuryMapping_treasuryAccountId_idx" ON "TreasuryMapping"("treasuryAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryMapping_hotelId_channel_method_currency_key" ON "TreasuryMapping"("hotelId", "channel", "method", "currency");

-- CreateIndex
CREATE INDEX "AccountingVoucher_hotelId_date_id_idx" ON "AccountingVoucher"("hotelId", "date", "id");

-- CreateIndex
CREATE INDEX "AccountingVoucher_hotelId_status_createdAt_idx" ON "AccountingVoucher"("hotelId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AccountingVoucher_ledgerAccountId_date_idx" ON "AccountingVoucher"("ledgerAccountId", "date");

-- CreateIndex
CREATE INDEX "AccountingVoucher_approvalId_idx" ON "AccountingVoucher"("approvalId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingVoucher_hotelId_number_key" ON "AccountingVoucher"("hotelId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingVoucher_hotelId_requestId_key" ON "AccountingVoucher"("hotelId", "requestId");

-- CreateIndex
CREATE INDEX "AccountingVoucherLine_instrumentId_idx" ON "AccountingVoucherLine"("instrumentId");

-- CreateIndex
CREATE INDEX "AccountingVoucherLine_treasuryAccountId_idx" ON "AccountingVoucherLine"("treasuryAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingVoucherLine_voucherId_sortOrder_key" ON "AccountingVoucherLine"("voucherId", "sortOrder");

-- CreateIndex
CREATE INDEX "Instrument_hotelId_status_dueDate_id_idx" ON "Instrument"("hotelId", "status", "dueDate", "id");

-- CreateIndex
CREATE INDEX "Instrument_hotelId_dueDate_idx" ON "Instrument"("hotelId", "dueDate");

-- CreateIndex
CREATE INDEX "Instrument_ledgerAccountId_idx" ON "Instrument"("ledgerAccountId");

-- CreateIndex
CREATE INDEX "Instrument_number_trgm_idx" ON "Instrument" USING GIN ("number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "InstrumentMovement_instrumentId_createdAt_idx" ON "InstrumentMovement"("instrumentId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_ledgerAccountId_idx" ON "Payment"("ledgerAccountId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingSettings" ADD CONSTRAINT "AccountingSettings_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_eventClientId_fkey" FOREIGN KEY ("eventClientId") REFERENCES "EventClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "AccountingVoucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryAccount" ADD CONSTRAINT "TreasuryAccount_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_treasuryAccountId_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "TreasuryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "AccountingVoucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "TreasuryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMapping" ADD CONSTRAINT "TreasuryMapping_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryMapping" ADD CONSTRAINT "TreasuryMapping_treasuryAccountId_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "TreasuryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingVoucher" ADD CONSTRAINT "AccountingVoucher_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingVoucher" ADD CONSTRAINT "AccountingVoucher_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingVoucher" ADD CONSTRAINT "AccountingVoucher_treasuryAccountId_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "TreasuryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingVoucher" ADD CONSTRAINT "AccountingVoucher_targetTreasuryAccountId_fkey" FOREIGN KEY ("targetTreasuryAccountId") REFERENCES "TreasuryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingVoucher" ADD CONSTRAINT "AccountingVoucher_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "Approval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingVoucherLine" ADD CONSTRAINT "AccountingVoucherLine_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "AccountingVoucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingVoucherLine" ADD CONSTRAINT "AccountingVoucherLine_treasuryAccountId_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "TreasuryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingVoucherLine" ADD CONSTRAINT "AccountingVoucherLine_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_endorsedToAccountId_fkey" FOREIGN KEY ("endorsedToAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_treasuryAccountId_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "TreasuryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "AccountingVoucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstrumentMovement" ADD CONSTRAINT "InstrumentMovement_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══════════════════════ Kısıtlar (modül 47) ═══════════════════════
-- Uygulama kodu atlansa bile yanlış kayıt yazılamaz.

-- Cari hareket: tek taraf (borç ya da alacak), eksi tutar yok.
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_one_side" CHECK ("debit" >= 0 AND "credit" >= 0 AND (("debit" > 0) <> ("credit" > 0)));

-- Cari: bakiye = borç − alacak (önbellek tutarlı); en fazla bir kart bağı ve bağ türle uyumlu.
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_balance_consistent" CHECK ("balance" = "debitTotal" - "creditTotal" AND "debitTotal" >= 0 AND "creditTotal" >= 0);
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_single_link" CHECK (num_nonnulls("agencyId", "supplierId", "eventClientId") <= 1);
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_link_type" CHECK (
  ("type" = 'AGENCY') = ("agencyId" IS NOT NULL)
  AND ("type" = 'SUPPLIER') = ("supplierId" IS NOT NULL)
  AND ("eventClientId" IS NULL OR "type" IN ('COMPANY', 'PERSON'))
);
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_term_range" CHECK ("paymentTermDays" BETWEEN 0 AND 365);

-- Kasa / banka: kasada banka bilgisi olmaz, bankanın adı vardır; para birimi kodu; IBAN otelde tekil.
ALTER TABLE "TreasuryAccount" ADD CONSTRAINT "TreasuryAccount_cash_no_bank" CHECK ("kind" = 'BANK' OR ("bankName" IS NULL AND "iban" IS NULL AND "branch" IS NULL AND "accountNumber" IS NULL));
ALTER TABLE "TreasuryAccount" ADD CONSTRAINT "TreasuryAccount_bank_named" CHECK ("kind" = 'CASH' OR "bankName" IS NOT NULL);
ALTER TABLE "TreasuryAccount" ADD CONSTRAINT "TreasuryAccount_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$');
CREATE UNIQUE INDEX "TreasuryAccount_hotelId_iban_key" ON "TreasuryAccount"("hotelId", "iban") WHERE "iban" IS NOT NULL;

-- Kasa / banka hareketi: sıfır tutar yok; döviz bilgisi ya tam ya hiç.
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_amount_non_zero" CHECK ("amount" <> 0);
ALTER TABLE "TreasuryMovement" ADD CONSTRAINT "TreasuryMovement_fx_complete" CHECK (
  ("originalAmount" IS NULL) = ("originalCurrency" IS NULL) AND ("originalAmount" IS NULL) = ("exchangeRate" IS NULL)
);

-- Eşleme: yalnız kasaya / bankaya giden yöntemler; para birimi boş (hepsi) ya da 3 harf.
ALTER TABLE "TreasuryMapping" ADD CONSTRAINT "TreasuryMapping_method_treasury" CHECK ("method" IN ('CASH', 'CARD', 'TRANSFER', 'VIRTUAL_POS'));
ALTER TABLE "TreasuryMapping" ADD CONSTRAINT "TreasuryMapping_currency_code" CHECK ("currency" = '' OR "currency" ~ '^[A-Z]{3}$');

ALTER TABLE "AccountingSettings" ADD CONSTRAINT "AccountingSettings_threshold_non_negative" CHECK ("paymentApprovalAmount" >= 0);

-- Fiş: türüne göre biçim; onay, işlenme ve iptal izi; hesap başına tek açılış bakiyesi.
ALTER TABLE "AccountingVoucher" ADD CONSTRAINT "AccountingVoucher_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "AccountingVoucher" ADD CONSTRAINT "AccountingVoucher_shape" CHECK (
  ("type" IN ('COLLECTION', 'PAYMENT') AND "ledgerAccountId" IS NOT NULL AND "targetTreasuryAccountId" IS NULL)
  OR ("type" = 'TRANSFER' AND "ledgerAccountId" IS NULL AND "treasuryAccountId" IS NOT NULL AND "targetTreasuryAccountId" IS NOT NULL AND "treasuryAccountId" <> "targetTreasuryAccountId")
  OR ("type" IN ('TREASURY_IN', 'TREASURY_OUT') AND "ledgerAccountId" IS NULL AND "treasuryAccountId" IS NOT NULL AND "targetTreasuryAccountId" IS NULL)
  OR ("type" = 'OPENING' AND num_nonnulls("ledgerAccountId", "treasuryAccountId") = 1 AND "targetTreasuryAccountId" IS NULL)
);
ALTER TABLE "AccountingVoucher" ADD CONSTRAINT "AccountingVoucher_opening_side" CHECK (
  ("type" = 'OPENING' AND "ledgerAccountId" IS NOT NULL) = ("openingSide" IS NOT NULL) AND ("openingSide" IS NULL OR "openingSide" IN ('DEBIT', 'CREDIT'))
);
ALTER TABLE "AccountingVoucher" ADD CONSTRAINT "AccountingVoucher_approval_trail" CHECK ("status" <> 'PENDING_APPROVAL' OR "approvalId" IS NOT NULL);
ALTER TABLE "AccountingVoucher" ADD CONSTRAINT "AccountingVoucher_posted_trail" CHECK ("status" NOT IN ('POSTED', 'VOIDED') OR "postedAt" IS NOT NULL);
ALTER TABLE "AccountingVoucher" ADD CONSTRAINT "AccountingVoucher_void_trail" CHECK (("status" = 'VOIDED') = ("voidedAt" IS NOT NULL AND "voidReason" IS NOT NULL));
CREATE UNIQUE INDEX "AccountingVoucher_one_opening_ledger" ON "AccountingVoucher"("ledgerAccountId") WHERE "type" = 'OPENING' AND "status" <> 'VOIDED' AND "ledgerAccountId" IS NOT NULL;
CREATE UNIQUE INDEX "AccountingVoucher_one_opening_treasury" ON "AccountingVoucher"("treasuryAccountId") WHERE "type" = 'OPENING' AND "status" <> 'VOIDED' AND "treasuryAccountId" IS NOT NULL;

-- Fiş satırı: türüne göre biçim.
ALTER TABLE "AccountingVoucherLine" ADD CONSTRAINT "AccountingVoucherLine_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "AccountingVoucherLine" ADD CONSTRAINT "AccountingVoucherLine_shape" CHECK (
  ("kind" = 'TREASURY' AND "treasuryAccountId" IS NOT NULL AND "instrumentKind" IS NULL)
  OR ("kind" = 'ENDORSE' AND "instrumentId" IS NOT NULL AND "instrumentKind" IS NULL)
  OR ("kind" IN ('CHEQUE_IN', 'CHEQUE_OUT') AND "instrumentKind" IS NOT NULL AND "number" IS NOT NULL AND "dueDate" IS NOT NULL)
);

-- Çek / senet: durum yönle uyumlu, ciro / tahsil izi; numara (iptal edilmemiş) tekil.
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_status_direction" CHECK (
  ("direction" = 'RECEIVED' AND "status" IN ('PORTFOLIO', 'AT_BANK', 'COLLECTED', 'ENDORSED', 'BOUNCED', 'RETURNED', 'CANCELLED'))
  OR ("direction" = 'ISSUED' AND "status" IN ('OUTSTANDING', 'PAID', 'BOUNCED', 'RETURNED', 'CANCELLED'))
);
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_endorse_trail" CHECK ("status" <> 'ENDORSED' OR "endorsedToAccountId" IS NOT NULL);
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_at_bank_trail" CHECK ("status" <> 'AT_BANK' OR "treasuryAccountId" IS NOT NULL);
-- Verdiğimiz çekin vadesi düzenleme gününden önce olamaz; müşteriden vadesi geçmiş çek alınabilir.
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_due_after_issue" CHECK ("direction" = 'RECEIVED' OR "dueDate" >= "issueDate");
CREATE UNIQUE INDEX "Instrument_number_key" ON "Instrument"("hotelId", "direction", "kind", COALESCE("bankName", ''), "number") WHERE "status" <> 'CANCELLED';
