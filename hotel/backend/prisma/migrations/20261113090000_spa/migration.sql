-- SPA ve spor salonu (modül 57). Tablolar Prisma'nın ürettiği; altta veritabanı kuralları (CHECK, EXCLUDE,
-- kısmi index) elle: Prisma bunları ifade edemez.

-- CreateEnum
CREATE TYPE "SpaServiceKind" AS ENUM ('PRIVATE', 'GROUP');

-- CreateEnum
CREATE TYPE "SpaAppointmentStatus" AS ENUM ('BOOKED', 'WAITLISTED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "SpaBookingSource" AS ENUM ('STAFF', 'PORTAL');

-- CreateEnum
CREATE TYPE "SpaSessionStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "FolioItemSource" ADD VALUE 'SPA';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationSource" ADD VALUE 'SPA_BOOKED';
ALTER TYPE "NotificationSource" ADD VALUE 'SPA_REMINDER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationTrigger" ADD VALUE 'SPA_BOOKED';
ALTER TYPE "NotificationTrigger" ADD VALUE 'SPA_REMINDER';

-- AlterEnum
ALTER TYPE "StaffAlertKind" ADD VALUE 'SPA';

-- AlterEnum
ALTER TYPE "TreasuryChannel" ADD VALUE 'SPA';

-- CreateTable
CREATE TABLE "SpaSettings" (
    "hotelId" TEXT NOT NULL,
    "openMinute" INTEGER NOT NULL DEFAULT 540,
    "closeMinute" INTEGER NOT NULL DEFAULT 1320,
    "slotMinutes" INTEGER NOT NULL DEFAULT 15,
    "freeCancelHours" INTEGER NOT NULL DEFAULT 4,
    "lateCancelFeePct" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "noShowFeePct" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "portalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "portalLeadMinutes" INTEGER NOT NULL DEFAULT 120,
    "portalMaxActive" INTEGER NOT NULL DEFAULT 4,
    "reminderHours" INTEGER NOT NULL DEFAULT 2,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaSettings_pkey" PRIMARY KEY ("hotelId")
);

-- CreateTable
CREATE TABLE "SpaRoom" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SpaRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaTherapist" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "gender" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SpaTherapist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaTherapistHour" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "SpaTherapistHour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaService" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "translations" JSONB NOT NULL DEFAULT '{}',
    "category" TEXT NOT NULL,
    "kind" "SpaServiceKind" NOT NULL DEFAULT 'PRIVATE',
    "durationMinutes" INTEGER NOT NULL,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(12,2) NOT NULL,
    "therapistCount" INTEGER NOT NULL DEFAULT 1,
    "guestCount" INTEGER NOT NULL DEFAULT 1,
    "capacity" INTEGER,
    "requiresRoom" BOOLEAN NOT NULL DEFAULT true,
    "portalBookable" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SpaService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaServiceTherapist" (
    "serviceId" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,

    CONSTRAINT "SpaServiceTherapist_pkey" PRIMARY KEY ("serviceId","therapistId")
);

-- CreateTable
CREATE TABLE "SpaServiceRoom" (
    "serviceId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,

    CONSTRAINT "SpaServiceRoom_pkey" PRIMARY KEY ("serviceId","roomId")
);

-- CreateTable
CREATE TABLE "SpaBlock" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "therapistId" TEXT,
    "roomId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpaBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaHold" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "therapistId" TEXT,
    "roomId" TEXT,
    "appointmentId" TEXT,
    "sessionId" TEXT,
    "blockId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpaHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaSession" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "status" "SpaSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "note" TEXT,
    "bookedCount" INTEGER NOT NULL DEFAULT 0,
    "waitlistCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SpaSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaSequence" (
    "hotelId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "SpaSequence_pkey" PRIMARY KEY ("hotelId","year")
);

