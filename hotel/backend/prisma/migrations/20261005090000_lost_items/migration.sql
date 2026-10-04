-- Modül 21: Kayıp eşya.
--
-- Başlangıç şemasındaki kullanılmayan `LostItem` taslağı yeniden kurulur:
-- etiket no, kategori, değerli eşya, bulunduğu oda ya da yer, saklandığı yer,
-- durum (depoda → sahibi bulundu → teslim edildi / kapatıldı), eşleşen misafir
-- ve konaklama, teslim (elden / kargo) ve kapatma izleri. Fotoğraflar
-- (`LostItemPhoto`, dosyalar sunucu diskinde) ve iletişim notları
-- (`LostItemNote`) ayrı tablolarda. Otel: saklama süreleri (normal / değerli).

-- Taslak tablo hiç kullanılmadı; yine de içinde kayıt varsa sessizce bozmayalım.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "LostItem") THEN
    RAISE EXCEPTION 'LostItem tablosunda kayıt var; modül 21 göçü bu kayıtları elle taşımadan çalıştırılmamalı';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "LostItemCategory" AS ENUM ('ELECTRONICS', 'JEWELRY', 'DOCUMENTS', 'CLOTHING', 'ACCESSORY', 'TOY', 'OTHER');

-- CreateEnum
CREATE TYPE "LostItemStatus" AS ENUM ('STORED', 'MATCHED', 'RETURNED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "LostItemReturnMethod" AS ENUM ('IN_PERSON', 'SHIPPED');

-- CreateEnum
CREATE TYPE "LostItemShippingPayer" AS ENUM ('GUEST', 'HOTEL');

-- CreateEnum
CREATE TYPE "LostItemDisposal" AS ENUM ('DONATED', 'DESTROYED', 'POLICE', 'RECORD_ERROR');

-- CreateEnum
CREATE TYPE "LostItemContactChannel" AS ENUM ('PHONE', 'WHATSAPP', 'SMS', 'EMAIL', 'IN_PERSON', 'NOTE');

-- AlterTable
ALTER TABLE "Hotel" ADD COLUMN     "lostItemRetentionDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "lostItemValuableRetentionDays" INTEGER NOT NULL DEFAULT 365;

-- AlterTable
ALTER TABLE "LostItem" DROP COLUMN "foundBy",
DROP COLUMN "returnedAt",
ADD COLUMN     "businessDate" DATE NOT NULL,
ADD COLUMN     "carrier" TEXT,
ADD COLUMN     "category" "LostItemCategory" NOT NULL,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedBy" TEXT,
ADD COLUMN     "disposalMethod" "LostItemDisposal",
ADD COLUMN     "disposalReason" TEXT,
ADD COLUMN     "foundByName" TEXT NOT NULL,
ADD COLUMN     "locationText" TEXT,
ADD COLUMN     "matchedAt" TIMESTAMP(3),
ADD COLUMN     "matchedBy" TEXT,
ADD COLUMN     "photosPurgedAt" TIMESTAMP(3),
ADD COLUMN     "receiverIdChecked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "receiverName" TEXT,
ADD COLUMN     "recordedBy" TEXT NOT NULL,
ADD COLUMN     "reference" TEXT NOT NULL,
ADD COLUMN     "requestId" TEXT NOT NULL,
ADD COLUMN     "reservationId" TEXT,
ADD COLUMN     "returnMethod" "LostItemReturnMethod",
ADD COLUMN     "returnNote" TEXT,
ADD COLUMN     "shippingAddress" TEXT,
ADD COLUMN     "shippingCost" DECIMAL(12,2),
ADD COLUMN     "shippingPayer" "LostItemShippingPayer",
ADD COLUMN     "storageLocation" TEXT NOT NULL,
ADD COLUMN     "trackingNumber" TEXT,
ADD COLUMN     "valuable" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "foundAt" DROP DEFAULT,
DROP COLUMN "status",
ADD COLUMN     "status" "LostItemStatus" NOT NULL DEFAULT 'STORED';

-- CreateTable
CREATE TABLE "LostItemPhoto" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "thumbBytes" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LostItemPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LostItemNote" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "channel" "LostItemContactChannel" NOT NULL,
    "text" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LostItemNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LostItemPhoto_itemId_createdAt_idx" ON "LostItemPhoto"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "LostItemNote_itemId_createdAt_idx" ON "LostItemNote"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "LostItem_hotelId_status_foundAt_id_idx" ON "LostItem"("hotelId", "status", "foundAt" DESC, "id");

-- CreateIndex
CREATE INDEX "LostItem_hotelId_status_valuable_businessDate_idx" ON "LostItem"("hotelId", "status", "valuable", "businessDate");

-- CreateIndex
CREATE INDEX "LostItem_hotelId_status_closedAt_id_idx" ON "LostItem"("hotelId", "status", "closedAt" DESC, "id");

-- CreateIndex
CREATE INDEX "LostItem_hotelId_roomId_foundAt_idx" ON "LostItem"("hotelId", "roomId", "foundAt");

-- CreateIndex
CREATE INDEX "LostItem_hotelId_businessDate_idx" ON "LostItem"("hotelId", "businessDate");

-- CreateIndex
CREATE INDEX "LostItem_guestId_status_idx" ON "LostItem"("guestId", "status");

-- CreateIndex
CREATE INDEX "LostItem_reservationId_status_idx" ON "LostItem"("reservationId", "status");

-- CreateIndex
CREATE INDEX "LostItem_description_trgm_idx" ON "LostItem" USING GIN ("description" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "LostItem_locationText_trgm_idx" ON "LostItem" USING GIN ("locationText" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "LostItem_hotelId_reference_key" ON "LostItem"("hotelId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "LostItem_hotelId_requestId_key" ON "LostItem"("hotelId", "requestId");

-- AddForeignKey
ALTER TABLE "LostItem" ADD CONSTRAINT "LostItem_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostItemPhoto" ADD CONSTRAINT "LostItemPhoto_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostItemPhoto" ADD CONSTRAINT "LostItemPhoto_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LostItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostItemNote" ADD CONSTRAINT "LostItemNote_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostItemNote" ADD CONSTRAINT "LostItemNote_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LostItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────── Kısmi index (fotoğraf silme işi) ───────────────

-- Kapanmış, fotoğrafları henüz silinmemiş eşyalar: saatlik iş bütün otellerde
-- yalnızca bunları tarar.
CREATE INDEX "LostItem_photo_purge_idx" ON "LostItem"("closedAt") WHERE "closedAt" IS NOT NULL AND "photosPurgedAt" IS NULL;

-- ─────────────── Kısıtlar (servisin kontrolüne ek, son savunma hattı) ───────────────

ALTER TABLE "Hotel" ADD CONSTRAINT "Hotel_lost_item_retention_range"
  CHECK ("lostItemRetentionDays" BETWEEN 7 AND 3650
     AND "lostItemValuableRetentionDays" BETWEEN 7 AND 3650
     AND "lostItemValuableRetentionDays" >= "lostItemRetentionDays");

-- Bulunduğu yer: oda ya da yazılı yer.
ALTER TABLE "LostItem" ADD CONSTRAINT "LostItem_place_present"
  CHECK ("roomId" IS NOT NULL OR "locationText" IS NOT NULL);

-- Eşleşme izi: eşleşen eşyada misafir ve eşleştiren var; konaklama misafirsiz olmaz.
ALTER TABLE "LostItem" ADD CONSTRAINT "LostItem_match_trail"
  CHECK (("status" <> 'MATCHED' OR ("guestId" IS NOT NULL AND "matchedAt" IS NOT NULL AND "matchedBy" IS NOT NULL))
     AND ("reservationId" IS NULL OR "guestId" IS NOT NULL));

-- Kapanış izi: teslim edilen ya da kapatılan eşyada an ve kişi var; açıkta yok.
ALTER TABLE "LostItem" ADD CONSTRAINT "LostItem_close_trail"
  CHECK (("status" IN ('RETURNED', 'DISPOSED')) = ("closedAt" IS NOT NULL)
     AND ("closedAt" IS NULL) = ("closedBy" IS NULL));

-- Teslim: yöntem var; elden teslimde teslim alan, kargoda firma + takip no + adres + ödeyen.
ALTER TABLE "LostItem" ADD CONSTRAINT "LostItem_return_trail"
  CHECK (("status" = 'RETURNED') = ("returnMethod" IS NOT NULL)
     AND ("returnMethod" IS DISTINCT FROM 'IN_PERSON' OR "receiverName" IS NOT NULL)
     AND ("returnMethod" IS DISTINCT FROM 'SHIPPED'
          OR ("carrier" IS NOT NULL AND "trackingNumber" IS NOT NULL AND "shippingAddress" IS NOT NULL AND "shippingPayer" IS NOT NULL))
     AND ("shippingCost" IS NULL OR "shippingCost" >= 0));

-- Kapatma: yöntem ve gerekçe birlikte, yalnızca kapatılan eşyada.
ALTER TABLE "LostItem" ADD CONSTRAINT "LostItem_disposal_trail"
  CHECK (("status" = 'DISPOSED') = ("disposalMethod" IS NOT NULL)
     AND ("disposalMethod" IS NULL) = ("disposalReason" IS NULL));

ALTER TABLE "LostItemPhoto" ADD CONSTRAINT "LostItemPhoto_sizes_positive"
  CHECK ("sizeBytes" > 0 AND "thumbBytes" > 0 AND "contentType" IN ('image/jpeg', 'image/webp'));
