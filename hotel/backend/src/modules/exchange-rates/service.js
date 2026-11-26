import { currentActor, toIsoDay } from '@hotelos/core';
import { EXCHANGE_RATE_KIND_LABELS, tcmbCandidateDays, tcmbRate } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { StaleWriteError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';
import { getHotelSettings } from '../settings/service.js';
import { tcmbProvider } from './providers/tcmb.js';
import { prismaUnfiltered } from '../../db.js';

/**
 * Kur ayarı ve TCMB'den çekme (modül 60). İş günü B'nin kuru = B'den önceki son TCMB bülteni (ayardaki kur türü). Elle girilmiş
 * kur (o gün) ezilmez. Ödeme ve fatura iş gününe kadar girilmiş son kuru kullanır (`payments/service.js`).
 */

/** @type {{ bulletin: (day: string) => Promise<any> }} */
let provider = tcmbProvider;
/** Testler: sahte sağlayıcı. @param {{ bulletin: (day: string) => Promise<any> }} value */
export function setRateProvider(value) {
  provider = value;
}

/** @param {any} client @param {string} hotelId */
export async function loadRateSettings(client, hotelId) {
  const row = await client.exchangeRateSettings.findUnique({ where: { hotelId } });
  return {
    autoFetch: row?.autoFetch ?? false,
    rateKind: row?.rateKind ?? 'FOREX_BUYING',
    currencies: row?.currencies ?? ['USD', 'EUR', 'GBP'],
    lastFetchAt: row?.lastFetchAt?.toISOString() ?? null,
    lastFetchOk: row?.lastFetchOk ?? null,
    lastMessage: row?.lastMessage ?? null,
    isDefault: !row,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

/** @param {string} hotelId */
export async function getRateSettings(hotelId) {
  const [settings, hotel] = await Promise.all([loadRateSettings(prisma, hotelId), getHotelSettings(hotelId)]);
  return { settings, hotelCurrency: hotel.currency, kinds: Object.entries(EXCHANGE_RATE_KIND_LABELS).map(([code, label]) => ({ code, label })) };
}

/** @param {string} hotelId @param {any} input `exchangeRateSettingsSchema` çıktısı */
export async function saveRateSettings(hotelId, input) {
  const [current, hotel] = await Promise.all([loadRateSettings(prisma, hotelId), getHotelSettings(hotelId)]);
  if (input.expectedUpdatedAt && current.updatedAt && new Date(current.updatedAt).getTime() !== new Date(input.expectedUpdatedAt).getTime()) throw new StaleWriteError('Ayar bu arada değişti; yenileyip tekrar deneyin');
  const data = { autoFetch: input.autoFetch, rateKind: input.rateKind, currencies: input.currencies.filter((code) => code !== hotel.currency), updatedBy: currentActor() };
  await writeWithEvents(async (tx) => {
    await tx.exchangeRateSettings.upsert({ where: { hotelId }, create: { hotelId, ...data }, update: data });
    await recordAudit(tx, { hotelId, entity: 'ExchangeRateSettings', entityId: hotelId, action: 'UPDATE', after: data });
  });
  return getRateSettings(hotelId);
}

/**
 * İş gününden önceki son bülten. Bir turda birden çok otel aynı günü ister: `cache` ile tek indirme.
 * @param {string} businessDay @param {Map<string, Promise<any>>} [cache]
 */
async function bulletinBefore(businessDay, cache = new Map()) {
  for (const day of tcmbCandidateDays(businessDay)) {
    if (!cache.has(day)) cache.set(day, provider.bulletin(day));
    const bulletin = await cache.get(day);
    if (bulletin) return bulletin;
  }
  return null;
}

/**
 * Çekme sonucunu yazar — `updatedAt`'e dokunmadan (ayar formunun sürüm denetimi her çekmede bozulmasın).
 * @param {string} hotelId @param {{ ok: boolean, message: string }} outcome
 */
async function recordFetchOutcome(hotelId, outcome) {
  const message = outcome.message.slice(0, 300);
  await prismaUnfiltered.$executeRaw`
    INSERT INTO "ExchangeRateSettings" ("hotelId", "lastFetchAt", "lastFetchOk", "lastMessage", "updatedAt")
    VALUES (${hotelId}, NOW(), ${outcome.ok}, ${message}, NOW())
    ON CONFLICT ("hotelId") DO UPDATE SET "lastFetchAt" = NOW(), "lastFetchOk" = EXCLUDED."lastFetchOk", "lastMessage" = EXCLUDED."lastMessage"`;
}

/**
 * Otelin iş günü kurlarını TCMB'den yazar (ayardaki dövizler; o gün elle girilmiş olan ezilmez). Hata fırlatmaz; sonucu ayara yazar.
 * @param {string} hotelId @param {{ actor?: string }} [options]
 * @returns {Promise<{ ok: boolean, message: string, written: string[], skipped: string[], bulletinDate: string | null, businessDay: string }>}
 */
export async function fetchTcmbRates(hotelId, { actor = 'TCMB', cache } = {}) {
  let outcome;
  let businessDay = null;
  try {
    const [settings, hotel, businessDate] = await Promise.all([loadRateSettings(prisma, hotelId), getHotelSettings(hotelId), getBusinessDate(hotelId)]);
    businessDay = toIsoDay(businessDate);
    const date = new Date(`${businessDay}T00:00:00.000Z`);
    const bulletin = await bulletinBefore(businessDay, cache);
    if (!bulletin) throw new Error(`Son ${tcmbCandidateDays(businessDay).length} iş gününde TCMB bülteni bulunamadı`);
    const written = [];
    const skipped = [];
    await writeWithEvents(async (tx) => {
      for (const currency of settings.currencies.filter((code) => code !== hotel.currency)) {
        const rate = tcmbRate(bulletin, currency, settings.rateKind);
        if (!rate) {
          skipped.push(`${currency} (bültende yok)`);
          continue;
        }
        const bulletinDate = new Date(`${bulletin.date}T00:00:00.000Z`);
        // Koşullu yazım: elle girilmiş satır (bu arada girilmiş olsa da) ezilmez; aynı anda iki çekme çakışmaz.
        const created = await tx.exchangeRate.createManyAndReturn({ data: [{ hotelId, currency, date, rate, enteredBy: actor, source: 'TCMB', bulletinDate }], skipDuplicates: true, select: { id: true } });
        if (created.length) {
          await recordAudit(tx, { hotelId, entity: 'ExchangeRate', entityId: created[0].id, action: 'CREATE', after: { currency, date: businessDay, rate, source: 'TCMB', bulletin: bulletin.date, kind: settings.rateKind } });
          written.push(currency);
          continue;
        }
        const existing = await tx.exchangeRate.findUnique({ where: { hotelId_currency_date: { hotelId, currency, date } }, select: { id: true, source: true, rate: true } });
        if (existing?.source === 'MANUAL') {
          skipped.push(`${currency} (elle girilmiş)`);
          continue;
        }
        if (!existing || Number(existing.rate) === Number(rate)) continue;
        const { count } = await tx.exchangeRate.updateMany({ where: { id: existing.id, source: 'TCMB' }, data: { rate, enteredBy: actor, bulletinDate } });
        if (!count) {
          skipped.push(`${currency} (elle girilmiş)`);
          continue;
        }
        await recordAudit(tx, { hotelId, entity: 'ExchangeRate', entityId: existing.id, action: 'UPDATE', after: { currency, date: businessDay, rate, source: 'TCMB', bulletin: bulletin.date, kind: settings.rateKind } });
        written.push(currency);
      }
    });
    outcome = { ok: true, message: `TCMB ${bulletin.date.split('-').reverse().join('.')} bülteni, ${EXCHANGE_RATE_KIND_LABELS[settings.rateKind].toLowerCase()}: ${written.length ? written.join(', ') : 'değişiklik yok'}${skipped.length ? ` · atlanan: ${skipped.join(', ')}` : ''}`, written, skipped, bulletinDate: bulletin.date, businessDay };
  } catch (error) {
    outcome = { ok: false, message: `TCMB'den alınamadı: ${/** @type {Error} */ (error).message}`, written: [], skipped: [], bulletinDate: null, businessDay };
    // Bülten indirme hatası bütün oteller için aynı: tur önbelleğinde kalmasın, sonraki otel yeniden denesin.
    cache?.clear();
  }
  await recordFetchOutcome(hotelId, outcome);
  return outcome;
}

/** Otomatik çekme açık oteller (iş). Bir otelin hatası diğerlerini durdurmaz; bülten tur içinde bir kez indirilir. */
export async function fetchAllTcmbRates(logger = null) {
  const rows = await prisma.exchangeRateSettings.findMany({ where: { autoFetch: true }, select: { hotelId: true } });
  const cache = new Map();
  let ok = 0;
  for (const { hotelId } of rows) {
    try {
      if ((await fetchTcmbRates(hotelId, { cache })).ok) ok += 1;
    } catch (error) {
      logger?.error?.({ err: error, hotelId }, 'TCMB kurları yazılamadı');
    }
  }
  return ok;
}
