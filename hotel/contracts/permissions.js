/**
 * RBAC izin kataloğu — tek kaynak.
 *
 * İzin adları hem sunucuda (`requirePermission`, rol→izin çözümü) hem tarayıcıda
 * (`useCan`, menü gizleme) kullanılır. Eskiden backend ve frontend `lib/permissions.js`
 * içinde iki kez tanımlıydı; kayması kaçınılmazdı. Artık ikisi de buradan okur.
 *
 * Yeni bir modül izin eklerken: `PERMISSIONS`'a değeri, `PERMISSION_LABELS`'a
 * Türkçe karşılığını, `PERMISSION_GROUPS`'a hangi başlık altında görüneceğini,
 * `DEFAULT_ROLE_PERMISSIONS`'a hangi rollerin varsayılan aldığını ekleyin.
 */

/** İzin değerleri. Değer stringleri veritabanına (RolePermission.permission) yazılır — değiştirmeyin. */
export const PERMISSIONS = Object.freeze({
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',

  ROOMS_VIEW: 'rooms.view',
  ROOMS_MANAGE: 'rooms.manage',
  ROOMS_OPERATE: 'rooms.operate',

  /** Rezervasyon listesi/detayı — görüntüleme. */
  RESERVATIONS_VIEW: 'reservations.view',
  /** Rezervasyon açma/düzenleme/iptal/no-show, grup ve bekleme listesi. */
  RESERVATIONS_MANAGE: 'reservations.manage',
  /** Sistem fiyatı yerine toplamı elle girmek (gerekçeyle). Yönetim işi. */
  RESERVATIONS_PRICE_OVERRIDE: 'reservations.price_override',

  /** Ön büro listeleri (gelecekler, gidecekler, konaklayanlar) — görüntüleme. */
  STAYS_VIEW: 'stays.view',
  /** Check-in / check-out ve aynı gün geri alma. */
  STAYS_MANAGE: 'stays.manage',
  /** Folyo bakiyesi kapanmadan çıkışa izin vermek (gerekçeyle). Yönetim işi. */
  STAYS_OPEN_BALANCE: 'stays.checkout_open_balance',

  MESSAGES_VIEW: 'messages.view',
  MESSAGES_REPLY: 'messages.reply',
  REQUESTS_VIEW: 'requests.view',
  REQUESTS_MANAGE: 'requests.manage',

  NOTIFICATIONS_VIEW: 'notifications.view',
  NOTIFICATIONS_MANAGE: 'notifications.manage',

  APPROVALS_VIEW: 'approvals.view',
  APPROVALS_DECIDE: 'approvals.decide',

  /** Kullanıcı listesini görmek. */
  USERS_VIEW: 'users.view',
  /** Kullanıcı ekleme/düzenleme/pasife alma/şifre sıfırlama. */
  USERS_MANAGE: 'users.manage',
  /** Rol → izin matrisini düzenlemek. */
  ROLES_MANAGE: 'roles.manage',
});

/** Tüm izinlerin düz listesi (doğrulama ve "ADMIN her şeyi görür" için). */
export const PERMISSION_VALUES = Object.freeze(Object.values(PERMISSIONS));

