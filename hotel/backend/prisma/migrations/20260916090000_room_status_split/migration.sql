-- Oda durumu modelinin düzeltilmesi (modül 3 revizyonu).
--
-- Eski model tek bir `Room.status` listesiydi: AVAILABLE, OCCUPIED, DIRTY,
-- CLEANING, BLOCKED, MAINTENANCE. Üç farklı soruyu tek kolonda karıştırıyordu:
--   * "Dolu ama kirli" yazılamıyordu (kalan misafirin günlük temizliği).
--   * Kat hizmetleri odayı "boş" yapınca misafir içerideyken oda boş görünüyordu.
--   * MAINTENANCE hiçbir kod yolundan atanamıyordu; BLOCKED ise yalnızca blok
--     "bugünü kapsıyorsa" yazılıyor, ileri tarihli blok günü gelince hiç
--     yansımıyordu (zamanlayıcı yok).
--
-- Yeni model üç bağımsız bilgi:
--   1. Room.occupancy            VACANT / OCCUPIED           (yalnızca giriş-çıkış)
--   2. Room.housekeepingStatus   DIRTY / CLEANING / CLEAN / INSPECTED
--   3. RoomBlock.type            OUT_OF_ORDER / OUT_OF_SERVICE (tarihli)
-- "Arızalı" artık kolon değil: o günü kapsayan bloktan okunur.

-- ─────────────── 1. Yeni tipler ───────────────

CREATE TYPE "RoomOccupancy" AS ENUM ('VACANT', 'OCCUPIED');
CREATE TYPE "HousekeepingStatus" AS ENUM ('DIRTY', 'CLEANING', 'CLEAN', 'INSPECTED');
CREATE TYPE "RoomBlockType" AS ENUM ('OUT_OF_ORDER', 'OUT_OF_SERVICE');

-- ─────────────── 2. Oda kolonları ve veri taşıma ───────────────

ALTER TABLE "Room"
  ADD COLUMN "occupancy" "RoomOccupancy" NOT NULL DEFAULT 'VACANT',
  ADD COLUMN "housekeepingStatus" "HousekeepingStatus" NOT NULL DEFAULT 'CLEAN';

-- Kat hizmeti eski durumdan türetilir. Bloklu/bakımdaki oda kirli sayılır:
-- tadilattan çıkan oda temizlik ister (eski blok kaldırma davranışıyla aynı).
UPDATE "Room" SET "housekeepingStatus" = CASE "status"
  WHEN 'DIRTY' THEN 'DIRTY'::"HousekeepingStatus"
  WHEN 'CLEANING' THEN 'CLEANING'::"HousekeepingStatus"
  WHEN 'BLOCKED' THEN 'DIRTY'::"HousekeepingStatus"
  WHEN 'MAINTENANCE' THEN 'DIRTY'::"HousekeepingStatus"
  ELSE 'CLEAN'::"HousekeepingStatus"
END;

-- Doluluk eski kolondan DEĞİL, gerçeğin kaynağından türetilir: odada giriş
-- yapmış (CHECKED_IN) rezervasyon var mı? Eski kolon elle "boş" yapılabildiği
-- için güvenilir değildi.
UPDATE "Room" AS r SET "occupancy" = 'OCCUPIED'
WHERE EXISTS (
  SELECT 1 FROM "Reservation" AS res
  WHERE res."roomId" = r.id AND res.status = 'CHECKED_IN' AND res."deletedAt" IS NULL
);

ALTER TABLE "Room" DROP COLUMN "status";
DROP TYPE "RoomStatus";

CREATE INDEX "Room_hotelId_housekeepingStatus_idx" ON "Room"("hotelId", "housekeepingStatus");
CREATE INDEX "Room_hotelId_occupancy_idx" ON "Room"("hotelId", "occupancy");

-- ─────────────── 3. Arıza kaydı tipi ve gün hassasiyeti ───────────────

-- Mevcut bloklar tadilat/arıza içindi: satıştan düşen tip.
ALTER TABLE "RoomBlock" ADD COLUMN "type" "RoomBlockType" NOT NULL DEFAULT 'OUT_OF_ORDER';

