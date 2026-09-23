-- Bekleme listesi tek yerde: WaitlistEntry.
--
-- Modül 4'ün paralel yazılan ilk sürümü (main, 20260922090000_reservation_waitlist)
-- bekleyen talebi Reservation satırı olarak `WAITLISTED` durumuyla tutuyordu.
-- Birleştirmede bekleme listesi ayrı tablo olarak kaldı. O sürüm bir süre
-- çalıştıysa kalan WAITLISTED satırları burada bekleme listesine taşınır ve
-- rezervasyon tarafında gerekçeyle iptal edilir; hiçbir talep kaybolmaz.
-- Satır yoksa hiçbir şey yapmaz. Enum değeri PostgreSQL'de silinemediği için
-- şemada kalır, kod yazmaz.

CREATE TEMP TABLE "_waitlisted_move" AS
SELECT r."id" AS "reservationId", gen_random_uuid()::text AS "entryId", gen_random_uuid()::text AS "auditId"
FROM "Reservation" r
WHERE r."status" = 'WAITLISTED';

INSERT INTO "WaitlistEntry" (
  "id", "hotelId", "guestId", "firstName", "lastName", "phone", "email",
  "roomTypeId", "checkIn", "checkOut", "adults", "children", "boardType",
  "notes", "status", "createdBy", "createdAt", "updatedAt"
)
SELECT
  m."entryId", r."hotelId", r."guestId", g."firstName", g."lastName", g."phone", g."email",
  r."roomTypeId", r."checkIn", r."checkOut", r."adults", r."children", r."boardType",
  concat_ws(E'\n', r."notes", 'Eski bekleyen kayıt: ' || r."confirmationCode"),
  'WAITING', r."createdBy", r."createdAt", now()
FROM "_waitlisted_move" m
JOIN "Reservation" r ON r."id" = m."reservationId"
JOIN "Guest" g ON g."id" = r."guestId";

UPDATE "Reservation" r
SET "status" = 'CANCELLED',
    "cancelledAt" = now(),
    "cancelledBy" = 'system',
    "cancelReason" = 'Bekleme listesine taşındı (eski bekleyen kaydı)',
    "cancellationFee" = 0,
    "updatedAt" = now()
FROM "_waitlisted_move" m
WHERE r."id" = m."reservationId";

-- Rezervasyon geçmişinde görünsün (denetim izi).
INSERT INTO "AuditLog" ("id", "hotelId", "entity", "entityId", "action", "actor", "before", "after", "changedFields", "correlationId", "createdAt", "updatedAt")
SELECT
  m."auditId", r."hotelId", 'Reservation', r."id", 'UPDATE', 'system',
  jsonb_build_object('status', 'WAITLISTED'),
  jsonb_build_object('status', 'CANCELLED', 'cancelReason', r."cancelReason", 'waitlistId', m."entryId"),
  ARRAY['status', 'cancelReason']::TEXT[],
  'migration:20260923090000_waitlisted_to_entries', now(), now()
FROM "_waitlisted_move" m
JOIN "Reservation" r ON r."id" = m."reservationId";

DROP TABLE "_waitlisted_move";
