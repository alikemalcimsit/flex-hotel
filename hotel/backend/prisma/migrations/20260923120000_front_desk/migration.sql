-- Modül 6: Check-in / check-out.
--
-- Rezervasyona giriş / çıkış izi (kim, ne zaman), erken giriş ve geç çıkış
-- ücreti, araç plakası, teminat ve bakiyesi kapanmadan çıkışın gerekçesi;
-- otele ücret ve kimlik politikaları; misafire kimlik belgesi türü. Folyo
-- tablolarına çıkıştaki bakiye sorgusu için index'ler.

-- CreateEnum
CREATE TYPE "StayFeeMode" AS ENUM ('NONE', 'FIXED', 'PERCENT_OF_NIGHT');

-- CreateEnum
CREATE TYPE "IdentityPolicy" AS ENUM ('PRIMARY_GUEST', 'ALL_ADULTS');

-- CreateEnum
CREATE TYPE "IdDocumentType" AS ENUM ('NATIONAL_ID', 'PASSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "DepositMethod" AS ENUM ('NONE', 'CASH', 'CARD_PREAUTH', 'TRANSFER');

-- AlterEnum
ALTER TYPE "StaffAlertKind" ADD VALUE 'CHECKOUT_OPEN_BALANCE';

-- AlterTable
ALTER TABLE "Guest" ADD COLUMN     "idType" "IdDocumentType";

-- AlterTable
ALTER TABLE "Hotel" ADD COLUMN     "checkInIdentityPolicy" "IdentityPolicy" NOT NULL DEFAULT 'PRIMARY_GUEST',
ADD COLUMN     "earlyCheckInFeeMode" "StayFeeMode" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "earlyCheckInFeeValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "lateCheckOutFeeMode" "StayFeeMode" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "lateCheckOutFeeValue" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "checkedInAt" TIMESTAMP(3),
ADD COLUMN     "checkedInBy" TEXT,
ADD COLUMN     "checkedOutAt" TIMESTAMP(3),
ADD COLUMN     "checkedOutBy" TEXT,
ADD COLUMN     "checkoutOpenBalance" DECIMAL(12,2),
ADD COLUMN     "depositAmount" DECIMAL(12,2),
ADD COLUMN     "depositMethod" "DepositMethod",
ADD COLUMN     "depositReference" TEXT,
ADD COLUMN     "earlyCheckInFee" DECIMAL(12,2),
ADD COLUMN     "lateCheckOutFee" DECIMAL(12,2),
ADD COLUMN     "openBalanceReason" TEXT,
ADD COLUMN     "vehiclePlate" TEXT;

-- CreateIndex
CREATE INDEX "Folio_hotelId_reservationId_idx" ON "Folio"("hotelId", "reservationId");

-- CreateIndex
CREATE INDEX "FolioItem_folioId_idx" ON "FolioItem"("folioId");

-- CreateIndex
CREATE INDEX "Guest_hotelId_idNumber_idx" ON "Guest"("hotelId", "idNumber");

-- CreateIndex
CREATE INDEX "Payment_folioId_idx" ON "Payment"("folioId");

-- CreateIndex
CREATE INDEX "Reservation_hotelId_status_checkOut_id_idx" ON "Reservation"("hotelId", "status", "checkOut", "id");

-- CreateIndex
CREATE INDEX "Reservation_hotelId_checkedInAt_idx" ON "Reservation"("hotelId", "checkedInAt");

-- CreateIndex
CREATE INDEX "Reservation_hotelId_checkedOutAt_idx" ON "Reservation"("hotelId", "checkedOutAt");


-- Var olan konaklamalar: giriş / çıkış anı bilinmiyor; planlanan tarihler yazılır
-- (aşağıdaki kısıtlar içerideki ve çıkmış kayıtta bu alanları zorunlu kılıyor).
UPDATE "Reservation" SET "checkedInAt" = "checkIn", "checkedInBy" = 'system'
WHERE "status" IN ('CHECKED_IN', 'CHECKED_OUT') AND "checkedInAt" IS NULL;
UPDATE "Reservation" SET "checkedOutAt" = "checkOut", "checkedOutBy" = 'system'
WHERE "status" = 'CHECKED_OUT' AND "checkedOutAt" IS NULL;

ALTER TABLE "Reservation"
  -- İçerideki misafirin giriş anı, çıkmış misafirin iki anı da vardır.
  ADD CONSTRAINT "Reservation_stay_times_valid" CHECK (
    ("status" <> 'CHECKED_IN' OR "checkedInAt" IS NOT NULL)
    AND ("status" <> 'CHECKED_OUT' OR ("checkedInAt" IS NOT NULL AND "checkedOutAt" IS NOT NULL))
  ),
  ADD CONSTRAINT "Reservation_stay_fees_valid" CHECK (
    ("earlyCheckInFee" IS NULL OR "earlyCheckInFee" >= 0) AND ("lateCheckOutFee" IS NULL OR "lateCheckOutFee" >= 0)
  ),
  -- Teminat: yöntem seçildiyse tutar pozitif; "yok" ise tutar yok.
  ADD CONSTRAINT "Reservation_deposit_valid" CHECK (
    (("depositMethod" IS NULL OR "depositMethod" = 'NONE') AND "depositAmount" IS NULL)
    OR ("depositMethod" <> 'NONE' AND "depositAmount" > 0)
  ),
  -- Bakiyesi kapanmadan çıkış gerekçesiz yazılamaz.
  ADD CONSTRAINT "Reservation_open_balance_has_reason" CHECK ("checkoutOpenBalance" IS NULL OR "openBalanceReason" IS NOT NULL);

ALTER TABLE "Hotel"
  ADD CONSTRAINT "Hotel_stay_fees_valid" CHECK (
    "earlyCheckInFeeValue" >= 0 AND "lateCheckOutFeeValue" >= 0
    AND ("earlyCheckInFeeMode" <> 'PERCENT_OF_NIGHT' OR "earlyCheckInFeeValue" <= 100)
    AND ("lateCheckOutFeeMode" <> 'PERCENT_OF_NIGHT' OR "lateCheckOutFeeValue" <= 100)
  );
