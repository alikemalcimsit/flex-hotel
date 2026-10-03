-- Modül 17: Ödeme alma.
--
-- Ödeme satırı: tür (tahsilat / iade / iptal kaydı), durum (onay bekliyor /
-- işlendi / reddedildi), kaynak (resepsiyon / ön ödeme / giriş teminatı),
-- folyoya giren tutar (kurla çevrilmiş), kasanın günü, tekrar işleme anahtarı,
-- iptal (ters kayıt) izi. Yeni tablo: günlük döviz kuru. Otel: büyük ödeme eşiği.
--
-- Eski kayıtlar: bu modülden önce ödeme yazan bir servis yoktu; var olan
-- satırlar (varsa) test / demo verisidir. Silinmez; yeni kolonlar önce boş
-- eklenir, eski satırlardan doldurulur (işlenmiş tahsilat, alındığı an), sonra
-- zorunlu yapılır.

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('PAYMENT', 'REFUND', 'REVERSAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'POSTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('DESK', 'ADVANCE', 'CHECK_IN_DEPOSIT');

-- ─────────────── Otel ───────────────

ALTER TABLE "Hotel" ADD COLUMN "largePaymentThreshold" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- ─────────────── Ödeme ───────────────

-- DropIndex
DROP INDEX "Payment_folioId_idx";

ALTER TABLE "Payment" ADD COLUMN "businessDate" DATE,
ADD COLUMN "declinedAt" TIMESTAMP(3),
ADD COLUMN "folioAmount" DECIMAL(12,2),
ADD COLUMN "kind" "PaymentKind" NOT NULL DEFAULT 'PAYMENT',
ADD COLUMN "note" TEXT,
ADD COLUMN "postedAt" TIMESTAMP(3),
ADD COLUMN "reservationId" TEXT,
ADD COLUMN "reversalOfId" TEXT,
ADD COLUMN "source" "PaymentSource" NOT NULL DEFAULT 'DESK',
ADD COLUMN "sourceKey" TEXT,
ADD COLUMN "status" "PaymentStatus" NOT NULL DEFAULT 'POSTED',
ADD COLUMN "voidApprovalId" TEXT,
ADD COLUMN "voidReason" TEXT,
ADD COLUMN "voidRequestedAt" TIMESTAMP(3),
ADD COLUMN "voidRequestedBy" TEXT,
ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "voidedBy" TEXT;

-- Eski satırlar: konaklama folyodan, işlenmiş tahsilat (eksi tutarlıysa iade),
-- folyo tutarı = ROUND(tutar × kur, 2), kasanın günü alındığı anın otel günü.
UPDATE "Payment" p
SET "reservationId" = f."reservationId",
    "kind" = CASE WHEN p."amount" < 0 THEN 'REFUND'::"PaymentKind" ELSE 'PAYMENT'::"PaymentKind" END,
    "folioAmount" = ROUND(p."amount" * COALESCE(p."exchangeRate", 1), 2),
    "businessDate" = ((p."receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE h."timezone")::date,
    "postedAt" = p."receivedAt"
FROM "Folio" f
JOIN "Hotel" h ON h."id" = f."hotelId"
WHERE f."id" = p."folioId";

ALTER TABLE "Payment" ALTER COLUMN "reservationId" SET NOT NULL,
ALTER COLUMN "folioAmount" SET NOT NULL,
ALTER COLUMN "businessDate" SET NOT NULL;

-- ─────────────── Döviz kuru ───────────────

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "rate" DECIMAL(12,6) NOT NULL,
    "enteredBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- ─────────────── Index'ler ───────────────

-- CreateIndex (günün kurları ve geçmiş)
CREATE INDEX "ExchangeRate_hotelId_date_idx" ON "ExchangeRate"("hotelId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_hotelId_currency_date_key" ON "ExchangeRate"("hotelId", "currency", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reversalOfId_key" ON "Payment"("reversalOfId");

-- CreateIndex (folyonun ödemeleri, imleçli)
CREATE INDEX "Payment_folioId_receivedAt_id_idx" ON "Payment"("folioId", "receivedAt", "id");

-- CreateIndex (kasa: günün hareketleri ve toplamları)
CREATE INDEX "Payment_hotelId_businessDate_postedAt_id_idx" ON "Payment"("hotelId", "businessDate", "postedAt", "id");

-- CreateIndex (onay bekleyenler)
CREATE INDEX "Payment_hotelId_status_receivedAt_idx" ON "Payment"("hotelId", "status", "receivedAt");

-- CreateIndex (konaklamanın giriş teminatı)
CREATE INDEX "Payment_reservationId_source_idx" ON "Payment"("reservationId", "source");

-- CreateIndex
CREATE INDEX "Payment_approvalId_idx" ON "Payment"("approvalId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_hotelId_sourceKey_key" ON "Payment"("hotelId", "sourceKey");

-- ─────────────── Yabancı anahtarlar ───────────────

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────── Kısıtlar (servisin kontrolüne ek, son savunma hattı) ───────────────

ALTER TABLE "Hotel" ADD CONSTRAINT "Hotel_large_payment_threshold_nonnegative" CHECK ("largePaymentThreshold" >= 0);

-- Tutarın işareti türüne uyar: tahsilat artı, iade eksi, iptal kaydı sıfır değil.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_sign"
  CHECK (("kind" = 'PAYMENT' AND "amount" > 0) OR ("kind" = 'REFUND' AND "amount" < 0) OR ("kind" = 'REVERSAL' AND "amount" <> 0));
-- Folyoya giren tutar kurla tutarlı ve sıfır değil (kuruş kaybolmaz, işaret korunur).
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_folio_amount_consistent"
  CHECK ("folioAmount" = ROUND("amount" * COALESCE("exchangeRate", 1), 2) AND "folioAmount" <> 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_rate_positive" CHECK ("exchangeRate" IS NULL OR "exchangeRate" > 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$');
-- İptal kaydı yalnızca bir asıl satıra bağlıdır.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reversal_link" CHECK (("kind" = 'REVERSAL') = ("reversalOfId" IS NOT NULL));
-- Durum izleri: işlendiyse işlenme anı, reddedildiyse ret anı var.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_posted_has_time" CHECK (("status" = 'POSTED') = ("postedAt" IS NOT NULL));
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_declined_has_time" CHECK (("status" = 'DECLINED') = ("declinedAt" IS NOT NULL));
-- Onaysız iade ve onaysız bekleyen satır olamaz (kendine iade yazmanın son engeli).
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_refund_approved" CHECK ("kind" <> 'REFUND' OR "approvalId" IS NOT NULL);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_pending_has_approval" CHECK ("status" <> 'PENDING' OR "approvalId" IS NOT NULL);
-- İptal ve iptal isteği izleri eksiksiz.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_void_trail" CHECK (("voidedAt" IS NULL) = ("voidedBy" IS NULL));
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_void_request_trail"
  CHECK (("voidRequestedAt" IS NULL) = ("voidRequestedBy" IS NULL) AND ("voidRequestedAt" IS NULL OR "voidApprovalId" IS NOT NULL));

ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_rate_positive" CHECK ("rate" > 0);
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$');
