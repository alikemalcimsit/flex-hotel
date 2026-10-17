-- Modül 37: satış projeleri ve banket / etkinlik (salon, müşteri, etkinlik dosyası, oturum, salon
-- tutma, kalem, ekipman, ödeme planı, ödeme, belge). Tablolar Prisma'nın ürettiği; altta veritabanı
-- kuralları (CHECK, EXCLUDE, kısmi tekil index) elle.

-- Personel uyarısı türü
ALTER TYPE "StaffAlertKind" ADD VALUE IF NOT EXISTS 'BANQUET';

-- CreateEnum
CREATE TYPE "VenueLayout" AS ENUM ('THEATER', 'CLASSROOM', 'U_SHAPE', 'BOARDROOM', 'BANQUET', 'CABARET', 'COCKTAIL');

-- CreateEnum
CREATE TYPE "VenueStatus" AS ENUM ('ACTIVE', 'PASSIVE');

-- CreateEnum
CREATE TYPE "EventClientType" AS ENUM ('COMPANY', 'PERSON');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('WEDDING', 'ENGAGEMENT', 'MEETING', 'CONFERENCE', 'GALA', 'BIRTHDAY', 'COCKTAIL', 'OTHER');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('INQUIRY', 'TENTATIVE', 'DEFINITE', 'COMPLETED', 'CANCELLED', 'LOST');

-- CreateEnum
CREATE TYPE "EventHoldStatus" AS ENUM ('TENTATIVE', 'DEFINITE');

