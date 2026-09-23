-- Rezervasyon yönetimi (modül 4): fiyat kaynağı ve iptal / no-show izleri,
-- gece gece fiyat (gelir raporlarının kaynağı), grup rezervasyonu, bekleme
-- listesi, otelin overbooking politikası ve zile "bekleme listesinde yer açıldı".
--
-- Mevcut rezervasyonların geceleri toplam fiyattan eşit bölünerek aktarılır
-- (son gece kuruş farkını alır); taban fiyat ve çarpan bilinmediği için boş kalır.

-- ─────────────── Ön kontroller ───────────────
-- Modül 4'e kadar hiçbir kod grup ya da istek kimliği yazmadı. Varsa sessizce
-- silmek ya da birleştirmek yerine dur: kayıtlar incelenmeli.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Reservation" WHERE "groupId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Reservation.groupId dolu kayıtlar var; modül 4 migration''ı eski grup kimliklerini taşımaz.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Reservation" WHERE "requestId" IS NOT NULL
    GROUP BY "hotelId", "requestId" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Aynı istek kimliğine sahip birden fazla rezervasyon var; tekil index kurulamaz.';
  END IF;
  IF EXISTS (SELECT 1 FROM "Reservation" WHERE "adults" < 1 OR "children" < 0 OR "totalPrice" < 0) THEN
    RAISE EXCEPTION 'Kişi sayısı ya da fiyatı geçersiz rezervasyon var; kısıtlar kurulamaz.';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "ReservationPriceMode" AS ENUM ('CALCULATED', 'MANUAL');
-- CreateEnum
CREATE TYPE "OverbookingPolicy" AS ENUM ('REJECT', 'APPROVAL');
-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'AVAILABLE', 'CONVERTED', 'CANCELLED', 'EXPIRED');
-- AlterEnum
ALTER TYPE "StaffAlertKind" ADD VALUE 'APPROVAL_DECIDED';
ALTER TYPE "StaffAlertKind" ADD VALUE 'WAITLIST_AVAILABLE';
-- AlterTable
ALTER TABLE "Hotel" ADD COLUMN     "overbookingPolicy" "OverbookingPolicy" NOT NULL DEFAULT 'REJECT';
-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancellationFee" DECIMAL(12,2),
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "createdBy" TEXT NOT NULL DEFAULT 'system',
ADD COLUMN     "noShowAt" TIMESTAMP(3),
ADD COLUMN     "noShowFee" DECIMAL(12,2),
ADD COLUMN     "priceMode" "ReservationPriceMode" NOT NULL DEFAULT 'CALCULATED',
ADD COLUMN     "priceNote" TEXT;
-- CreateTable
CREATE TABLE "ReservationGroup" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "ReservationGroup_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "ReservationNight" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "baseRate" DECIMAL(12,2),
    "multiplier" DECIMAL(6,3),
    "seasonName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "ReservationNight_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "guestId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "roomTypeId" TEXT NOT NULL,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3) NOT NULL,
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "boardType" "BoardType" NOT NULL DEFAULT 'BB',
    "notes" TEXT,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "availableSince" TIMESTAMP(3),
    "reservationId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "closeReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "ReservationGroup_code_key" ON "ReservationGroup"("code");
