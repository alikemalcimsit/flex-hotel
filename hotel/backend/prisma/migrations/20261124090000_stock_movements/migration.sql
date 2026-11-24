-- Modül 44: stok çıkışı / fire / transfer / sayım farkı / satış düşümü ve sayım.

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('OPEN', 'APPROVED', 'CANCELLED');

-- AlterEnum: minimum altına düşen malzeme için açılan stok talebinin zili.
ALTER TYPE "StaffAlertKind" ADD VALUE 'STOCK';

-- AlterEnum: yalnız mal kabul ortalama maliyeti değiştirir; diğerleri miktarı o anki ortalamayla değiştirir.
ALTER TYPE "StockMovementKind" ADD VALUE 'ISSUE';
ALTER TYPE "StockMovementKind" ADD VALUE 'WASTE';
ALTER TYPE "StockMovementKind" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "StockMovementKind" ADD VALUE 'TRANSFER_IN';
ALTER TYPE "StockMovementKind" ADD VALUE 'COUNT_ADJUST';
ALTER TYPE "StockMovementKind" ADD VALUE 'SALE';

-- AlterTable: satış düşümünde hangi menü ürünü için (ürün bazlı maliyet raporu).
ALTER TABLE "StockMovement" ADD COLUMN     "menuItemId" TEXT;

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "openedBy" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "adjustedLines" INTEGER NOT NULL DEFAULT 0,
    "adjustedValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id"),
    -- Onaylanan sayımın onay damgası, iptal edilenin iptal damgası ve sebebi olur.
    CONSTRAINT "StockCount_status_trail" CHECK (
        ("status" = 'OPEN' AND "approvedAt" IS NULL AND "cancelledAt" IS NULL)
        OR ("status" = 'APPROVED' AND "approvedAt" IS NOT NULL AND "approvedBy" IS NOT NULL AND "cancelledAt" IS NULL)
        OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledBy" IS NOT NULL AND "cancelReason" IS NOT NULL AND "approvedAt" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "expectedQuantity" DECIMAL(14,3) NOT NULL,
    "countedQuantity" DECIMAL(14,3),
    "differenceQuantity" DECIMAL(14,3),
    "unitCost" DECIMAL(14,4) NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StockCountLine_counted_nonnegative" CHECK ("countedQuantity" IS NULL OR "countedQuantity" >= 0)
);

-- CreateIndex
CREATE INDEX "StockCount_hotelId_status_openedAt_idx" ON "StockCount"("hotelId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "StockCount_hotelId_warehouseId_openedAt_idx" ON "StockCount"("hotelId", "warehouseId", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_hotelId_number_key" ON "StockCount"("hotelId", "number");

-- Depoda aynı anda tek açık sayım (kısmi tekil indeks; Prisma şemasında ifade edilemez).
CREATE UNIQUE INDEX "StockCount_one_open_per_warehouse" ON "StockCount"("warehouseId") WHERE "status" = 'OPEN';

-- CreateIndex
CREATE INDEX "StockCountLine_hotelId_stockItemId_idx" ON "StockCountLine"("hotelId", "stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_countId_stockItemId_key" ON "StockCountLine"("countId", "stockItemId");

-- CreateIndex
CREATE INDEX "StockMovement_hotelId_menuItemId_occurredAt_idx" ON "StockMovement"("hotelId", "menuItemId", "occurredAt");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
