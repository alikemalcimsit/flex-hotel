import { TAXPAYER_CHECK_TTL_MS } from '@hotelos/hotel-contracts';
import { ConflictError } from '../../lib/errors.js';
import { providerFor } from './providers/index.js';
import { prisma } from './shared.js';

/**
 * Mükellef sorgusu (modül 49): alıcı GİB'e kayıtlı e-Fatura kullanıcısı mı, posta kutusu etiketleri neler.
 * Sonuç entegratör başına bir gün önbellekte kalır (her kesimde dış sorgu atılmaz). Sorgu yapılamazsa kesim
 * durur: belge türü (e-Fatura / e-Arşiv) bilinmeden fatura numarası verilemez.
 */

/**
 * @param {string} hotelId @param {{ provider: string }} settings @param {string} taxNumber
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ registered: boolean, title: string | null, aliases: string[], cached: boolean }>}
 */
export async function lookupTaxpayer(hotelId, settings, taxNumber, { now = new Date() } = {}) {
  const provider = providerFor(settings.provider);
  if (!provider) throw new ConflictError(`Tanımsız entegratör: ${settings.provider}`, 'EDOC_PROVIDER_UNKNOWN');
  const key = { hotelId_provider_taxNumber: { hotelId, provider: provider.name, taxNumber } };
  const cached = await prisma.taxpayerLookup.findUnique({ where: key });
  if (cached && now.getTime() - cached.checkedAt.getTime() < TAXPAYER_CHECK_TTL_MS) {
    return { registered: cached.registered, title: cached.title, aliases: cached.aliases, cached: true };
  }
  let result;
  try {
    result = await provider.checkTaxpayer({ client: prisma, hotelId, settings }, taxNumber);
  } catch (error) {
    throw new ConflictError(`Mükellef sorgusu yapılamadı (${/** @type {Error} */ (error).message}); biraz sonra yeniden deneyin`, 'TAXPAYER_LOOKUP_FAILED');
  }
  const data = { registered: result.registered, title: result.title, aliases: result.aliases, checkedAt: now };
  await prisma.taxpayerLookup.upsert({ where: key, create: { hotelId, provider: provider.name, taxNumber, ...data }, update: data });
  return { ...result, cached: false };
}

/**
 * Önbellekteki sonucu unut (test mükellefi eklenip silinince; e-Fatura'ya geçtiğini bildiren alıcı için).
 * @param {any} client @param {string} hotelId @param {string} taxNumber
 */
export function forgetTaxpayer(client, hotelId, taxNumber) {
  return client.taxpayerLookup.deleteMany({ where: { hotelId, taxNumber } });
}
