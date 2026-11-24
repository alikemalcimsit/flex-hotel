-- Modül 26: Rapor tasarımcısı + Excel yükleme.

-- CreateTable
CREATE TABLE "ReportDefinition" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "design" JSONB NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataImport" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT,
    "total" INTEGER NOT NULL,
    "created" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportDefinition_hotelId_owner_updatedAt_idx" ON "ReportDefinition"("hotelId", "owner", "updatedAt");

-- CreateIndex
CREATE INDEX "ReportDefinition_hotelId_shared_updatedAt_idx" ON "ReportDefinition"("hotelId", "shared", "updatedAt");

-- CreateIndex
CREATE INDEX "DataImport_hotelId_createdAt_idx" ON "DataImport"("hotelId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReportDefinition" ADD CONSTRAINT "ReportDefinition_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataImport" ADD CONSTRAINT "DataImport_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "ReportDefinition" ADD CONSTRAINT "ReportDefinition_valid"
  CHECK (length(btrim("title")) BETWEEN 1 AND 80 AND "source" IN ('RESERVATIONS', 'FOLIO_ITEMS', 'GUESTS', 'PAYMENTS'));
ALTER TABLE "DataImport" ADD CONSTRAINT "DataImport_valid"
  CHECK ("kind" IN ('GUESTS', 'RATE_PLANS') AND "total" >= 0 AND "created" >= 0 AND "skipped" >= 0 AND "created" + "skipped" <= "total");