-- Blok tarihleri gün başı olmalı. Saatli bir tarih (15 Ekim 15:00) aynı günün
-- 12:00'de çıkan misafiriyle "çakışır" ama gece hesabında çakışmaz; iki kural
-- birbirini yalanlar. Önce varsa saatli kayıtlar gün başına çekilir.
UPDATE "RoomBlock"
SET "startDate" = date_trunc('day', "startDate"),
    "endDate" = CASE
      WHEN "endDate" IS NULL THEN NULL
      WHEN date_trunc('day', "endDate") <= date_trunc('day', "startDate") THEN date_trunc('day', "startDate") + interval '1 day'
      ELSE date_trunc('day', "endDate")
    END
WHERE "startDate" <> date_trunc('day', "startDate")
   OR ("endDate" IS NOT NULL AND "endDate" <> date_trunc('day', "endDate"));

ALTER TABLE "RoomBlock" ADD CONSTRAINT "RoomBlock_day_precision"
  CHECK (
    "startDate" = date_trunc('day', "startDate")
    AND ("endDate" IS NULL OR "endDate" = date_trunc('day', "endDate"))
  );

-- ─────────────── 4. Rezervasyon kısıtları gece semantiğine hizalanıyor ───────────────
--
-- Uygulama müsaitliği GECE ile sayar (giriş günü dahil, çıkış günü hariç), ama
-- eski kısıtlar ham zaman damgasını karşılaştırıyordu. Sonuç: geç çıkış
-- (18'inde 16:00) ile aynı gün girişi (18'inde 14:00) uygulama "çakışmaz"
-- deyip veritabanı reddediyordu; tersine, aynı gün giriş-çıkış (0 gece)
-- `checkOut > checkIn` kontrolünü geçiyordu. İki katman aynı kuralı konuşmalı.

ALTER TABLE "Reservation" DROP CONSTRAINT "Reservation_no_double_booking";
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_no_double_booking"
  EXCLUDE USING gist (
    "roomId" WITH =,
    tsrange(date_trunc('day', "checkIn"), date_trunc('day', "checkOut"), '[)') WITH &&
  ) WHERE (
    "roomId" IS NOT NULL
    AND "deletedAt" IS NULL
    AND "status" IN ('PENDING', 'CONFIRMED', 'CHECKED_IN')
  );

ALTER TABLE "Reservation" DROP CONSTRAINT "Reservation_date_order";
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_date_order"
  CHECK (date_trunc('day', "checkOut") > date_trunc('day', "checkIn"));

-- ─────────────── 5. Rezervasyon ↔ arıza kaydı çakışması ───────────────
--
-- EXCLUDE kısıtı iki farklı tabloyu karşılaştıramaz. Uygulama katmanı bu
-- kontrolü zaten yapıyor, ama "garantiyi veritabanı verir" ilkesi burada da
-- geçerli: modül 4'ün rezervasyon kodu, elle atılan SQL veya eşzamanlı iki
-- istek, arızalı odaya misafir yerleştirememeli.
--
-- Yarışa karşı: iki tetikleyici de önce aynı `Room` satırını kilitler. READ
-- COMMITTED'da plpgsql'deki her sorgu yeni anlık görüntü aldığı için, kilidi
-- bekleyen işlem diğerinin commit ettiği satırı görür ve reddeder.

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
          && tsrange(date_trunc('day', NEW."checkIn"), date_trunc('day', NEW."checkOut"), '[)')
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
      AND tsrange(date_trunc('day', r."checkIn"), date_trunc('day', r."checkOut"), '[)')
          && tsrange(NEW."startDate", NEW."endDate", '[)')
    LIMIT 1;

    IF conflict_id IS NOT NULL THEN
      RAISE EXCEPTION 'RoomBlock_has_reservations: bu tarihlerde odada rezervasyon var (rezervasyon %)', conflict_id
        USING ERRCODE = '23P01', CONSTRAINT = 'RoomBlock_has_reservations';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Reservation_room_blocked_guard"
  BEFORE INSERT OR UPDATE OF "roomId", "checkIn", "checkOut", "status", "deletedAt" ON "Reservation"
  FOR EACH ROW EXECUTE FUNCTION hotelos_guard_room_block_overlap();

CREATE TRIGGER "RoomBlock_has_reservations_guard"
  BEFORE INSERT OR UPDATE OF "roomId", "startDate", "endDate", "deletedAt" ON "RoomBlock"
  FOR EACH ROW EXECUTE FUNCTION hotelos_guard_room_block_overlap();
