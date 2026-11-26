-- Modül 63: zincir konsolu — zincir (HotelGroup), otel erişimi (UserHotel), Hotel.groupId.

-- CreateTable
CREATE TABLE "HotelGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HotelGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserHotel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserHotel_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Hotel" ADD COLUMN "groupId" TEXT;

-- CreateIndex
CREATE INDEX "Hotel_groupId_name_idx" ON "Hotel"("groupId", "name");

-- CreateIndex
CREATE INDEX "User_hotelId_name_idx" ON "User"("hotelId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "UserHotel_userId_hotelId_key" ON "UserHotel"("userId", "hotelId");

-- CreateIndex
CREATE INDEX "UserHotel_hotelId_role_idx" ON "UserHotel"("hotelId", "role");

-- AddForeignKey
ALTER TABLE "Hotel" ADD CONSTRAINT "Hotel_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "HotelGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHotel" ADD CONSTRAINT "UserHotel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHotel" ADD CONSTRAINT "UserHotel_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
