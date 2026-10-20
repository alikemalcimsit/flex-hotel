-- Modül 39: restoran POS ve menü (modül 38'in menü kısmı): satış noktası, masa, menü grubu / ürünü,
-- POS politikası, numara serisi, garson vardiyası, adisyon, sipariş turu, kalem, düzeltme (ikram / iptal /
-- indirim), ödeme, odaya yazma. Tablolar Prisma'nın ürettiği; altta veritabanı kuralları (CHECK, kısmi
-- tekil index) elle.

-- Personel uyarısı türü
ALTER TYPE "StaffAlertKind" ADD VALUE IF NOT EXISTS 'POS';

-- CreateEnum
CREATE TYPE "PosStation" AS ENUM ('HOT', 'COLD', 'BAR', 'PASTRY', 'NONE');

-- CreateEnum
CREATE TYPE "PosCheckStatus" AS ENUM ('OPEN', 'CLOSED', 'VOID');

-- CreateEnum
CREATE TYPE "PosOrderStatus" AS ENUM ('NEW', 'PREPARING', 'READY', 'SERVED');

-- CreateEnum
CREATE TYPE "PosAdjustmentKind" AS ENUM ('COMP', 'VOID', 'DISCOUNT');

-- CreateEnum
CREATE TYPE "PosAdjustmentStatus" AS ENUM ('APPLIED', 'PENDING', 'DECLINED');

-- CreateEnum
CREATE TYPE "PosShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "PosOutlet" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "allowRoomCharge" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosOutlet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosTable" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 4,
    "zone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuCategory" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "outletIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "taxCategory" TEXT NOT NULL DEFAULT 'FNB',
    "station" "PosStation" NOT NULL DEFAULT 'HOT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "soldOut" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosSettings" (
    "hotelId" TEXT NOT NULL,
    "adjustmentApprovalAmount" DECIMAL(12,2) NOT NULL DEFAULT 1000,
    "cashVarianceAlert" DECIMAL(12,2) NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosSettings_pkey" PRIMARY KEY ("hotelId")
);

-- CreateTable
CREATE TABLE "PosSequence" (
    "hotelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "PosSequence_pkey" PRIMARY KEY ("hotelId","kind","year")
);

