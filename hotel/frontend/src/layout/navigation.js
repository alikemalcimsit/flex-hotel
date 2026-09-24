import { PERMISSIONS, ROLE_LABELS } from '@hotelos/hotel-contracts';

/**
 * Menü yapısı — tek kaynak.
 *
 * Yan menü, üst bardaki konum satırı ve bölüm sayfalarındaki sekmeler
 * (Odalar, Ayarlar) aynı listeden beslenir; bir alt sayfa eklenince üç yer
 * ayrı ayrı güncellenmez.
 *
 * `roles` dolu olan girdiler yalnızca o rollere, `permission` taşıyanlar
 * yalnızca o izne sahip kullanıcılara gösterilir (alt sayfalar da kendi izniyle
 * süzülür). İzinler giriş yapan kullanıcının oturumundan gelir (modül 2).
 * `badge` yan menüde sayı rozeti gösterilecek maddeyi işaretler.
 * Not: bu görsel bir kısıt; gerçek yetki kontrolü sunucuda.
 */
export const NAV_SECTIONS = Object.freeze([
  {
    title: 'Genel',
    items: [{ label: 'Panel', to: '/', icon: 'dashboard', end: true }],
  },
  {
    title: 'Ön büro',
    // Odalar ön büro işi: resepsiyon ve kat hizmetleri de görmeli, yalnızca admin değil.
    items: [
      {
        label: 'Giriş / çıkış',
        to: '/on-buro',
        icon: 'key',
        permission: PERMISSIONS.STAYS_VIEW,
        children: [
          { label: 'Gelecekler', to: '/on-buro/gelecekler', icon: 'arrowRight' },
          { label: 'Gidecekler', to: '/on-buro/gidecekler', icon: 'logout' },
          { label: 'Konaklayanlar', to: '/on-buro/konaklayanlar', icon: 'bed' },
        ],
      },
      {
        label: 'Rezervasyonlar',
        to: '/rezervasyonlar',
        icon: 'bookOpen',
        permission: PERMISSIONS.RESERVATIONS_VIEW,
        children: [
          { label: 'Liste', to: '/rezervasyonlar/liste', icon: 'list' },
          {
            label: 'Yeni rezervasyon',
            to: '/rezervasyonlar/yeni',
            icon: 'plus',
            permission: PERMISSIONS.RESERVATIONS_MANAGE,
          },
          { label: 'Bekleme listesi', to: '/rezervasyonlar/bekleme-listesi', icon: 'clock' },
        ],
      },
      { label: 'Oda planı', to: '/oda-plani', icon: 'calendar' },
      {
        label: 'Mesajlar',
        to: '/mesajlar',
        icon: 'message',
        badge: 'messages',
        permission: PERMISSIONS.MESSAGES_VIEW,
      },
      {
        label: 'İstekler',
        to: '/istekler',
        icon: 'clipboard',
        badge: 'requests',
        permission: PERMISSIONS.REQUESTS_VIEW,
      },
      {
        label: 'Odalar',
        to: '/odalar',
        icon: 'bed',
        children: [
          { label: 'Oda listesi', to: '/odalar/liste', icon: 'list' },
          { label: 'Müsaitlik', to: '/odalar/musaitlik', icon: 'calendar' },
          { label: 'Oda atama', to: '/odalar/atama', icon: 'key' },
        ],
      },
    ],
  },
  {
    title: 'Yönetim',
    items: [
      {
        label: 'Onaylar',
        to: '/onaylar',
        icon: 'checkCheck',
        badge: 'approvals',
        permission: PERMISSIONS.APPROVALS_VIEW,
        children: [
          { label: 'Bekleyen', to: '/onaylar/bekleyen', icon: 'clock' },
          { label: 'Geçmiş', to: '/onaylar/gecmis', icon: 'list' },
        ],
      },
      {
        label: 'Bildirimler',
        to: '/bildirimler',
        icon: 'bell',
        permission: PERMISSIONS.NOTIFICATIONS_VIEW,
        children: [
          { label: 'Gönderim geçmişi', to: '/bildirimler/gecmis', icon: 'clock' },
          {
            label: 'Şablonlar',
            to: '/bildirimler/sablonlar',
            icon: 'fileText',
            permission: PERMISSIONS.NOTIFICATIONS_MANAGE,
          },
          {
            label: 'Kanallar',
            to: '/bildirimler/kanallar',
            icon: 'send',
            permission: PERMISSIONS.NOTIFICATIONS_MANAGE,
          },
        ],
      },
      {
        label: 'Ayarlar',
        to: '/ayarlar',
        icon: 'settings',
        roles: ['ADMIN'],
        children: [
          { label: 'Otel bilgileri', to: '/ayarlar/otel', icon: 'building' },
          { label: 'Oda tipleri', to: '/ayarlar/oda-tipleri', icon: 'layers' },
          { label: 'Vergiler', to: '/ayarlar/vergiler', icon: 'percent' },
          { label: 'Sezonlar', to: '/ayarlar/sezonlar', icon: 'sun' },
          { label: 'Genel parametreler', to: '/ayarlar/genel', icon: 'sliders' },
          { label: 'Kullanıcılar', to: '/ayarlar/kullanicilar', icon: 'user', permission: PERMISSIONS.USERS_VIEW },
          { label: 'Roller & İzinler', to: '/ayarlar/roller', icon: 'lock', permission: PERMISSIONS.ROLES_MANAGE },
          { label: 'AI asistanı', to: '/ayarlar/ai', icon: 'bot', permission: PERMISSIONS.SETTINGS_VIEW },
          { label: 'Mesaj kanalları', to: '/ayarlar/mesaj-kanallari', icon: 'message', permission: PERMISSIONS.SETTINGS_VIEW },
        ],
      },
    ],
  },
]);

