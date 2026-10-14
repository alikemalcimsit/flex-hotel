-- Modül 31: promosyon ve kupon (kural motoru, kupon üretimi, rezervasyonda indirim).

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "PromotionDiscountType" AS ENUM ('PERCENT', 'AMOUNT', 'FREE_NIGHTS');

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "couponId" TEXT,
ADD COLUMN     "discountTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "promotionId" TEXT,
ADD COLUMN     "promotionTerms" JSONB;

-- AlterTable
ALTER TABLE "ReservationNight" ADD COLUMN     "discount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "status" "PromotionStatus" NOT NULL DEFAULT 'DRAFT',
    "requiresCoupon" BOOLEAN NOT NULL DEFAULT false,
    "discountType" "PromotionDiscountType" NOT NULL,
    "discountValue" DECIMAL(12,2),
    "stayNights" INTEGER,
    "payNights" INTEGER,
    "bookFrom" DATE,
    "bookTo" DATE,
    "stayFrom" DATE,
    "stayTo" DATE,
    "minNights" INTEGER,
    "maxNights" INTEGER,
    "minLeadDays" INTEGER,
    "maxLeadDays" INTEGER,
    "roomTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "boardTypes" "BoardType"[] DEFAULT ARRAY[]::"BoardType"[],
    "sources" "ReservationSource"[],
    "createdBy" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "maxUses" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "batchId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Promotion_hotelId_status_requiresCoupon_idx" ON "Promotion"("hotelId", "status", "requiresCoupon");

-- CreateIndex
CREATE INDEX "Promotion_hotelId_name_idx" ON "Promotion"("hotelId", "name");

