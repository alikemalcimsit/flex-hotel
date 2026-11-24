-- Modül 42: paket servis — satış noktası türü ve sistem ürünü. Enum değeri eklemek kendi migration'ında: yeni değer
-- aynı transaction'da kullanılamaz (sonraki migration kullanır).

-- AlterEnum
ALTER TYPE "PosOutletKind" ADD VALUE 'DELIVERY';

-- AlterEnum
ALTER TYPE "PosSystemItem" ADD VALUE 'DELIVERY_FEE';
