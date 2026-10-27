-- Modül 41: oda servisi. Satış noktası türü (salon / oda servisi), sistem ürünü (tepsi ücreti), oda servisi
-- politikası, oda servisi siparişi ve misafirin QR sipariş bağlantısı. Tablolar Prisma'nın ürettiği; altta
-- veritabanı kuralları (CHECK, kısmi tekil index) elle.

-- CreateEnum
CREATE TYPE "PosOutletKind" AS ENUM ('DINING', 'ROOM_SERVICE');

-- CreateEnum
CREATE TYPE "PosSystemItem" AS ENUM ('TRAY_CHARGE');

-- CreateEnum
CREATE TYPE "RoomServiceSource" AS ENUM ('STAFF', 'GUEST', 'REQUEST');

-- CreateEnum
CREATE TYPE "RoomServiceStatus" AS ENUM ('REQUESTED', 'SCHEDULED', 'RECEIVED', 'PREPARING', 'READY', 'ON_THE_WAY', 'DELIVERED', 'CANCELLED', 'REJECTED');

-- AlterTable
ALTER TABLE "MenuCategory" ADD COLUMN     "system" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "system" "PosSystemItem";

-- AlterTable
ALTER TABLE "PosOutlet" ADD COLUMN     "kind" "PosOutletKind" NOT NULL DEFAULT 'DINING';

-- AlterTable
ALTER TABLE "PosSettings" ADD COLUMN     "deliveryTargetMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "guestOrderingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prepLeadMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "trayAlertMinutes" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "trayCharge" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RoomServiceOrder" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "checkId" TEXT,
    "reservationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "roomNumber" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "source" "RoomServiceSource" NOT NULL,
    "guestRequestId" TEXT,
    "linkId" TEXT,
    "status" "RoomServiceStatus" NOT NULL,
    "covers" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "deliverAt" TIMESTAMP(3),
    "releaseAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3) NOT NULL,
    "items" JSONB NOT NULL,
    "itemsTotal" DECIMAL(14,2) NOT NULL,
    "trayExpected" BOOLEAN NOT NULL DEFAULT true,
    "sourceKey" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "acceptedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectReason" TEXT,
    "receivedAt" TIMESTAMP(3),
    "preparingAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "runnerEmail" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "deliveredBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "trayCollectedAt" TIMESTAMP(3),
    "trayCollectedBy" TEXT,
    "lateAlertedAt" TIMESTAMP(3),
    "trayAlertedAt" TIMESTAMP(3),
    "waitAlertedAt" TIMESTAMP(3),
    "stayAlertedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomServiceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomServiceLink" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "RoomServiceLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoomServiceOrder_checkId_key" ON "RoomServiceOrder"("checkId");