-- CreateIndex
CREATE INDEX "Coupon_hotelId_promotionId_createdAt_id_idx" ON "Coupon"("hotelId", "promotionId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Coupon_promotionId_batchId_idx" ON "Coupon"("promotionId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_hotelId_code_key" ON "Coupon"("hotelId", "code");

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────── Veri bütünlüğü ───────────────
--
-- Prisma kısmi index, ifade index'i ve CHECK ifade edemez; bunlar son savunma
-- hattıdır (servis aynı kuralları yazmadan önce denetler).

-- Promosyon: ad otel içinde tekil (büyük / küçük harf duyarsız); aramada trigram.
CREATE UNIQUE INDEX "Promotion_hotelId_name_key" ON "Promotion"("hotelId", lower("name"));
CREATE INDEX "Promotion_name_trgm_idx" ON "Promotion" USING gin ("name" gin_trgm_ops);

-- İndirim türüyle alanlar tutarlı: yüzde (0, 100], tutar > 0, "X kal Y öde"de 2 ≤ X ≤ 30, 1 ≤ Y < X.
-- Dönemler geçerli (iki uç dahil, en fazla 1100 gün), gece / gün koşulları tutarlı, en az bir
-- satış kanalı ve hiçbiri acente değil (kontrat fiyatı nettir). Durum izi: taslakta yayın izi yok.
ALTER TABLE "Promotion"
  ADD CONSTRAINT "Promotion_name_not_blank" CHECK (length(btrim("name")) >= 2),
  ADD CONSTRAINT "Promotion_discount_valid" CHECK (
    ("discountType" = 'PERCENT' AND "discountValue" > 0 AND "discountValue" <= 100 AND "stayNights" IS NULL AND "payNights" IS NULL)
    OR ("discountType" = 'AMOUNT' AND "discountValue" > 0 AND "discountValue" <= 100000000 AND "stayNights" IS NULL AND "payNights" IS NULL)
    OR ("discountType" = 'FREE_NIGHTS' AND "discountValue" IS NULL AND "stayNights" BETWEEN 2 AND 30 AND "payNights" >= 1 AND "payNights" < "stayNights")
  ),
  ADD CONSTRAINT "Promotion_book_window_valid" CHECK (
    "bookFrom" IS NULL OR "bookTo" IS NULL OR ("bookTo" >= "bookFrom" AND ("bookTo" - "bookFrom") < 1100)
  ),
  ADD CONSTRAINT "Promotion_stay_window_valid" CHECK (
    "stayFrom" IS NULL OR "stayTo" IS NULL OR ("stayTo" >= "stayFrom" AND ("stayTo" - "stayFrom") < 1100)
  ),
  ADD CONSTRAINT "Promotion_nights_valid" CHECK (
    ("minNights" IS NULL OR "minNights" >= 1) AND ("maxNights" IS NULL OR "maxNights" >= COALESCE("minNights", 1))
  ),
  ADD CONSTRAINT "Promotion_lead_valid" CHECK (
    ("minLeadDays" IS NULL OR "minLeadDays" >= 0) AND ("maxLeadDays" IS NULL OR "maxLeadDays" >= COALESCE("minLeadDays", 0))
  ),
  ADD CONSTRAINT "Promotion_sources_valid" CHECK (
    cardinality("sources") >= 1 AND NOT ('AGENCY' = ANY ("sources"))
  ),
  ADD CONSTRAINT "Promotion_status_trail" CHECK (
    "status" <> 'DRAFT' OR ("activatedAt" IS NULL AND "activatedBy" IS NULL)
  );

-- Kupon: kod biçimi (büyük harf, harf / rakam / tire, 4–30), kullanım sınırı ≥ 1; aramada trigram.
ALTER TABLE "Coupon"
  ADD CONSTRAINT "Coupon_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{3,29}$'),
  ADD CONSTRAINT "Coupon_max_uses_valid" CHECK ("maxUses" IS NULL OR "maxUses" >= 1);
CREATE INDEX "Coupon_code_trgm_idx" ON "Coupon" USING gin ("code" gin_trgm_ops);

-- Rezervasyon: kupon varsa promosyon da vardır; promosyon varsa kopyası da vardır (ve tersi);
-- indirim yalnızca promosyonla doğar; acente satışına ve elle fiyata promosyon uygulanmaz.
ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_coupon_needs_promotion" CHECK ("couponId" IS NULL OR "promotionId" IS NOT NULL),
  ADD CONSTRAINT "Reservation_promotion_terms" CHECK (("promotionId" IS NULL) = ("promotionTerms" IS NULL)),
  ADD CONSTRAINT "Reservation_discount_valid" CHECK ("discountTotal" >= 0 AND ("promotionId" IS NOT NULL OR "discountTotal" = 0)),
  ADD CONSTRAINT "Reservation_promotion_not_agency" CHECK ("agencyId" IS NULL OR "promotionId" IS NULL),
  ADD CONSTRAINT "Reservation_promotion_calculated" CHECK ("promotionId" IS NULL OR "priceMode" = 'CALCULATED');

-- Gece: indirim eksi olamaz.
ALTER TABLE "ReservationNight"
  ADD CONSTRAINT "ReservationNight_discount_valid" CHECK ("discount" >= 0);

-- Kullanım raporu ve kupon sayımı (yalnızca promosyonlu satırlar index'lenir):
-- otelin promosyonlu satışları satış / giriş gününe göre, bir promosyonun satışları,
-- bir kuponun geçerli kullanımları.
CREATE INDEX "Reservation_promo_booked_idx" ON "Reservation"("hotelId", "createdAt", "id")
  WHERE "promotionId" IS NOT NULL AND "deletedAt" IS NULL;
CREATE INDEX "Reservation_promo_stay_idx" ON "Reservation"("hotelId", "checkIn", "id")
  WHERE "promotionId" IS NOT NULL AND "deletedAt" IS NULL;
CREATE INDEX "Reservation_promotion_idx" ON "Reservation"("promotionId", "createdAt", "id")
  WHERE "promotionId" IS NOT NULL;
CREATE INDEX "Reservation_coupon_idx" ON "Reservation"("couponId", "status")
  WHERE "couponId" IS NOT NULL;