-- CreateTable
CREATE TABLE "PosShift" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "waiterEmail" TEXT NOT NULL,
    "outletId" TEXT,
    "status" "PosShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openingFloat" DECIMAL(12,2) NOT NULL,
    "businessDate" DATE NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "countedCash" DECIMAL(12,2),
    "expectedCash" DECIMAL(12,2),
    "variance" DECIMAL(12,2),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosCheck" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "tableId" TEXT,
    "number" TEXT NOT NULL,
    "status" "PosCheckStatus" NOT NULL DEFAULT 'OPEN',
    "covers" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "waiterEmail" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "sourceKey" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedBy" TEXT NOT NULL,
    "billRequestedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "businessDate" DATE,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedBy" TEXT,
    "reopenReason" TEXT,
    "splitFromId" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "compTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "voidTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountPct" DECIMAL(5,2),
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "roomChargeTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosOrder" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "status" "PosOrderStatus" NOT NULL DEFAULT 'NEW',
    "sourceKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosOrderLine" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "station" "PosStation" NOT NULL,
    "taxCategory" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "voidedQuantity" INTEGER NOT NULL DEFAULT 0,
    "compedQuantity" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "businessDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosAdjustment" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "kind" "PosAdjustmentKind" NOT NULL,
    "lineId" TEXT,
    "quantity" INTEGER,
    "waste" BOOLEAN NOT NULL DEFAULT false,
    "discountPct" DECIMAL(5,2),
    "discountAmount" DECIMAL(14,2),
    "value" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "PosAdjustmentStatus" NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvalId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosPayment" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'PAYMENT',
    "status" "PaymentStatus" NOT NULL DEFAULT 'POSTED',
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "reference" TEXT,
    "sourceKey" TEXT,
    "receivedBy" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMP(3),
    "approvalId" TEXT,
    "declinedAt" TIMESTAMP(3),
    "reversalOfId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,
    "voidApprovalId" TEXT,
    "voidRequestedAt" TIMESTAMP(3),
    "voidRequestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosRoomCharge" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "roomNumber" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "eventId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "chargedBy" TEXT NOT NULL,
    "chargedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosRoomCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosOutlet_hotelId_isActive_sortOrder_idx" ON "PosOutlet"("hotelId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PosOutlet_hotelId_code_key" ON "PosOutlet"("hotelId", "code");

-- CreateIndex
CREATE INDEX "PosTable_hotelId_outletId_sortOrder_idx" ON "PosTable"("hotelId", "outletId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PosTable_outletId_name_key" ON "PosTable"("outletId", "name");

-- CreateIndex
CREATE INDEX "MenuCategory_hotelId_sortOrder_idx" ON "MenuCategory"("hotelId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "MenuCategory_hotelId_name_key" ON "MenuCategory"("hotelId", "name");

-- CreateIndex
CREATE INDEX "MenuItem_hotelId_categoryId_sortOrder_idx" ON "MenuItem"("hotelId", "categoryId", "sortOrder");

-- CreateIndex
CREATE INDEX "MenuItem_name_trgm_idx" ON "MenuItem" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_hotelId_code_key" ON "MenuItem"("hotelId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_categoryId_name_key" ON "MenuItem"("categoryId", "name");

-- CreateIndex
CREATE INDEX "PosShift_hotelId_status_waiterEmail_idx" ON "PosShift"("hotelId", "status", "waiterEmail");

-- CreateIndex
CREATE INDEX "PosShift_hotelId_openedAt_id_idx" ON "PosShift"("hotelId", "openedAt", "id");

-- CreateIndex
CREATE INDEX "PosShift_hotelId_waiterEmail_openedAt_idx" ON "PosShift"("hotelId", "waiterEmail", "openedAt");

-- CreateIndex
CREATE INDEX "PosCheck_hotelId_status_outletId_tableId_idx" ON "PosCheck"("hotelId", "status", "outletId", "tableId");

-- CreateIndex
CREATE INDEX "PosCheck_hotelId_openedAt_id_idx" ON "PosCheck"("hotelId", "openedAt", "id");

-- CreateIndex
CREATE INDEX "PosCheck_tableId_openedAt_idx" ON "PosCheck"("tableId", "openedAt");

-- CreateIndex
CREATE INDEX "PosCheck_number_trgm_idx" ON "PosCheck" USING GIN ("number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "PosCheck_hotelId_businessDate_outletId_idx" ON "PosCheck"("hotelId", "businessDate", "outletId");

-- CreateIndex
CREATE INDEX "PosCheck_shiftId_status_idx" ON "PosCheck"("shiftId", "status");

-- CreateIndex
CREATE INDEX "PosCheck_hotelId_waiterEmail_status_idx" ON "PosCheck"("hotelId", "waiterEmail", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PosCheck_hotelId_number_key" ON "PosCheck"("hotelId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PosCheck_hotelId_sourceKey_key" ON "PosCheck"("hotelId", "sourceKey");

-- CreateIndex
CREATE INDEX "PosOrder_hotelId_outletId_status_sentAt_idx" ON "PosOrder"("hotelId", "outletId", "status", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "PosOrder_hotelId_sourceKey_key" ON "PosOrder"("hotelId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "PosOrder_checkId_seq_key" ON "PosOrder"("checkId", "seq");

-- CreateIndex
CREATE INDEX "PosOrderLine_checkId_sortOrder_idx" ON "PosOrderLine"("checkId", "sortOrder");

-- CreateIndex
CREATE INDEX "PosOrderLine_orderId_idx" ON "PosOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "PosOrderLine_hotelId_businessDate_idx" ON "PosOrderLine"("hotelId", "businessDate");

-- CreateIndex
CREATE INDEX "PosAdjustment_checkId_status_idx" ON "PosAdjustment"("checkId", "status");

-- CreateIndex
CREATE INDEX "PosAdjustment_approvalId_idx" ON "PosAdjustment"("approvalId");

-- CreateIndex
CREATE INDEX "PosAdjustment_hotelId_kind_requestedAt_idx" ON "PosAdjustment"("hotelId", "kind", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PosPayment_reversalOfId_key" ON "PosPayment"("reversalOfId");

-- CreateIndex
CREATE INDEX "PosPayment_checkId_receivedAt_id_idx" ON "PosPayment"("checkId", "receivedAt", "id");

-- CreateIndex
CREATE INDEX "PosPayment_hotelId_businessDate_postedAt_id_idx" ON "PosPayment"("hotelId", "businessDate", "postedAt", "id");

-- CreateIndex
CREATE INDEX "PosPayment_hotelId_status_receivedAt_idx" ON "PosPayment"("hotelId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "PosPayment_shiftId_method_idx" ON "PosPayment"("shiftId", "method");

-- CreateIndex
CREATE INDEX "PosPayment_approvalId_idx" ON "PosPayment"("approvalId");

-- CreateIndex
CREATE INDEX "PosPayment_voidApprovalId_idx" ON "PosPayment"("voidApprovalId");

-- CreateIndex
CREATE UNIQUE INDEX "PosPayment_hotelId_sourceKey_key" ON "PosPayment"("hotelId", "sourceKey");

-- CreateIndex
CREATE INDEX "PosRoomCharge_checkId_idx" ON "PosRoomCharge"("checkId");

-- CreateIndex
CREATE INDEX "PosRoomCharge_hotelId_businessDate_idx" ON "PosRoomCharge"("hotelId", "businessDate");

-- CreateIndex
CREATE INDEX "PosRoomCharge_reservationId_idx" ON "PosRoomCharge"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "PosRoomCharge_hotelId_sourceKey_key" ON "PosRoomCharge"("hotelId", "sourceKey");

-- AddForeignKey
ALTER TABLE "PosOutlet" ADD CONSTRAINT "PosOutlet_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTable" ADD CONSTRAINT "PosTable_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "PosOutlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuCategory" ADD CONSTRAINT "MenuCategory_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MenuCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosSettings" ADD CONSTRAINT "PosSettings_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "PosOutlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCheck" ADD CONSTRAINT "PosCheck_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCheck" ADD CONSTRAINT "PosCheck_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "PosOutlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCheck" ADD CONSTRAINT "PosCheck_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "PosTable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCheck" ADD CONSTRAINT "PosCheck_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "PosShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosCheck" ADD CONSTRAINT "PosCheck_splitFromId_fkey" FOREIGN KEY ("splitFromId") REFERENCES "PosCheck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "PosCheck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "PosOutlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrderLine" ADD CONSTRAINT "PosOrderLine_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "PosCheck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrderLine" ADD CONSTRAINT "PosOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PosOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrderLine" ADD CONSTRAINT "PosOrderLine_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosAdjustment" ADD CONSTRAINT "PosAdjustment_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "PosCheck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosAdjustment" ADD CONSTRAINT "PosAdjustment_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PosOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosAdjustment" ADD CONSTRAINT "PosAdjustment_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "Approval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPayment" ADD CONSTRAINT "PosPayment_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPayment" ADD CONSTRAINT "PosPayment_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "PosCheck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPayment" ADD CONSTRAINT "PosPayment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "PosShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPayment" ADD CONSTRAINT "PosPayment_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "Approval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPayment" ADD CONSTRAINT "PosPayment_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "PosPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosRoomCharge" ADD CONSTRAINT "PosRoomCharge_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "PosCheck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosRoomCharge" ADD CONSTRAINT "PosRoomCharge_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────── Veritabanı kuralları (elle) ───────────────

ALTER TABLE "PosOutlet"
  ADD CONSTRAINT "PosOutlet_name_not_blank" CHECK (length(btrim("name")) >= 2 AND length(btrim("code")) >= 1);

ALTER TABLE "PosTable"
  ADD CONSTRAINT "PosTable_valid" CHECK (length(btrim("name")) >= 1 AND "seats" BETWEEN 1 AND 50);

ALTER TABLE "MenuCategory" ADD CONSTRAINT "MenuCategory_name_not_blank" CHECK (length(btrim("name")) >= 2);

ALTER TABLE "MenuItem"
  ADD CONSTRAINT "MenuItem_valid" CHECK (
    length(btrim("name")) >= 2 AND "price" > 0
    AND "taxCategory" IN ('ROOM', 'FNB', 'MINIBAR', 'LAUNDRY', 'SPA', 'OTHER')
  );

ALTER TABLE "PosSettings"
  ADD CONSTRAINT "PosSettings_valid" CHECK ("adjustmentApprovalAmount" >= 0 AND "cashVarianceAlert" >= 0);

ALTER TABLE "PosSequence" ADD CONSTRAINT "PosSequence_valid" CHECK ("last" >= 1 AND "year" BETWEEN 2000 AND 2999);

-- Vardiya: avans eksi olamaz; kapanmış vardiyanın sayımı, beklenen nakdi ve farkı yazılı, fark = sayılan − beklenen.
ALTER TABLE "PosShift"
  ADD CONSTRAINT "PosShift_valid" CHECK ("openingFloat" >= 0 AND ("countedCash" IS NULL OR "countedCash" >= 0)),
  ADD CONSTRAINT "PosShift_status_trail" CHECK (
    ("status" = 'OPEN' AND "closedAt" IS NULL AND "countedCash" IS NULL AND "expectedCash" IS NULL AND "variance" IS NULL)
    OR ("status" = 'CLOSED' AND "closedAt" IS NOT NULL AND "closedBy" IS NOT NULL AND "countedCash" IS NOT NULL
        AND "expectedCash" IS NOT NULL AND "variance" = "countedCash" - "expectedCash")
  );
-- Bir garsonun aynı anda tek açık vardiyası olur.
CREATE UNIQUE INDEX "PosShift_one_open_per_waiter" ON "PosShift"("hotelId", "waiterEmail") WHERE "status" = 'OPEN';

-- Adisyon: kişi, tutar tutarlılığı (toplam = vergisiz + vergi; fiyatlar vergi dahil olduğundan toplam ara toplam − indirimdir,
-- otelin hariç vergisi varsa onun kadar fazladır), durum izi.
ALTER TABLE "PosCheck"
  ADD CONSTRAINT "PosCheck_covers_valid" CHECK ("covers" BETWEEN 1 AND 200),
  ADD CONSTRAINT "PosCheck_totals_valid" CHECK (
    "subtotal" >= 0 AND "compTotal" >= 0 AND "voidTotal" >= 0 AND "discountTotal" >= 0 AND "discountTotal" <= "subtotal"
    AND "grandTotal" >= "subtotal" - "discountTotal" AND "grandTotal" = "netTotal" + "taxTotal"
    AND "paidTotal" >= 0 AND "roomChargeTotal" >= 0
    AND ("discountPct" IS NULL OR ("discountPct" > 0 AND "discountPct" <= 100))
  ),
  ADD CONSTRAINT "PosCheck_status_trail" CHECK (
    ("status" = 'OPEN' AND "closedAt" IS NULL AND "voidedAt" IS NULL)
    OR ("status" = 'CLOSED' AND "closedAt" IS NOT NULL AND "closedBy" IS NOT NULL AND "businessDate" IS NOT NULL AND "voidedAt" IS NULL
        AND "paidTotal" + "roomChargeTotal" = "grandTotal")
    OR ("status" = 'VOID' AND "voidedAt" IS NOT NULL AND "voidedBy" IS NOT NULL AND "closedAt" IS NULL AND "grandTotal" = 0)
  ),
  ADD CONSTRAINT "PosCheck_not_own_split" CHECK ("splitFromId" IS NULL OR "splitFromId" <> "id");

-- Sipariş kalemi: adet, iptal + ikram adet sınırı, fiyat.
ALTER TABLE "PosOrderLine"
  ADD CONSTRAINT "PosOrderLine_valid" CHECK (
    "quantity" BETWEEN 1 AND 99 AND "voidedQuantity" >= 0 AND "compedQuantity" >= 0
    AND "voidedQuantity" + "compedQuantity" <= "quantity" AND "unitPrice" >= 0
  ),
  ADD CONSTRAINT "PosOrderLine_tax_category" CHECK ("taxCategory" IN ('ROOM', 'FNB', 'MINIBAR', 'LAUNDRY', 'SPA', 'OTHER'));

ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_seq_valid" CHECK ("seq" >= 1);

-- Düzeltme: türüne göre alanlar; onay bekleyenin onay kaydı var.
ALTER TABLE "PosAdjustment"
  ADD CONSTRAINT "PosAdjustment_shape" CHECK (
    ("kind" = 'DISCOUNT' AND "lineId" IS NULL AND "quantity" IS NULL AND NOT "waste"
       AND (("discountPct" IS NULL) <> ("discountAmount" IS NULL)))
    OR ("kind" IN ('COMP', 'VOID') AND "lineId" IS NOT NULL AND "quantity" BETWEEN 1 AND 99
       AND "discountPct" IS NULL AND "discountAmount" IS NULL AND ("kind" = 'VOID' OR NOT "waste"))
  ),
  ADD CONSTRAINT "PosAdjustment_valid" CHECK ("value" >= 0 AND length(btrim("reason")) >= 3),
  ADD CONSTRAINT "PosAdjustment_status_trail" CHECK (
    ("status" = 'APPLIED')
    OR ("status" = 'PENDING' AND "approvalId" IS NOT NULL AND "decidedAt" IS NULL)
    OR ("status" = 'DECLINED' AND "decidedAt" IS NOT NULL)
  );

-- Restoran ödemesi: tahsilat +, iptal kaydı asıl satırın tersi; nakit / kart; durum izi.
ALTER TABLE "PosPayment"
  ADD CONSTRAINT "PosPayment_amount_sign" CHECK (
    ("kind" = 'PAYMENT' AND "amount" > 0) OR ("kind" = 'REVERSAL' AND "amount" <> 0 AND "reversalOfId" IS NOT NULL)
  ),
  ADD CONSTRAINT "PosPayment_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "PosPayment_method_valid" CHECK ("method" IN ('CASH', 'CARD')),
  ADD CONSTRAINT "PosPayment_status_trail" CHECK (
    ("status" = 'POSTED' AND "postedAt" IS NOT NULL AND "declinedAt" IS NULL)
    OR ("status" = 'PENDING' AND "postedAt" IS NULL AND "declinedAt" IS NULL AND "approvalId" IS NOT NULL)
    OR ("status" = 'DECLINED' AND "postedAt" IS NULL AND "declinedAt" IS NOT NULL)
  );

ALTER TABLE "PosRoomCharge"
  ADD CONSTRAINT "PosRoomCharge_valid" CHECK ("amount" > 0 AND length(btrim("roomNumber")) >= 1);
