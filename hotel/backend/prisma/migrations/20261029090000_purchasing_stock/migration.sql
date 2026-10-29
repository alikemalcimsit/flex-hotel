-- CreateEnum
CREATE TYPE "PurchaseRoundStatus" AS ENUM ('OPEN', 'AWARDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('RECEIPT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PurchaseRequestSource" ADD VALUE 'MANUAL';
ALTER TYPE "PurchaseRequestSource" ADD VALUE 'STOCK';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PurchaseRequestStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "PurchaseRequestStatus" ADD VALUE 'ORDERED';

-- AlterTable
ALTER TABLE "PurchaseRequestLine" ADD COLUMN     "roundLineId" TEXT;

-- AlterTable
ALTER TABLE "StockItem" ADD COLUMN     "minLevel" DECIMAL(14,3),
ADD COLUMN     "onHand" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "taxOffice" TEXT,
    "taxNumber" TEXT,
    "address" TEXT,
    "paymentTermDays" INTEGER NOT NULL DEFAULT 30,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 1,
    "groups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseSettings" (
    "hotelId" TEXT NOT NULL,
    "orderApprovalAmount" DECIMAL(14,2) NOT NULL DEFAULT 50000,
    "defaultTaxRatePct" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseSettings_pkey" PRIMARY KEY ("hotelId")
);

-- CreateTable
CREATE TABLE "PurchaseRound" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "PurchaseRoundStatus" NOT NULL DEFAULT 'OPEN',
    "neededBy" DATE NOT NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "awardedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "PurchaseRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRoundLine" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" "KitchenUnit" NOT NULL,
    "neededBy" DATE NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "awardedQuoteLineId" TEXT,
    "awardReason" TEXT,
    "orderLineId" TEXT,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "PurchaseRoundLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseQuote" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "deliveryDays" INTEGER NOT NULL,
    "validUntil" DATE,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseQuoteLine" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "roundLineId" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,4),
    "taxRatePct" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "PurchaseQuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "roundId" TEXT,
    "status" "PurchaseOrderStatus" NOT NULL,
    "expectedOn" DATE NOT NULL,
    "paymentTermDays" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "netTotal" DECIMAL(14,2) NOT NULL,
    "taxTotal" DECIMAL(14,2) NOT NULL,
    "grandTotal" DECIMAL(14,2) NOT NULL,
    "receivedTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "approvalId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "closeReason" TEXT,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" "KitchenUnit" NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "taxRatePct" DECIMAL(5,2) NOT NULL,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "receivedQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "waybillNumber" TEXT NOT NULL,
    "receivedOn" DATE NOT NULL,
    "note" TEXT,
    "netTotal" DECIMAL(14,2) NOT NULL,
    "taxTotal" DECIMAL(14,2) NOT NULL,
    "grandTotal" DECIMAL(14,2) NOT NULL,
    "closedShort" BOOLEAN NOT NULL DEFAULT false,
    "receivedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "taxRatePct" DECIMAL(5,2) NOT NULL,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLevel" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "kind" "StockMovementKind" NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,
    "onHandAfter" DECIMAL(14,3) NOT NULL,
    "avgCostAfter" DECIMAL(14,4) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplier_hotelId_isActive_name_idx" ON "Supplier"("hotelId", "isActive", "name");

-- CreateIndex
CREATE INDEX "Supplier_name_trgm_idx" ON "Supplier" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Supplier_groups_idx" ON "Supplier" USING GIN ("groups");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_hotelId_code_key" ON "Supplier"("hotelId", "code");

-- CreateIndex
CREATE INDEX "PurchaseRound_hotelId_status_createdAt_id_idx" ON "PurchaseRound"("hotelId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "PurchaseRound_hotelId_createdAt_id_idx" ON "PurchaseRound"("hotelId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRound_hotelId_number_key" ON "PurchaseRound"("hotelId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRoundLine_awardedQuoteLineId_key" ON "PurchaseRoundLine"("awardedQuoteLineId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRoundLine_orderLineId_key" ON "PurchaseRoundLine"("orderLineId");

-- CreateIndex
CREATE INDEX "PurchaseRoundLine_roundId_sortOrder_idx" ON "PurchaseRoundLine"("roundId", "sortOrder");

-- CreateIndex
CREATE INDEX "PurchaseRoundLine_stockItemId_idx" ON "PurchaseRoundLine"("stockItemId");

-- CreateIndex
CREATE INDEX "PurchaseQuote_supplierId_idx" ON "PurchaseQuote"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseQuote_roundId_supplierId_key" ON "PurchaseQuote"("roundId", "supplierId");

-- CreateIndex
CREATE INDEX "PurchaseQuoteLine_roundLineId_idx" ON "PurchaseQuoteLine"("roundLineId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseQuoteLine_quoteId_roundLineId_key" ON "PurchaseQuoteLine"("quoteId", "roundLineId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_hotelId_status_createdAt_id_idx" ON "PurchaseOrder"("hotelId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "PurchaseOrder_hotelId_createdAt_id_idx" ON "PurchaseOrder"("hotelId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "PurchaseOrder_hotelId_supplierId_createdAt_idx" ON "PurchaseOrder"("hotelId", "supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_hotelId_expectedOn_idx" ON "PurchaseOrder"("hotelId", "expectedOn");

-- CreateIndex
CREATE INDEX "PurchaseOrder_roundId_idx" ON "PurchaseOrder"("roundId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_hotelId_number_key" ON "PurchaseOrder"("hotelId", "number");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_orderId_sortOrder_idx" ON "PurchaseOrderLine"("orderId", "sortOrder");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_hotelId_stockItemId_idx" ON "PurchaseOrderLine"("hotelId", "stockItemId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_hotelId_receivedOn_id_idx" ON "GoodsReceipt"("hotelId", "receivedOn", "id");

-- CreateIndex
CREATE INDEX "GoodsReceipt_orderId_idx" ON "GoodsReceipt"("orderId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_hotelId_warehouseId_receivedOn_idx" ON "GoodsReceipt"("hotelId", "warehouseId", "receivedOn");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_hotelId_number_key" ON "GoodsReceipt"("hotelId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_hotelId_supplierId_waybillNumber_key" ON "GoodsReceipt"("hotelId", "supplierId", "waybillNumber");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_receiptId_idx" ON "GoodsReceiptLine"("receiptId");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_orderLineId_idx" ON "GoodsReceiptLine"("orderLineId");

-- CreateIndex
CREATE INDEX "Warehouse_hotelId_isActive_name_idx" ON "Warehouse"("hotelId", "isActive", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_hotelId_code_key" ON "Warehouse"("hotelId", "code");

-- CreateIndex
CREATE INDEX "StockLevel_hotelId_stockItemId_idx" ON "StockLevel"("hotelId", "stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLevel_warehouseId_stockItemId_key" ON "StockLevel"("warehouseId", "stockItemId");

-- CreateIndex
CREATE INDEX "StockMovement_hotelId_stockItemId_occurredAt_id_idx" ON "StockMovement"("hotelId", "stockItemId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "StockMovement_hotelId_occurredAt_id_idx" ON "StockMovement"("hotelId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "StockMovement_hotelId_warehouseId_occurredAt_idx" ON "StockMovement"("hotelId", "warehouseId", "occurredAt");

-- CreateIndex
CREATE INDEX "StockMovement_sourceType_sourceId_idx" ON "StockMovement"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "PurchaseRequestLine_roundLineId_idx" ON "PurchaseRequestLine"("roundLineId");

-- CreateIndex
CREATE INDEX "PurchaseRequestLine_hotelId_roundLineId_neededBy_idx" ON "PurchaseRequestLine"("hotelId", "roundLineId", "neededBy");

-- AddForeignKey
ALTER TABLE "PurchaseRequestLine" ADD CONSTRAINT "PurchaseRequestLine_roundLineId_fkey" FOREIGN KEY ("roundLineId") REFERENCES "PurchaseRoundLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseSettings" ADD CONSTRAINT "PurchaseSettings_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRound" ADD CONSTRAINT "PurchaseRound_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRoundLine" ADD CONSTRAINT "PurchaseRoundLine_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "PurchaseRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRoundLine" ADD CONSTRAINT "PurchaseRoundLine_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRoundLine" ADD CONSTRAINT "PurchaseRoundLine_awardedQuoteLineId_fkey" FOREIGN KEY ("awardedQuoteLineId") REFERENCES "PurchaseQuoteLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRoundLine" ADD CONSTRAINT "PurchaseRoundLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseQuote" ADD CONSTRAINT "PurchaseQuote_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "PurchaseRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseQuote" ADD CONSTRAINT "PurchaseQuote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseQuoteLine" ADD CONSTRAINT "PurchaseQuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "PurchaseQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseQuoteLine" ADD CONSTRAINT "PurchaseQuoteLine_roundLineId_fkey" FOREIGN KEY ("roundLineId") REFERENCES "PurchaseRoundLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "PurchaseRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ══════════════ Elle eklenen kısıtlar (modül 45) ══════════════
-- Not: PurchaseRequestStatus / PurchaseRequestSource'a eklenen değerler aynı transaction'da kullanılamaz;
-- aşağıdaki kısıtlar yalnız bu migration'da CREATE TYPE ile kurulan enumların değerlerine dayanır.

-- Tedarikçi: ad (büyük/küçük harf duyarsız) ve vergi / T.C. kimlik no otelde tek; vade ve termin aralığı.
CREATE UNIQUE INDEX "Supplier_hotelId_name_lower_key" ON "Supplier"("hotelId", lower("name"));
CREATE UNIQUE INDEX "Supplier_hotelId_tax_number_key" ON "Supplier"("hotelId", "taxNumber") WHERE "taxNumber" IS NOT NULL;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_terms_range" CHECK ("paymentTermDays" BETWEEN 0 AND 180 AND "leadTimeDays" BETWEEN 0 AND 60);

-- Politika: eşik eksi değil, KDV oranı bilinen (PURCHASE_TAX_RATES).
ALTER TABLE "PurchaseSettings" ADD CONSTRAINT "PurchaseSettings_threshold_non_negative" CHECK ("orderApprovalAmount" >= 0);
ALTER TABLE "PurchaseSettings" ADD CONSTRAINT "PurchaseSettings_tax_known" CHECK ("defaultTaxRatePct" IN (0, 1, 10, 20));

-- Teklif turu: iptal edilmiş turun kapatma kaydı olur.
ALTER TABLE "PurchaseRound" ADD CONSTRAINT "PurchaseRound_cancel_trail" CHECK ("status" <> 'CANCELLED' OR ("cancelledAt" IS NOT NULL AND "cancelledBy" IS NOT NULL));

-- Tur satırı: miktar pozitif, porsiyon değil; siparişe dönen satırın kazananı var; siparişli satır bırakılmaz.
ALTER TABLE "PurchaseRoundLine" ADD CONSTRAINT "PurchaseRoundLine_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "PurchaseRoundLine" ADD CONSTRAINT "PurchaseRoundLine_unit_not_portion" CHECK ("unit" <> 'PORTION');
ALTER TABLE "PurchaseRoundLine" ADD CONSTRAINT "PurchaseRoundLine_order_needs_award" CHECK ("orderLineId" IS NULL OR "awardedQuoteLineId" IS NOT NULL);
ALTER TABLE "PurchaseRoundLine" ADD CONSTRAINT "PurchaseRoundLine_released_not_ordered" CHECK ("releasedAt" IS NULL OR "orderLineId" IS NULL);

-- Teklif: termin aralığı (MAX_SUPPLIER_LEAD_DAYS); satır fiyatı eksi değil, KDV oranı bilinen.
ALTER TABLE "PurchaseQuote" ADD CONSTRAINT "PurchaseQuote_delivery_range" CHECK ("deliveryDays" BETWEEN 0 AND 60);
ALTER TABLE "PurchaseQuoteLine" ADD CONSTRAINT "PurchaseQuoteLine_price_non_negative" CHECK ("unitPrice" IS NULL OR "unitPrice" >= 0);
ALTER TABLE "PurchaseQuoteLine" ADD CONSTRAINT "PurchaseQuoteLine_tax_known" CHECK ("taxRatePct" IN (0, 1, 10, 20));

-- Sipariş: tutarlar eksi değil; onay bekleyenin onay isteği var; iptal ve eksik kapatma izi; vade aralığı.
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_totals_non_negative" CHECK ("netTotal" >= 0 AND "taxTotal" >= 0 AND "grandTotal" >= 0 AND "receivedTotal" >= 0);
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_approval_trail" CHECK ("status" <> 'PENDING_APPROVAL' OR "approvalId" IS NOT NULL);
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_cancel_trail" CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_close_trail" CHECK ("status" <> 'CLOSED' OR "closedAt" IS NOT NULL);
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_terms_range" CHECK ("paymentTermDays" BETWEEN 0 AND 180);

-- Sipariş satırı: miktar pozitif; teslim alınan 0 ile sipariş (+%5 tartılan malzemede, MAX_OVER_RECEIPT_PCT) arası.
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_received_range" CHECK (
  "receivedQuantity" >= 0 AND "receivedQuantity" <= "quantity" * (CASE WHEN "unit" = 'PIECE' THEN 1 ELSE 1.05 END)
);
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_amounts_non_negative" CHECK ("unitPrice" >= 0 AND "netAmount" >= 0 AND "taxAmount" >= 0 AND "total" >= 0);

-- Mal kabul: tutarlar eksi değil, satır miktarı pozitif.
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_totals_non_negative" CHECK ("netTotal" >= 0 AND "taxTotal" >= 0 AND "grandTotal" >= 0);
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_quantity_positive" CHECK ("quantity" > 0);

-- Depo: ad otelde tek; tek varsayılan depo; varsayılan depo etkin.
CREATE UNIQUE INDEX "Warehouse_hotelId_name_lower_key" ON "Warehouse"("hotelId", lower("name"));
CREATE UNIQUE INDEX "Warehouse_one_default" ON "Warehouse"("hotelId") WHERE "isDefault";
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_default_active" CHECK (NOT "isDefault" OR "isActive");

-- Malzeme kartı: minimum seviye eksi değil.
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_min_level_non_negative" CHECK ("minLevel" IS NULL OR "minLevel" >= 0);

-- Stok hareketi: miktar 0 değil (giriş artı, 44'te çıkış eksi); birim ve ortalama maliyet eksi değil.
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_quantity_non_zero" CHECK ("quantity" <> 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_cost_non_negative" CHECK ("unitCost" >= 0 AND "avgCostAfter" >= 0);
