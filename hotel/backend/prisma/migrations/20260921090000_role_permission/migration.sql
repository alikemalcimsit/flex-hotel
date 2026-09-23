-- Rol → izin matrisi (modül 2 — RBAC). Bir otelin hiç satırı yoksa çözüm koddaki
-- varsayılanlara düşer; matris kaydedilince tüm roller için satır yazılır ve DB
-- kaynak olur. ADMIN satır tutmaz — kod her zaman ADMIN'e tüm izinleri verir.

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "permission" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RolePermission_hotelId_role_idx" ON "RolePermission"("hotelId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_hotelId_role_permission_key" ON "RolePermission"("hotelId", "role", "permission");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