/** İzinlerin kullanıcıya gösterilen Türkçe adları (matris ekranı başlıkları). */
export const PERMISSION_LABELS = Object.freeze({
  [PERMISSIONS.SETTINGS_VIEW]: 'Ayarları görüntüle',
  [PERMISSIONS.SETTINGS_MANAGE]: 'Ayarları yönet',
  [PERMISSIONS.ROOMS_VIEW]: 'Odaları görüntüle',
  [PERMISSIONS.ROOMS_MANAGE]: 'Oda envanterini yönet',
  [PERMISSIONS.ROOMS_OPERATE]: 'Oda işlemleri (atama, durum)',
  [PERMISSIONS.RESERVATIONS_VIEW]: 'Rezervasyonları görüntüle',
  [PERMISSIONS.RESERVATIONS_MANAGE]: 'Rezervasyonları yönet',
  [PERMISSIONS.RESERVATIONS_PRICE_OVERRIDE]: 'Fiyatı elle belirle',
  [PERMISSIONS.STAYS_VIEW]: 'Giriş / çıkış listelerini görüntüle',
  [PERMISSIONS.STAYS_MANAGE]: 'Giriş / çıkış yap',
  [PERMISSIONS.STAYS_OPEN_BALANCE]: 'Bakiyesi kapanmadan çıkışa izin ver',
  [PERMISSIONS.MESSAGES_VIEW]: 'Mesajları görüntüle',
  [PERMISSIONS.MESSAGES_REPLY]: 'Mesaj yaz / yönet',
  [PERMISSIONS.REQUESTS_VIEW]: 'İstekleri görüntüle',
  [PERMISSIONS.REQUESTS_MANAGE]: 'İstekleri yönet',
  [PERMISSIONS.NOTIFICATIONS_VIEW]: 'Bildirimleri görüntüle',
  [PERMISSIONS.NOTIFICATIONS_MANAGE]: 'Bildirim ayarlarını yönet',
  [PERMISSIONS.APPROVALS_VIEW]: 'Onay kuyruğunu görüntüle',
  [PERMISSIONS.APPROVALS_DECIDE]: 'Onayla / reddet',
  [PERMISSIONS.USERS_VIEW]: 'Kullanıcıları görüntüle',
  [PERMISSIONS.USERS_MANAGE]: 'Kullanıcıları yönet',
  [PERMISSIONS.ROLES_MANAGE]: 'Rolleri ve izinleri yönet',
});

/**
 * Matris ekranında izinlerin gruplandığı başlıklar. Satır=rol, sütun=izin
 * matrisi bu gruplara bölünerek okunur olur.
 */
export const PERMISSION_GROUPS = Object.freeze([
  { key: 'settings', label: 'Ayarlar', permissions: [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_MANAGE] },
  {
    key: 'rooms',
    label: 'Odalar',
    permissions: [PERMISSIONS.ROOMS_VIEW, PERMISSIONS.ROOMS_MANAGE, PERMISSIONS.ROOMS_OPERATE],
  },
  {
    key: 'reservations',
    label: 'Rezervasyonlar',
    permissions: [PERMISSIONS.RESERVATIONS_VIEW, PERMISSIONS.RESERVATIONS_MANAGE, PERMISSIONS.RESERVATIONS_PRICE_OVERRIDE],
  },
  {
    key: 'stays',
    label: 'Giriş / çıkış',
    permissions: [PERMISSIONS.STAYS_VIEW, PERMISSIONS.STAYS_MANAGE, PERMISSIONS.STAYS_OPEN_BALANCE],
  },
  {
    key: 'guest',
    label: 'Misafir iletişimi',
    permissions: [
      PERMISSIONS.MESSAGES_VIEW,
      PERMISSIONS.MESSAGES_REPLY,
      PERMISSIONS.REQUESTS_VIEW,
      PERMISSIONS.REQUESTS_MANAGE,
    ],
  },
  {
    key: 'notifications',
    label: 'Bildirimler',
    permissions: [PERMISSIONS.NOTIFICATIONS_VIEW, PERMISSIONS.NOTIFICATIONS_MANAGE],
  },
  { key: 'approvals', label: 'Onaylar', permissions: [PERMISSIONS.APPROVALS_VIEW, PERMISSIONS.APPROVALS_DECIDE] },
  {
    key: 'admin',
    label: 'Yönetim',
    permissions: [PERMISSIONS.USERS_VIEW, PERMISSIONS.USERS_MANAGE, PERMISSIONS.ROLES_MANAGE],
  },
]);

