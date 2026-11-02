-- Fatura ve e-belge (modül 16 çekirdeği + modül 49).
--
-- Eski taslak "Invoice" tablosu (ilk iskeletten; hiçbir kod yazmıyordu) yeniden kurulur. Satır varsa migration
-- durur: veri sessizce kaybolmasın, elle taşınsın.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Invoice") THEN
    RAISE EXCEPTION 'Invoice tablosunda satır var; modül 49 migration''ı eski faturaları taşımaz (önce elle aktarın)';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "InvoiceSource" AS ENUM ('FOLIO', 'EVENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "InvoiceDocumentType" AS ENUM ('E_FATURA', 'E_ARSIV');

-- CreateEnum
CREATE TYPE "InvoiceBuyerType" AS ENUM ('PERSON', 'COMPANY', 'FOREIGN');

-- CreateEnum
CREATE TYPE "EDocumentState" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'REJECTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TestTaxpayerBehavior" AS ENUM ('ACCEPT', 'REJECT', 'NO_MAILBOX', 'UNAVAILABLE');

-- AlterEnum
BEGIN;
CREATE TYPE "InvoiceStatus_new" AS ENUM ('DRAFT', 'ISSUED', 'CANCEL_PENDING', 'CANCELLED');
ALTER TABLE "public"."Invoice" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Invoice" ALTER COLUMN "status" TYPE "InvoiceStatus_new" USING ("status"::text::"InvoiceStatus_new");
ALTER TYPE "InvoiceStatus" RENAME TO "InvoiceStatus_old";
ALTER TYPE "InvoiceStatus_new" RENAME TO "InvoiceStatus";
DROP TYPE "public"."InvoiceStatus_old";
ALTER TABLE "Invoice" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- DropIndex
DROP INDEX "Invoice_number_key";

-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "deletedAt",
DROP COLUMN "eInvoiceUuid",
DROP COLUMN "taxAmount",
DROP COLUMN "totalAmount",
ADD COLUMN     "buyer" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "buyerName" TEXT,
ADD COLUMN     "buyerTaxNumber" TEXT,
ADD COLUMN     "buyerType" "InvoiceBuyerType",
ADD COLUMN     "cancelApprovalId" TEXT,
ADD COLUMN     "cancelMethod" TEXT,
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelReference" TEXT,
ADD COLUMN     "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN     "cancelRequestedBy" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "createdBy" TEXT NOT NULL,
ADD COLUMN     "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "documentType" "InvoiceDocumentType",
ADD COLUMN     "edocAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "edocCheckedAt" TIMESTAMP(3),
ADD COLUMN     "edocChecks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "edocCompletedAt" TIMESTAMP(3),
ADD COLUMN     "edocEnvironment" TEXT,
ADD COLUMN     "edocLockedAt" TIMESTAMP(3),
ADD COLUMN     "edocMessage" TEXT,
ADD COLUMN     "edocNextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "edocProvider" TEXT,
ADD COLUMN     "edocProviderRef" TEXT,
ADD COLUMN     "edocSentAt" TIMESTAMP(3),
ADD COLUMN     "edocState" "EDocumentState",
ADD COLUMN     "edocStatusCode" TEXT,
ADD COLUMN     "eventId" TEXT,
ADD COLUMN     "exchangeRate" DECIMAL(12,6),
ADD COLUMN     "grossTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "guestId" TEXT,
ADD COLUMN     "issueDate" DATE,
ADD COLUMN     "issuedBy" TEXT,
ADD COLUMN     "ledgerAccountId" TEXT,
ADD COLUMN     "netTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "receiverAlias" TEXT,
ADD COLUMN     "serviceFrom" DATE,
ADD COLUMN     "serviceTo" DATE,
ADD COLUMN     "source" "InvoiceSource" NOT NULL,
ADD COLUMN     "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxes" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "uuid" TEXT NOT NULL,
ALTER COLUMN "folioId" DROP NOT NULL,
ALTER COLUMN "number" DROP NOT NULL,
ALTER COLUMN "issuedAt" DROP NOT NULL,
ALTER COLUMN "issuedAt" DROP DEFAULT,
ALTER COLUMN "currency" DROP DEFAULT;

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitCode" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "taxes" JSONB NOT NULL DEFAULT '[]',
    "serviceFrom" DATE,
    "serviceTo" DATE,
    "taxCategory" TEXT,
    "unitAmount" DECIMAL(14,2),

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceDocument" (
    "invoiceId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "xml" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceDocument_pkey" PRIMARY KEY ("invoiceId")
);

