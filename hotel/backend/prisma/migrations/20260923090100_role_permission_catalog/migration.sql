-- Rol matrisi (modül 2): matris kaydedildiğinde katalogda olan izinler.
-- Sonradan kataloğa eklenen izin (yeni modül) bu listede olmaz ve rolün koddaki
-- varsayılanına düşer; aksi hâlde matrisi kaydetmiş otelde yeni modülün izni
-- ADMIN dışında herkese kapalı kalırdı.

-- AlterTable
ALTER TABLE "Hotel" ADD COLUMN "permissionCatalog" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Matrisi bu migration'dan önce kaydetmiş oteller: o günkü katalog (modül 2'nin
-- ilk sürümündeki 18 izin). Bu izinlerde yöneticinin kararı korunur; sonrakiler
-- (ör. reservations.price_override) varsayılana düşer.
UPDATE "Hotel" h
SET "permissionCatalog" = ARRAY[
  'settings.view', 'settings.manage',
  'rooms.view', 'rooms.manage', 'rooms.operate',
  'reservations.view', 'reservations.manage',
  'messages.view', 'messages.reply', 'requests.view', 'requests.manage',
  'notifications.view', 'notifications.manage',
  'approvals.view', 'approvals.decide',
  'users.view', 'users.manage', 'roles.manage'
]::TEXT[]
WHERE EXISTS (SELECT 1 FROM "RolePermission" rp WHERE rp."hotelId" = h."id");

ALTER TABLE "Hotel" ALTER COLUMN "permissionCatalog" SET NOT NULL;
