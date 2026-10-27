-- Modül 43: banket F&B planlaması. 38'in reçete kısmı (malzeme kartı, reçete, satır) ve 45'in talep kısmı
-- (satın alma talebi, satırı, numara serisi) bu modülde kuruldu (kullanıcı kararı, 27 Ekim 2026). Set menü kataloğu,
-- etkinlik menüsü (oturumun öğünü; dosyanın kişi başı kalemini üretir), banket politikasına fazla hazırlık payı ve menü
-- kesinleştirme süresi. Tablolar Prisma'nın ürettiği; altta veritabanı kuralları (CHECK, harf duyarsız tekil ad) elle.
-- CreateEnum
CREATE TYPE "KitchenUnit" AS ENUM ('KG', 'G', 'L', 'ML', 'PIECE', 'PORTION');

-- CreateEnum
CREATE TYPE "StockItemGroup" AS ENUM ('MEAT', 'POULTRY', 'SEAFOOD', 'DAIRY', 'PRODUCE', 'DRY_GOODS', 'PANTRY', 'BAKERY', 'BEVERAGE', 'FROZEN', 'OTHER');

-- CreateEnum
CREATE TYPE "RecipeKind" AS ENUM ('DISH', 'PREP');

-- CreateEnum
CREATE TYPE "MenuCourseMode" AS ENUM ('ALL', 'CHOICE');

