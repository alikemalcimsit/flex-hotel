-- Modül 19: Çamaşırhane & minibar.
--
-- Minibar: ürün listesi (fiyat, standart adet), odanın sayım fişi ve satırları.
-- Fiş konaklamaya yazılırsa `minibar.consumed` olayıyla folyoya gider (olay
-- kimliği `eventId`); odada kimse yoksa kayıp olarak gerekçesiyle yazılır.
-- Çamaşırhane: fiyat listesi (parça × hizmet), sipariş ve satırları; teslimde
-- ücret `laundry.charged` ile folyoya gider. Otel: ekspres farkı (yüzde).
-- Folyo kalem kaynağına `LAUNDRY` eklenir.

-- CreateEnum
CREATE TYPE "MinibarCategory" AS ENUM ('DRINK', 'ALCOHOL', 'SNACK', 'OTHER');

-- CreateEnum
CREATE TYPE "MinibarChargeTarget" AS ENUM ('IN_HOUSE', 'LATE', 'NONE');

-- CreateEnum
CREATE TYPE "LaundryService" AS ENUM ('WASH', 'DRY_CLEAN', 'PRESS');

-- CreateEnum
CREATE TYPE "LaundryStatus" AS ENUM ('RECEIVED', 'IN_PROCESS', 'READY', 'DELIVERED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "FolioItemSource" ADD VALUE 'LAUNDRY';

-- AlterTable
ALTER TABLE "Hotel" ADD COLUMN     "laundryExpressPct" DECIMAL(5,2) NOT NULL DEFAULT 50;

-- CreateTable
CREATE TABLE "MinibarItem" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "MinibarCategory" NOT NULL DEFAULT 'DRINK',
    "price" DECIMAL(12,2) NOT NULL,
    "parLevel" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MinibarItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MinibarConsumption" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "reservationId" TEXT,
    "chargeTarget" "MinibarChargeTarget" NOT NULL,
    "reference" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "lossReason" TEXT,
    "note" TEXT,
    "requestId" TEXT NOT NULL,
    "eventId" TEXT,
    "recordedBy" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MinibarConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MinibarConsumptionLine" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "consumptionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "MinibarConsumptionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaundryItem" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "service" "LaundryService" NOT NULL DEFAULT 'WASH',
    "price" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LaundryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaundryOrder" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "LaundryStatus" NOT NULL DEFAULT 'RECEIVED',
    "express" BOOLEAN NOT NULL DEFAULT false,
    "expressPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "surcharge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "requestId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "receivedBy" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusChangedBy" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "deliveredBy" TEXT,
    "deliveredBusinessDate" DATE,
    "chargeEventId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LaundryOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaundryOrderLine" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "service" "LaundryService" NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "LaundryOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MinibarItem_hotelId_active_sortOrder_idx" ON "MinibarItem"("hotelId", "active", "sortOrder");

-- CreateIndex
CREATE INDEX "MinibarConsumption_hotelId_businessDate_recordedAt_id_idx" ON "MinibarConsumption"("hotelId", "businessDate", "recordedAt", "id");

-- CreateIndex
CREATE INDEX "MinibarConsumption_roomId_recordedAt_idx" ON "MinibarConsumption"("roomId", "recordedAt");

-- CreateIndex
CREATE INDEX "MinibarConsumption_reservationId_idx" ON "MinibarConsumption"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "MinibarConsumption_hotelId_requestId_key" ON "MinibarConsumption"("hotelId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "MinibarConsumption_hotelId_reference_key" ON "MinibarConsumption"("hotelId", "reference");

-- CreateIndex
CREATE INDEX "MinibarConsumptionLine_consumptionId_idx" ON "MinibarConsumptionLine"("consumptionId");

-- CreateIndex
CREATE INDEX "MinibarConsumptionLine_itemId_idx" ON "MinibarConsumptionLine"("itemId");

-- CreateIndex
CREATE INDEX "LaundryItem_hotelId_active_sortOrder_idx" ON "LaundryItem"("hotelId", "active", "sortOrder");

-- CreateIndex
CREATE INDEX "LaundryOrder_hotelId_status_dueAt_id_idx" ON "LaundryOrder"("hotelId", "status", "dueAt", "id");

-- CreateIndex
CREATE INDEX "LaundryOrder_hotelId_status_statusChangedAt_id_idx" ON "LaundryOrder"("hotelId", "status", "statusChangedAt", "id");

-- CreateIndex (günlük rapor: o gün teslim edilenler)
CREATE INDEX "LaundryOrder_hotelId_deliveredBusinessDate_idx" ON "LaundryOrder"("hotelId", "deliveredBusinessDate");

-- CreateIndex
CREATE INDEX "LaundryOrder_hotelId_businessDate_idx" ON "LaundryOrder"("hotelId", "businessDate");

-- CreateIndex
CREATE INDEX "LaundryOrder_reservationId_status_idx" ON "LaundryOrder"("reservationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LaundryOrder_hotelId_requestId_key" ON "LaundryOrder"("hotelId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "LaundryOrder_hotelId_reference_key" ON "LaundryOrder"("hotelId", "reference");

-- CreateIndex
CREATE INDEX "LaundryOrderLine_orderId_idx" ON "LaundryOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "LaundryOrderLine_itemId_idx" ON "LaundryOrderLine"("itemId");

-- AddForeignKey
ALTER TABLE "MinibarItem" ADD CONSTRAINT "MinibarItem_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinibarConsumption" ADD CONSTRAINT "MinibarConsumption_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinibarConsumption" ADD CONSTRAINT "MinibarConsumption_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinibarConsumption" ADD CONSTRAINT "MinibarConsumption_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinibarConsumptionLine" ADD CONSTRAINT "MinibarConsumptionLine_consumptionId_fkey" FOREIGN KEY ("consumptionId") REFERENCES "MinibarConsumption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinibarConsumptionLine" ADD CONSTRAINT "MinibarConsumptionLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MinibarItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaundryItem" ADD CONSTRAINT "LaundryItem_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaundryOrder" ADD CONSTRAINT "LaundryOrder_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaundryOrder" ADD CONSTRAINT "LaundryOrder_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaundryOrder" ADD CONSTRAINT "LaundryOrder_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaundryOrderLine" ADD CONSTRAINT "LaundryOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LaundryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaundryOrderLine" ADD CONSTRAINT "LaundryOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LaundryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────── Kısmi tekil index'ler (silinen kodun yeniden kullanılabilmesi için) ───────────────

CREATE UNIQUE INDEX "MinibarItem_hotelId_code_active_key" ON "MinibarItem"("hotelId", "code") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "LaundryItem_hotelId_code_active_key" ON "LaundryItem"("hotelId", "code") WHERE "deletedAt" IS NULL;

-- ─────────────── Kısıtlar (servisin kontrolüne ek, son savunma hattı) ───────────────

ALTER TABLE "Hotel" ADD CONSTRAINT "Hotel_laundry_express_pct_range" CHECK ("laundryExpressPct" BETWEEN 0 AND 300);

ALTER TABLE "MinibarItem" ADD CONSTRAINT "MinibarItem_price_positive" CHECK ("price" > 0);
ALTER TABLE "MinibarItem" ADD CONSTRAINT "MinibarItem_par_level_range" CHECK ("parLevel" BETWEEN 0 AND 20);
ALTER TABLE "LaundryItem" ADD CONSTRAINT "LaundryItem_price_positive" CHECK ("price" > 0);

-- Fiş: kayıpsa konaklama yok ve gerekçe var; yazılansa konaklama var. Konaklamaya yazılanın olayı var.
ALTER TABLE "MinibarConsumption" ADD CONSTRAINT "MinibarConsumption_target_consistent"
  CHECK (("chargeTarget" = 'NONE') = ("reservationId" IS NULL)
     AND ("chargeTarget" <> 'NONE' OR "lossReason" IS NOT NULL)
     AND (("chargeTarget" = 'NONE') = ("eventId" IS NULL)));
ALTER TABLE "MinibarConsumption" ADD CONSTRAINT "MinibarConsumption_totals_positive" CHECK ("totalAmount" > 0 AND "itemCount" > 0);
ALTER TABLE "MinibarConsumptionLine" ADD CONSTRAINT "MinibarConsumptionLine_consistent"
  CHECK ("quantity" BETWEEN 1 AND 99 AND "unitPrice" > 0 AND "total" = "unitPrice" * "quantity");

-- Sipariş: toplam = ara toplam + ekspres farkı; ekspres değilse fark yok. Durum izleri eksiksiz.
ALTER TABLE "LaundryOrder" ADD CONSTRAINT "LaundryOrder_totals_consistent"
  CHECK ("total" = "subtotal" + "surcharge" AND "subtotal" > 0 AND "surcharge" >= 0 AND "itemCount" > 0
     AND ("express" OR ("surcharge" = 0 AND "expressPct" = 0)));
ALTER TABLE "LaundryOrder" ADD CONSTRAINT "LaundryOrder_delivered_trail"
  CHECK (("status" = 'DELIVERED') = ("deliveredAt" IS NOT NULL)
     AND ("deliveredAt" IS NULL) = ("deliveredBy" IS NULL)
     AND ("deliveredAt" IS NULL) = ("deliveredBusinessDate" IS NULL)
     AND ("deliveredAt" IS NULL) = ("chargeEventId" IS NULL));
ALTER TABLE "LaundryOrder" ADD CONSTRAINT "LaundryOrder_cancelled_trail"
  CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)
     AND ("cancelledAt" IS NULL) = ("cancelledBy" IS NULL)
     AND ("cancelledAt" IS NULL) = ("cancelReason" IS NULL));
ALTER TABLE "LaundryOrderLine" ADD CONSTRAINT "LaundryOrderLine_consistent"
  CHECK ("quantity" BETWEEN 1 AND 99 AND "unitPrice" > 0 AND "total" = "unitPrice" * "quantity");