-- CreateTable
CREATE TABLE "SpaAppointment" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "sessionId" TEXT,
    "serviceName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "kind" "SpaServiceKind" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "busyUntil" TIMESTAMP(3) NOT NULL,
    "guestCount" INTEGER NOT NULL DEFAULT 1,
    "reservationId" TEXT,
    "guestId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "roomNumber" TEXT,
    "status" "SpaAppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "source" "SpaBookingSource" NOT NULL DEFAULT 'STAFF',
    "therapistPreference" TEXT,
    "note" TEXT,
    "listPrice" DECIMAL(12,2) NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "priceReason" TEXT,
    "priceBy" TEXT,
    "feePct" DECIMAL(5,2),
    "feeWaivedBy" TEXT,
    "feeWaiveReason" TEXT,
    "amountDue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalDue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paidTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "roomChargeTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "requestKey" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "SpaAppointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaPayment" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'PAYMENT',
    "status" "PaymentStatus" NOT NULL DEFAULT 'POSTED',
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "sourceKey" TEXT,
    "receivedBy" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMP(3),
    "approvalId" TEXT,
    "declinedAt" TIMESTAMP(3),
    "reversalOfId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,
    "voidApprovalId" TEXT,
    "voidRequestedAt" TIMESTAMP(3),
    "voidRequestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaRoomCharge" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "roomNumber" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "eventId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "chargedBy" TEXT NOT NULL,
    "chargedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessDate" DATE NOT NULL,

    CONSTRAINT "SpaRoomCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpaRoom_hotelId_sortOrder_name_idx" ON "SpaRoom"("hotelId", "sortOrder", "name");

-- CreateIndex
CREATE INDEX "SpaTherapist_hotelId_sortOrder_name_idx" ON "SpaTherapist"("hotelId", "sortOrder", "name");

