-- Modül 22: CRM & misafir kartı. Yapılandırılmış tercih ve not tabloları.
-- (Guest.tags[] ve preferences JSON zaten vardı; tercih artık kategori+değer.)

CREATE TYPE "GuestPreferenceCategory" AS ENUM ('FLOOR', 'BED', 'PILLOW', 'DIET', 'ALLERGY', 'ROOM_FEATURE', 'TRANSPORT', 'OCCASION', 'OTHER');
CREATE TYPE "PreferenceSource" AS ENUM ('STAFF', 'GUEST', 'AI');
CREATE TYPE "PreferenceConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TABLE "GuestPreference" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "category" "GuestPreferenceCategory" NOT NULL,
    "value" TEXT NOT NULL,
    "source" "PreferenceSource" NOT NULL DEFAULT 'STAFF',
    "confidence" "PreferenceConfidence" NOT NULL DEFAULT 'MEDIUM',
    "lastConfirmedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "GuestPreference_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GuestPreference_hotelId_guestId_idx" ON "GuestPreference"("hotelId", "guestId");
CREATE INDEX "GuestPreference_guestId_category_idx" ON "GuestPreference"("guestId", "category");

CREATE TABLE "GuestNote" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "GuestNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GuestNote_hotelId_guestId_pinned_idx" ON "GuestNote"("hotelId", "guestId", "pinned");

ALTER TABLE "GuestPreference" ADD CONSTRAINT "GuestPreference_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuestPreference" ADD CONSTRAINT "GuestPreference_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuestNote" ADD CONSTRAINT "GuestNote_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuestNote" ADD CONSTRAINT "GuestNote_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