-- CreateIndex
CREATE INDEX "ReservationGroup_hotelId_createdAt_idx" ON "ReservationGroup"("hotelId", "createdAt");
-- CreateIndex
CREATE INDEX "ReservationNight_hotelId_date_idx" ON "ReservationNight"("hotelId", "date");
-- CreateIndex
CREATE UNIQUE INDEX "ReservationNight_reservationId_date_key" ON "ReservationNight"("reservationId", "date");
-- CreateIndex
CREATE INDEX "WaitlistEntry_hotelId_status_checkIn_id_idx" ON "WaitlistEntry"("hotelId", "status", "checkIn", "id");
-- CreateIndex
CREATE INDEX "WaitlistEntry_hotelId_createdAt_id_idx" ON "WaitlistEntry"("hotelId", "createdAt", "id");
-- CreateIndex
CREATE INDEX "Reservation_hotelId_checkIn_id_idx" ON "Reservation"("hotelId", "checkIn", "id");
-- CreateIndex
CREATE INDEX "Reservation_hotelId_createdAt_id_idx" ON "Reservation"("hotelId", "createdAt", "id");
-- CreateIndex
CREATE INDEX "Reservation_hotelId_status_checkIn_id_idx" ON "Reservation"("hotelId", "status", "checkIn", "id");
-- CreateIndex
CREATE INDEX "Reservation_hotelId_groupId_idx" ON "Reservation"("hotelId", "groupId");
-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ReservationGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ReservationGroup" ADD CONSTRAINT "ReservationGroup_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ReservationNight" ADD CONSTRAINT "ReservationNight_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ReservationNight" ADD CONSTRAINT "ReservationNight_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────── Kısıtlar ───────────────

ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_party_valid" CHECK ("adults" >= 1 AND "children" >= 0),
  ADD CONSTRAINT "Reservation_price_valid" CHECK ("totalPrice" >= 0),
  ADD CONSTRAINT "Reservation_fees_valid" CHECK (
    ("cancellationFee" IS NULL OR "cancellationFee" >= 0) AND ("noShowFee" IS NULL OR "noShowFee" >= 0)
  ),
  ADD CONSTRAINT "Reservation_manual_price_has_note" CHECK ("priceMode" <> 'MANUAL' OR "priceNote" IS NOT NULL);

-- Aynı otelde aynı istek kimliğiyle ikinci rezervasyon açılmaz (çift tık, ağ
-- tekrarı, kanaldan yeniden gelen istek).
CREATE UNIQUE INDEX "Reservation_hotelId_requestId_key" ON "Reservation" ("hotelId", "requestId")
  WHERE "requestId" IS NOT NULL;

ALTER TABLE "ReservationNight"
  ADD CONSTRAINT "ReservationNight_day_precision" CHECK ("date" = date_trunc('day', "date")),
  ADD CONSTRAINT "ReservationNight_amount_valid" CHECK ("amount" >= 0);

ALTER TABLE "WaitlistEntry"
  ADD CONSTRAINT "WaitlistEntry_date_order" CHECK (date_trunc('day', "checkOut") > date_trunc('day', "checkIn")),
  ADD CONSTRAINT "WaitlistEntry_party_valid" CHECK ("adults" >= 1 AND "children" >= 0);

-- ─────────────── Mevcut rezervasyonların geceleri ───────────────

WITH src AS (
  SELECT r."id", r."hotelId", r."totalPrice",
         date_trunc('day', r."checkIn") AS "firstNight",
         (date_trunc('day', r."checkOut")::date - date_trunc('day', r."checkIn")::date) AS "nights"
  FROM "Reservation" r
  WHERE r."deletedAt" IS NULL
)
INSERT INTO "ReservationNight" ("id", "hotelId", "reservationId", "date", "amount", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text,
       s."hotelId",
       s."id",
       s."firstNight" + (g.i * interval '1 day'),
       CASE
         WHEN g.i < s."nights" - 1 THEN floor(s."totalPrice" * 100 / s."nights") / 100
         ELSE s."totalPrice" - (s."nights" - 1) * (floor(s."totalPrice" * 100 / s."nights") / 100)
       END,
       now() AT TIME ZONE 'UTC',
       now() AT TIME ZONE 'UTC'
FROM src s
CROSS JOIN LATERAL generate_series(0, s."nights" - 1) AS g(i)
WHERE s."nights" > 0;

-- Onaylı / içeride / çıkmış eski kayıtların onay anı bilinmiyor; açılış anı kullanılır.
UPDATE "Reservation" SET "confirmedAt" = "createdAt"
WHERE "status" IN ('CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT') AND "confirmedAt" IS NULL;

-- Onay kuyruğu: isteyenin kaydından onaya ulaşmak (aynı rezervasyon isteği
-- kapasite aşımıyla ikinci kez gelirse ikinci onay açılmaz).
CREATE INDEX "Approval_hotelId_entityType_entityId_idx" ON "Approval" ("hotelId", "entityType", "entityId");
