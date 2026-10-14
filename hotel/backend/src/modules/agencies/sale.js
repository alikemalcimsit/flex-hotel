import { eachNight, toIsoDay, toMoneyString } from '@hotelos/core';
import { BOARD_TYPE_LABELS } from '@hotelos/hotel-contracts';
import { ValidationError } from '../../lib/errors.js';
import { describeProblems, priceAgencyNights, saleProblems, toReservationNights } from './rules.js';

/**
 * Acente adına satış (modül 29): rezervasyon servisinin kontrat fiyatını ve
 * stop-sale'i okuduğu yer.
 *
 * Okuma, çağıranın transaction'ında ve **acente kilidi alındıktan sonra**
 * yapılır (`lockAgencies(..., { shared: true })`): kontratı ya da stop-sale'i
 * değiştiren işlem acenteyi özel kilitler, bu yüzden satış ya değişiklikten
 * önceki durumu tam görür ya da sonrakini — arada kalmaz. Önizleme (kilitsiz)
 * aynı okumayı `prisma` ile yapar.
 */

/**
 * Satış reddi. 422; `code` ekranın dallandığı kod (`AGENCY_*`), mesaj
 * rezervasyon formunda "Acente" alanının altında görünür.
 */
export class AgencySaleError extends ValidationError {
  /**
   * @param {string} message
   * @param {string} code `AGENCY_SALE_ISSUES` değerlerinden biri
   * @param {Record<string, unknown>} [details]
   */
  constructor(message, code, details = {}) {
    super(message, { field: 'agencyId', ...details });
    this.code = code;
  }
}

const DAY_MS = 86_400_000;

/**
 * Konaklamanın gece günleri (ISO), çıkış günü hariç.
 * @param {Date | string} checkIn
 * @param {Date | string} checkOut
 */
export function stayDays(checkIn, checkOut) {
  return eachNight(checkIn, checkOut).map(toIsoDay);
}

/** @param {string} day */
const dayStart = (day) => new Date(`${day}T00:00:00.000Z`);

/**
 * Acentenin bu konaklamayı kapsayan satıştaki kontratlarını (fiyat ve stop-sale
 * satırlarıyla; yalnızca konaklamaya değenler) okur ve satış nesnesi döner.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof import('../../db.js').prisma} db
 * @param {string} hotelId
 * @param {string} agencyId
 * @param {{ checkIn: Date | string, checkOut: Date | string, hotelCurrency: string }} stay
 */
export async function loadAgencySale(db, hotelId, agencyId, { checkIn, checkOut, hotelCurrency }) {
  const agency = await db.agency.findFirst({
    where: { id: agencyId, hotelId },
    select: { id: true, code: true, name: true, status: true, commissionPct: true, paymentTermDays: true },
  });
  if (!agency) throw new AgencySaleError('Acente bulunamadı', 'AGENCY_NOT_FOUND');

  const days = stayDays(checkIn, checkOut);
  const first = dayStart(days[0] ?? toIsoDay(checkIn));
  const last = dayStart(days.at(-1) ?? toIsoDay(checkIn));
  const overlap = { startDate: { lte: last }, endDate: { gte: first } };
  const contracts = await db.contract.findMany({
    where: { hotelId, agencyId, status: 'ACTIVE', ...overlap },
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      currency: true,
      rates: { where: overlap, select: { roomTypeId: true, boardType: true, startDate: true, endDate: true, price: true } },
      stopSales: { where: overlap, select: { roomTypeId: true, startDate: true, endDate: true, reason: true } },
    },
  });

  return buildSale({ agency, contracts, hotelCurrency });
}

/**
 * @param {{ agency: { id: string, code: string, name: string, status: string, commissionPct: unknown, paymentTermDays: number }, contracts: import('./rules.js').SaleContract[] & Array<{ currency: string }>, hotelCurrency: string }} input
 */
