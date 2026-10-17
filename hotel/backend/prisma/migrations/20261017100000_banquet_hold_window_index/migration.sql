-- Modül 37: salon takviminin otel geneli pencere sorgusu ("pencere başından sonra biten" tutmalar).
-- Mevcut (hotelId, venueId, startAt, endAt) index'i salonsuz pencere sorgusuna yaramıyordu (sıralı tarama).
CREATE INDEX "EventVenueHold_hotelId_endAt_idx" ON "EventVenueHold"("hotelId", "endAt");
