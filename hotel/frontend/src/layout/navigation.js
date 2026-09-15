/**
 * Menü yapısı — tek kaynak.
 *
 * Yan menü, üst bardaki konum satırı ve bölüm sayfalarındaki sekmeler
 * (Odalar, Ayarlar) aynı listeden beslenir; bir alt sayfa eklenince üç yer
 * ayrı ayrı güncellenmez.
 *
 * `roles` dolu olan girdiler yalnızca o rollere gösterilir.
 * Not: bu görsel bir kısıt; gerçek yetki kontrolü modül 2 (RBAC) ile sunucuya gelecek.
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
        ],
      },
    ],
  },
]);

/**
 * Sahte oturumdaki rol kodlarının ekrandaki adı. Modül 2 gerçek rolleri
 * getirdiğinde bu liste oradan beslenecek.
 */
export const ROLE_LABELS = Object.freeze({
  ADMIN: 'Yönetici',
  FRONT_DESK: 'Resepsiyon',
});

/**
 * Role göre görünür bölümler; içi boşalan bölüm hiç çizilmez.
 * @param {string | undefined} role
 */
export function visibleSections(role) {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.roles || item.roles.includes(role)),
  })).filter((section) => section.items.length > 0);
}

/** Bir bölümün alt sayfaları (sekmeler için). @param {string} to */
export function childrenOf(to) {
  for (const section of NAV_SECTIONS) {
    const item = section.items.find((entry) => entry.to === to);
    if (item) return item.children ?? [];
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