-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('OPEN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseRequestSource" AS ENUM ('BANQUET');

-- AlterTable
ALTER TABLE "EventItem" ADD COLUMN     "eventMenuId" TEXT;

-- AlterTable
ALTER TABLE "EventSettings" ADD COLUMN     "menuFinalizeDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "overproductionPct" DECIMAL(5,2) NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "group" "StockItemGroup" NOT NULL,
    "unit" "KitchenUnit" NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "costUpdatedAt" TIMESTAMP(3),
    "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "kind" "RecipeKind" NOT NULL,
    "station" "PosStation" NOT NULL DEFAULT 'HOT',
    "menuItemId" TEXT,
    "yieldQuantity" DECIMAL(12,3) NOT NULL,
    "yieldUnit" "KitchenUnit" NOT NULL,
    "leadMinutes" INTEGER NOT NULL DEFAULT 0,
    "method" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeLine" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "stockItemId" TEXT,
    "subRecipeId" TEXT,
    "quantity" DECIMAL(12,4) NOT NULL,
    "unit" "KitchenUnit" NOT NULL,
    "wastePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "RecipeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BanquetMenu" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pricePerPerson" DECIMAL(12,2) NOT NULL,
    "taxCategory" TEXT NOT NULL DEFAULT 'FNB',
    "minGuests" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BanquetMenu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BanquetMenuCourse" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "MenuCourseMode" NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "BanquetMenuCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BanquetMenuDish" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "label" TEXT,
    "portionsPerGuest" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "BanquetMenuDish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMenu" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sourceMenuId" TEXT,
    "name" TEXT NOT NULL,
    "serveAt" TIMESTAMP(3) NOT NULL,
    "guests" INTEGER,
    "pricePerPerson" DECIMAL(12,2) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxCategory" TEXT NOT NULL DEFAULT 'FNB',
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "finalizedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventMenu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMenuCourse" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "eventMenuId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "MenuCourseMode" NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "EventMenuCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMenuDish" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "eventMenuId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "label" TEXT,
    "portionsPerGuest" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "guestCount" INTEGER,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "EventMenuDish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'OPEN',
    "source" "PurchaseRequestSource" NOT NULL,
    "neededBy" DATE NOT NULL,
    "note" TEXT,
    "requestedBy" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequestLine" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" "KitchenUnit" NOT NULL,
    "neededBy" DATE NOT NULL,
    "eventId" TEXT,
    "estimatedUnitCost" DECIMAL(14,4) NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "PurchaseRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseSequence" (
    "hotelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "PurchaseSequence_pkey" PRIMARY KEY ("hotelId","kind","year")
);

-- CreateIndex
CREATE INDEX "StockItem_hotelId_group_name_idx" ON "StockItem"("hotelId", "group", "name");

-- CreateIndex
CREATE INDEX "StockItem_hotelId_isActive_name_idx" ON "StockItem"("hotelId", "isActive", "name");

-- CreateIndex
CREATE INDEX "StockItem_name_trgm_idx" ON "StockItem" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_hotelId_code_key" ON "StockItem"("hotelId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_menuItemId_key" ON "Recipe"("menuItemId");

-- CreateIndex
CREATE INDEX "Recipe_hotelId_kind_isActive_name_idx" ON "Recipe"("hotelId", "kind", "isActive", "name");

-- CreateIndex
CREATE INDEX "Recipe_name_trgm_idx" ON "Recipe" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_hotelId_code_key" ON "Recipe"("hotelId", "code");

-- CreateIndex
CREATE INDEX "RecipeLine_recipeId_sortOrder_idx" ON "RecipeLine"("recipeId", "sortOrder");

-- CreateIndex
CREATE INDEX "RecipeLine_stockItemId_idx" ON "RecipeLine"("stockItemId");

-- CreateIndex
CREATE INDEX "RecipeLine_subRecipeId_idx" ON "RecipeLine"("subRecipeId");

-- CreateIndex
CREATE INDEX "BanquetMenu_hotelId_isActive_name_idx" ON "BanquetMenu"("hotelId", "isActive", "name");

-- CreateIndex
CREATE UNIQUE INDEX "BanquetMenu_hotelId_code_key" ON "BanquetMenu"("hotelId", "code");

-- CreateIndex
CREATE INDEX "BanquetMenuCourse_menuId_sortOrder_idx" ON "BanquetMenuCourse"("menuId", "sortOrder");

-- CreateIndex
CREATE INDEX "BanquetMenuDish_courseId_sortOrder_idx" ON "BanquetMenuDish"("courseId", "sortOrder");

-- CreateIndex
CREATE INDEX "BanquetMenuDish_recipeId_idx" ON "BanquetMenuDish"("recipeId");

-- CreateIndex
CREATE INDEX "EventMenu_eventId_serveAt_idx" ON "EventMenu"("eventId", "serveAt");

-- CreateIndex
CREATE INDEX "EventMenu_hotelId_serveAt_idx" ON "EventMenu"("hotelId", "serveAt");

-- CreateIndex
CREATE INDEX "EventMenu_sessionId_idx" ON "EventMenu"("sessionId");

-- CreateIndex
CREATE INDEX "EventMenu_sourceMenuId_idx" ON "EventMenu"("sourceMenuId");

-- CreateIndex
CREATE INDEX "EventMenuCourse_eventMenuId_sortOrder_idx" ON "EventMenuCourse"("eventMenuId", "sortOrder");

-- CreateIndex
CREATE INDEX "EventMenuDish_courseId_sortOrder_idx" ON "EventMenuDish"("courseId", "sortOrder");

-- CreateIndex
CREATE INDEX "EventMenuDish_eventMenuId_idx" ON "EventMenuDish"("eventMenuId");

-- CreateIndex
CREATE INDEX "EventMenuDish_recipeId_idx" ON "EventMenuDish"("recipeId");

-- CreateIndex
CREATE INDEX "PurchaseRequest_hotelId_createdAt_id_idx" ON "PurchaseRequest"("hotelId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "PurchaseRequest_hotelId_status_createdAt_id_idx" ON "PurchaseRequest"("hotelId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "PurchaseRequest_hotelId_neededBy_idx" ON "PurchaseRequest"("hotelId", "neededBy");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_hotelId_number_key" ON "PurchaseRequest"("hotelId", "number");

-- CreateIndex
CREATE INDEX "PurchaseRequestLine_requestId_sortOrder_idx" ON "PurchaseRequestLine"("requestId", "sortOrder");

-- CreateIndex
CREATE INDEX "PurchaseRequestLine_eventId_stockItemId_idx" ON "PurchaseRequestLine"("eventId", "stockItemId");

-- CreateIndex
CREATE INDEX "PurchaseRequestLine_hotelId_stockItemId_idx" ON "PurchaseRequestLine"("hotelId", "stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "EventItem_eventMenuId_key" ON "EventItem"("eventMenuId");

-- AddForeignKey
ALTER TABLE "EventItem" ADD CONSTRAINT "EventItem_eventMenuId_fkey" FOREIGN KEY ("eventMenuId") REFERENCES "EventMenu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_subRecipeId_fkey" FOREIGN KEY ("subRecipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanquetMenu" ADD CONSTRAINT "BanquetMenu_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanquetMenuCourse" ADD CONSTRAINT "BanquetMenuCourse_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "BanquetMenu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanquetMenuDish" ADD CONSTRAINT "BanquetMenuDish_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "BanquetMenuCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanquetMenuDish" ADD CONSTRAINT "BanquetMenuDish_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMenu" ADD CONSTRAINT "EventMenu_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMenu" ADD CONSTRAINT "EventMenu_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EventSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMenu" ADD CONSTRAINT "EventMenu_sourceMenuId_fkey" FOREIGN KEY ("sourceMenuId") REFERENCES "BanquetMenu"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMenuCourse" ADD CONSTRAINT "EventMenuCourse_eventMenuId_fkey" FOREIGN KEY ("eventMenuId") REFERENCES "EventMenu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMenuDish" ADD CONSTRAINT "EventMenuDish_eventMenuId_fkey" FOREIGN KEY ("eventMenuId") REFERENCES "EventMenu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMenuDish" ADD CONSTRAINT "EventMenuDish_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "EventMenuCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMenuDish" ADD CONSTRAINT "EventMenuDish_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestLine" ADD CONSTRAINT "PurchaseRequestLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestLine" ADD CONSTRAINT "PurchaseRequestLine_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestLine" ADD CONSTRAINT "PurchaseRequestLine_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────── Veritabanı kuralları ───────────────

-- Ad otel içinde harf duyarsız tekil ("Dana kıyma" ile "dana kıyma" iki kart olmaz). Uygulama da aynı kuralla denetler;
-- bu index eşzamanlı iki kaydın son savunmasıdır.
CREATE UNIQUE INDEX "StockItem_hotelId_name_lower_key" ON "StockItem"("hotelId", lower("name"));
CREATE UNIQUE INDEX "Recipe_hotelId_name_lower_key" ON "Recipe"("hotelId", lower("name"));
CREATE UNIQUE INDEX "BanquetMenu_hotelId_name_lower_key" ON "BanquetMenu"("hotelId", lower("name"));

-- Malzeme kartı: stok birimi porsiyon olamaz; maliyet negatif olamaz; alerjenler bilinen 14 gruptan.
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_unit_not_portion" CHECK ("unit" <> 'PORTION');
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_unit_cost_non_negative" CHECK ("unitCost" >= 0);
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_allergens_known" CHECK (
  "allergens" IS NOT NULL AND "allergens" <@ ARRAY['GLUTEN', 'CRUSTACEANS', 'EGGS', 'FISH', 'PEANUTS', 'SOY', 'MILK', 'NUTS', 'CELERY', 'MUSTARD', 'SESAME', 'SULPHITES', 'LUPIN', 'MOLLUSCS']::TEXT[]
);

-- Reçete: yemek porsiyon verir, ara ürün kg / L / adet; verim pozitif; hazırlık süresi 0–3 gün; ara ürün menüye bağlanmaz.
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_yield_unit_matches_kind" CHECK (
  ("kind" = 'DISH' AND "yieldUnit" = 'PORTION') OR ("kind" = 'PREP' AND "yieldUnit" IN ('KG', 'L', 'PIECE'))
);
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_yield_positive" CHECK ("yieldQuantity" > 0);
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_lead_range" CHECK ("leadMinutes" BETWEEN 0 AND 4320);
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_prep_not_on_menu" CHECK ("kind" = 'DISH' OR "menuItemId" IS NULL);

-- Reçete satırı: malzeme ya da ara reçete (tam biri), kendini içermez; miktar pozitif; fire %0–<100.
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_one_source" CHECK (num_nonnulls("stockItemId", "subRecipeId") = 1);
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_not_self" CHECK ("subRecipeId" IS NULL OR "subRecipeId" <> "recipeId");
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "RecipeLine" ADD CONSTRAINT "RecipeLine_waste_range" CHECK ("wastePct" >= 0 AND "wastePct" < 100);

-- Set menü ve etkinlik menüsü: fiyat negatif değil, kişi pozitif, kişi başı porsiyon (0, 10].
ALTER TABLE "BanquetMenu" ADD CONSTRAINT "BanquetMenu_price_non_negative" CHECK ("pricePerPerson" >= 0);
ALTER TABLE "BanquetMenu" ADD CONSTRAINT "BanquetMenu_min_guests_positive" CHECK ("minGuests" IS NULL OR "minGuests" > 0);
ALTER TABLE "BanquetMenuDish" ADD CONSTRAINT "BanquetMenuDish_portions_range" CHECK ("portionsPerGuest" > 0 AND "portionsPerGuest" <= 10);
ALTER TABLE "EventMenu" ADD CONSTRAINT "EventMenu_price_non_negative" CHECK ("pricePerPerson" >= 0);
ALTER TABLE "EventMenu" ADD CONSTRAINT "EventMenu_discount_range" CHECK ("discountPct" >= 0 AND "discountPct" <= 100);
ALTER TABLE "EventMenu" ADD CONSTRAINT "EventMenu_guests_positive" CHECK ("guests" IS NULL OR "guests" > 0);
-- Kesinleşme izi tamdır: an ve kişi birlikte yazılır / silinir.
ALTER TABLE "EventMenu" ADD CONSTRAINT "EventMenu_finalized_trail" CHECK (("finalizedAt" IS NULL) = ("finalizedBy" IS NULL));
ALTER TABLE "EventMenuDish" ADD CONSTRAINT "EventMenuDish_portions_range" CHECK ("portionsPerGuest" > 0 AND "portionsPerGuest" <= 10);
ALTER TABLE "EventMenuDish" ADD CONSTRAINT "EventMenuDish_guest_count_positive" CHECK ("guestCount" IS NULL OR "guestCount" > 0);

-- Banket politikası: fazla hazırlık %0–30, menü kesinleştirme 0–60 gün.
ALTER TABLE "EventSettings" ADD CONSTRAINT "EventSettings_overproduction_range" CHECK ("overproductionPct" >= 0 AND "overproductionPct" <= 30);
ALTER TABLE "EventSettings" ADD CONSTRAINT "EventSettings_menu_finalize_range" CHECK ("menuFinalizeDays" BETWEEN 0 AND 60);

-- Satın alma talebi: iptal izi tam (iptalde an, kişi, gerekçe; açıkken hiçbiri); satır miktarı pozitif, birim porsiyon değil.
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_cancel_trail" CHECK (
  ("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)
  AND ("cancelledAt" IS NULL) = ("cancelledBy" IS NULL)
  AND ("cancelledAt" IS NULL) = ("cancelReason" IS NULL)
);
ALTER TABLE "PurchaseRequestLine" ADD CONSTRAINT "PurchaseRequestLine_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "PurchaseRequestLine" ADD CONSTRAINT "PurchaseRequestLine_unit_not_portion" CHECK ("unit" <> 'PORTION');
ALTER TABLE "PurchaseRequestLine" ADD CONSTRAINT "PurchaseRequestLine_cost_non_negative" CHECK ("estimatedUnitCost" >= 0);
