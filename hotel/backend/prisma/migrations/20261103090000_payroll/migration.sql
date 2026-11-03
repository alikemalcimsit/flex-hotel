-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "PayBasis" AS ENUM ('GROSS', 'NET');

-- CreateEnum
CREATE TYPE "InsuranceType" AS ENUM ('NORMAL', 'RETIRED');

-- CreateEnum
CREATE TYPE "EmployeePaymentMethod" AS ENUM ('BANK', 'CASH');

-- CreateEnum
CREATE TYPE "PayrollRunKind" AS ENUM ('MONTHLY', 'SUPPLEMENTARY');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'CALCULATED', 'PENDING_APPROVAL', 'APPROVED');

-- CreateEnum
CREATE TYPE "PayElementKind" AS ENUM ('EARNING', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "PayElementExemption" AS ENUM ('NONE', 'MEAL', 'TRANSPORT');

-- CreateEnum
CREATE TYPE "PayrollItemSource" AS ENUM ('MANUAL', 'SERVICE_CHARGE', 'TERMINATION');

-- CreateEnum
CREATE TYPE "IncentiveMethod" AS ENUM ('TREASURY_POINTS', 'MIN_WAGE_EMPLOYER_SHARE', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "GarnishmentType" AS ENUM ('ICRA', 'NAFAKA');

-- CreateEnum
CREATE TYPE "GarnishmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('OPEN', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NoticeMode" AS ENUM ('NONE', 'EMPLOYER_PAYS', 'EMPLOYEE_PAYS');

-- CreateEnum
CREATE TYPE "ServiceChargeMethod" AS ENUM ('POINTS', 'EQUAL');

-- CreateEnum
CREATE TYPE "ServiceChargeStatus" AS ENUM ('DRAFT', 'DISTRIBUTED');

-- CreateEnum
CREATE TYPE "PayrollLineKind" AS ENUM ('EARNING', 'DEDUCTION');

-- AlterEnum
ALTER TYPE "LedgerAccountType" ADD VALUE 'EMPLOYEE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerSource" ADD VALUE 'PAYROLL';
ALTER TYPE "LedgerSource" ADD VALUE 'PAYROLL_PAYMENT';
ALTER TYPE "LedgerSource" ADD VALUE 'EMPLOYEE_ADVANCE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TreasurySource" ADD VALUE 'PAYROLL_PAYMENT';
ALTER TYPE "TreasurySource" ADD VALUE 'EMPLOYEE_ADVANCE';

-- AlterTable
ALTER TABLE "LedgerAccount" ADD COLUMN     "employeeId" TEXT;

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "nationality" TEXT NOT NULL DEFAULT 'TR',
    "nationalId" TEXT NOT NULL,
    "birthDate" DATE,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "departmentId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "hireDate" DATE NOT NULL,
    "terminationDate" DATE,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "payBasis" "PayBasis" NOT NULL DEFAULT 'GROSS',
    "salary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "insuranceType" "InsuranceType" NOT NULL DEFAULT 'NORMAL',
    "disabilityDegree" INTEGER,
    "paymentMethod" "EmployeePaymentMethod" NOT NULL DEFAULT 'BANK',
    "iban" TEXT,
    "besEnrolled" BOOLEAN NOT NULL DEFAULT false,
    "besRate" DECIMAL(6,5),
    "besOptOutOn" DATE,
    "serviceChargePoints" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "userId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeIncentive" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "method" "IncentiveMethod" NOT NULL,
    "points" DECIMAL(5,2),
    "amount" DECIMAL(14,2),
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeIncentive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeAdvance" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "installments" INTEGER NOT NULL,
    "installmentAmount" DECIMAL(14,2) NOT NULL,
    "firstYear" INTEGER NOT NULL,
    "firstMonth" INTEGER NOT NULL,
    "paidOn" DATE NOT NULL,
    "treasuryAccountId" TEXT,
    "deducted" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Garnishment" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "GarnishmentType" NOT NULL,
    "fileNumber" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "creditor" TEXT NOT NULL,
    "notifiedOn" DATE NOT NULL,
    "totalAmount" DECIMAL(14,2),
    "monthlyAmount" DECIMAL(14,2),
    "rate" DECIMAL(6,5),
    "deducted" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "GarnishmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "ledgerAccountId" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Garnishment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollSettings" (
    "hotelId" TEXT NOT NULL,
    "workplaceName" TEXT,
    "sgkWorkplaceNo" TEXT,
    "taxOffice" TEXT,
    "taxNumber" TEXT,
    "sector" TEXT NOT NULL DEFAULT 'GENERAL',
    "treasuryDiscount" BOOLEAN NOT NULL DEFAULT true,
    "sgkLedgerAccountId" TEXT,
    "taxLedgerAccountId" TEXT,
    "besLedgerAccountId" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSettings_pkey" PRIMARY KEY ("hotelId")
);

-- CreateTable
CREATE TABLE "PayrollParameterSet" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "catalogKey" TEXT,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollParameterSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayElement" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PayElementKind" NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "sgk" BOOLEAN NOT NULL,
    "gv" BOOLEAN NOT NULL,
    "dv" BOOLEAN NOT NULL,
    "exemption" "PayElementExemption" NOT NULL DEFAULT 'NONE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollAttendance" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "missingDays" INTEGER NOT NULL DEFAULT 0,
    "missingReason" TEXT,
    "workedDays" INTEGER,
    "overtimeHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "holidayDays" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "weeklyRestDays" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollItem" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "elementId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "isNet" BOOLEAN NOT NULL DEFAULT false,
    "source" "PayrollItemSource" NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "runId" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeTermination" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "terminationDate" DATE NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "severanceEligible" BOOLEAN NOT NULL,
    "noticeMode" "NoticeMode" NOT NULL,
    "noticeWeeks" INTEGER NOT NULL,
    "unusedLeaveDays" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "severanceBase" DECIMAL(14,2) NOT NULL,
    "severanceCeiling" DECIMAL(14,2) NOT NULL,
    "serviceYears" INTEGER NOT NULL,
    "serviceMonths" INTEGER NOT NULL,
    "serviceDays" INTEGER NOT NULL,
    "severanceAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "noticeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "leaveAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "overrideReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeTermination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "kind" "PayrollRunKind" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "parameterSetId" TEXT,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "grossTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "netTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "deductionTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "payableTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "employeeSgkTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "employeeUnemploymentTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "employerSgkTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "employerUnemploymentTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "gvTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "dvTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "costTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "paidTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "calculatedAt" TIMESTAMP(3),
    "calculatedBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedBy" TEXT,
    "approvalId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollEntry" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "payBasis" "PayBasis" NOT NULL,
    "insuranceType" "InsuranceType" NOT NULL,
    "sgkDays" INTEGER NOT NULL,
    "workedDays" INTEGER NOT NULL,
    "missingDays" INTEGER NOT NULL DEFAULT 0,
    "missingReason" TEXT,
    "gross" DECIMAL(14,2) NOT NULL,
    "sgkSubject" DECIMAL(14,2) NOT NULL,
    "pek" DECIMAL(14,2) NOT NULL,
    "employeeSgk" DECIMAL(14,2) NOT NULL,
    "employeeUnemployment" DECIMAL(14,2) NOT NULL,
    "gvBase" DECIMAL(14,2) NOT NULL,
    "gvBefore" DECIMAL(16,2) NOT NULL,
    "gvComputed" DECIMAL(14,2) NOT NULL,
    "minWageGvExemption" DECIMAL(14,2) NOT NULL,
    "gvPayable" DECIMAL(14,2) NOT NULL,
    "dvComputed" DECIMAL(14,2) NOT NULL,
    "minWageDvExemption" DECIMAL(14,2) NOT NULL,
    "dvPayable" DECIMAL(14,2) NOT NULL,
    "minWageBase" DECIMAL(14,2) NOT NULL,
    "minWageBefore" DECIMAL(16,2) NOT NULL,
    "net" DECIMAL(14,2) NOT NULL,
    "deductionTotal" DECIMAL(14,2) NOT NULL,
    "payable" DECIMAL(14,2) NOT NULL,
    "employerSgk" DECIMAL(14,2) NOT NULL,
    "employerUnemployment" DECIMAL(14,2) NOT NULL,
    "treasuryDiscount" DECIMAL(14,2) NOT NULL,
    "incentiveDiscount" DECIMAL(14,2) NOT NULL,
    "employerCost" DECIMAL(14,2) NOT NULL,
    "incentiveCode" TEXT,
    "paymentMethod" "EmployeePaymentMethod" NOT NULL,
    "iban" TEXT,
    "paymentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "trace" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "kind" "PayrollLineKind" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "quantity" TEXT,
    "isNet" BOOLEAN NOT NULL DEFAULT false,
    "refId" TEXT,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPayment" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "method" "EmployeePaymentMethod" NOT NULL,
    "treasuryAccountId" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "count" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceChargePool" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "ServiceChargeMethod" NOT NULL,
    "daysWeighted" BOOLEAN NOT NULL DEFAULT true,
    "departmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ServiceChargeStatus" NOT NULL DEFAULT 'DRAFT',
    "distributedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceChargePool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollOpening" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "gvCumulative" DECIMAL(16,2) NOT NULL,
    "minWageCumulative" DECIMAL(16,2) NOT NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollOpening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollSequence" (
    "hotelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PayrollSequence_pkey" PRIMARY KEY ("hotelId","kind")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_hotelId_code_key" ON "Department"("hotelId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_hotelId_status_lastName_firstName_idx" ON "Employee"("hotelId", "status", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "Employee_hotelId_departmentId_status_idx" ON "Employee"("hotelId", "departmentId", "status");

-- CreateIndex
CREATE INDEX "Employee_hotelId_nationalId_idx" ON "Employee"("hotelId", "nationalId");

-- CreateIndex
CREATE INDEX "Employee_hotelId_hireDate_terminationDate_idx" ON "Employee"("hotelId", "hireDate", "terminationDate");

-- CreateIndex
CREATE INDEX "Employee_firstName_trgm_idx" ON "Employee" USING GIN ("firstName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Employee_lastName_trgm_idx" ON "Employee" USING GIN ("lastName" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_hotelId_code_key" ON "Employee"("hotelId", "code");

-- CreateIndex
CREATE INDEX "EmployeeIncentive_employeeId_validFrom_idx" ON "EmployeeIncentive"("employeeId", "validFrom");

-- CreateIndex
CREATE INDEX "EmployeeIncentive_hotelId_validFrom_idx" ON "EmployeeIncentive"("hotelId", "validFrom");

-- CreateIndex
CREATE INDEX "EmployeeAdvance_hotelId_employeeId_status_idx" ON "EmployeeAdvance"("hotelId", "employeeId", "status");

-- CreateIndex
CREATE INDEX "EmployeeAdvance_hotelId_status_idx" ON "EmployeeAdvance"("hotelId", "status");

-- CreateIndex
CREATE INDEX "Garnishment_hotelId_employeeId_status_notifiedOn_idx" ON "Garnishment"("hotelId", "employeeId", "status", "notifiedOn");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollParameterSet_hotelId_validFrom_key" ON "PayrollParameterSet"("hotelId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PayElement_hotelId_code_key" ON "PayElement"("hotelId", "code");

-- CreateIndex
CREATE INDEX "PayrollAttendance_hotelId_year_month_idx" ON "PayrollAttendance"("hotelId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollAttendance_employeeId_year_month_key" ON "PayrollAttendance"("employeeId", "year", "month");

-- CreateIndex
CREATE INDEX "PayrollItem_hotelId_year_month_employeeId_idx" ON "PayrollItem"("hotelId", "year", "month", "employeeId");

-- CreateIndex
CREATE INDEX "PayrollItem_hotelId_source_sourceId_idx" ON "PayrollItem"("hotelId", "source", "sourceId");

-- CreateIndex
CREATE INDEX "PayrollItem_runId_idx" ON "PayrollItem"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeTermination_employeeId_key" ON "EmployeeTermination"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeTermination_hotelId_terminationDate_idx" ON "EmployeeTermination"("hotelId", "terminationDate");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_approvalId_key" ON "PayrollRun"("approvalId");

-- CreateIndex
CREATE INDEX "PayrollRun_hotelId_year_month_idx" ON "PayrollRun"("hotelId", "year", "month");

-- CreateIndex
CREATE INDEX "PayrollRun_hotelId_status_idx" ON "PayrollRun"("hotelId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_hotelId_year_month_kind_sequence_key" ON "PayrollRun"("hotelId", "year", "month", "kind", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_hotelId_number_key" ON "PayrollRun"("hotelId", "number");

-- CreateIndex
CREATE INDEX "PayrollEntry_hotelId_employeeId_idx" ON "PayrollEntry"("hotelId", "employeeId");

-- CreateIndex
CREATE INDEX "PayrollEntry_runId_departmentId_idx" ON "PayrollEntry"("runId", "departmentId");

-- CreateIndex
CREATE INDEX "PayrollEntry_runId_paymentId_idx" ON "PayrollEntry"("runId", "paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEntry_runId_employeeId_key" ON "PayrollEntry"("runId", "employeeId");

-- CreateIndex
CREATE INDEX "PayrollLine_entryId_sortOrder_idx" ON "PayrollLine"("entryId", "sortOrder");

-- CreateIndex
CREATE INDEX "PayrollLine_hotelId_refId_idx" ON "PayrollLine"("hotelId", "refId");

-- CreateIndex
CREATE INDEX "PayrollPayment_runId_idx" ON "PayrollPayment"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceChargePool_hotelId_year_month_key" ON "ServiceChargePool"("hotelId", "year", "month");

-- CreateIndex
CREATE INDEX "PayrollOpening_hotelId_year_idx" ON "PayrollOpening"("hotelId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollOpening_employeeId_year_key" ON "PayrollOpening"("employeeId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_employeeId_key" ON "LedgerAccount"("employeeId");

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeIncentive" ADD CONSTRAINT "EmployeeIncentive_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAdvance" ADD CONSTRAINT "EmployeeAdvance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Garnishment" ADD CONSTRAINT "Garnishment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollSettings" ADD CONSTRAINT "PayrollSettings_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollParameterSet" ADD CONSTRAINT "PayrollParameterSet_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayElement" ADD CONSTRAINT "PayElement_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAttendance" ADD CONSTRAINT "PayrollAttendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "PayElement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTermination" ADD CONSTRAINT "EmployeeTermination_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "PayrollEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollOpening" ADD CONSTRAINT "PayrollOpening_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Aynı kişinin aynı otelde tek aktif kaydı (yeniden işe giriş, önceki kayıt çıkış yaptıktan sonra yeni kayıttır)
CREATE UNIQUE INDEX "Employee_active_nationalId_key" ON "Employee"("hotelId", "nationalId") WHERE "status" = 'ACTIVE';

-- Veri bütünlüğü (servis zaten denetler; bu son savunma hattı)
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_values_check" CHECK ("salary" >= 0 AND ("disabilityDegree" IS NULL OR "disabilityDegree" BETWEEN 1 AND 3) AND ("terminationDate" IS NULL OR "terminationDate" >= "hireDate"));
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_period_check" CHECK ("month" BETWEEN 1 AND 12 AND ("kind" <> 'MONTHLY' OR "sequence" = 1));
ALTER TABLE "PayrollAttendance" ADD CONSTRAINT "PayrollAttendance_days_check" CHECK ("month" BETWEEN 1 AND 12 AND "missingDays" BETWEEN 0 AND 30 AND ("workedDays" IS NULL OR "workedDays" BETWEEN 0 AND 30) AND "overtimeHours" >= 0 AND "holidayDays" >= 0 AND "weeklyRestDays" >= 0);
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_values_check" CHECK ("amount" > 0 AND "month" BETWEEN 1 AND 12);
ALTER TABLE "EmployeeAdvance" ADD CONSTRAINT "EmployeeAdvance_values_check" CHECK ("amount" > 0 AND "deducted" >= 0 AND "deducted" <= "amount" AND "installments" >= 1);
ALTER TABLE "Garnishment" ADD CONSTRAINT "Garnishment_values_check" CHECK ("deducted" >= 0 AND ("totalAmount" IS NULL OR "deducted" <= "totalAmount"));