-- CreateIndex
CREATE INDEX "SpaTherapistHour_hotelId_idx" ON "SpaTherapistHour"("hotelId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaTherapistHour_therapistId_weekday_startMinute_key" ON "SpaTherapistHour"("therapistId", "weekday", "startMinute");

-- CreateIndex
CREATE INDEX "SpaService_hotelId_kind_sortOrder_name_idx" ON "SpaService"("hotelId", "kind", "sortOrder", "name");

-- CreateIndex
CREATE INDEX "SpaServiceTherapist_therapistId_idx" ON "SpaServiceTherapist"("therapistId");

-- CreateIndex
CREATE INDEX "SpaServiceRoom_roomId_idx" ON "SpaServiceRoom"("roomId");

-- CreateIndex
CREATE INDEX "SpaBlock_hotelId_endsAt_idx" ON "SpaBlock"("hotelId", "endsAt");

-- CreateIndex
CREATE INDEX "SpaBlock_therapistId_endsAt_idx" ON "SpaBlock"("therapistId", "endsAt");

-- CreateIndex
CREATE INDEX "SpaBlock_roomId_endsAt_idx" ON "SpaBlock"("roomId", "endsAt");

-- CreateIndex
CREATE INDEX "SpaHold_hotelId_startsAt_idx" ON "SpaHold"("hotelId", "startsAt");

-- CreateIndex
CREATE INDEX "SpaHold_therapistId_startsAt_idx" ON "SpaHold"("therapistId", "startsAt");

-- CreateIndex
CREATE INDEX "SpaHold_roomId_startsAt_idx" ON "SpaHold"("roomId", "startsAt");

-- CreateIndex
CREATE INDEX "SpaHold_appointmentId_idx" ON "SpaHold"("appointmentId");

-- CreateIndex
CREATE INDEX "SpaHold_sessionId_idx" ON "SpaHold"("sessionId");

-- CreateIndex
CREATE INDEX "SpaHold_blockId_idx" ON "SpaHold"("blockId");

-- CreateIndex
CREATE INDEX "SpaSession_hotelId_startsAt_id_idx" ON "SpaSession"("hotelId", "startsAt", "id");

-- CreateIndex
CREATE INDEX "SpaSession_hotelId_status_startsAt_idx" ON "SpaSession"("hotelId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "SpaSession_serviceId_startsAt_idx" ON "SpaSession"("serviceId", "startsAt");

-- CreateIndex
CREATE INDEX "SpaAppointment_hotelId_startsAt_id_idx" ON "SpaAppointment"("hotelId", "startsAt", "id");

-- CreateIndex
CREATE INDEX "SpaAppointment_hotelId_status_startsAt_id_idx" ON "SpaAppointment"("hotelId", "status", "startsAt", "id");

-- CreateIndex
CREATE INDEX "SpaAppointment_hotelId_serviceId_startsAt_idx" ON "SpaAppointment"("hotelId", "serviceId", "startsAt");

-- CreateIndex
CREATE INDEX "SpaAppointment_reservationId_startsAt_idx" ON "SpaAppointment"("reservationId", "startsAt");

-- CreateIndex
CREATE INDEX "SpaAppointment_sessionId_status_createdAt_idx" ON "SpaAppointment"("sessionId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SpaAppointment_customerName_trgm_idx" ON "SpaAppointment" USING GIN ("customerName" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "SpaAppointment_hotelId_code_key" ON "SpaAppointment"("hotelId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SpaAppointment_hotelId_requestKey_key" ON "SpaAppointment"("hotelId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "SpaPayment_reversalOfId_key" ON "SpaPayment"("reversalOfId");

-- CreateIndex
CREATE INDEX "SpaPayment_appointmentId_receivedAt_id_idx" ON "SpaPayment"("appointmentId", "receivedAt", "id");

-- CreateIndex
CREATE INDEX "SpaPayment_hotelId_businessDate_postedAt_id_idx" ON "SpaPayment"("hotelId", "businessDate", "postedAt", "id");

-- CreateIndex
CREATE INDEX "SpaPayment_hotelId_status_receivedAt_idx" ON "SpaPayment"("hotelId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "SpaPayment_approvalId_idx" ON "SpaPayment"("approvalId");

-- CreateIndex
CREATE INDEX "SpaPayment_voidApprovalId_idx" ON "SpaPayment"("voidApprovalId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaPayment_hotelId_sourceKey_key" ON "SpaPayment"("hotelId", "sourceKey");

-- CreateIndex
CREATE INDEX "SpaRoomCharge_appointmentId_idx" ON "SpaRoomCharge"("appointmentId");

-- CreateIndex
CREATE INDEX "SpaRoomCharge_hotelId_businessDate_idx" ON "SpaRoomCharge"("hotelId", "businessDate");

-- CreateIndex
CREATE INDEX "SpaRoomCharge_reservationId_idx" ON "SpaRoomCharge"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaRoomCharge_hotelId_sourceKey_key" ON "SpaRoomCharge"("hotelId", "sourceKey");

-- AddForeignKey
ALTER TABLE "SpaSettings" ADD CONSTRAINT "SpaSettings_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaRoom" ADD CONSTRAINT "SpaRoom_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaTherapist" ADD CONSTRAINT "SpaTherapist_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaTherapistHour" ADD CONSTRAINT "SpaTherapistHour_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "SpaTherapist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaService" ADD CONSTRAINT "SpaService_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaServiceTherapist" ADD CONSTRAINT "SpaServiceTherapist_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "SpaService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaServiceTherapist" ADD CONSTRAINT "SpaServiceTherapist_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "SpaTherapist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaServiceRoom" ADD CONSTRAINT "SpaServiceRoom_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "SpaService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaServiceRoom" ADD CONSTRAINT "SpaServiceRoom_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "SpaRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaBlock" ADD CONSTRAINT "SpaBlock_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaBlock" ADD CONSTRAINT "SpaBlock_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "SpaTherapist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaBlock" ADD CONSTRAINT "SpaBlock_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "SpaRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaHold" ADD CONSTRAINT "SpaHold_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "SpaTherapist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaHold" ADD CONSTRAINT "SpaHold_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "SpaRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaHold" ADD CONSTRAINT "SpaHold_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "SpaAppointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaHold" ADD CONSTRAINT "SpaHold_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SpaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaHold" ADD CONSTRAINT "SpaHold_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "SpaBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaSession" ADD CONSTRAINT "SpaSession_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaSession" ADD CONSTRAINT "SpaSession_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "SpaService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaAppointment" ADD CONSTRAINT "SpaAppointment_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaAppointment" ADD CONSTRAINT "SpaAppointment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "SpaService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaAppointment" ADD CONSTRAINT "SpaAppointment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SpaSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaAppointment" ADD CONSTRAINT "SpaAppointment_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaAppointment" ADD CONSTRAINT "SpaAppointment_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaPayment" ADD CONSTRAINT "SpaPayment_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaPayment" ADD CONSTRAINT "SpaPayment_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "SpaAppointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaPayment" ADD CONSTRAINT "SpaPayment_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "Approval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaPayment" ADD CONSTRAINT "SpaPayment_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "SpaPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaRoomCharge" ADD CONSTRAINT "SpaRoomCharge_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "SpaAppointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaRoomCharge" ADD CONSTRAINT "SpaRoomCharge_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ══════════════════ Elle: veritabanı kuralları ══════════════════

-- Ayar sınırları (sözleşmedeki sınırlarla aynı).
ALTER TABLE "SpaSettings" ADD CONSTRAINT "SpaSettings_limits" CHECK (
  "openMinute" BETWEEN 0 AND 1380 AND "closeMinute" BETWEEN 60 AND 1440 AND "closeMinute" > "openMinute"
  AND "slotMinutes" IN (5, 10, 15, 20, 30, 60) AND "freeCancelHours" BETWEEN 0 AND 168
  AND "lateCancelFeePct" BETWEEN 0 AND 100 AND "noShowFeePct" BETWEEN 0 AND 100
  AND "portalLeadMinutes" BETWEEN 0 AND 10080 AND "portalMaxActive" BETWEEN 1 AND 20 AND "reminderHours" BETWEEN 0 AND 72);

-- Ad, silinmemiş kayıtlar arasında tekil (büyük / küçük harf ayrımsız).
CREATE UNIQUE INDEX "SpaRoom_name_active_key" ON "SpaRoom" ("hotelId", lower("name")) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "SpaTherapist_name_active_key" ON "SpaTherapist" ("hotelId", lower("name")) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "SpaService_name_active_key" ON "SpaService" ("hotelId", lower("name")) WHERE "deletedAt" IS NULL;

ALTER TABLE "SpaRoom" ADD CONSTRAINT "SpaRoom_valid" CHECK (length(btrim("name")) >= 2);
ALTER TABLE "SpaTherapist" ADD CONSTRAINT "SpaTherapist_valid" CHECK (length(btrim("name")) >= 2 AND ("gender" IS NULL OR "gender" IN ('FEMALE', 'MALE')));
ALTER TABLE "SpaTherapistHour" ADD CONSTRAINT "SpaTherapistHour_valid" CHECK ("weekday" BETWEEN 1 AND 7 AND "startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute");

-- Hizmet: süre, ara, fiyat, terapist / misafir sayısı; kontenjan yalnız grup dersinde.
ALTER TABLE "SpaService" ADD CONSTRAINT "SpaService_valid" CHECK (
  length(btrim("name")) >= 2 AND "durationMinutes" BETWEEN 5 AND 600 AND "bufferMinutes" BETWEEN 0 AND 120 AND "price" >= 0
  AND "therapistCount" BETWEEN 0 AND 4 AND "guestCount" BETWEEN 1 AND 4
  AND (("kind" = 'GROUP') = ("capacity" IS NOT NULL)) AND ("capacity" IS NULL OR "capacity" BETWEEN 2 AND 500)
  AND ("kind" = 'PRIVATE' OR ("therapistCount" <= 1 AND "guestCount" = 1)));

-- Blok: bir terapistin ya da bir odanın (ikisi birden değil) geçerli aralığı.
ALTER TABLE "SpaBlock" ADD CONSTRAINT "SpaBlock_valid" CHECK (
  "endsAt" > "startsAt" AND (("therapistId" IS NOT NULL)::int + ("roomId" IS NOT NULL)::int) = 1 AND length(btrim("reason")) >= 2);

-- Tutma: tek kaynak, tek sahip; aynı terapiste / odaya çakışan iki etkin tutma olamaz (çifte randevunun son kalesi:
-- uygulama boş saati hesaplar, yarışı bu kısıt keser).
ALTER TABLE "SpaHold" ADD CONSTRAINT "SpaHold_valid" CHECK (
  "endsAt" > "startsAt"
  AND (("therapistId" IS NOT NULL)::int + ("roomId" IS NOT NULL)::int) = 1
  AND (("appointmentId" IS NOT NULL)::int + ("sessionId" IS NOT NULL)::int + ("blockId" IS NOT NULL)::int) = 1);
ALTER TABLE "SpaHold" ADD CONSTRAINT "SpaHold_no_therapist_overlap"
  EXCLUDE USING gist ("therapistId" WITH =, tsrange("startsAt", "endsAt", '[)') WITH &&)
  WHERE ("active" AND "therapistId" IS NOT NULL);
ALTER TABLE "SpaHold" ADD CONSTRAINT "SpaHold_no_room_overlap"
  EXCLUDE USING gist ("roomId" WITH =, tsrange("startsAt", "endsAt", '[)') WITH &&)
  WHERE ("active" AND "roomId" IS NOT NULL);

-- Seans: aralık, kontenjan; asıl liste kontenjanı aşamaz.
ALTER TABLE "SpaSession" ADD CONSTRAINT "SpaSession_valid" CHECK (
  "endsAt" > "startsAt" AND "capacity" BETWEEN 1 AND 500 AND "price" >= 0
  AND "bookedCount" BETWEEN 0 AND "capacity" AND "waitlistCount" >= 0);

-- Randevu: aralık, tutarlar, bakiye tutarlılığı; açık randevunun borcu yoktur; yedek yalnız grup dersinde;
-- silinen bedelin borcu kalmaz.
ALTER TABLE "SpaAppointment" ADD CONSTRAINT "SpaAppointment_valid" CHECK (
  "endsAt" > "startsAt" AND "busyUntil" >= "endsAt" AND "guestCount" BETWEEN 1 AND 10
  AND length(btrim("customerName")) >= 2
  AND "listPrice" >= 0 AND "price" >= 0 AND "amountDue" >= 0 AND "totalDue" >= 0 AND "paidTotal" >= 0 AND "roomChargeTotal" >= 0
  AND "balance" = "totalDue" - "paidTotal" - "roomChargeTotal"
  AND ("feePct" IS NULL OR "feePct" BETWEEN 0 AND 100)
  AND ("status" <> 'WAITLISTED' OR "sessionId" IS NOT NULL)
  AND ("status" NOT IN ('BOOKED', 'WAITLISTED') OR ("amountDue" = 0 AND "totalDue" = 0))
  AND ("feeWaivedBy" IS NULL OR "amountDue" = 0)
  AND ("therapistPreference" IS NULL OR "therapistPreference" IN ('FEMALE', 'MALE'))
  AND (("kind" = 'GROUP') = ("sessionId" IS NOT NULL)));

-- Açık bakiyeler listesi: kapanmış ama bakiyesi sıfır olmayan randevular (küçük kısmi index).
CREATE INDEX "SpaAppointment_open_balance_idx" ON "SpaAppointment" ("hotelId", "startsAt", "id")
  WHERE "balance" <> 0 AND "status" IN ('COMPLETED', 'CANCELLED', 'NO_SHOW');
-- Hatırlatma işi: yaklaşan, hatırlatılmamış, konaklamaya bağlı açık randevular.
CREATE INDEX "SpaAppointment_reminder_idx" ON "SpaAppointment" ("hotelId", "startsAt")
  WHERE "status" = 'BOOKED' AND "reminderSentAt" IS NULL AND "reservationId" IS NOT NULL;

-- Spa ödemesi (modül 17 / 37 ile aynı kurallar): tutarın işareti, durum izi, yöntem.
ALTER TABLE "SpaPayment"
  ADD CONSTRAINT "SpaPayment_amount_sign" CHECK (
    ("kind" = 'PAYMENT' AND "amount" > 0) OR ("kind" = 'REFUND' AND "amount" < 0) OR ("kind" = 'REVERSAL' AND "amount" <> 0 AND "reversalOfId" IS NOT NULL)
  ),
  ADD CONSTRAINT "SpaPayment_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "SpaPayment_status_trail" CHECK (
    ("status" = 'POSTED' AND "postedAt" IS NOT NULL AND "declinedAt" IS NULL)
    OR ("status" = 'PENDING' AND "postedAt" IS NULL AND "declinedAt" IS NULL AND "approvalId" IS NOT NULL)
    OR ("status" = 'DECLINED' AND "postedAt" IS NULL AND "declinedAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "SpaPayment_method_valid" CHECK ("method" IN ('CASH', 'CARD'));

ALTER TABLE "SpaRoomCharge" ADD CONSTRAINT "SpaRoomCharge_valid" CHECK ("amount" > 0 AND "total" > 0 AND length(btrim("roomNumber")) >= 1);
