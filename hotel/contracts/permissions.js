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

  /** Aktivite akışı, olaylar ve işlem zincirleri (modül 10). */
  ACTIVITY_VIEW: 'activity.view',
  /** Denetim kaydı: kim hangi kaydı ne zaman nasıl değiştirdi (eski/yeni değerle). */
  AUDIT_VIEW: 'audit.view',

  /** Günlük durum ekranı (modül 13): doluluk, gelecek / gidecek, oda geliri, ADR. */
  DASHBOARD_VIEW: 'dashboard.view',
  /** Tahminin kritik gün eşikleri (modül 25; tahminin kendisi günlük durumla görülür). */
  FORECAST_MANAGE: 'forecast.manage',

  /** Folyoları ve kalemlerini görmek (modül 15). Kat hizmetleri görmez. */
  FOLIO_VIEW: 'folio.view',
  /** Harcama işlemek, kalem aktarmak, folyo bölmek / birleştirmek / kapatmak, iptal istemek (iptal onaya gider). */
  FOLIO_POST: 'folio.post',
  /** İndirim uygulamak, kapanmış folyoyu yeniden açmak. Yönetim / muhasebe işi. */
  FOLIO_ADJUST: 'folio.adjust',

  /** Ödeme almak: tahsilat, ön ödeme / depozito (modül 17). Eşik üstü ödeme onaya gider. */
  PAYMENT_RECEIVE: 'payment.receive',
  /** İade ve ödeme iptali (hatalı giriş) istemek. Her ikisi de ikinci bir yetkilinin onayına gider. */
  PAYMENT_REFUND: 'payment.refund',
  /** Kasa görünümü: günün yöntem bazında tahsilat / iade toplamları ve hareketleri. */
  CASH_VIEW: 'cash.view',
  /** Günlük döviz kurunu girmek. Döviz ödemeleri bu kurla çevrilir. */
  EXCHANGE_RATES_MANAGE: 'exchange_rates.manage',

  /** Minibar tüketimlerini, çamaşır siparişlerini ve günlük raporu görmek (modül 19). */
  EXTRAS_VIEW: 'extras.view',
  /** Odada minibar tüketimi girmek (kat görevlisi). Folyoya otomatik yansır. */
  MINIBAR_POST: 'minibar.post',
  /** Çamaşır siparişi almak, parça sayımını düzeltmek, durumunu ilerletmek / teslim etmek. */
  LAUNDRY_POST: 'laundry.post',
  /** Minibar ve çamaşırhane fiyat listeleri, ekspres farkı. */
  EXTRAS_MANAGE: 'extras.manage',

  /** Kayıp eşya listesini ve kayıtlarını görmek (modül 21). Misafirin iletişim bilgisi teslim yetkisiyle görünür. */
  LOST_ITEMS_VIEW: 'lost_items.view',
  /** Bulunan eşyayı fotoğrafıyla kaydetmek, bilgilerini düzeltmek. */
  LOST_ITEMS_RECORD: 'lost_items.record',
  /** Eşyayı misafirle eşleştirmek, misafirle iletişim notu yazmak, teslim etmek / kargolamak. */
  LOST_ITEMS_RELEASE: 'lost_items.release',
  /** Sahibi çıkmayan eşyayı kapatmak (bağış, imha, polis) ve saklama sürelerini ayarlamak. */
  LOST_ITEMS_MANAGE: 'lost_items.manage',

  /** Gelir raporları (modül 23): doluluk, ADR, RevPAR, oda geliri, kırılımlar, geçen yıl. */
  REPORTS_VIEW: 'reports.view',

  /** Aktör paneli (modül 12): aktörlerin durumu, bildirgesi, LLM harcaması. */
  ACTORS_VIEW: 'actors.view',
  /** Aktörü bu otelde açmak / kapatmak (kapalı aktörün işi personele düşer). */
  ACTORS_MANAGE: 'actors.manage',
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
  [PERMISSIONS.ACTIVITY_VIEW]: 'Aktivite akışını ve zincirleri görüntüle',
  [PERMISSIONS.AUDIT_VIEW]: 'Denetim kaydını görüntüle',
  [PERMISSIONS.DASHBOARD_VIEW]: 'Günlük durumu görüntüle (doluluk, gelir)',
  [PERMISSIONS.FORECAST_MANAGE]: 'Tahminin kritik gün eşiklerini ayarla',
  [PERMISSIONS.FOLIO_VIEW]: 'Folyoları görüntüle',
  [PERMISSIONS.FOLIO_POST]: 'Folyoya harcama işle, aktar, böl, birleştir',
  [PERMISSIONS.FOLIO_ADJUST]: 'İndirim uygula, kapanmış folyoyu yeniden aç',
  [PERMISSIONS.PAYMENT_RECEIVE]: 'Ödeme al (tahsilat, ön ödeme)',
  [PERMISSIONS.PAYMENT_REFUND]: 'İade / ödeme iptali iste (onaya gider)',
  [PERMISSIONS.CASH_VIEW]: 'Kasayı görüntüle',
  [PERMISSIONS.EXCHANGE_RATES_MANAGE]: 'Günlük döviz kurunu gir',
  [PERMISSIONS.EXTRAS_VIEW]: 'Minibar / çamaşır kayıtlarını ve günlük raporu görüntüle',
  [PERMISSIONS.MINIBAR_POST]: 'Minibar tüketimi gir',
  [PERMISSIONS.LAUNDRY_POST]: 'Çamaşır siparişi al, durumunu güncelle',
  [PERMISSIONS.EXTRAS_MANAGE]: 'Minibar / çamaşır fiyat listelerini yönet',
  [PERMISSIONS.LOST_ITEMS_VIEW]: 'Kayıp eşyaları görüntüle',
  [PERMISSIONS.LOST_ITEMS_RECORD]: 'Bulunan eşya kaydet',
  [PERMISSIONS.LOST_ITEMS_RELEASE]: 'Kayıp eşyayı misafirle eşleştir, teslim et',
  [PERMISSIONS.LOST_ITEMS_MANAGE]: 'Sahibi çıkmayan eşyayı kapat, saklama süresini ayarla',
  [PERMISSIONS.REPORTS_VIEW]: 'Gelir raporlarını görüntüle (doluluk, ADR, RevPAR)',
  [PERMISSIONS.ACTORS_VIEW]: 'Aktör panelini görüntüle',
  [PERMISSIONS.ACTORS_MANAGE]: 'Aktörleri aç / kapat',
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
  { key: 'dashboard', label: 'Günlük durum', permissions: [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.FORECAST_MANAGE] },
  {
    key: 'folios',
    label: 'Folyo',
    permissions: [PERMISSIONS.FOLIO_VIEW, PERMISSIONS.FOLIO_POST, PERMISSIONS.FOLIO_ADJUST],
  },
  {
    key: 'payments',
    label: 'Ödeme ve kasa',
    permissions: [PERMISSIONS.PAYMENT_RECEIVE, PERMISSIONS.PAYMENT_REFUND, PERMISSIONS.CASH_VIEW, PERMISSIONS.EXCHANGE_RATES_MANAGE],
  },
  {
    key: 'extras',
    label: 'Minibar ve çamaşır',
    permissions: [PERMISSIONS.EXTRAS_VIEW, PERMISSIONS.MINIBAR_POST, PERMISSIONS.LAUNDRY_POST, PERMISSIONS.EXTRAS_MANAGE],
  },
  {
    key: 'lost_items',
    label: 'Kayıp eşya',
    permissions: [PERMISSIONS.LOST_ITEMS_VIEW, PERMISSIONS.LOST_ITEMS_RECORD, PERMISSIONS.LOST_ITEMS_RELEASE, PERMISSIONS.LOST_ITEMS_MANAGE],
  },
  { key: 'reports', label: 'Raporlar', permissions: [PERMISSIONS.REPORTS_VIEW] },
  { key: 'monitoring', label: 'İzleme', permissions: [PERMISSIONS.ACTIVITY_VIEW, PERMISSIONS.AUDIT_VIEW] },
  { key: 'actors', label: 'Aktörler', permissions: [PERMISSIONS.ACTORS_VIEW, PERMISSIONS.ACTORS_MANAGE] },
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
    PERMISSIONS.ACTIVITY_VIEW,
    PERMISSIONS.AUDIT_VIEW,
    // Müdür aktörleri görür; açıp kapatmak (otomasyonu durdurmak) yöneticinin kararı.
    PERMISSIONS.ACTORS_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.FOLIO_VIEW,
    PERMISSIONS.FOLIO_POST,
    PERMISSIONS.FOLIO_ADJUST,
    PERMISSIONS.PAYMENT_RECEIVE,
    PERMISSIONS.PAYMENT_REFUND,
    PERMISSIONS.CASH_VIEW,
    PERMISSIONS.EXCHANGE_RATES_MANAGE,
    PERMISSIONS.EXTRAS_VIEW,
    PERMISSIONS.MINIBAR_POST,
    PERMISSIONS.LAUNDRY_POST,
    PERMISSIONS.EXTRAS_MANAGE,
    PERMISSIONS.LOST_ITEMS_VIEW,
    PERMISSIONS.LOST_ITEMS_RECORD,
    PERMISSIONS.LOST_ITEMS_RELEASE,
    PERMISSIONS.LOST_ITEMS_MANAGE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.FORECAST_MANAGE,
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
    // Resepsiyon hesabı görür, harcama işler; indirim ve yeniden açma yönetimde.
    PERMISSIONS.FOLIO_VIEW,
    PERMISSIONS.FOLIO_POST,
    // Tahsilat ve kendi kasası resepsiyonun işi; iade / iptal isteyebilir (onaylayamaz).
    PERMISSIONS.PAYMENT_RECEIVE,
    PERMISSIONS.PAYMENT_REFUND,
    PERMISSIONS.CASH_VIEW,
    // Resepsiyon misafirin çamaşırını alır, çıkışta minibarı sorar.
    PERMISSIONS.EXTRAS_VIEW,
    PERMISSIONS.MINIBAR_POST,
    PERMISSIONS.LAUNDRY_POST,
    // Misafir eşyasını resepsiyona sorar: eşleştirme, iletişim ve teslim resepsiyonda.
    PERMISSIONS.LOST_ITEMS_VIEW,
    PERMISSIONS.LOST_ITEMS_RECORD,
    PERMISSIONS.LOST_ITEMS_RELEASE,
  ]),
  HOUSEKEEPING: Object.freeze([
    PERMISSIONS.ROOMS_VIEW,
    PERMISSIONS.ROOMS_OPERATE,
    // Gidecekler listesi: hangi oda bugün boşalacak (temizlik sırası).
    PERMISSIONS.STAYS_VIEW,
    PERMISSIONS.REQUESTS_VIEW,
    PERMISSIONS.REQUESTS_MANAGE,
    // Minibar sayımı ve çamaşırhane kat hizmetlerinin işi; fiyat listesi yönetimde.
    PERMISSIONS.EXTRAS_VIEW,
    PERMISSIONS.MINIBAR_POST,
    PERMISSIONS.LAUNDRY_POST,
    // Eşyayı en çok oda temizliğinde kat görevlisi bulur; sahibine teslim resepsiyonun işi.
    PERMISSIONS.LOST_ITEMS_VIEW,
    PERMISSIONS.LOST_ITEMS_RECORD,
  ]),
  ACCOUNTING: Object.freeze([
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.ROOMS_VIEW,
    PERMISSIONS.STAYS_VIEW,
    PERMISSIONS.NOTIFICATIONS_VIEW,
    PERMISSIONS.APPROVALS_VIEW,
    // Gelir ve ADR muhasebenin günlük işi.
    PERMISSIONS.DASHBOARD_VIEW,
    // Hesap düzeltmesi, açık bakiye takibi muhasebenin işi.
    PERMISSIONS.FOLIO_VIEW,
    PERMISSIONS.FOLIO_POST,
    PERMISSIONS.FOLIO_ADJUST,
    // Tahsilat, kasa mutabakatı ve günlük kur muhasebenin işi.
    PERMISSIONS.PAYMENT_RECEIVE,
    PERMISSIONS.PAYMENT_REFUND,
    PERMISSIONS.CASH_VIEW,
    PERMISSIONS.EXCHANGE_RATES_MANAGE,
    // Ek hizmet geliri ve fiyat listesi muhasebenin de işi.
    PERMISSIONS.EXTRAS_VIEW,
    PERMISSIONS.EXTRAS_MANAGE,
    // Gelir raporları muhasebenin aylık işi.
    PERMISSIONS.REPORTS_VIEW,
  ]),
  FNB: Object.freeze([
    PERMISSIONS.ROOMS_VIEW,
    PERMISSIONS.REQUESTS_VIEW,
    PERMISSIONS.REQUESTS_MANAGE,
    // Restoranda / havuz barında unutulan eşyayı kaydeder.
    PERMISSIONS.LOST_ITEMS_VIEW,
    PERMISSIONS.LOST_ITEMS_RECORD,
  ]),
});

/**
 * Bir rolün varsayılan izinleri (salt okuma yardımcı). Bilinmeyen rol → boş.
 * @param {string | null | undefined} role
 * @returns {readonly string[]}
 */
export function defaultPermissionsForRole(role) {
  return DEFAULT_ROLE_PERMISSIONS[role] ?? [];
}
