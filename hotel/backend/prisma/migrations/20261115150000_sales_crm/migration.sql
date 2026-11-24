-- Modül 36: Call center & satış CRM.
-- Lead (fırsat: NEW → QUOTED → WAITING → WON/LOST), CallLog (ekle-yalnız arama
-- günlüğü; FlexAI 2.0 hazır: kanal SESLİ AI, kayıt referansı, özet), Quote
-- (fiyatı hazırlandığı anda kilitlenen teklif; kabul → rezervasyon).

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'QUOTED', 'WAITING', 'WON', 'LOST');
CREATE TYPE "LeadSource" AS ENUM ('PHONE', 'EMAIL', 'WALK_IN', 'WEB', 'OTHER');
CREATE TYPE "CallChannel" AS ENUM ('STAFF', 'VOICE_AI');
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "CallOutcome" AS ENUM ('INFO', 'QUOTE_REQUESTED', 'FOLLOW_UP', 'NO_ANSWER', 'NOT_INTERESTED', 'OTHER');
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Lead" (
  "id"               TEXT NOT NULL,
  "hotelId"          TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "company"          TEXT,
  "phone"            TEXT,
  "email"            TEXT,
  "source"           "LeadSource" NOT NULL DEFAULT 'PHONE',
  "status"           "LeadStatus" NOT NULL DEFAULT 'NEW',
  "guestId"          TEXT,
  "checkIn"          DATE,
  "checkOut"         DATE,
  "roomTypeId"       TEXT,
  "adults"           INTEGER,
  "children"         INTEGER,
  "notes"            TEXT,
  "followUpAt"       DATE,
  "wonReservationId" TEXT,
  "lostReason"       TEXT,
  "createdBy"        TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  "deletedAt"        TIMESTAMP(3),

  CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Lead_hotelId_status_updatedAt_idx" ON "Lead"("hotelId", "status", "updatedAt");
CREATE INDEX "Lead_hotelId_followUpAt_idx" ON "Lead"("hotelId", "followUpAt");
CREATE INDEX "Lead_hotelId_deletedAt_idx" ON "Lead"("hotelId", "deletedAt");

-- CreateTable
CREATE TABLE "CallLog" (
  "id"           TEXT NOT NULL,
  "hotelId"      TEXT NOT NULL,
  "leadId"       TEXT NOT NULL,
  "channel"      "CallChannel" NOT NULL DEFAULT 'STAFF',
  "direction"    "CallDirection" NOT NULL DEFAULT 'INBOUND',
  "phone"        TEXT,
  "outcome"      "CallOutcome" NOT NULL,
  "summary"      TEXT NOT NULL,
  "recordingRef" TEXT,
  "calledAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"    TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CallLog_leadId_calledAt_idx" ON "CallLog"("leadId", "calledAt");
CREATE INDEX "CallLog_hotelId_calledAt_idx" ON "CallLog"("hotelId", "calledAt");

-- CreateTable
CREATE TABLE "Quote" (
  "id"             TEXT NOT NULL,
  "hotelId"        TEXT NOT NULL,
  "leadId"         TEXT NOT NULL,
  "code"           TEXT NOT NULL,
  "status"         "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
  "roomTypeId"     TEXT NOT NULL,
  "boardType"      "BoardType" NOT NULL DEFAULT 'BB',
  "checkIn"        DATE NOT NULL,
  "checkOut"       DATE NOT NULL,
  "adults"         INTEGER NOT NULL,
  "children"       INTEGER NOT NULL DEFAULT 0,
  "nightsSnapshot" JSONB NOT NULL DEFAULT '[]',
  "total"          DECIMAL(12,2) NOT NULL,
  "currency"       TEXT NOT NULL DEFAULT 'TRY',
  "validUntil"     DATE NOT NULL,
  "notes"          TEXT,
  "sentAt"         TIMESTAMP(3),
  "decidedAt"      TIMESTAMP(3),
  "rejectReason"   TEXT,
  "reservationId"  TEXT,
  "createdBy"      TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "deletedAt"      TIMESTAMP(3),

  CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Quote_reservationId_key" ON "Quote"("reservationId");
CREATE UNIQUE INDEX "Quote_hotelId_code_key" ON "Quote"("hotelId", "code");
CREATE INDEX "Quote_leadId_createdAt_idx" ON "Quote"("leadId", "createdAt");
CREATE INDEX "Quote_hotelId_status_validUntil_idx" ON "Quote"("hotelId", "status", "validUntil");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_wonReservationId_fkey" FOREIGN KEY ("wonReservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────── Veri bütünlüğü ───────────────
--
-- Son savunma hattı (servis aynı kuralları önce denetler).

-- Fırsat: ulaşılabilir kişi (telefon ya da e-posta), geçerli konaklama,
-- durum izleri: WON rezervasyonla, LOST sebeple.
ALTER TABLE "Lead"
  ADD CONSTRAINT "Lead_contact_present" CHECK ("phone" IS NOT NULL OR "email" IS NOT NULL),
  ADD CONSTRAINT "Lead_stay_valid" CHECK ("checkIn" IS NULL OR "checkOut" IS NULL OR "checkOut" > "checkIn"),
  ADD CONSTRAINT "Lead_won_trail" CHECK ("status" <> 'WON' OR "wonReservationId" IS NOT NULL),
  ADD CONSTRAINT "Lead_lost_trail" CHECK ("status" <> 'LOST' OR "lostReason" IS NOT NULL);

-- Arama kaydı: özet boş olamaz (rapor ve FlexAI 101 buna dayanır).
ALTER TABLE "CallLog"
  ADD CONSTRAINT "CallLog_summary_not_blank" CHECK (length(btrim("summary")) >= 3);

-- Teklif: pozitif toplam, geçerli dönem; durum izleri — gönderilmişlik ve karar.
ALTER TABLE "Quote"
  ADD CONSTRAINT "Quote_total_valid" CHECK ("total" > 0 AND "total" <= 100000000),
  ADD CONSTRAINT "Quote_stay_valid" CHECK ("checkOut" > "checkIn"),
  ADD CONSTRAINT "Quote_sent_trail" CHECK ("status" = 'DRAFT' OR "sentAt" IS NOT NULL),
  ADD CONSTRAINT "Quote_decided_trail" CHECK (
    ("status" IN ('DRAFT', 'SENT') AND "decidedAt" IS NULL)
    OR ("status" IN ('ACCEPTED', 'REJECTED', 'EXPIRED') AND "decidedAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "Quote_accepted_trail" CHECK ("status" <> 'ACCEPTED' OR "reservationId" IS NOT NULL);
