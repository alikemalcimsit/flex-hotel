/** Kendi marka işareti çizilmiş platformlar (BrandIcon.jsx ve Icon.jsx). */
const KNOWN_BRANDS = new Set(['github', 'linkedin', 'instagram'])

/**
 * Bağlantı etiketinden ikon adı çıkarır.
 *
 * Kişi verisinde her bağlantı için ayrıca ikon adı tutulmuyordu; GitHub,
 * LinkedIn ve Kaggle aynı genel zincir ikonunu paylaşıyordu. Etiket zaten
 * platformun adı olduğu için ikon ondan türetiliyor. Açıkça verilen ikon
 * her zaman önceliklidir; tanınmayan platform genel bağlantı ikonuna düşer.
 *
 * @param {{label?: string, icon?: string}} link
 * @returns {string}
 */
export function iconForLink(link) {
  if (link?.icon) return link.icon
  const key = (link?.label ?? '').trim().toLowerCase()
  return KNOWN_BRANDS.has(key) ? key : 'link'
}
