-- Cari hareketine bağlı fatura numarası (modül 16 / 49): folyo aktarımı ve etkinlik bedeli alacağı faturalanınca
-- numara buraya yazılır (ödemenin kendi referansı "reference"ta kalır); iptalde silinir. Serbest faturanın
-- alacağı da numarasını taşır.
ALTER TABLE "LedgerEntry" ADD COLUMN "invoiceNumber" TEXT;
