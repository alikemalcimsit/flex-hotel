import { prisma } from '../../db.js';

/**
 * Senkrondaki (ACTIVE) Channex kanalı olan oteller — süreç içi liste. iCal kanalına
 * gönderim yoktur (kanal takvimimizi kendisi okur), envanter olayı onu ilgilendirmez.
 *
 * Kanal aktörü her envanter olayını dinler; kanal kullanmayan otelin olayı
 * aktöre hiç girmemeli (işlenmiş olay kaydı, aktivite satırı yazılmasın). Aktör
 * bu kararı olay anında, senkron verir (`accepts`): liste bellekte tutulur,
 * açılışta yüklenir ve kanal senkrona alınınca / durdurulunca / silinince
 * tazelenir. Liste henüz yüklenmemişse (açılışın ilk anları) olay kabul edilir:
 * işleyici veritabanına bakar, kanal yoksa bir şey yapmaz.
 *
 * Süreç içidir (olay yolu gibi); çok örnekli kuruluma geçilince paylaşılan yere taşınır.
 */

/** @type {Set<string> | null} */
let targets = null;

/** Açılışta ve testte: bütün otellerin senkrondaki kanalları. */
export async function loadSyncTargets() {
  const rows = await prisma.channel.findMany({ where: { status: 'ACTIVE', type: 'CHANNEX' }, select: { hotelId: true }, distinct: ['hotelId'] });
  targets = new Set(rows.map((row) => row.hotelId));
  return targets.size;
}

/**
 * Otelin kanal durumu değişti: o otelin satırı yeniden okunur.
 * @param {string} hotelId
 */
export async function refreshSyncTarget(hotelId) {
  const active = await prisma.channel.count({ where: { hotelId, status: 'ACTIVE', type: 'CHANNEX' } });
  if (!targets) return;
  if (active > 0) targets.add(hotelId);
  else targets.delete(hotelId);
}

/**
 * Bu otelin envanter olayı kanal aktörünü ilgilendiriyor mu? (senkron)
 * @param {string} hotelId
 */
export function isSyncTarget(hotelId) {
  return targets === null || targets.has(hotelId);
}