export { ROLE_LABELS };

/**
 * Bir menü girdisi bu rol + izinlerle görünür mü?
 * @param {string | undefined} role
 * @param {readonly string[]} granted Giriş yapan kullanıcının etkin izinleri
 */
function allowedFor(role, granted) {
  const set = granted ?? [];
  return (entry) =>
    (!entry.roles || entry.roles.includes(role)) && (!entry.permission || set.includes(entry.permission));
}

/**
 * Rol + izinlere göre görünür bölümler; içi boşalan bölüm hiç çizilmez.
 * @param {string | undefined} role
 * @param {readonly string[]} [granted]
 */
export function visibleSections(role, granted) {
  const allowed = allowedFor(role, granted);
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items
      .filter(allowed)
      .map((item) => (item.children ? { ...item, children: item.children.filter(allowed) } : item)),
  })).filter((section) => section.items.length > 0);
}

/**
 * Bir bölümün alt sayfaları (sekmeler için). Rol verilirse yalnızca o rol +
 * izinlerin görebildikleri; rol verilmezse hepsi.
 * @param {string} to
 * @param {string} [role]
 * @param {readonly string[]} [granted]
 */
export function childrenOf(to, role, granted) {
  for (const section of NAV_SECTIONS) {
    const item = section.items.find((entry) => entry.to === to);
    if (!item) continue;
    const children = item.children ?? [];
    return role === undefined ? children : children.filter(allowedFor(role, granted));
  }
  return [];
}

/** @param {string} pathname @param {string} to */
function isUnder(pathname, to) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * Adrese karşılık gelen bölüm, menü maddesi ve varsa alt sayfa — konum satırı
 * için. Kök (`/`) yalnızca tam eşleşir, yoksa her adresin sahibi olurdu.
 *
 * @param {string} pathname
 * @returns {{ section: string, item: object, child: object | null } | null}
 */
export function findLocation(pathname) {
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      const matches = item.end ? pathname === item.to : isUnder(pathname, item.to);
      if (!matches) continue;
      const child = (item.children ?? []).find((entry) => isUnder(pathname, entry.to)) ?? null;
      return { section: section.title, item, child };
    }
  }
  return null;
}