-- CreateTable
CREATE TABLE "InvoiceLog" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" "EDocumentState",
    "code" TEXT,
    "message" TEXT,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceSettings" (
    "hotelId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "taxNumber" TEXT NOT NULL,
    "taxOffice" TEXT NOT NULL,
    "mersisNo" TEXT,
    "tradeRegistryNo" TEXT,
    "street" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Türkiye',
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "eFaturaPrefix" TEXT NOT NULL,
    "eArsivPrefix" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'TEST',
    "environment" TEXT NOT NULL DEFAULT 'TEST',
    "senderAlias" TEXT,
    "autoDraft" BOOLEAN NOT NULL DEFAULT true,
    "footerNote" TEXT,
    "bankInfo" TEXT,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceSettings_pkey" PRIMARY KEY ("hotelId")
);

-- CreateTable
CREATE TABLE "InvoiceTaxCode" (
    "hotelId" TEXT NOT NULL,
    "taxId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceTaxCode_pkey" PRIMARY KEY ("hotelId","taxId")
);

-- CreateTable
CREATE TABLE "InvoiceSequence" (
    "hotelId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("hotelId","prefix","year")
);

-- CreateTable
CREATE TABLE "TestTaxpayer" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "taxNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "behavior" "TestTaxpayerBehavior" NOT NULL DEFAULT 'ACCEPT',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestTaxpayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxpayerLookup" (
    "hotelId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "taxNumber" TEXT NOT NULL,
    "registered" BOOLEAN NOT NULL,
    "title" TEXT,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checkedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxpayerLookup_pkey" PRIMARY KEY ("hotelId","provider","taxNumber")
);

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_sortOrder_idx" ON "InvoiceLine"("invoiceId", "sortOrder");

