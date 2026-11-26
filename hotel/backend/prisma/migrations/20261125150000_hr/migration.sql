-- Modül 52: İK — izin, bakiye düzeltmesi, vardiya, günlük puantaj, özlük belgesi, İK ayarı; HR zili.

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'UNPAID', 'MATERNITY', 'PATERNITY', 'MARRIAGE', 'BEREAVEMENT', 'ADMINISTRATIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShiftSource" AS ENUM ('MANUAL', 'PLANNER');

-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('PRESENT', 'ABSENT', 'LEAVE', 'REST', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "TimesheetSource" AS ENUM ('MANUAL', 'DEVICE', 'MOBILE');

-- CreateEnum
CREATE TYPE "EmployeeDocumentType" AS ENUM ('ID_COPY', 'CONTRACT', 'HEALTH_REPORT', 'HYGIENE_CERTIFICATE', 'CRIMINAL_RECORD', 'DIPLOMA', 'CERTIFICATE', 'RESIDENCE_PERMIT', 'WORK_PERMIT', 'SGK_ENTRY', 'OTHER');

-- AlterEnum
ALTER TYPE "StaffAlertKind" ADD VALUE 'HR';

-- CreateTable
CREATE TABLE "Leave" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "LeaveType" NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "days" DECIMAL(5,1) NOT NULL,
    "reason" TEXT,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvalId" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "cancelledBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Leave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveAdjustment" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "days" DECIMAL(5,1) NOT NULL,
    "effectiveOn" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "source" "ShiftSource" NOT NULL DEFAULT 'MANUAL',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timesheet" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'PRESENT',
    "clockIn" TIMESTAMP(3),
    "clockOut" TIMESTAMP(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "leaveId" TEXT,
    "source" "TimesheetSource" NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "EmployeeDocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "fileKey" TEXT,
    "fileName" TEXT,
    "contentType" TEXT,
    "size" INTEGER,
    "issuedOn" DATE,
    "expiresOn" DATE,
    "note" TEXT,
    "remindedAt" TIMESTAMP(3),
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrSettings" (
    "hotelId" TEXT NOT NULL,
    "weeklyRestDay" INTEGER NOT NULL DEFAULT 0,
    "dailyWorkMinutes" INTEGER NOT NULL DEFAULT 450,
    "weeklyWorkMinutes" INTEGER NOT NULL DEFAULT 2700,
    "publicHolidays" JSONB NOT NULL DEFAULT '[]',
    "leaveApprovalRequired" BOOLEAN NOT NULL DEFAULT true,
    "documentReminderDays" INTEGER NOT NULL DEFAULT 30,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrSettings_pkey" PRIMARY KEY ("hotelId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Leave_approvalId_key" ON "Leave"("approvalId");

-- CreateIndex
CREATE INDEX "Leave_hotelId_employeeId_startDate_idx" ON "Leave"("hotelId", "employeeId", "startDate");

-- CreateIndex
CREATE INDEX "Leave_hotelId_status_startDate_idx" ON "Leave"("hotelId", "status", "startDate");

-- CreateIndex
CREATE INDEX "Leave_hotelId_startDate_endDate_idx" ON "Leave"("hotelId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "LeaveAdjustment_hotelId_employeeId_effectiveOn_idx" ON "LeaveAdjustment"("hotelId", "employeeId", "effectiveOn");

-- CreateIndex
CREATE INDEX "Shift_hotelId_date_departmentId_idx" ON "Shift"("hotelId", "date", "departmentId");

-- CreateIndex
CREATE INDEX "Shift_hotelId_employeeId_date_idx" ON "Shift"("hotelId", "employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_employeeId_date_startTime_key" ON "Shift"("employeeId", "date", "startTime");

-- CreateIndex
CREATE INDEX "Timesheet_hotelId_date_idx" ON "Timesheet"("hotelId", "date");

-- CreateIndex
CREATE INDEX "Timesheet_hotelId_employeeId_date_idx" ON "Timesheet"("hotelId", "employeeId", "date");

-- CreateIndex
CREATE INDEX "Timesheet_leaveId_idx" ON "Timesheet"("leaveId");

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_employeeId_date_key" ON "Timesheet"("employeeId", "date");

-- CreateIndex
CREATE INDEX "EmployeeDocument_hotelId_employeeId_deletedAt_idx" ON "EmployeeDocument"("hotelId", "employeeId", "deletedAt");

-- CreateIndex
CREATE INDEX "EmployeeDocument_hotelId_expiresOn_idx" ON "EmployeeDocument"("hotelId", "expiresOn");

-- AddForeignKey
ALTER TABLE "Leave" ADD CONSTRAINT "Leave_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Leave" ADD CONSTRAINT "Leave_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Leave" ADD CONSTRAINT "Leave_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "Approval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAdjustment" ADD CONSTRAINT "LeaveAdjustment_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAdjustment" ADD CONSTRAINT "LeaveAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_leaveId_fkey" FOREIGN KEY ("leaveId") REFERENCES "Leave"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSettings" ADD CONSTRAINT "HrSettings_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- İzin aralığı ve gün sayısı; vardiya saat biçimi ve molası; puantaj dakikaları; durum izi.
ALTER TABLE "Leave" ADD CONSTRAINT "Leave_date_range" CHECK ("endDate" >= "startDate" AND "days" >= 0);
ALTER TABLE "Leave" ADD CONSTRAINT "Leave_status_trail" CHECK (
  ("status" = 'PENDING' AND "decidedAt" IS NULL AND "cancelledAt" IS NULL)
  OR ("status" = 'APPROVED' AND "decidedAt" IS NOT NULL AND "cancelledAt" IS NULL)
  OR ("status" = 'REJECTED' AND "decidedAt" IS NOT NULL AND "cancelledAt" IS NULL)
  OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL)
);
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_time_format" CHECK ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "breakMinutes" BETWEEN 0 AND 480);
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_minutes" CHECK ("breakMinutes" >= 0 AND "workedMinutes" >= 0 AND "overtimeMinutes" >= 0 AND "overtimeMinutes" <= "workedMinutes");
ALTER TABLE "HrSettings" ADD CONSTRAINT "HrSettings_ranges" CHECK ("weeklyRestDay" BETWEEN 0 AND 6 AND "dailyWorkMinutes" BETWEEN 60 AND 720 AND "weeklyWorkMinutes" BETWEEN 60 AND 4320 AND "documentReminderDays" BETWEEN 0 AND 365);
