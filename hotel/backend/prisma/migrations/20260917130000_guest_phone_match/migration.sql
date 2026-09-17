-- Misafiri kanal numarasından bulmak (modül 7).
--
-- Kartta telefon her biçimde yazılabilir ("0532 111 00 01", "+90 532 ...");
-- kanal ülke koduyla gönderir ("905321110001"). Ülke kodu yazılmamış numara
-- otelin telefon ülke koduyla yorumlanır (bkz. messaging/rules.js →
-- phoneMatchScore); aday kartlar rakamların son 7'siyle bulunur.

-- AlterTable
ALTER TABLE "Hotel" ADD COLUMN "phoneCountryCode" TEXT NOT NULL DEFAULT '90';

ALTER TABLE "Hotel"
  ADD CONSTRAINT "Hotel_phone_country_code_valid" CHECK ("phoneCountryCode" ~ '^[1-9][0-9]{0,2}$');

-- İfade, servisteki sorguyla birebir aynı olmalı; değişirse ikisi birlikte değişir.
CREATE INDEX "Guest_phone_match_idx"
  ON "Guest" ("hotelId", (right(regexp_replace("phone", '[^0-9]', '', 'g'), 7)))
  WHERE "phone" IS NOT NULL AND "deletedAt" IS NULL;