-- CreateEnum
CREATE TYPE "EventItemCategory" AS ENUM ('VENUE', 'FNB', 'BEVERAGE', 'EQUIPMENT', 'SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "EventItemUnit" AS ENUM ('PERSON', 'PIECE', 'HOUR', 'DAY', 'PACKAGE');

-- CreateEnum
CREATE TYPE "EventDocumentKind" AS ENUM ('OFFER', 'CONTRACT', 'PROFORMA');

-- CreateEnum
CREATE TYPE "EventDocumentStatus" AS ENUM ('ISSUED', 'ACCEPTED', 'DECLINED', 'SIGNED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "areaSqm" DECIMAL(8,2),
    "hourlyRate" DECIMAL(12,2),
    "halfDayRate" DECIMAL(12,2),
    "dayRate" DECIMAL(12,2),
    "setupMinutes" INTEGER NOT NULL DEFAULT 60,
    "teardownMinutes" INTEGER NOT NULL DEFAULT 60,
    "status" "VenueStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueCapacity" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "layout" "VenueLayout" NOT NULL,
    "capacity" INTEGER NOT NULL,

    CONSTRAINT "VenueCapacity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventEquipment" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "stockQuantity" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventEquipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventClient" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "type" "EventClientType" NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "taxOffice" TEXT,
    "taxNumber" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventSettings" (
    "hotelId" TEXT NOT NULL,
    "optionDays" INTEGER NOT NULL DEFAULT 7,
    "offerValidityDays" INTEGER NOT NULL DEFAULT 14,
    "depositPct" DECIMAL(5,2) NOT NULL DEFAULT 30,
    "requireSignedContract" BOOLEAN NOT NULL DEFAULT true,
    "cancellationTiers" JSONB NOT NULL DEFAULT '[]',
    "contractTerms" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventSettings_pkey" PRIMARY KEY ("hotelId")
);

-- CreateTable
CREATE TABLE "EventSequence" (
    "hotelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "EventSequence_pkey" PRIMARY KEY ("hotelId","kind","year")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "clientId" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'INQUIRY',
    "expectedPax" INTEGER NOT NULL,
    "guaranteedPax" INTEGER,
    "actualPax" INTEGER,
    "billablePax" INTEGER NOT NULL DEFAULT 0,
    "optionUntil" DATE,
    "optionedAt" TIMESTAMP(3),
    "firstStartAt" TIMESTAMP(3),
    "lastEndAt" TIMESTAMP(3),
    "currency" TEXT NOT NULL,
    "netTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cancellationTiers" JSONB,
    "cancellationFee" DECIMAL(14,2),
    "definiteAt" TIMESTAMP(3),
    "definiteBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "lostAt" TIMESTAMP(3),
    "lostBy" TEXT,
    "lostReason" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventSession" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "layout" "VenueLayout" NOT NULL,
    "pax" INTEGER NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "setupMinutes" INTEGER NOT NULL,
    "teardownMinutes" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventVenueHold" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "EventHoldStatus" NOT NULL,
    "heldAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventVenueHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventItem" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sessionId" TEXT,
    "equipmentId" TEXT,
    "category" "EventItemCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "perPerson" BOOLEAN NOT NULL DEFAULT false,
    "quantity" DECIMAL(12,2) NOT NULL,
    "billedQuantity" DECIMAL(12,2) NOT NULL,
    "unit" "EventItemUnit" NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxCategory" TEXT NOT NULL,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "taxLines" JSONB NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventInstallment" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventPayment" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
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

    CONSTRAINT "EventPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventDocument" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" "EventDocumentKind" NOT NULL,
    "number" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "EventDocumentStatus" NOT NULL DEFAULT 'ISSUED',
    "snapshot" JSONB NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "grandTotal" DECIMAL(14,2) NOT NULL,
    "validUntil" DATE,
    "decisionDate" DATE,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "issuedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Venue_hotelId_status_code_idx" ON "Venue"("hotelId", "status", "code");

-- CreateIndex
CREATE INDEX "Venue_parentId_idx" ON "Venue"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_hotelId_code_key" ON "Venue"("hotelId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "VenueCapacity_venueId_layout_key" ON "VenueCapacity"("venueId", "layout");

-- CreateIndex
CREATE INDEX "EventEquipment_hotelId_isActive_name_idx" ON "EventEquipment"("hotelId", "isActive", "name");

-- CreateIndex
CREATE UNIQUE INDEX "EventEquipment_hotelId_code_key" ON "EventEquipment"("hotelId", "code");

-- CreateIndex
CREATE INDEX "EventClient_hotelId_name_idx" ON "EventClient"("hotelId", "name");

-- CreateIndex
CREATE INDEX "EventClient_name_trgm_idx" ON "EventClient" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Event_hotelId_status_firstStartAt_id_idx" ON "Event"("hotelId", "status", "firstStartAt", "id");

-- CreateIndex
CREATE INDEX "Event_hotelId_firstStartAt_id_idx" ON "Event"("hotelId", "firstStartAt", "id");

-- CreateIndex
CREATE INDEX "Event_hotelId_clientId_firstStartAt_idx" ON "Event"("hotelId", "clientId", "firstStartAt");

-- CreateIndex
CREATE INDEX "Event_hotelId_ownerEmail_firstStartAt_idx" ON "Event"("hotelId", "ownerEmail", "firstStartAt");

-- CreateIndex
CREATE INDEX "Event_status_optionUntil_idx" ON "Event"("status", "optionUntil");

-- CreateIndex
CREATE INDEX "Event_name_trgm_idx" ON "Event" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Event_hotelId_code_key" ON "Event"("hotelId", "code");

-- CreateIndex
CREATE INDEX "EventSession_eventId_startAt_idx" ON "EventSession"("eventId", "startAt");

-- CreateIndex
CREATE INDEX "EventSession_hotelId_venueId_startAt_idx" ON "EventSession"("hotelId", "venueId", "startAt");

-- CreateIndex
CREATE INDEX "EventVenueHold_hotelId_venueId_startAt_endAt_idx" ON "EventVenueHold"("hotelId", "venueId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "EventVenueHold_eventId_idx" ON "EventVenueHold"("eventId");

-- CreateIndex
CREATE INDEX "EventVenueHold_sessionId_idx" ON "EventVenueHold"("sessionId");

-- CreateIndex
CREATE INDEX "EventItem_eventId_sortOrder_idx" ON "EventItem"("eventId", "sortOrder");

-- CreateIndex
CREATE INDEX "EventItem_equipmentId_sessionId_idx" ON "EventItem"("equipmentId", "sessionId");

-- CreateIndex
CREATE INDEX "EventItem_sessionId_idx" ON "EventItem"("sessionId");

-- CreateIndex
CREATE INDEX "EventInstallment_eventId_dueDate_idx" ON "EventInstallment"("eventId", "dueDate");

-- CreateIndex
CREATE INDEX "EventInstallment_hotelId_dueDate_idx" ON "EventInstallment"("hotelId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "EventPayment_reversalOfId_key" ON "EventPayment"("reversalOfId");

-- CreateIndex
CREATE INDEX "EventPayment_eventId_receivedAt_id_idx" ON "EventPayment"("eventId", "receivedAt", "id");

-- CreateIndex
CREATE INDEX "EventPayment_hotelId_businessDate_postedAt_id_idx" ON "EventPayment"("hotelId", "businessDate", "postedAt", "id");

-- CreateIndex
CREATE INDEX "EventPayment_hotelId_status_receivedAt_idx" ON "EventPayment"("hotelId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "EventPayment_approvalId_idx" ON "EventPayment"("approvalId");

-- CreateIndex
CREATE INDEX "EventPayment_voidApprovalId_idx" ON "EventPayment"("voidApprovalId");

-- CreateIndex
CREATE UNIQUE INDEX "EventPayment_hotelId_sourceKey_key" ON "EventPayment"("hotelId", "sourceKey");

-- CreateIndex
CREATE INDEX "EventDocument_eventId_kind_createdAt_idx" ON "EventDocument"("eventId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventDocument_hotelId_number_key" ON "EventDocument"("hotelId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "EventDocument_eventId_kind_version_key" ON "EventDocument"("eventId", "kind", "version");

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueCapacity" ADD CONSTRAINT "VenueCapacity_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventEquipment" ADD CONSTRAINT "EventEquipment_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventClient" ADD CONSTRAINT "EventClient_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSettings" ADD CONSTRAINT "EventSettings_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "EventClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSession" ADD CONSTRAINT "EventSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSession" ADD CONSTRAINT "EventSession_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventVenueHold" ADD CONSTRAINT "EventVenueHold_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventVenueHold" ADD CONSTRAINT "EventVenueHold_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EventSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventVenueHold" ADD CONSTRAINT "EventVenueHold_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventItem" ADD CONSTRAINT "EventItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventItem" ADD CONSTRAINT "EventItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EventSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventItem" ADD CONSTRAINT "EventItem_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "EventEquipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventInstallment" ADD CONSTRAINT "EventInstallment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPayment" ADD CONSTRAINT "EventPayment_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPayment" ADD CONSTRAINT "EventPayment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPayment" ADD CONSTRAINT "EventPayment_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "Approval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPayment" ADD CONSTRAINT "EventPayment_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "EventPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventDocument" ADD CONSTRAINT "EventDocument_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventDocument" ADD CONSTRAINT "EventDocument_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────── Veritabanı kuralları (elle) ───────────────

-- Salon: ad, fiyatlar (varsa pozitif), alan, kurulum / söküm süresi, kendi kendinin parçası olamaz.
ALTER TABLE "Venue"
  ADD CONSTRAINT "Venue_name_not_blank" CHECK (length(btrim("name")) >= 2),
  ADD CONSTRAINT "Venue_rates_valid" CHECK (
    ("hourlyRate" IS NULL OR "hourlyRate" > 0) AND ("halfDayRate" IS NULL OR "halfDayRate" > 0) AND ("dayRate" IS NULL OR "dayRate" > 0)
    AND ("areaSqm" IS NULL OR "areaSqm" > 0)
  ),
  ADD CONSTRAINT "Venue_buffers_valid" CHECK ("setupMinutes" BETWEEN 0 AND 720 AND "teardownMinutes" BETWEEN 0 AND 720),
  ADD CONSTRAINT "Venue_not_own_part" CHECK ("parentId" IS NULL OR "parentId" <> "id");

ALTER TABLE "VenueCapacity" ADD CONSTRAINT "VenueCapacity_valid" CHECK ("capacity" BETWEEN 1 AND 10000);

ALTER TABLE "EventEquipment"
  ADD CONSTRAINT "EventEquipment_valid" CHECK ("unitPrice" >= 0 AND "stockQuantity" BETWEEN 0 AND 10000 AND length(btrim("name")) >= 2);

ALTER TABLE "EventClient" ADD CONSTRAINT "EventClient_name_not_blank" CHECK (length(btrim("name")) >= 2);

ALTER TABLE "EventSettings"
  ADD CONSTRAINT "EventSettings_valid" CHECK (
    "optionDays" BETWEEN 1 AND 60 AND "offerValidityDays" BETWEEN 1 AND 90 AND "depositPct" BETWEEN 0 AND 100
    AND jsonb_typeof("cancellationTiers") = 'array' AND jsonb_array_length("cancellationTiers") <= 10
  );

ALTER TABLE "EventSequence" ADD CONSTRAINT "EventSequence_valid" CHECK ("last" >= 1 AND "year" BETWEEN 2000 AND 2999);

-- Etkinlik: kişi sayıları, tutar tutarlılığı, oturum aralığı ve durum izi.
ALTER TABLE "Event"
  ADD CONSTRAINT "Event_name_not_blank" CHECK (length(btrim("name")) >= 2),
  ADD CONSTRAINT "Event_pax_valid" CHECK (
    "expectedPax" BETWEEN 1 AND 10000 AND ("guaranteedPax" IS NULL OR "guaranteedPax" BETWEEN 1 AND 10000)
    AND ("actualPax" IS NULL OR "actualPax" BETWEEN 0 AND 10000) AND "billablePax" >= 0
  ),
  ADD CONSTRAINT "Event_totals_valid" CHECK ("grandTotal" = "netTotal" + "taxTotal" AND ("cancellationFee" IS NULL OR "cancellationFee" >= 0)),
  ADD CONSTRAINT "Event_span_valid" CHECK (("firstStartAt" IS NULL) = ("lastEndAt" IS NULL) AND ("firstStartAt" IS NULL OR "firstStartAt" < "lastEndAt")),
  ADD CONSTRAINT "Event_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "Event_status_trail" CHECK (
    ("status" = 'INQUIRY' AND "optionUntil" IS NULL AND "definiteAt" IS NULL AND "completedAt" IS NULL AND "cancelledAt" IS NULL AND "lostAt" IS NULL)
    OR ("status" = 'TENTATIVE' AND "optionUntil" IS NOT NULL AND "optionedAt" IS NOT NULL AND "definiteAt" IS NULL AND "completedAt" IS NULL AND "cancelledAt" IS NULL AND "lostAt" IS NULL)
    OR ("status" = 'DEFINITE' AND "definiteAt" IS NOT NULL AND "definiteBy" IS NOT NULL AND "completedAt" IS NULL AND "cancelledAt" IS NULL AND "lostAt" IS NULL)
    OR ("status" = 'COMPLETED' AND "definiteAt" IS NOT NULL AND "completedAt" IS NOT NULL AND "completedBy" IS NOT NULL AND "actualPax" IS NOT NULL AND "cancelledAt" IS NULL AND "lostAt" IS NULL)
    OR ("status" = 'CANCELLED' AND "definiteAt" IS NOT NULL AND "cancelledAt" IS NOT NULL AND "cancelledBy" IS NOT NULL AND "cancelReason" IS NOT NULL AND "cancellationFee" IS NOT NULL AND "completedAt" IS NULL AND "lostAt" IS NULL)
    OR ("status" = 'LOST' AND "lostAt" IS NOT NULL AND "lostBy" IS NOT NULL AND "lostReason" IS NOT NULL AND "definiteAt" IS NULL AND "completedAt" IS NULL AND "cancelledAt" IS NULL)
  );

-- Oturum: bitiş başlangıçtan sonra, en fazla 72 saat; kişi ve hazırlık süreleri.
ALTER TABLE "EventSession"
  ADD CONSTRAINT "EventSession_time_valid" CHECK ("endAt" > "startAt" AND "endAt" - "startAt" <= interval '72 hours'),
  ADD CONSTRAINT "EventSession_pax_valid" CHECK ("pax" BETWEEN 1 AND 10000),
  ADD CONSTRAINT "EventSession_buffers_valid" CHECK ("setupMinutes" BETWEEN 0 AND 720 AND "teardownMinutes" BETWEEN 0 AND 720),
  ADD CONSTRAINT "EventSession_title_not_blank" CHECK (length(btrim("title")) >= 2);

-- Salon tutma: aralık geçerli; aynı atomik salon parçasına aynı saatte iki kesin tutma olamaz.
ALTER TABLE "EventVenueHold" ADD CONSTRAINT "EventVenueHold_time_valid" CHECK ("endAt" > "startAt");
ALTER TABLE "EventVenueHold" ADD CONSTRAINT "EventVenueHold_no_double_definite"
  EXCLUDE USING gist ("venueId" WITH =, tsrange("startAt", "endAt", '[)') WITH &&)
  WHERE ("status" = 'DEFINITE');

-- Kalem: miktar, fiyat, indirim, tutar tutarlılığı; ekipman kalemi oturuma bağlı ve adedi tam sayı.
ALTER TABLE "EventItem"
  ADD CONSTRAINT "EventItem_amounts_valid" CHECK (
    "quantity" > 0 AND "billedQuantity" >= 0 AND "unitPrice" >= 0 AND "discountPct" BETWEEN 0 AND 100
    AND "total" = "netAmount" + "taxAmount"
  ),
  ADD CONSTRAINT "EventItem_equipment_valid" CHECK (
    ("equipmentId" IS NULL) = ("category" <> 'EQUIPMENT')
    AND ("equipmentId" IS NULL OR ("sessionId" IS NOT NULL AND "quantity" = trunc("quantity")))
  ),
  ADD CONSTRAINT "EventItem_per_person_unit" CHECK (NOT "perPerson" OR "unit" = 'PERSON');

ALTER TABLE "EventInstallment"
  ADD CONSTRAINT "EventInstallment_valid" CHECK ("amount" > 0 AND length(btrim("label")) >= 2);

-- Etkinlik ödemesi: işaret türe uygun (tahsilat +, iade −, iptal kaydı asıl satırın tersi), durum izi.
ALTER TABLE "EventPayment"
  ADD CONSTRAINT "EventPayment_amount_sign" CHECK (
    ("kind" = 'PAYMENT' AND "amount" > 0) OR ("kind" = 'REFUND' AND "amount" < 0) OR ("kind" = 'REVERSAL' AND "amount" <> 0 AND "reversalOfId" IS NOT NULL)
  ),
  ADD CONSTRAINT "EventPayment_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "EventPayment_status_trail" CHECK (
    ("status" = 'POSTED' AND "postedAt" IS NOT NULL AND "declinedAt" IS NULL)
    OR ("status" = 'PENDING' AND "postedAt" IS NULL AND "declinedAt" IS NULL AND "approvalId" IS NOT NULL)
    OR ("status" = 'DECLINED' AND "postedAt" IS NULL AND "declinedAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "EventPayment_method_valid" CHECK ("method" IN ('CASH', 'CARD', 'TRANSFER', 'VIRTUAL_POS'));

-- Belge: sürüm, dosya, türe göre geçerli durum ve karar izi.
ALTER TABLE "EventDocument"
  ADD CONSTRAINT "EventDocument_valid" CHECK ("version" >= 1 AND "fileSize" > 0 AND "grandTotal" >= 0),
  ADD CONSTRAINT "EventDocument_status_by_kind" CHECK (
    ("kind" = 'OFFER' AND "status" IN ('ISSUED', 'ACCEPTED', 'DECLINED', 'SUPERSEDED'))
    OR ("kind" = 'CONTRACT' AND "status" IN ('ISSUED', 'SIGNED', 'SUPERSEDED'))
    OR ("kind" = 'PROFORMA' AND "status" IN ('ISSUED', 'SUPERSEDED'))
  ),
  ADD CONSTRAINT "EventDocument_decision_trail" CHECK (
    ("status" NOT IN ('ACCEPTED', 'DECLINED', 'SIGNED')) OR ("decisionDate" IS NOT NULL AND "decidedBy" IS NOT NULL AND "decidedAt" IS NOT NULL)
  );

-- Bir etkinliğin her türden en fazla bir geçerli (yenisiyle geçersizleşmemiş) belgesi olur.
CREATE UNIQUE INDEX "EventDocument_one_current_per_kind" ON "EventDocument"("eventId", "kind") WHERE "status" <> 'SUPERSEDED';
