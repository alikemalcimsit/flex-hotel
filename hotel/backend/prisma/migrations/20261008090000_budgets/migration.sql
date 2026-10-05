-- Modül 27: bütçe yönetimi (sürümlü bütçe, satırlar, gider kalemleri ve gerçekleşenleri, AI yorumu).

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "BudgetCommentaryStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "expenseItemId" TEXT,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetExpenseItem" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetExpenseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetExpenseActual" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "expenseItemId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "enteredBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetExpenseActual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetCommentary" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "status" "BudgetCommentaryStatus" NOT NULL DEFAULT 'PENDING',
    "text" TEXT,
    "failureReason" TEXT,
    "model" TEXT,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetCommentary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Budget_hotelId_year_status_idx" ON "Budget"("hotelId", "year", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_hotelId_year_version_key" ON "Budget"("hotelId", "year", "version");

-- CreateIndex
CREATE INDEX "BudgetLine_expenseItemId_idx" ON "BudgetLine"("expenseItemId");

-- CreateIndex
CREATE INDEX "BudgetLine_hotelId_idx" ON "BudgetLine"("hotelId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetLine_budgetId_item_month_key" ON "BudgetLine"("budgetId", "item", "month");

-- CreateIndex
CREATE INDEX "BudgetExpenseItem_hotelId_archivedAt_sortOrder_idx" ON "BudgetExpenseItem"("hotelId", "archivedAt", "sortOrder");

-- CreateIndex
CREATE INDEX "BudgetExpenseActual_hotelId_year_idx" ON "BudgetExpenseActual"("hotelId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetExpenseActual_expenseItemId_year_month_key" ON "BudgetExpenseActual"("expenseItemId", "year", "month");

-- CreateIndex
CREATE INDEX "BudgetCommentary_hotelId_year_month_scope_requestedAt_idx" ON "BudgetCommentary"("hotelId", "year", "month", "scope", "requestedAt" DESC);

-- CreateIndex
CREATE INDEX "BudgetCommentary_budgetId_idx" ON "BudgetCommentary"("budgetId");

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_expenseItemId_fkey" FOREIGN KEY ("expenseItemId") REFERENCES "BudgetExpenseItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetExpenseItem" ADD CONSTRAINT "BudgetExpenseItem_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetExpenseActual" ADD CONSTRAINT "BudgetExpenseActual_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetExpenseActual" ADD CONSTRAINT "BudgetExpenseActual_expenseItemId_fkey" FOREIGN KEY ("expenseItemId") REFERENCES "BudgetExpenseItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetCommentary" ADD CONSTRAINT "BudgetCommentary_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetCommentary" ADD CONSTRAINT "BudgetCommentary_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────── Kısıtlar (servisin kontrolüne ek, son savunma hattı) ───────────────

-- Yılın en fazla bir taslağı ve bir onaylı sürümü (aynı anda iki "revize aç" ya da iki onay tek sonuç verir).
CREATE UNIQUE INDEX "Budget_one_draft_per_year" ON "Budget"("hotelId", "year") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "Budget_one_approved_per_year" ON "Budget"("hotelId", "year") WHERE "status" = 'APPROVED';

ALTER TABLE "Budget" ADD CONSTRAINT "Budget_version_positive" CHECK ("version" >= 1 AND "year" BETWEEN 2000 AND 9999);
-- Onay izi: onaylı ve eski sürümde kim / ne zaman onayladı dolu; eski sürümde ne zaman geçildi dolu.
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_approval_trail"
  CHECK (("status" = 'DRAFT' OR ("approvedAt" IS NOT NULL AND "approvedBy" IS NOT NULL))
     AND (("status" = 'SUPERSEDED') = ("supersededAt" IS NOT NULL)));

ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_values"
  CHECK ("month" BETWEEN 1 AND 12 AND "amount" >= 0 AND ("item" <> 'OCCUPANCY' OR "amount" <= 100));
-- Gider satırının kalemi gider kaleminin kimliğidir; sistem satırında gider kalemi yok.
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_expense_item"
  CHECK ("expenseItemId" IS NULL OR "item" = "expenseItemId");

-- Etkin gider kalemi adı otelde tekil (büyük / küçük harf fark etmez).
CREATE UNIQUE INDEX "BudgetExpenseItem_active_label_key" ON "BudgetExpenseItem"("hotelId", lower("label")) WHERE "archivedAt" IS NULL;

ALTER TABLE "BudgetExpenseActual" ADD CONSTRAINT "BudgetExpenseActual_values"
  CHECK ("month" BETWEEN 1 AND 12 AND "amount" >= 0 AND "year" BETWEEN 2000 AND 9999);

-- Dönem için aynı anda tek bekleyen yorum isteği.
CREATE UNIQUE INDEX "BudgetCommentary_one_pending" ON "BudgetCommentary"("hotelId", "budgetId", "year", "month", "scope") WHERE "status" = 'PENDING';
ALTER TABLE "BudgetCommentary" ADD CONSTRAINT "BudgetCommentary_values"
  CHECK ("month" BETWEEN 1 AND 12 AND "scope" IN ('MONTH', 'YTD')
     AND ("status" <> 'READY' OR ("text" IS NOT NULL AND "completedAt" IS NOT NULL))
     AND ("status" <> 'FAILED' OR ("failureReason" IS NOT NULL AND "completedAt" IS NOT NULL)));