export function buildSale({ agency, contracts, hotelCurrency }) {
  const commissionPct = toMoneyString(String(agency.commissionPct));

  /** Kontratın parası otelinkinden farklıysa fiyat yanlış okunur: satış açılmaz. */
  const mismatch = contracts.find((contract) => contract.currency !== hotelCurrency);

  /**
   * @param {{ roomTypeId: string, boardType: string, days: string[] }} line
   */
  const nightsFor = ({ roomTypeId, boardType, days }) => {
    if (mismatch) {
      throw new AgencySaleError(
        `"${mismatch.name}" kontratının para birimi (${mismatch.currency}) otelin para biriminden (${hotelCurrency}) farklı; kontratı düzeltin`,
        'AGENCY_NO_CONTRACT',
      );
    }
    return priceAgencyNights({ contracts, roomTypeId, boardType, days });
  };

  /** @param {{ roomTypeName: string, boardType: string }} line */
  const labels = ({ roomTypeName, boardType }) => ({
    agencyName: agency.name,
    roomTypeName,
    boardLabel: BOARD_TYPE_LABELS[boardType] ?? boardType,
  });

  return {
    agency: { id: agency.id, code: agency.code, name: agency.name, status: agency.status, paymentTermDays: agency.paymentTermDays },
    /** Açılış anındaki komisyon yüzdesi (rezervasyona kopyalanır). */
    commissionPct,

    /** Yeni satış için acente aktif olmalı. */
    assertActive() {
      if (agency.status !== 'ACTIVE') {
        throw new AgencySaleError(`${agency.name} acentesi pasif; yeni rezervasyon açılamaz`, 'AGENCY_PASSIVE');
      }
    },

    /**
     * Bu geceler satılabilir mi? `requireRate` kapalıysa (fiyat elle girildi)
     * yalnızca stop-sale engeller.
     *
     * @param {{ roomTypeId: string, roomTypeName: string, boardType: string, days: string[], requireRate: boolean }} line
     */
    assertSellable(line) {
      if (line.days.length === 0) return;
      const problems = saleProblems(nightsFor(line), { requireRate: line.requireRate });
      if (problems.length === 0) return;
      throw new AgencySaleError(describeProblems(problems, labels(line)), problems[0].code, {
        problems: problems.map(({ code, ranges }) => ({ code, ranges })),
      });
    },

    /**
     * Kontrat fiyatıyla gece listesi (hepsi fiyatlanmalı, yoksa reddedilir).
     * @param {{ roomTypeId: string, roomTypeName: string, boardType: string, days: string[] }} line
     */
    price(line) {
      const nights = nightsFor(line);
      const problems = saleProblems(nights, { requireRate: true });
      if (problems.length > 0) {
        throw new AgencySaleError(describeProblems(problems, labels(line)), problems[0].code, {
          problems: problems.map(({ code, ranges }) => ({ code, ranges })),
        });
      }
      return toReservationNights(nights);
    },

    /**
     * Önizleme: reddetmez, sonucu anlatır.
     * @param {{ roomTypeId: string, roomTypeName: string, boardType: string, days: string[] }} line
     * @returns {{ sellable: boolean, nights: ReturnType<typeof toReservationNights>, issue: { code: string, message: string } | null }}
     */
    preview(line) {
      try {
        const nights = nightsFor(line);
        const problems = saleProblems(nights, { requireRate: true });
        if (problems.length > 0) {
          return { sellable: false, nights: [], issue: { code: problems[0].code, message: describeProblems(problems, labels(line)) } };
        }
        return { sellable: true, nights: toReservationNights(nights), issue: null };
      } catch (error) {
        if (error instanceof AgencySaleError) return { sellable: false, nights: [], issue: { code: error.code, message: error.message } };
        throw error;
      }
    },
  };
}

/** Bir günün ertesi (ISO). */
export const dayAfter = (day) => toIsoDay(new Date(dayStart(day).getTime() + DAY_MS));
