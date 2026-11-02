-- Faturalama başlangıcı (modül 49): öncesinde kapanan folyo / etkinlik "faturalanacaklar"a girmez. Var olan
-- ayarda ayarın kaydedildiği gün.
ALTER TABLE "InvoiceSettings" ADD COLUMN "startDate" DATE;
UPDATE "InvoiceSettings" SET "startDate" = "createdAt"::date;
ALTER TABLE "InvoiceSettings" ALTER COLUMN "startDate" SET NOT NULL;
