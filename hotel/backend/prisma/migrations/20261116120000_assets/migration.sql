-- Modül 46: Demirbaş ve amortisman.

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'DISPOSED');

-- CreateEnum
CREATE TYPE "AssetDisposalType" AS ENUM ('SOLD', 'SCRAPPED', 'LOST');

-- CreateEnum
CREATE TYPE "AssetMovementKind" AS ENUM ('CREATED', 'UPDATED', 'TRANSFERRED', 'ASSIGNED', 'RETURNED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "AssetCountStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "AssetCategory" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "usefulLifeYears" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetArea" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "roomId" TEXT,
    "areaId" TEXT,
    "employeeId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "purchaseDate" DATE NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "usefulLifeYears" INTEGER NOT NULL,
    "openingAccumulated" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "openingThroughYear" INTEGER,
    "supplierName" TEXT,
    "invoiceNumber" TEXT,
    "warrantyUntil" DATE,
    "warrantyAlertedFor" DATE,
    "note" TEXT,
    "disposalType" "AssetDisposalType",
    "disposedOn" DATE,
    "disposalPrice" DECIMAL(14,2),
    "disposalReason" TEXT,
    "disposalBookValue" DECIMAL(14,2),
    "disposedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetMovement" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "kind" "AssetMovementKind" NOT NULL,
    "fromLabel" TEXT,
    "toLabel" TEXT,
    "note" TEXT,
    "countId" TEXT,
    "actor" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetDepreciationRun" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "assetCount" INTEGER NOT NULL,
    "postedBy" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetDepreciationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetDepreciation" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "accumulatedAfter" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "AssetDepreciation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetCount" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT,
    "roomId" TEXT,
    "areaId" TEXT,
    "status" "AssetCountStatus" NOT NULL DEFAULT 'OPEN',
    "expectedCount" INTEGER NOT NULL,
    "openedBy" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "transferredCount" INTEGER,
    "cancelledBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetCountItem" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "expected" BOOLEAN NOT NULL,
    "expectedRoomId" TEXT,
    "expectedAreaId" TEXT,
    "foundRoomId" TEXT,
    "foundAreaId" TEXT,
    "foundAt" TIMESTAMP(3),
    "foundBy" TEXT,

    CONSTRAINT "AssetCountItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetSequence" (
    "hotelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "AssetSequence_pkey" PRIMARY KEY ("hotelId","kind","year")
);

-- CreateIndex
CREATE INDEX "AssetCategory_hotelId_isActive_idx" ON "AssetCategory"("hotelId", "isActive");

-- CreateIndex
CREATE INDEX "AssetArea_hotelId_isActive_idx" ON "AssetArea"("hotelId", "isActive");

-- CreateIndex
CREATE INDEX "Asset_hotelId_status_categoryId_idx" ON "Asset"("hotelId", "status", "categoryId");

-- CreateIndex
CREATE INDEX "Asset_hotelId_roomId_idx" ON "Asset"("hotelId", "roomId");

-- CreateIndex
CREATE INDEX "Asset_hotelId_areaId_idx" ON "Asset"("hotelId", "areaId");

-- CreateIndex
CREATE INDEX "Asset_hotelId_employeeId_idx" ON "Asset"("hotelId", "employeeId");

-- CreateIndex
CREATE INDEX "Asset_hotelId_status_warrantyUntil_idx" ON "Asset"("hotelId", "status", "warrantyUntil");

-- CreateIndex
CREATE INDEX "Asset_name_trgm_idx" ON "Asset" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Asset_hotelId_code_key" ON "Asset"("hotelId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_hotelId_requestId_key" ON "Asset"("hotelId", "requestId");

-- CreateIndex
CREATE INDEX "AssetMovement_assetId_occurredAt_idx" ON "AssetMovement"("assetId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetDepreciationRun_hotelId_year_key" ON "AssetDepreciationRun"("hotelId", "year");

-- CreateIndex
CREATE INDEX "AssetDepreciation_runId_idx" ON "AssetDepreciation"("runId");

-- CreateIndex
CREATE INDEX "AssetDepreciation_hotelId_year_idx" ON "AssetDepreciation"("hotelId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "AssetDepreciation_assetId_year_key" ON "AssetDepreciation"("assetId", "year");

-- CreateIndex
CREATE INDEX "AssetCount_hotelId_status_openedAt_idx" ON "AssetCount"("hotelId", "status", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCount_hotelId_number_key" ON "AssetCount"("hotelId", "number");

-- CreateIndex
CREATE INDEX "AssetCountItem_countId_foundAt_idx" ON "AssetCountItem"("countId", "foundAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCountItem_countId_assetId_key" ON "AssetCountItem"("countId", "assetId");

-- AddForeignKey
ALTER TABLE "AssetCategory" ADD CONSTRAINT "AssetCategory_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetArea" ADD CONSTRAINT "AssetArea_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "AssetArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetMovement" ADD CONSTRAINT "AssetMovement_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetDepreciationRun" ADD CONSTRAINT "AssetDepreciationRun_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetDepreciation" ADD CONSTRAINT "AssetDepreciation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AssetDepreciationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetDepreciation" ADD CONSTRAINT "AssetDepreciation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCount" ADD CONSTRAINT "AssetCount_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCount" ADD CONSTRAINT "AssetCount_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCount" ADD CONSTRAINT "AssetCount_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "AssetArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCountItem" ADD CONSTRAINT "AssetCountItem_countId_fkey" FOREIGN KEY ("countId") REFERENCES "AssetCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCountItem" ADD CONSTRAINT "AssetCountItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Kategori ve alan adları otel içinde büyük / küçük harf duyarsız tekil ("Lobi" = "lobi").
CREATE UNIQUE INDEX "AssetCategory_hotelId_name_key" ON "AssetCategory"("hotelId", lower("name"));
CREATE UNIQUE INDEX "AssetArea_hotelId_name_key" ON "AssetArea"("hotelId", lower("name"));
-- Kodla / seri noyla arama.
CREATE INDEX "Asset_code_trgm_idx" ON "Asset" USING GIN ("code" gin_trgm_ops);
CREATE INDEX "Asset_serialNumber_trgm_idx" ON "Asset" USING GIN ("serialNumber" gin_trgm_ops);

ALTER TABLE "AssetCategory" ADD CONSTRAINT "AssetCategory_valid"
  CHECK (length(btrim("name")) >= 1 AND "usefulLifeYears" BETWEEN 1 AND 50);
ALTER TABLE "AssetArea" ADD CONSTRAINT "AssetArea_valid" CHECK (length(btrim("name")) >= 1);

-- Kart: konum tam olarak bir oda ya da bir alan; zimmet kişi + zaman birlikte ve yalnız kullanımdaki kartta.
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_location_valid" CHECK (num_nonnulls("roomId", "areaId") = 1);
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_assignment_valid"
  CHECK ((("employeeId" IS NULL) = ("assignedAt" IS NULL)) AND ("status" = 'ACTIVE' OR "employeeId" IS NULL));
-- Finansal alanlar: tutar ≥ 0, ömür 1–50; açılış maliyeti aşmaz, yılıyla birlikte yazılır ve alış yılından önce olamaz.
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_financials_valid"
  CHECK (
    "cost" >= 0
    AND "usefulLifeYears" BETWEEN 1 AND 50
    AND "openingAccumulated" >= 0
    AND "openingAccumulated" <= "cost"
    AND (
      ("openingAccumulated" = 0 AND "openingThroughYear" IS NULL)
      OR ("openingAccumulated" > 0 AND "openingThroughYear" >= EXTRACT(YEAR FROM "purchaseDate"))
    )
    AND ("warrantyUntil" IS NULL OR "warrantyUntil" >= "purchaseDate")
  );
-- Elden çıkarma izi: tür, tarih, gerekçe, net değer ve yapan birlikte; satış bedeli yalnız (ve her) satışta.
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_disposal_trail"
  CHECK (
    (
      "status" = 'ACTIVE'
      AND num_nulls("disposalType", "disposedOn", "disposalReason", "disposalBookValue", "disposedBy", "disposalPrice") = 6
    )
    OR (
      "status" = 'DISPOSED'
      AND num_nonnulls("disposalType", "disposedOn", "disposalReason", "disposalBookValue", "disposedBy") = 5
      AND ("disposalType" = 'SOLD') = ("disposalPrice" IS NOT NULL)
      AND "disposedOn" >= "purchaseDate"
    )
  );

ALTER TABLE "AssetDepreciation" ADD CONSTRAINT "AssetDepreciation_valid" CHECK ("amount" > 0 AND "accumulatedAfter" >= "amount");
ALTER TABLE "AssetDepreciationRun" ADD CONSTRAINT "AssetDepreciationRun_valid" CHECK ("total" >= 0 AND "assetCount" >= 0);

-- Sayım: kapsam en fazla bir yer; durum izleri.
ALTER TABLE "AssetCount" ADD CONSTRAINT "AssetCount_scope_valid" CHECK (num_nonnulls("roomId", "areaId") <= 1);
ALTER TABLE "AssetCount" ADD CONSTRAINT "AssetCount_status_trail"
  CHECK (
    ("status" = 'OPEN' AND num_nulls("closedAt", "closedBy", "transferredCount", "cancelledAt", "cancelledBy", "cancelReason") = 6)
    OR ("status" = 'CLOSED' AND num_nonnulls("closedAt", "closedBy", "transferredCount") = 3 AND num_nulls("cancelledAt", "cancelledBy", "cancelReason") = 3)
    OR ("status" = 'CANCELLED' AND num_nonnulls("cancelledAt", "cancelledBy", "cancelReason") = 3 AND num_nulls("closedAt", "closedBy", "transferredCount") = 3)
  );
-- Satır: beklenen açılıştaki yeriyle; kapsam dışından gelen yalnız okutulmuş olabilir; bulunduğu yer okutmayla birlikte.
ALTER TABLE "AssetCountItem" ADD CONSTRAINT "AssetCountItem_valid"
  CHECK (
    ("expected" = (num_nonnulls("expectedRoomId", "expectedAreaId") = 1))
    AND num_nonnulls("expectedRoomId", "expectedAreaId") <= 1
    AND ("expected" OR "foundAt" IS NOT NULL)
    AND (("foundAt" IS NULL) = ("foundBy" IS NULL))
    AND (("foundAt" IS NULL) = (num_nonnulls("foundRoomId", "foundAreaId") = 0))
    AND num_nonnulls("foundRoomId", "foundAreaId") <= 1
  );
