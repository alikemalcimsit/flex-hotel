-- Modül 42: paket (eve teslim) sipariş. Politika (ücret, en az tutar, teslim hedefi) ve sipariş tablosu. Tablolar
-- Prisma'nın ürettiği; altta veritabanı kuralları (CHECK, trigram index) elle.

-- CreateEnum
CREATE TYPE "DeliverySource" AS ENUM ('PHONE', 'MESSAGE', 'ONLINE');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('RECEIVED', 'PREPARING', 'READY', 'ON_THE_WAY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryDoorMethod" AS ENUM ('CASH', 'CARD');

-- AlterTable
ALTER TABLE "PosSettings" ADD COLUMN     "deliveryFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryMinOrder" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryOrderMinutes" INTEGER NOT NULL DEFAULT 45;

-- CreateTable
CREATE TABLE "DeliveryOrder" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "source" "DeliverySource" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'RECEIVED',
    "customerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "addressNote" TEXT,
    "note" TEXT,
    "doorMethod" "DeliveryDoorMethod",
    "changeFor" DECIMAL(12,2),
    "dueAt" TIMESTAMP(3) NOT NULL,
    "courierEmail" TEXT,
    "assignedAt" TIMESTAMP(3),
    "sourceKey" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "preparingAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "deliveredBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryOrder_checkId_key" ON "DeliveryOrder"("checkId");

-- CreateIndex
CREATE INDEX "DeliveryOrder_hotelId_status_dueAt_idx" ON "DeliveryOrder"("hotelId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "DeliveryOrder_hotelId_createdAt_id_idx" ON "DeliveryOrder"("hotelId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "DeliveryOrder_hotelId_phone_createdAt_idx" ON "DeliveryOrder"("hotelId", "phone", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryOrder_hotelId_number_key" ON "DeliveryOrder"("hotelId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryOrder_hotelId_sourceKey_key" ON "DeliveryOrder"("hotelId", "sourceKey");

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "PosOutlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "PosCheck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Veritabanı kuralları (elle) ──

-- Paket servis politikası: ücret ve en az tutar eksi olamaz; hedef süre makul aralıkta.
ALTER TABLE "PosSettings"
  ADD CONSTRAINT "PosSettings_delivery_valid" CHECK (
    "deliveryFee" >= 0 AND "deliveryMinOrder" >= 0 AND "deliveryOrderMinutes" BETWEEN 10 AND 240
  );

-- Paket sipariş: müşteri / adres alanları, telefon yalnız rakam, bozuk para yalnız kapıda nakitte.
ALTER TABLE "DeliveryOrder"
  ADD CONSTRAINT "DeliveryOrder_fields_valid" CHECK (
    length(btrim("customerName")) >= 2 AND length("customerName") <= 120
    AND "phone" ~ '^\+?[0-9]{7,15}$'
    AND length(btrim("address")) >= 5 AND length("address") <= 300
    AND ("addressNote" IS NULL OR length("addressNote") <= 200)
    AND ("note" IS NULL OR length("note") <= 300)
    AND ("changeFor" IS NULL OR ("changeFor" > 0 AND "doorMethod" = 'CASH'))
  ),
  -- Durum izi: her adımın damgası; yoldaki ve teslim edilenin kuryesi var; iptalin sebebi var.
  ADD CONSTRAINT "DeliveryOrder_status_trail" CHECK (
    "status" = 'RECEIVED'
    OR ("status" = 'PREPARING' AND "preparingAt" IS NOT NULL)
    OR ("status" = 'READY' AND "readyAt" IS NOT NULL)
    OR ("status" = 'ON_THE_WAY' AND "dispatchedAt" IS NOT NULL AND "courierEmail" IS NOT NULL)
    OR ("status" = 'DELIVERED' AND "deliveredAt" IS NOT NULL AND "deliveredBy" IS NOT NULL AND "courierEmail" IS NOT NULL)
    OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledBy" IS NOT NULL AND "cancelReason" IS NOT NULL)
  ),
  ADD CONSTRAINT "DeliveryOrder_courier_trail" CHECK (("courierEmail" IS NULL) = ("assignedAt" IS NULL));

-- Geçmiş araması: numara ve müşteri adı parçası (restoran / oda servisi aramasıyla aynı yol).
CREATE INDEX "DeliveryOrder_number_trgm_idx" ON "DeliveryOrder" USING GIN ("number" gin_trgm_ops);
CREATE INDEX "DeliveryOrder_customerName_trgm_idx" ON "DeliveryOrder" USING GIN ("customerName" gin_trgm_ops);
