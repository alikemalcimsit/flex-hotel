-- Online check-in araması (modül 53): onay kodu + rezervasyon sahibi ve refakatçi adları kaydın kendisinde, trigram indeksli.
ALTER TABLE "OnlineCheckin" ADD COLUMN "searchText" TEXT;
UPDATE "OnlineCheckin" o SET "searchText" = concat_ws(' ', r."confirmationCode", o."guest"->>'firstName', o."guest"->>'lastName',
  (SELECT string_agg(concat_ws(' ', c->>'firstName', c->>'lastName'), ' ') FROM jsonb_array_elements(o."companions") c))
FROM "Reservation" r WHERE r."id" = o."reservationId";
ALTER TABLE "OnlineCheckin" ALTER COLUMN "searchText" SET NOT NULL;
CREATE INDEX "OnlineCheckin_searchText_trgm_idx" ON "OnlineCheckin" USING GIN ("searchText" gin_trgm_ops);
