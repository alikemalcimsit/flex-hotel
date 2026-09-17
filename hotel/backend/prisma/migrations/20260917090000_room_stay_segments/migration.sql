-- Oda değişikliği geçmişi (modül 5 revizyonu).
--
-- Sorun: rezervasyonun tek bir `roomId`'si vardı. İçerideki misafir başka
-- odaya taşınınca konaklamanın GEÇMİŞ geceleri de yeni odaya yazılmış
-- sayılıyordu:
--   * Hedef odada konaklamanın geçmiş gecelerinde bitmiş bir arıza kaydı ya da
--     başka misafir varsa taşıma reddediliyordu (oda bugün tamamen boş olsa bile).
--   * Taşıma yapılınca eski oda geçmiş gecelerde boş, yeni oda dolu görünüyordu;
--     gece kapanışı ve faturalama yanlış odayı okurdu.
--
-- Çözüm:
--   * `Reservation.roomSince`: misafirin `roomId` odasında kalmaya başladığı
--     gece. Boşsa konaklamanın tamamı o odadadır (eski kayıtlar etkilenmez).
--   * `RoomStaySegment`: kapanmış oda dilimleri `[startDate, endDate)`.
--   * Çifte rezervasyon kısıtı ve arıza tetikleyicisi yalnızca AÇIK dilime
--     bakar: `[coalesce(roomSince, checkIn), checkOut)`.

-- ─────────────── Rezervasyon: mevcut odadaki başlangıç ───────────────

ALTER TABLE "Reservation" ADD COLUMN "roomSince" TIMESTAMP(3);

-- Gün hassasiyetinde, konaklamanın içinde. Çıkış günüyle eşit olabilir:
-- taşındığı gün erken çıkış yapan misafirin çıkış tarihi güncellenebilmeli
-- (açık dilim boşalır, kısıt boş aralığı çakışma saymaz).
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_room_since_valid"
  CHECK (
    "roomSince" IS NULL
    OR (
      "roomSince" = date_trunc('day', "roomSince")
      AND "roomSince" >= date_trunc('day', "checkIn")
      AND "roomSince" <= date_trunc('day', "checkOut")
    )
  );

ALTER TABLE "Reservation" DROP CONSTRAINT "Reservation_no_double_booking";
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_no_double_booking"
  EXCLUDE USING gist (
    "roomId" WITH =,
    tsrange(
      date_trunc('day', COALESCE("roomSince", "checkIn")),
      date_trunc('day', "checkOut"),
      '[)'
    ) WITH &&
  ) WHERE (
    "roomId" IS NOT NULL
    AND "deletedAt" IS NULL
    AND "status" IN ('PENDING', 'CONFIRMED', 'CHECKED_IN')
  );

-- ─────────────── Kapanmış oda dilimleri ───────────────

CREATE TABLE "RoomStaySegment" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "movedBy" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RoomStaySegment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RoomStaySegment_hotelId_roomId_startDate_endDate_idx"
  ON "RoomStaySegment"("hotelId", "roomId", "startDate", "endDate");
CREATE INDEX "RoomStaySegment_reservationId_idx" ON "RoomStaySegment"("reservationId");

ALTER TABLE "RoomStaySegment" ADD CONSTRAINT "RoomStaySegment_hotelId_fkey"
  FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoomStaySegment" ADD CONSTRAINT "RoomStaySegment_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoomStaySegment" ADD CONSTRAINT "RoomStaySegment_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RoomStaySegment" ADD CONSTRAINT "RoomStaySegment_day_precision"
  CHECK ("startDate" = date_trunc('day', "startDate") AND "endDate" = date_trunc('day', "endDate"));
ALTER TABLE "RoomStaySegment" ADD CONSTRAINT "RoomStaySegment_date_order"
  CHECK ("endDate" > "startDate");

-- Aynı odada iki konaklamanın geçmiş dilimleri çakışamaz: "o gece bu odada
-- kim vardı" sorusunun tek cevabı olmalı.
ALTER TABLE "RoomStaySegment" ADD CONSTRAINT "RoomStaySegment_no_overlap"
  EXCLUDE USING gist (
    "roomId" WITH =,
    tsrange("startDate", "endDate", '[)') WITH &&
  ) WHERE ("deletedAt" IS NULL);

-- ─────────────── Arıza kaydı ↔ rezervasyon tetikleyicisi ───────────────
--
-- Aynı kural, açık dilimle: taşınan misafirin önceki gecelerindeki (bitmiş)
-- arıza kaydı yeni odaya yerleşmeyi engellemez.

CREATE OR REPLACE FUNCTION hotelos_guard_room_block_overlap() RETURNS trigger AS $$
DECLARE
  conflict_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'Reservation' THEN
    IF NEW."roomId" IS NULL
       OR NEW."deletedAt" IS NOT NULL
       OR NEW.status NOT IN ('PENDING', 'CONFIRMED', 'CHECKED_IN') THEN
      RETURN NEW;
    END IF;

    PERFORM 1 FROM "Room" WHERE id = NEW."roomId" FOR UPDATE;

    SELECT b.id INTO conflict_id
    FROM "RoomBlock" AS b
    WHERE b."roomId" = NEW."roomId"
      AND b."deletedAt" IS NULL
      AND tsrange(b."startDate", b."endDate", '[)')
          && tsrange(
               date_trunc('day', COALESCE(NEW."roomSince", NEW."checkIn")),
               date_trunc('day', NEW."checkOut"),
               '[)'
             )
    LIMIT 1;

    IF conflict_id IS NOT NULL THEN
      RAISE EXCEPTION 'Reservation_room_blocked: oda bu tarihlerde arızalı veya hizmet dışı (blok %)', conflict_id
        USING ERRCODE = '23P01', CONSTRAINT = 'Reservation_room_blocked';
    END IF;
  ELSE
    IF NEW."deletedAt" IS NOT NULL THEN
      RETURN NEW;
    END IF;

    PERFORM 1 FROM "Room" WHERE id = NEW."roomId" FOR UPDATE;

    SELECT r.id INTO conflict_id
    FROM "Reservation" AS r
    WHERE r."roomId" = NEW."roomId"
      AND r."deletedAt" IS NULL
      AND r.status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN')
      AND tsrange(
            date_trunc('day', COALESCE(r."roomSince", r."checkIn")),
            date_trunc('day', r."checkOut"),
            '[)'
          ) && tsrange(NEW."startDate", NEW."endDate", '[)')
    LIMIT 1;

    IF conflict_id IS NOT NULL THEN
      RAISE EXCEPTION 'RoomBlock_has_reservations: bu tarihlerde odada rezervasyon var (rezervasyon %)', conflict_id
        USING ERRCODE = '23P01', CONSTRAINT = 'RoomBlock_has_reservations';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Tetikleyici `roomSince` değişince de çalışmalı (oda değişikliği).
DROP TRIGGER "Reservation_room_blocked_guard" ON "Reservation";
CREATE TRIGGER "Reservation_room_blocked_guard"
  BEFORE INSERT OR UPDATE OF "roomId", "roomSince", "checkIn", "checkOut", "status", "deletedAt" ON "Reservation"
  FOR EACH ROW EXECUTE FUNCTION hotelos_guard_room_block_overlap();
