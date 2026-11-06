-- Online check-in listesi giriş gününe göre sıralanır / süzülür: rezervasyonla birleştirmeden, indeksle (modül 53).
ALTER TABLE "OnlineCheckin" ADD COLUMN "arrivalDate" DATE;
UPDATE "OnlineCheckin" o SET "arrivalDate" = r."checkIn"::date FROM "Reservation" r WHERE r."id" = o."reservationId";
ALTER TABLE "OnlineCheckin" ALTER COLUMN "arrivalDate" SET NOT NULL;
DROP INDEX "OnlineCheckin_hotelId_status_submittedAt_idx";
CREATE INDEX "OnlineCheckin_hotelId_arrivalDate_submittedAt_id_idx" ON "OnlineCheckin"("hotelId", "arrivalDate", "submittedAt", "id");
CREATE INDEX "OnlineCheckin_hotelId_status_arrivalDate_submittedAt_id_idx" ON "OnlineCheckin"("hotelId", "status", "arrivalDate", "submittedAt", "id");