/** Roller (Prisma `UserRole` enum'uyla birebir). */
export const ROLES = Object.freeze(['ADMIN', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPING', 'ACCOUNTING', 'FNB']);

/** Rollerin kullanıcıya gösterilen Türkçe adları. */
export const ROLE_LABELS = Object.freeze({
  ADMIN: 'Yönetici',
  MANAGER: 'Müdür',
  FRONT_DESK: 'Ön büro',
  HOUSEKEEPING: 'Kat hizmetleri',
  ACCOUNTING: 'Muhasebe',
  FNB: 'Yiyecek & İçecek',
});

/**
 * Varsayılan rol → izin eşlemesi. Bir otelin `RolePermission` tablosunda hiç
 * satırı yoksa çözüm buna düşer; matris kaydedilince DB kaynak olur.
 *
 * ADMIN listelenmez: kod her zaman ADMIN'e tüm izinleri verir (matris ekranından
 * kilitlenme koruması). Bu tablo diğer roller için başlangıç noktasıdır.
 */
export const DEFAULT_ROLE_PERMISSIONS = Object.freeze({
  ADMIN: PERMISSION_VALUES,
  MANAGER: Object.freeze([
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.ROOMS_VIEW,
    PERMISSIONS.ROOMS_MANAGE,
    PERMISSIONS.ROOMS_OPERATE,
    PERMISSIONS.RESERVATIONS_VIEW,
    PERMISSIONS.RESERVATIONS_MANAGE,
    PERMISSIONS.RESERVATIONS_PRICE_OVERRIDE,
    PERMISSIONS.STAYS_VIEW,
    PERMISSIONS.STAYS_MANAGE,
    PERMISSIONS.STAYS_OPEN_BALANCE,
    PERMISSIONS.MESSAGES_VIEW,
    PERMISSIONS.MESSAGES_REPLY,
    PERMISSIONS.REQUESTS_VIEW,
    PERMISSIONS.REQUESTS_MANAGE,
    PERMISSIONS.NOTIFICATIONS_VIEW,
    PERMISSIONS.NOTIFICATIONS_MANAGE,
    PERMISSIONS.APPROVALS_VIEW,
    PERMISSIONS.APPROVALS_DECIDE,
    PERMISSIONS.USERS_VIEW,
  ]),
  FRONT_DESK: Object.freeze([
    PERMISSIONS.ROOMS_VIEW,
    PERMISSIONS.ROOMS_OPERATE,
    PERMISSIONS.RESERVATIONS_VIEW,
    PERMISSIONS.RESERVATIONS_MANAGE,
    PERMISSIONS.STAYS_VIEW,
    PERMISSIONS.STAYS_MANAGE,
    PERMISSIONS.MESSAGES_VIEW,
    PERMISSIONS.MESSAGES_REPLY,
    PERMISSIONS.REQUESTS_VIEW,
    PERMISSIONS.REQUESTS_MANAGE,
    PERMISSIONS.NOTIFICATIONS_VIEW,
  ]),
  HOUSEKEEPING: Object.freeze([
    PERMISSIONS.ROOMS_VIEW,
    PERMISSIONS.ROOMS_OPERATE,
    // Gidecekler listesi: hangi oda bugün boşalacak (temizlik sırası).
    PERMISSIONS.STAYS_VIEW,
    PERMISSIONS.REQUESTS_VIEW,
    PERMISSIONS.REQUESTS_MANAGE,
  ]),
  ACCOUNTING: Object.freeze([
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.ROOMS_VIEW,
    PERMISSIONS.STAYS_VIEW,
    PERMISSIONS.NOTIFICATIONS_VIEW,
    PERMISSIONS.APPROVALS_VIEW,
  ]),
  FNB: Object.freeze([PERMISSIONS.ROOMS_VIEW, PERMISSIONS.REQUESTS_VIEW, PERMISSIONS.REQUESTS_MANAGE]),
});

/**
 * Bir rolün varsayılan izinleri (salt okuma yardımcı). Bilinmeyen rol → boş.
 * @param {string | null | undefined} role
 * @returns {readonly string[]}
 */
export function defaultPermissionsForRole(role) {
  return DEFAULT_ROLE_PERMISSIONS[role] ?? [];
}
