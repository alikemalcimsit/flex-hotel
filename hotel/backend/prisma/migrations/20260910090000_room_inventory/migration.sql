-- Modül 3 (Oda tipi müsaitlik & oda atama).
--
-- İki değişmez veritabanına gömülüyor:
--   1. Bir fiziksel odaya çakışan iki aktif rezervasyon yapılamaz
--   2. Bir odanın çakışan iki bloğu olamaz
--
-- Aralık semantiği DİKKAT: rezervasyon ve bloklar `[)` (yarı açık) —
-- 15-18 rezervasyonu ile 18-20 rezervasyonu ÇAKIŞMAZ, çünkü misafir 18'de
-- çıkar ve yeni misafir aynı gün girer. Bu, sezonlardaki `[]` (iki uçtan
-- kapalı) semantiğinin bilinçli olarak tersidir.

-- ─────────────── Oda blokları ───────────────

CREATE TABLE "RoomBlock" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RoomBlock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RoomBlock_hotelId_roomId_startDate_endDate_idx"
  ON "RoomBlock"("hotelId", "roomId", "startDate", "endDate");
CREATE INDEX "RoomBlock_hotelId_deletedAt_idx" ON "RoomBlock"("hotelId", "deletedAt");

ALTER TABLE "RoomBlock" ADD CONSTRAINT "RoomBlock_hotelId_fkey"
  FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoomBlock" ADD CONSTRAINT "RoomBlock_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bitiş, başlangıçtan önce olamaz. NULL bitiş = süresiz blok, kısıt onu es geçer.
ALTER TABLE "RoomBlock" ADD CONSTRAINT "RoomBlock_date_order"
  CHECK ("endDate" IS NULL OR "endDate" > "startDate");

-- Aynı odaya çakışan iki blok konamaz: hangi sebebin geçerli olduğu belirsiz
-- kalır ve blok kaldırılırken hangisinin kalkacağı bilinemez.
-- `endDate` NULL ise tsrange üst sınırı açık kalır (süresiz blok).
ALTER TABLE "RoomBlock" ADD CONSTRAINT "RoomBlock_no_overlap"
  EXCLUDE USING gist (
    "roomId" WITH =,
    tsrange("startDate", "endDate", '[)') WITH &&
  ) WHERE ("deletedAt" IS NULL);

-- ─────────────── Çifte rezervasyon koruması ───────────────
--
-- Modül 1'deki sezon çakışmasıyla aynı gerekçe: iki resepsiyon görevlisi aynı
-- anda son boş odayı iki farklı rezervasyona atarsa, "önce oku sonra yaz"
-- kontrolü ikisini de geçirir. Bu kısıt, uygulama kodu ne yaparsa yapsın
-- fiziksel bir odanın iki misafire birden verilmesini imkânsız kılar.
--
-- Yalnızca envanteri tüketen durumlar sayılır: iptal edilmiş, gelmemiş veya
-- çıkış yapmış rezervasyon odayı işgal etmez.
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_no_double_booking"
  EXCLUDE USING gist (
    "roomId" WITH =,
    tsrange("checkIn", "checkOut", '[)') WITH &&
  ) WHERE (
    "roomId" IS NOT NULL
    AND "deletedAt" IS NULL
    AND "status" IN ('PENDING', 'CONFIRMED', 'CHECKED_IN')
  );

-- Çıkış, girişten sonra olmalı (en az bir gecelik konaklama).
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_date_order"
  CHECK ("checkOut" > "checkIn");

-- ─────────────── Müsaitlik sorgusunun sıcak yolu ───────────────

CREATE INDEX "Reservation_hotelId_roomTypeId_status_checkIn_checkOut_idx"
  ON "Reservation"("hotelId", "roomTypeId", "status", "checkIn", "checkOut");

CREATE INDEX "Reservation_hotelId_roomId_checkIn_checkOut_idx"
  ON "Reservation"("hotelId", "roomId", "checkIn", "checkOut");
