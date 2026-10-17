-- Modül 37 düzeltmesi: aynı salona aynı saatte iki kesin tutma yasağı yalnızca **farklı**
-- etkinlikler arasında geçerli. Aynı etkinliğin arka arkaya oturumları (sabah / öğleden sonra,
-- plenary / gala) aynı salonda kurulum / söküm süreleriyle üst üste binebilir; eski kısıt
-- bunları da çakışma sayıp kesinleştirmeyi reddediyordu.
ALTER TABLE "EventVenueHold" DROP CONSTRAINT "EventVenueHold_no_double_definite";
ALTER TABLE "EventVenueHold" ADD CONSTRAINT "EventVenueHold_no_double_definite"
  EXCLUDE USING gist ("venueId" WITH =, "eventId" WITH <>, tsrange("startAt", "endAt", '[)') WITH &&)
  WHERE ("status" = 'DEFINITE');
