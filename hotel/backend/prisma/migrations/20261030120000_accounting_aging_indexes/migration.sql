-- Ön muhasebe (modül 47): yaşlandırmanın (FIFO) kısmi kapsayan index'leri.
--
-- Yaşlandırma her cari için bakiyeyi kapatan en yeni hareketleri (yalnız bakiyenin yönündeki satırlar) yeniden
-- eskiye okur. Bu index'ler cari + yeniden eskiye sırayı ve gereken kolonları (tutar, vade, otel) taşır: sorgu
-- tabloya dokunmadan, sıralama yapmadan index'ten okunur (600.000 hareketli, 16.456 borçlu carili ölçüm otelinde rapor 2,15 sn → 0,68 sn).
--
-- Not: Prisma kısmi / INCLUDE'lu index'i şemada ifade edemiyor; index'ler yalnız burada tanımlı. `migrate diff`
-- çıktısında bunları düşüren satırlar görülürse migration'a alınmamalı.
CREATE INDEX "LedgerEntry_debit_fifo_idx" ON "LedgerEntry" ("accountId", "date" DESC, "createdAt" DESC, "id" DESC) INCLUDE ("debit", "dueDate", "hotelId") WHERE "debit" > 0;
CREATE INDEX "LedgerEntry_credit_fifo_idx" ON "LedgerEntry" ("accountId", "date" DESC, "createdAt" DESC, "id" DESC) INCLUDE ("credit", "dueDate", "hotelId") WHERE "credit" > 0;