-- CreateIndex
CREATE INDEX "RoomServiceOrder_hotelId_status_dueAt_idx" ON "RoomServiceOrder"("hotelId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "RoomServiceOrder_hotelId_status_releaseAt_idx" ON "RoomServiceOrder"("hotelId", "status", "releaseAt");

-- CreateIndex
CREATE INDEX "RoomServiceOrder_hotelId_deliverAt_idx" ON "RoomServiceOrder"("hotelId", "deliverAt");

-- CreateIndex
CREATE INDEX "RoomServiceOrder_hotelId_status_deliveredAt_idx" ON "RoomServiceOrder"("hotelId", "status", "deliveredAt");

-- CreateIndex
CREATE INDEX "RoomServiceOrder_hotelId_createdAt_id_idx" ON "RoomServiceOrder"("hotelId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "RoomServiceOrder_hotelId_roomNumber_createdAt_idx" ON "RoomServiceOrder"("hotelId", "roomNumber", "createdAt");

-- CreateIndex
CREATE INDEX "RoomServiceOrder_reservationId_status_idx" ON "RoomServiceOrder"("reservationId", "status");

-- CreateIndex
CREATE INDEX "RoomServiceOrder_linkId_status_idx" ON "RoomServiceOrder"("linkId", "status");

-- CreateIndex
CREATE INDEX "RoomServiceOrder_guestRequestId_idx" ON "RoomServiceOrder"("guestRequestId");

-- CreateIndex
CREATE INDEX "RoomServiceOrder_number_trgm_idx" ON "RoomServiceOrder" USING GIN ("number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "RoomServiceOrder_guestName_trgm_idx" ON "RoomServiceOrder" USING GIN ("guestName" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "RoomServiceOrder_hotelId_number_key" ON "RoomServiceOrder"("hotelId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "RoomServiceOrder_hotelId_sourceKey_key" ON "RoomServiceOrder"("hotelId", "sourceKey");

-- CreateIndex
CREATE INDEX "RoomServiceLink_reservationId_revokedAt_idx" ON "RoomServiceLink"("reservationId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_hotelId_system_key" ON "MenuItem"("hotelId", "system");

-- AddForeignKey
ALTER TABLE "RoomServiceOrder" ADD CONSTRAINT "RoomServiceOrder_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomServiceOrder" ADD CONSTRAINT "RoomServiceOrder_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "PosOutlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomServiceOrder" ADD CONSTRAINT "RoomServiceOrder_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "PosCheck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomServiceOrder" ADD CONSTRAINT "RoomServiceOrder_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomServiceOrder" ADD CONSTRAINT "RoomServiceOrder_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomServiceOrder" ADD CONSTRAINT "RoomServiceOrder_guestRequestId_fkey" FOREIGN KEY ("guestRequestId") REFERENCES "GuestRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomServiceOrder" ADD CONSTRAINT "RoomServiceOrder_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "RoomServiceLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomServiceLink" ADD CONSTRAINT "RoomServiceLink_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomServiceLink" ADD CONSTRAINT "RoomServiceLink_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomServiceLink" ADD CONSTRAINT "RoomServiceLink_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────── Veritabanı kuralları (elle) ───────────────

-- Oda servisi noktası odaya yazmaya açıktır (teslimde kalan folyoya yazılır).
ALTER TABLE "PosOutlet"
  ADD CONSTRAINT "PosOutlet_room_service_charges" CHECK ("kind" <> 'ROOM_SERVICE' OR "allowRoomCharge");

-- Otelde tek sistem grubu (tepsi ücreti gibi gizli ürünlerin grubu).
CREATE UNIQUE INDEX "MenuCategory_one_system_per_hotel" ON "MenuCategory"("hotelId") WHERE "system";

-- Oda servisi politikası: ücret eksi olamaz; süreler makul aralıkta.
ALTER TABLE "PosSettings"
  ADD CONSTRAINT "PosSettings_room_service_valid" CHECK (
    "trayCharge" >= 0
    AND "deliveryTargetMinutes" BETWEEN 5 AND 240
    AND "prepLeadMinutes" BETWEEN 5 AND 240
    AND "trayAlertMinutes" BETWEEN 15 AND 1440
  );

-- Oda servisi siparişi: kişi, tutar, kaynağın bağı ve durum izi.
--   * Kabul bekleyen ve ileri saatli sipariş adisyonsuzdur; mutfağa düşmüş (ve teslim edilmiş) siparişin adisyonu vardır.
--   * İptal edilen sipariş mutfağa düştüyse adisyonu kalır (kalemleri iptal / zayi), düşmediyse adisyonsuzdur.
--   * Ret yalnızca misafir siparişine, kabulden önce.
ALTER TABLE "RoomServiceOrder"
  ADD CONSTRAINT "RoomServiceOrder_valid" CHECK (
    "covers" BETWEEN 1 AND 200 AND "itemsTotal" >= 0 AND jsonb_typeof("items") = 'array'
    AND length(btrim("roomNumber")) >= 1 AND length(btrim("number")) >= 1
    AND ("note" IS NULL OR length("note") <= 500)
  ),
  ADD CONSTRAINT "RoomServiceOrder_source_link" CHECK (
    ("source" <> 'REQUEST' OR "guestRequestId" IS NOT NULL)
    AND ("source" <> 'GUEST' OR "linkId" IS NOT NULL)
  ),
  ADD CONSTRAINT "RoomServiceOrder_status_trail" CHECK (
    ("status" = 'REQUESTED' AND "source" = 'GUEST' AND "checkId" IS NULL AND "acceptedAt" IS NULL)
    OR ("status" = 'SCHEDULED' AND "checkId" IS NULL AND "releaseAt" IS NOT NULL AND "deliverAt" IS NOT NULL)
    OR ("status" = 'RECEIVED' AND "checkId" IS NOT NULL AND "receivedAt" IS NOT NULL)
    OR ("status" = 'PREPARING' AND "checkId" IS NOT NULL AND "receivedAt" IS NOT NULL AND "preparingAt" IS NOT NULL)
    OR ("status" = 'READY' AND "checkId" IS NOT NULL AND "receivedAt" IS NOT NULL AND "readyAt" IS NOT NULL)
    OR ("status" = 'ON_THE_WAY' AND "checkId" IS NOT NULL AND "receivedAt" IS NOT NULL AND "dispatchedAt" IS NOT NULL AND "runnerEmail" IS NOT NULL)
    OR ("status" = 'DELIVERED' AND "checkId" IS NOT NULL AND "receivedAt" IS NOT NULL AND "deliveredAt" IS NOT NULL AND "deliveredBy" IS NOT NULL)
    OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledBy" IS NOT NULL AND "cancelReason" IS NOT NULL)
    OR ("status" = 'REJECTED' AND "source" = 'GUEST' AND "checkId" IS NULL AND "rejectedAt" IS NOT NULL AND "rejectedBy" IS NOT NULL AND "rejectReason" IS NOT NULL)
  ),
  ADD CONSTRAINT "RoomServiceOrder_tray_after_delivery" CHECK ("trayCollectedAt" IS NULL OR ("deliveredAt" IS NOT NULL AND "trayExpected"));

-- Misafir isteği aynı anda tek açık (bitmemiş) siparişe çevrilir; teslim / iptal / ret sonrası istek yeniden açılırsa
-- yeniden çevrilebilir.
CREATE UNIQUE INDEX "RoomServiceOrder_one_active_per_request" ON "RoomServiceOrder"("guestRequestId")
  WHERE "guestRequestId" IS NOT NULL AND "status" IN ('REQUESTED', 'SCHEDULED', 'RECEIVED', 'PREPARING', 'READY', 'ON_THE_WAY');

-- Toplanacak tepsiler (teslim edilmiş, tepsi bırakılmış, toplanmamış): pano sayacı ve uyarı taraması.
CREATE INDEX "RoomServiceOrder_trays_pending" ON "RoomServiceOrder"("hotelId", "deliveredAt")
  WHERE "status" = 'DELIVERED' AND "trayExpected" AND "trayCollectedAt" IS NULL;

-- Konaklamada tek geçerli QR bağlantısı (yenilenince eskisi iptal edilir).
CREATE UNIQUE INDEX "RoomServiceLink_one_active_per_stay" ON "RoomServiceLink"("reservationId") WHERE "revokedAt" IS NULL;
ALTER TABLE "RoomServiceLink" ADD CONSTRAINT "RoomServiceLink_nonce_valid" CHECK (length("nonce") >= 16);
