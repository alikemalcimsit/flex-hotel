-- Modül 33: kanal yönetimi (Channex + iCal). Tablolar Prisma'nın ürettiği; altta veritabanı
-- kuralları (CHECK) ve kısmi index'ler elle.

-- Personel uyarısı türleri
ALTER TYPE "StaffAlertKind" ADD VALUE IF NOT EXISTS 'CHANNEL_BOOKING';
ALTER TYPE "StaffAlertKind" ADD VALUE IF NOT EXISTS 'CHANNEL_SYNC';

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('CHANNEX', 'ICAL');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "ChannexEnvironment" AS ENUM ('STAGING', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "IcalProvider" AS ENUM ('AIRBNB', 'BOOKING', 'OTHER');

-- CreateEnum
CREATE TYPE "ChannelSyncKind" AS ENUM ('DELTA', 'FULL', 'BOOKINGS', 'ICAL_IMPORT', 'SETUP');

-- CreateEnum
CREATE TYPE "ChannelSyncStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "ChannelSyncTrigger" AS ENUM ('CHANGE', 'SCHEDULE', 'MANUAL', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "ChannelAriKind" AS ENUM ('AVAILABILITY', 'RATE');

-- CreateEnum
CREATE TYPE "ChannelBookingState" AS ENUM ('PENDING', 'PROCESSED', 'REVIEW', 'ATTENTION');

-- CreateEnum
CREATE TYPE "ChannelBookingStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChannelRevisionKind" AS ENUM ('NEW', 'MODIFIED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.



-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "channelBookingId" TEXT,
ADD COLUMN     "channelRoomIndex" INTEGER;

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ChannelStatus" NOT NULL DEFAULT 'DRAFT',
    "environment" "ChannexEnvironment",
    "propertyId" TEXT,
    "apiKey" TEXT,
    "webhookId" TEXT,
    "webhookSecret" TEXT,
    "externalName" TEXT,
    "externalCurrency" TEXT,
    "provider" "IcalProvider",
    "priceMarkupPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "horizonDays" INTEGER NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelState" (
    "channelId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "dirtyFrom" DATE,
    "dirtyTo" DATE,
    "fullSyncRequestedAt" TIMESTAMP(3),
    "fullSyncReason" TEXT,
    "fullSyncTrigger" "ChannelSyncTrigger",
    "lastFullSyncAt" TIMESTAMP(3),
    "lastDeltaAt" TIMESTAMP(3),
    "lastBookingPollAt" TIMESTAMP(3),
    "lastIcalImportAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" "ChannelSyncStatus",
    "pausedUntil" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelState_pkey" PRIMARY KEY ("channelId")
);

-- CreateTable
CREATE TABLE "ChannelRoomMapping" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "externalRoomTypeId" TEXT,
    "externalName" TEXT,
    "icalImportUrl" TEXT,
    "exportToken" TEXT,
    "lastImportAt" TIMESTAMP(3),
    "lastImportError" TEXT,
    "lastExportAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelRoomMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelRateMapping" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "roomMappingId" TEXT NOT NULL,
    "externalRatePlanId" TEXT NOT NULL,
    "externalName" TEXT,
    "boardType" "BoardType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelRateMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelAriState" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "kind" "ChannelAriKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "sent" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelAriState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelStopSale" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "roomTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelStopSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelSyncLog" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "kind" "ChannelSyncKind" NOT NULL,
    "status" "ChannelSyncStatus" NOT NULL,
    "trigger" "ChannelSyncTrigger" NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "externalIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "windowFrom" DATE,
    "windowTo" DATE,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelBooking" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalBookingId" TEXT NOT NULL,
    "externalCode" TEXT,
    "otaName" TEXT,
    "status" "ChannelBookingStatus" NOT NULL DEFAULT 'ACTIVE',
    "state" "ChannelBookingState" NOT NULL DEFAULT 'PENDING',
    "stateReason" TEXT,
    "guestName" TEXT,
    "checkIn" DATE,
    "checkOut" DATE,
    "roomCount" INTEGER NOT NULL DEFAULT 1,
    "amount" DECIMAL(12,2),
    "currency" TEXT,
    "appliedRevisionAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelBookingRevision" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "externalRevisionId" TEXT NOT NULL,
    "kind" "ChannelRevisionKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "error" TEXT,

    CONSTRAINT "ChannelBookingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Channel_hotelId_deletedAt_name_idx" ON "Channel"("hotelId", "deletedAt", "name");

-- CreateIndex
CREATE INDEX "Channel_status_type_idx" ON "Channel"("status", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelRoomMapping_exportToken_key" ON "ChannelRoomMapping"("exportToken");

-- CreateIndex
CREATE INDEX "ChannelRoomMapping_hotelId_roomTypeId_idx" ON "ChannelRoomMapping"("hotelId", "roomTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelRoomMapping_channelId_roomTypeId_key" ON "ChannelRoomMapping"("channelId", "roomTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelRoomMapping_channelId_externalRoomTypeId_key" ON "ChannelRoomMapping"("channelId", "externalRoomTypeId");

-- CreateIndex
CREATE INDEX "ChannelRateMapping_roomMappingId_idx" ON "ChannelRateMapping"("roomMappingId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelRateMapping_channelId_externalRatePlanId_key" ON "ChannelRateMapping"("channelId", "externalRatePlanId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelAriState_channelId_kind_externalId_key" ON "ChannelAriState"("channelId", "kind", "externalId");

-- CreateIndex
CREATE INDEX "ChannelStopSale_channelId_endDate_idx" ON "ChannelStopSale"("channelId", "endDate");

-- CreateIndex
CREATE INDEX "ChannelSyncLog_channelId_createdAt_id_idx" ON "ChannelSyncLog"("channelId", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "ChannelSyncLog_channelId_kind_createdAt_idx" ON "ChannelSyncLog"("channelId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "ChannelSyncLog_channelId_status_createdAt_idx" ON "ChannelSyncLog"("channelId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ChannelSyncLog_createdAt_idx" ON "ChannelSyncLog"("createdAt");

-- CreateIndex
CREATE INDEX "ChannelBooking_channelId_createdAt_id_idx" ON "ChannelBooking"("channelId", "createdAt" DESC, "id");

-- CreateIndex
CREATE INDEX "ChannelBooking_hotelId_state_updatedAt_idx" ON "ChannelBooking"("hotelId", "state", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelBooking_channelId_externalBookingId_key" ON "ChannelBooking"("channelId", "externalBookingId");

-- CreateIndex
CREATE INDEX "ChannelBookingRevision_bookingId_occurredAt_idx" ON "ChannelBookingRevision"("bookingId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelBookingRevision_channelId_externalRevisionId_key" ON "ChannelBookingRevision"("channelId", "externalRevisionId");

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_channelBookingId_fkey" FOREIGN KEY ("channelBookingId") REFERENCES "ChannelBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelState" ADD CONSTRAINT "ChannelState_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelRoomMapping" ADD CONSTRAINT "ChannelRoomMapping_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelRoomMapping" ADD CONSTRAINT "ChannelRoomMapping_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelRateMapping" ADD CONSTRAINT "ChannelRateMapping_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelRateMapping" ADD CONSTRAINT "ChannelRateMapping_roomMappingId_fkey" FOREIGN KEY ("roomMappingId") REFERENCES "ChannelRoomMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelAriState" ADD CONSTRAINT "ChannelAriState_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelStopSale" ADD CONSTRAINT "ChannelStopSale_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelSyncLog" ADD CONSTRAINT "ChannelSyncLog_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelBooking" ADD CONSTRAINT "ChannelBooking_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelBookingRevision" ADD CONSTRAINT "ChannelBookingRevision_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelBookingRevision" ADD CONSTRAINT "ChannelBookingRevision_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "ChannelBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────── Kanal: tür alanları, sınırlar, tekillik ───────────────

-- Channex kanalında ortam, mülk ve anahtar zorunlu, iCal sağlayıcısı yok; iCal'de tersi.
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_type_fields" CHECK (
  ("type" = 'CHANNEX' AND "environment" IS NOT NULL AND "propertyId" IS NOT NULL AND "apiKey" IS NOT NULL AND "provider" IS NULL)
  OR ("type" = 'ICAL' AND "environment" IS NULL AND "propertyId" IS NULL AND "apiKey" IS NULL
      AND "webhookId" IS NULL AND "webhookSecret" IS NULL AND "provider" IS NOT NULL)
);
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_name_not_blank" CHECK (length(btrim("name")) >= 2);
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_markup_range" CHECK ("priceMarkupPercent" BETWEEN -50 AND 100);
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_horizon_range" CHECK ("horizonDays" BETWEEN 30 AND 730);
-- Senkrondaki kanal bir kez senkrona alınmıştır.
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_status_trail" CHECK ("status" = 'DRAFT' OR "activatedAt" IS NOT NULL);

-- Ad otel içinde tekil (silinmemişler arasında, büyük / küçük harf duyarsız).
CREATE UNIQUE INDEX "Channel_hotelId_name_active_key" ON "Channel" ("hotelId", lower("name")) WHERE "deletedAt" IS NULL;
-- Bir Channex mülkü tek kanala bağlanır (aynı mülke iki kanaldan gönderim birbirini ezerdi).
CREATE UNIQUE INDEX "Channel_channex_property_key" ON "Channel" ("environment", "propertyId")
  WHERE "deletedAt" IS NULL AND "type" = 'CHANNEX';

-- ─────────────── Çalışma durumu ───────────────

-- Kirli pencere: ikisi birlikte dolu ya da boş, bitiş başlangıçtan önce değil.
ALTER TABLE "ChannelState" ADD CONSTRAINT "ChannelState_dirty_window" CHECK (
  ("dirtyFrom" IS NULL) = ("dirtyTo" IS NULL) AND ("dirtyFrom" IS NULL OR "dirtyTo" >= "dirtyFrom")
);
ALTER TABLE "ChannelState" ADD CONSTRAINT "ChannelState_failure_count" CHECK ("failureCount" >= 0);

-- ─────────────── Stop-sale, log, kanal rezervasyonu ───────────────

ALTER TABLE "ChannelStopSale" ADD CONSTRAINT "ChannelStopSale_period" CHECK ("endDate" >= "startDate");
ALTER TABLE "ChannelSyncLog" ADD CONSTRAINT "ChannelSyncLog_duration" CHECK ("durationMs" >= 0);
ALTER TABLE "ChannelBooking" ADD CONSTRAINT "ChannelBooking_room_count" CHECK ("roomCount" >= 1);
ALTER TABLE "ChannelBooking" ADD CONSTRAINT "ChannelBooking_amount" CHECK ("amount" IS NULL OR "amount" >= 0);
ALTER TABLE "ChannelBooking" ADD CONSTRAINT "ChannelBooking_stay" CHECK (
  "checkIn" IS NULL OR "checkOut" IS NULL OR "checkOut" > "checkIn"
);
-- Kapatılan (doğrulanan / elle işlenen) kaydın kimin, ne zaman, ne notla kapattığı.
ALTER TABLE "ChannelBooking" ADD CONSTRAINT "ChannelBooking_resolution" CHECK (
  ("resolvedAt" IS NULL) = ("resolvedBy" IS NULL) AND ("resolvedAt" IS NULL) = ("resolutionNote" IS NULL)
);

-- ─────────────── Rezervasyon ↔ kanal rezervasyonu ───────────────

ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_channel_room" CHECK (
  ("channelBookingId" IS NULL) = ("channelRoomIndex" IS NULL) AND ("channelRoomIndex" IS NULL OR "channelRoomIndex" >= 0)
);
-- Kanal rezervasyonunun odaları (çoğu rezervasyonda boş: kısmi index).
CREATE INDEX "Reservation_channel_booking_idx" ON "Reservation" ("channelBookingId", "channelRoomIndex")
  WHERE "channelBookingId" IS NOT NULL;