-- CreateIndex
CREATE INDEX "InvoiceLog_invoiceId_createdAt_idx" ON "InvoiceLog"("invoiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceTaxCode_taxId_key" ON "InvoiceTaxCode"("taxId");

-- CreateIndex
CREATE UNIQUE INDEX "TestTaxpayer_hotelId_taxNumber_key" ON "TestTaxpayer"("hotelId", "taxNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_uuid_key" ON "Invoice"("uuid");

-- CreateIndex
CREATE INDEX "Invoice_hotelId_issueDate_issuedAt_id_idx" ON "Invoice"("hotelId", "issueDate" DESC, "issuedAt" DESC, "id");

-- CreateIndex
CREATE INDEX "Invoice_hotelId_status_createdAt_idx" ON "Invoice"("hotelId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_hotelId_edocState_issueDate_idx" ON "Invoice"("hotelId", "edocState", "issueDate");

-- CreateIndex
CREATE INDEX "Invoice_hotelId_buyerTaxNumber_idx" ON "Invoice"("hotelId", "buyerTaxNumber");

-- CreateIndex
CREATE INDEX "Invoice_folioId_idx" ON "Invoice"("folioId");

-- CreateIndex
CREATE INDEX "Invoice_eventId_idx" ON "Invoice"("eventId");

-- CreateIndex
CREATE INDEX "Invoice_ledgerAccountId_issueDate_idx" ON "Invoice"("ledgerAccountId", "issueDate");

-- CreateIndex
CREATE INDEX "Invoice_guestId_issuedAt_idx" ON "Invoice"("guestId", "issuedAt");

-- CreateIndex
CREATE INDEX "Invoice_buyerName_trgm_idx" ON "Invoice" USING GIN ("buyerName" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_hotelId_number_key" ON "Invoice"("hotelId", "number");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceDocument" ADD CONSTRAINT "InvoiceDocument_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLog" ADD CONSTRAINT "InvoiceLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceSettings" ADD CONSTRAINT "InvoiceSettings_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceTaxCode" ADD CONSTRAINT "InvoiceTaxCode_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceTaxCode" ADD CONSTRAINT "InvoiceTaxCode_taxId_fkey" FOREIGN KEY ("taxId") REFERENCES "Tax"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestTaxpayer" ADD CONSTRAINT "TestTaxpayer_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────── Kısıtlar (Prisma şemada ifade edemiyor) ───────────────

-- Kaynak bağı: folyo faturası folyoya, etkinlik faturası etkinliğe, serbest fatura cariye bağlı.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_source_link" CHECK (
  ("source" = 'FOLIO' AND "folioId" IS NOT NULL AND "eventId" IS NULL)
  OR ("source" = 'EVENT' AND "eventId" IS NOT NULL AND "folioId" IS NULL)
  OR ("source" = 'MANUAL' AND "folioId" IS NULL AND "eventId" IS NULL AND "ledgerAccountId" IS NOT NULL)
);
-- Taslağın numarası ve e-belgesi yoktur; kesilmiş faturanın numarası, türü, günü, alıcısı ve e-belge durumu vardır.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_draft_unnumbered" CHECK ("status" <> 'DRAFT' OR ("number" IS NULL AND "edocState" IS NULL AND "documentType" IS NULL));
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_issued_trail" CHECK (
  "status" = 'DRAFT'
  OR ("number" IS NOT NULL AND "documentType" IS NOT NULL AND "issueDate" IS NOT NULL AND "issuedAt" IS NOT NULL AND "buyerType" IS NOT NULL AND "edocState" IS NOT NULL)
);
-- GİB numarası: 3 karakter seri + 4 hane yıl + 9 hane sıra.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_number_format" CHECK ("number" IS NULL OR "number" ~ '^[A-Z0-9]{3}[0-9]{13}$');
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_cancel_pending_trail" CHECK ("status" <> 'CANCEL_PENDING' OR ("cancelApprovalId" IS NOT NULL AND "cancelRequestedAt" IS NOT NULL));
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_cancelled_trail" CHECK ("status" <> 'CANCELLED' OR ("cancelledAt" IS NOT NULL AND "cancelMethod" IN ('LOCAL', 'INTEGRATOR', 'PORTAL')));
-- Toplamlar: net = brüt − iskonto, toplam = net + vergi; eksi tutar yok (e-faturada eksi satır olmaz).
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_totals" CHECK (
  "grossTotal" >= 0 AND "discountTotal" >= 0 AND "taxTotal" >= 0
  AND "netTotal" = "grossTotal" - "discountTotal" AND "netTotal" >= 0 AND "total" = "netTotal" + "taxTotal"
);
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_amounts" CHECK (
  "quantity" > 0 AND "unitPrice" >= 0 AND "grossAmount" >= 0 AND "discountAmount" >= 0 AND "taxAmount" >= 0
  AND "netAmount" = "grossAmount" - "discountAmount" AND "netAmount" >= 0 AND "total" = "netAmount" + "taxAmount"
);
ALTER TABLE "InvoiceSettings" ADD CONSTRAINT "InvoiceSettings_prefixes" CHECK (
  "eFaturaPrefix" ~ '^[A-Z0-9]{3}$' AND "eArsivPrefix" ~ '^[A-Z0-9]{3}$' AND "eFaturaPrefix" <> "eArsivPrefix"
);
ALTER TABLE "InvoiceSettings" ADD CONSTRAINT "InvoiceSettings_environment" CHECK ("environment" IN ('TEST', 'LIVE') AND NOT ("environment" = 'LIVE' AND "provider" = 'TEST'));
ALTER TABLE "InvoiceSequence" ADD CONSTRAINT "InvoiceSequence_range" CHECK ("last" >= 1 AND "last" <= 999999999 AND "prefix" ~ '^[A-Z0-9]{3}$');
ALTER TABLE "InvoiceTaxCode" ADD CONSTRAINT "InvoiceTaxCode_code" CHECK ("code" IN ('0015', '0059'));

-- Folyo ve etkinlik başına en fazla bir geçerli (iptal edilmemiş) fatura: aynı folyo iki kez faturalanamaz.
CREATE UNIQUE INDEX "Invoice_folio_active_key" ON "Invoice"("folioId") WHERE "folioId" IS NOT NULL AND "status" <> 'CANCELLED';
CREATE UNIQUE INDEX "Invoice_event_active_key" ON "Invoice"("eventId") WHERE "eventId" IS NOT NULL AND "status" <> 'CANCELLED';

-- e-belge kuyruğu: sırası gelen (gönderici), sonucu beklenen (durum sorgusu), takılı kalan (kurtarıcı). Kesilmiş
-- faturaların çoğu tamamlanmış durumdadır; kısmi index'ler yalnız iş bekleyenleri taşır.
CREATE INDEX "Invoice_edoc_queue_idx" ON "Invoice"("edocNextAttemptAt") WHERE "edocState" = 'QUEUED' AND "status" = 'ISSUED';
CREATE INDEX "Invoice_edoc_poll_idx" ON "Invoice"("edocCheckedAt" NULLS FIRST, "id") WHERE "edocState" = 'SENT';
CREATE INDEX "Invoice_edoc_sending_idx" ON "Invoice"("edocLockedAt") WHERE "edocState" = 'SENDING';
