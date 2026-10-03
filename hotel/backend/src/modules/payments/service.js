import { randomUUID } from 'node:crypto';
import { currentActor, toDecimal, toIsoDay, toMoneyString } from '@hotelos/core';
import {
  APPROVAL_TYPE_LABELS,
  PAYMENT_KIND_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_SOURCE_LABELS,
  PERMISSIONS,
  folioActionError,
  folioDisplayName,
  paymentCurrencyError,
  paymentVoidError,
} from '@hotelos/hotel-contracts';
import { Prisma } from '@prisma/client';
import { prisma, prismaUnfiltered } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { encodeCursor, newerThan, olderThan, parseCursor } from '../../lib/cursor.js';
import { ConflictError, NotFoundError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockFolios, lockReservations } from '../../lib/locks.js';
import { findActiveStaffByEmail } from '../../lib/staff.js';
import { writeWithEvents } from '../../lib/write.js';
import { decideApproval, requestApproval } from '../approvals/service.js';
import { createStayFolio, dayStart, money, refreshFolioTotals } from '../folios/posting.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { guestFullName } from '../reservations/guests.js';
import { getHotelSettings } from '../settings/service.js';
import {
  needsLargePaymentApproval,
  paymentSourceForStay,
  rateText,
  refundableAmount,
  resolvePaymentRate,
  sameRate,
  summarizeCash,
  toFolioAmount,
  voidLeavesRefundsCovered,
} from './rules.js';

/**
 * Ödeme alma (modül 17).
 *
 * ### Para kuralları
 *
 * - Ödeme folyoya yazılır; bakiye = Σ kalem − Σ işlenmiş ödemenin folyo
 *   tutarı. Ödeme yazan her işlem **folyoyu kilitler** ve toplamları aynı
 *   transaction'da kalemlerden / ödemelerden yeniden hesaplar
 *   (`refreshFolioTotals`): çıkış bakiyeyi okurken yarım kalmış ödeme görmez.
 * - **Ödeme silinmez.** Hatalı giriş iptal kaydıyla (asıl satırın tersi),
 *   misafire geri verilen para iadeyle (eksi satır) düzeltilir; ikisi de onaylı.
 * - **Eşik:** folyoya girecek tutar otelin büyük ödeme eşiğine eşit ya da
 *   büyükse ödeme "onay bekliyor" kaydedilir; ikinci bir yetkili onaylayınca
 *   bakiyeye ve kasaya girer, reddedilirse hiç işlenmez. İade her zaman onaylı.
 *   İsteyen kendi isteğini onaylayamaz (dört göz, `approvals.js`).
 * - **Döviz:** kur günün kur tablosundan (iş gününe kadarki en son giriş, en
 *   fazla birkaç gün eski). Form gördüğü kuru gönderir; farklıysa yazılmaz.
 *   Ödeme kendi kurunu saklar: tablo sonradan değişse de ödeme değişmez.
 * - **Kasanın günü** (`businessDate`): ödemenin bakiyeye girdiği iş günü.
 *   Onay bekleyen ödeme kasada ayrıca görünür (para çekmecede, defterde değil).
 * - **Giriş teminatı:** girişte alınan nakit / havale teminatı ödeme olarak
 *   işlenir (kart provizyonu ödeme değildir; çıkışta kartla tahsil edilir).
 *   Giriş geri alınınca teminat ödemesi iptal kaydıyla düşer.
 *
 * ### Kilit sırası
 *
 * Rezervasyon → folyo (bkz. `lib/locks.js`). Folyo açabilen işlem (ön ödeme,
 * teminat) önce rezervasyonu kilitler.
 */

/** Kasa görünümünde gösterilen en fazla onay bekleyen satır. */
const CASH_PENDING_LIMIT = 50;

/** Merge yarışında ödemenin folyosu kilit altında değişmişse en fazla bu kadar yeniden denenir. */
const MAX_LOCK_ATTEMPTS = 3;

/** Konaklaması bitmiş durumlar: ödemeyle sıfırlanan folyoyu aktör kapatır (bkz. `closeFolioIfSettled`). */
const ENDED_STAY_STATUSES = Object.freeze(['CHECKED_OUT', 'CANCELLED', 'NO_SHOW']);

/** @param {{ reservation?: { status?: string } }} folio */
const stayEnded = (folio) => ENDED_STAY_STATUSES.includes(folio.reservation?.status ?? '');

/** Giriş teminatı olarak ödemeye çevrilen yöntemler (kart provizyonu ödeme değil). */
const DEPOSIT_PAYMENT_METHODS = Object.freeze({ CASH: 'CASH', TRANSFER: 'TRANSFER' });

const iso = (value) => (value ? value.toISOString() : null);

/** "2026-09-29" → "29.09.2026" */
const dotted = (day) => day.split('-').reverse().join('.');

/** @param {string} hotelId */
async function businessDay(hotelId) {
  return toIsoDay(await getBusinessDate(hotelId));
}

const trMoney = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Kullanıcıya yazılan tutar (hata mesajı, onay özeti): "55.000,00 TRY".
 * Yalnızca metin; hesap `money.js` ile yapılır.
 * @param {string} amount @param {string} currency
 */
const priced = (amount, currency) => `${trMoney.format(Number(money(amount)))} ${currency}`;

/** Kur metni: "38.512500" → "38,5125". @param {string} rate */
const rateLabel = (rate) => rate.replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');

/* ══════════════════ Seçimler ve dönüştürücüler ══════════════════ */

const STAY_REF_SELECT = Object.freeze({
  id: true,
  confirmationCode: true,
  status: true,
  room: { select: { number: true } },
  guest: { select: { firstName: true, lastName: true } },
});

/** @param {any} stay */
const stayRef = (stay) =>
  stay
    ? {
        id: stay.id,
        confirmationCode: stay.confirmationCode,
        status: stay.status,
        roomNumber: stay.room?.number ?? null,
        guestName: guestFullName(stay.guest),
      }
    : null;

const PAYMENT_SELECT = Object.freeze({
  id: true,
  folioId: true,
  reservationId: true,
  kind: true,
  status: true,
  source: true,
  method: true,
  amount: true,
  currency: true,
  exchangeRate: true,
  folioAmount: true,
  businessDate: true,
  reference: true,
  note: true,
  receivedBy: true,
  receivedAt: true,
  postedAt: true,
  approvalId: true,
  declinedAt: true,
  reversalOfId: true,
  voidedAt: true,
  voidedBy: true,
  voidReason: true,
  voidApprovalId: true,
  voidRequestedAt: true,
  voidRequestedBy: true,
});

/** @param {any} row */
function toPaymentDto(row) {
  return {
    id: row.id,
    folioId: row.folioId,
    reservationId: row.reservationId,
    kind: row.kind,
    status: row.status,
    source: row.source,
    method: row.method,
    amount: money(row.amount),
    currency: row.currency,
    exchangeRate: row.exchangeRate === null ? null : rateText(String(row.exchangeRate)),
    folioAmount: money(row.folioAmount),
    // Eski adıyla da (modül 15'in ekranı `converted` okur).
    converted: money(row.folioAmount),
    businessDate: toIsoDay(row.businessDate),
    reference: row.reference ?? null,
    note: row.note ?? null,
    receivedBy: row.receivedBy,
    receivedAt: iso(row.receivedAt),
    postedAt: iso(row.postedAt),
    approvalId: row.approvalId ?? null,
    declinedAt: iso(row.declinedAt),
    reversalOfId: row.reversalOfId ?? null,
    voided: Boolean(row.voidedAt),
    voidedAt: iso(row.voidedAt),
    voidedBy: row.voidedBy ?? null,
    voidReason: row.voidReason ?? null,
    voidPending: Boolean(row.voidRequestedAt),
    voidApprovalId: row.voidApprovalId ?? null,
    voidRequestedBy: row.voidRequestedBy ?? null,
  };
}

/** Denetim izine yazılan ödeme özeti. */
const paymentAudit = (row) => ({
  folioId: row.folioId,
  kind: row.kind,
  status: row.status,
  source: row.source,
  method: row.method,
  amount: money(row.amount),
  currency: row.currency,
  exchangeRate: row.exchangeRate === null || row.exchangeRate === undefined ? null : rateText(String(row.exchangeRate)),
  folioAmount: money(row.folioAmount),
  reference: row.reference ?? null,
});

const FOLIO_FOR_PAYMENT_SELECT = Object.freeze({
  id: true,
  hotelId: true,
  reservationId: true,
  window: true,
  payerName: true,
  status: true,
  currency: true,
  balance: true,
  reservation: { select: STAY_REF_SELECT },
});

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {string} folioId
 */
async function findFolio(client, hotelId, folioId) {
  const folio = await client.folio.findFirst({ where: { id: folioId, hotelId }, select: FOLIO_FOR_PAYMENT_SELECT });
  if (!folio) throw new NotFoundError('Folyo bulunamadı');
  return folio;
}

/**
 * Folyoya ödeme yazılabilir mi (açık olmalı) → 409.
 * @param {{ status: string }} folio
 */
function assertFolioOpen(folio) {
  const reason = folioActionError(folio, 'post');
  if (reason) throw new ConflictError(reason, 'FOLIO_NOT_OPEN', { status: folio.status });
}

/**
 * Konaklamanın etiketi (onay ekranı ve zil için): "ABC123 · oda 204 · Ayşe Kaya".
 * @param {any} stay
 */
const stayLabel = (stay) => `${stay.confirmationCode} · oda ${stay.room?.number ?? '—'} · ${guestFullName(stay.guest)}`;

/* ══════════════════ Kurlar ══════════════════ */

/**
 * Para birimlerinin iş gününe kadar girilmiş en son kurları.
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {string} businessDate
 * @param {string[]} [currencies] verilirse yalnızca bunlar
 */
async function latestRates(client, hotelId, businessDate, currencies) {
  // Otel × döviz × gün tekil index'i: döviz başına en son gün tek adımda.
  const rows = await client.$queryRaw`
    SELECT DISTINCT ON (r."currency") r."currency", r."rate"::text AS "rate", r."date", r."enteredBy", r."updatedAt"
    FROM "ExchangeRate" r
    WHERE r."hotelId" = ${hotelId} AND r."date" <= ${businessDate}::date
      ${currencies ? Prisma.sql`AND r."currency" = ANY(${currencies}::text[])` : Prisma.empty}
    ORDER BY r."currency", r."date" DESC`;
  return new Map(rows.map((row) => [row.currency, { rate: row.rate, date: toIsoDay(row.date), enteredBy: row.enteredBy, updatedAt: row.updatedAt }]));
}

/**
 * Ödeme formunun ve kur ekranının okuduğu güncel kurlar.
 * @param {string} hotelId
 */
export async function getCurrentRates(hotelId) {
  const [businessDate, hotel] = await Promise.all([businessDay(hotelId), getHotelSettings(hotelId)]);
  const latest = await latestRates(prisma, hotelId, businessDate);
  return {
    businessDate,
    hotelCurrency: hotel.currency,
    rates: [...latest.entries()]
      .filter(([currency]) => currency !== hotel.currency)
      .map(([currency, row]) => {
        const resolved = resolvePaymentRate({ currency, folioCurrency: hotel.currency, hotelCurrency: hotel.currency, latest: row, businessDate });
        return {
          currency,
          rate: rateText(row.rate),
          date: row.date,
          today: row.date === businessDate,
          usable: !resolved.error,
          problem: resolved.error,
          enteredBy: row.enteredBy,
          updatedAt: iso(row.updatedAt),
        };
      }),
  };
}

/**
 * Günün kurlarını gir (yalnızca iş günü; aynı gün yeniden girilirse güncellenir,
 * denetim izi eski değeri tutar). Geçmiş ödemeler kendi kurunu sakladığı için
 * değişmez.
 *
 * @param {string} hotelId
 * @param {{ rates: Array<{ currency: string, rate: string }> }} input
 */
export async function setTodayRates(hotelId, { rates }) {
  const [businessDate, hotel] = await Promise.all([businessDay(hotelId), getHotelSettings(hotelId)]);
  if (rates.some((row) => row.currency === hotel.currency)) {
    throw new ValidationError(`Otelin kendi para birimi (${hotel.currency}) için kur girilmez.`, { field: 'rates' });
  }
  const actor = currentActor();
  const date = dayStart(businessDate);
  try {
    await writeWithEvents(async (tx, stage) => {
      const before = await tx.exchangeRate.findMany({
        where: { hotelId, date, currency: { in: rates.map((row) => row.currency) } },
        select: { id: true, currency: true, rate: true },
      });
      const previous = new Map(before.map((row) => [row.currency, row]));
      const changed = [];
      for (const row of rates) {
        const old = previous.get(row.currency);
        if (old && sameRate(String(old.rate), row.rate)) continue;
        const saved = await tx.exchangeRate.upsert({
          where: { hotelId_currency_date: { hotelId, currency: row.currency, date } },
          create: { hotelId, currency: row.currency, date, rate: row.rate, enteredBy: actor },
          update: { rate: row.rate, enteredBy: actor },
          select: { id: true },
        });
        await recordAudit(tx, {
          hotelId,
          entity: 'ExchangeRate',
          entityId: saved.id,
          action: old ? 'UPDATE' : 'CREATE',
          before: old ? { currency: row.currency, date: businessDate, rate: rateText(String(old.rate)) } : null,
          after: { currency: row.currency, date: businessDate, rate: rateText(row.rate) },
        });
        changed.push(row.currency);
      }
      if (changed.length) await stage('exchange_rate.updated', { hotelId, date: businessDate, currencies: changed });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getCurrentRates(hotelId);
}

/**
 * Kur geçmişi (son gün önce), imleçli.
 * @param {string} hotelId
 * @param {{ currency?: string, cursor?: string, limit: number }} query
 */
export async function listRateHistory(hotelId, query) {
  const cursor = parseCursor(query.cursor);
  const rows = await prisma.exchangeRate.findMany({
    where: { hotelId, ...(query.currency ? { currency: query.currency } : {}), ...(cursor ? olderThan('date', cursor) : {}) },
    select: { id: true, currency: true, date: true, rate: true, enteredBy: true, updatedAt: true },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
  });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    rates: page.map((row) => ({
      id: row.id,
      currency: row.currency,
      date: toIsoDay(row.date),
      rate: rateText(String(row.rate)),
      enteredBy: row.enteredBy,
      updatedAt: iso(row.updatedAt),
    })),
    nextCursor: rows.length > query.limit && last ? encodeCursor({ at: last.date, id: last.id }) : null,
  };
}

/* ══════════════════ Önizleme ══════════════════ */

/**
 * Ödeme / iade formunun canlı hesabı: kur, folyoya girecek tutar, onaya gidip gitmeyeceği.
 * @param {string} hotelId
 * @param {{ amount: string, currency?: string | null, kind: 'PAYMENT' | 'REFUND' }} input
 */
export async function quotePayment(hotelId, input) {
  const [businessDate, hotel] = await Promise.all([businessDay(hotelId), getHotelSettings(hotelId)]);
  const currency = input.currency ?? hotel.currency;
  const latest = currency === hotel.currency ? null : (await latestRates(prisma, hotelId, businessDate, [currency])).get(currency) ?? null;
  const rate = resolvePaymentRate({ currency, folioCurrency: hotel.currency, hotelCurrency: hotel.currency, latest, businessDate });
  const folioAmount = rate.error ? null : toFolioAmount(input.amount, rate.rate);
  return {
    currency,
    folioCurrency: hotel.currency,
    rate: rate.rate,
    rateDate: rate.rateDate,
    problem: rate.error,
    folioAmount,
    threshold: money(hotel.largePaymentThreshold),
    requiresApproval: input.kind === 'REFUND' || Boolean(folioAmount && needsLargePaymentApproval(folioAmount, hotel.largePaymentThreshold)),
  };
}

/* ══════════════════ Yazma çekirdeği ══════════════════ */

/**
 * Ödemenin kuru ve folyo tutarı (transaction içinde). Döviz ödemesinde formun
 * gördüğü kur sunucununkiyle aynı olmalı; değilse 409 (yeni kur ayrıntıda).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ hotelId: string, hotelCurrency: string, folio: { currency: string }, method: string, amount: string, currency: string, expectedRate?: string | null, businessDate: string }} input
 * @returns {Promise<{ rate: string | null, folioAmount: string }>}
 */
async function priceInFolioCurrency(tx, { hotelId, hotelCurrency, folio, method, amount, currency, expectedRate, businessDate }) {
  const currencyProblem = paymentCurrencyError(method, currency, folio.currency);
  if (currencyProblem) throw new ValidationError(currencyProblem, { field: 'currency' });
  const latest = currency === folio.currency ? null : (await latestRates(tx, hotelId, businessDate, [currency])).get(currency) ?? null;
  const resolved = resolvePaymentRate({ currency, folioCurrency: folio.currency, hotelCurrency, latest, businessDate });
  if (resolved.error) throw new ConflictError(resolved.error, 'RATE_UNAVAILABLE', { currency });
  if (resolved.rate !== null && !sameRate(expectedRate, resolved.rate)) {
    throw new ConflictError(
      `${currency} kuru ${rateLabel(resolved.rate)} (${dotted(resolved.rateDate)}). Tutarı yeni kurla kontrol edip yeniden onaylayın.`,
      'RATE_CHANGED',
      { rate: resolved.rate, rateDate: resolved.rateDate, currency },
    );
  }
  const folioAmount = toFolioAmount(amount, resolved.rate);
  if (toDecimal(folioAmount).isZero()) {
    throw new ValidationError(`Tutar ${folio.currency} karşılığı 0,00 ediyor; daha büyük bir tutar girin.`, { field: 'amount' });
  }
  return { rate: resolved.rate, folioAmount };
}

/**
 * Folyonun ödeme durumu: işlenmiş net ödeme ve onay bekleyen iadeler (folyo para biriminde).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {string} folioId
 */
async function folioPaymentState(client, hotelId, folioId) {
  const [row] = await client.$queryRaw`
    SELECT COALESCE(SUM(p."folioAmount") FILTER (WHERE p."status" = 'POSTED'), 0)::text AS "postedNet",
           COALESCE(SUM(p."folioAmount") FILTER (WHERE p."status" = 'PENDING' AND p."kind" = 'REFUND'), 0)::text AS "pendingRefunds",
           COUNT(*) FILTER (WHERE p."status" = 'PENDING')::int AS "pending",
           COUNT(*) FILTER (WHERE p."voidRequestedAt" IS NOT NULL)::int AS "pendingVoids"
    FROM "Payment" p
    WHERE p."hotelId" = ${hotelId} AND p."folioId" = ${folioId} AND p."deletedAt" IS NULL`;
  return {
    postedNet: money(row?.postedNet ?? '0'),
    pendingRefunds: money(row?.pendingRefunds ?? '0'),
    pending: row?.pending ?? 0,
    pendingVoids: row?.pendingVoids ?? 0,
  };
}

/**
 * Ödeme / iade satırını yazar (folyo kilitli, açık olmalı). Eşik üstü ödeme ve
 * iade onaya gider (`PENDING`); diğerleri işlenir (`POSTED`) ve toplamlar
 * yenilenir. Aynı anahtarla ikinci kez gelen istek yeni satır açmaz.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {{
 *   hotelId: string,
 *   folio: any,
 *   kind: 'PAYMENT' | 'REFUND',
 *   source: 'DESK' | 'ADVANCE' | 'CHECK_IN_DEPOSIT',
 *   input: { method: string, amount: string, currency?: string | null, expectedRate?: string | null, reference?: string | null, note?: string | null, reason?: string },
 *   sourceKey: string,
 *   receivedBy: string,
 *   businessDate: string,
 *   hotel: { currency: string, largePaymentThreshold: string },
 * }} options
 * @returns {Promise<{ paymentId: string, created: boolean, status: string, approvalId: string | null }>}
 */
async function writePayment(tx, stage, { hotelId, folio, kind, source, input, sourceKey, receivedBy, businessDate, hotel }) {
  const existing = await tx.payment.findFirst({ where: { hotelId, sourceKey }, select: { id: true, status: true, approvalId: true } });
  if (existing) return { paymentId: existing.id, created: false, status: existing.status, approvalId: existing.approvalId };

  assertFolioOpen(folio);
  const currency = input.currency ?? folio.currency;
  const signed = kind === 'REFUND' ? toMoneyString(toDecimal(input.amount).negated()) : toMoneyString(input.amount);
  const { rate, folioAmount } = await priceInFolioCurrency(tx, {
    hotelId,
    hotelCurrency: hotel.currency,
    folio,
    method: input.method,
    amount: signed,
    currency,
    expectedRate: input.expectedRate ?? null,
    businessDate,
  });

  const state = await folioPaymentState(tx, hotelId, folio.id);
  if (kind === 'REFUND') {
    const limit = refundableAmount(state);
    if (toDecimal(folioAmount).abs().gt(toDecimal(limit))) {
      throw new ValidationError(
        toDecimal(limit).isZero()
          ? 'Bu folyoda iade edilecek ödeme yok (alınmamış para iade edilemez).'
          : `Bu folyodan en fazla ${priced(limit, folio.currency)} iade edilebilir (alınan ödemeler, bekleyen iadeler düşülmüş).`,
        { field: 'amount', refundable: limit },
      );
    }
  }

  const pending = kind === 'REFUND' || needsLargePaymentApproval(folioAmount, hotel.largePaymentThreshold);
  const paymentId = randomUUID();
  let approvalId = null;
  if (pending) {
    const balanceAfter = toMoneyString(toDecimal(money(folio.balance)).minus(toDecimal(folioAmount)));
    const approvalType = kind === 'REFUND' ? 'REFUND' : 'LARGE_PAYMENT';
    const what = kind === 'REFUND' ? 'İade' : 'Büyük ödeme';
    ({ approvalId } = await requestApproval(tx, stage, {
      hotelId,
      type: approvalType,
      summary: `${what}: ${folio.reservation.room?.number ?? '—'} · ${guestFullName(folio.reservation.guest)} — ${priced(signed.replace('-', ''), currency)} ${PAYMENT_METHOD_LABELS[input.method]}`.slice(0, 200),
      reason: input.reason ?? (kind === 'PAYMENT' ? `Tutar büyük ödeme eşiğine (${priced(money(hotel.largePaymentThreshold), hotel.currency)}) eşit ya da üstünde` : null),
      amount: toMoneyString(toDecimal(folioAmount).abs()),
      currency: folio.currency,
      // Onay ekranı veriyi yorumlamadan gösterir: onaylayanın okuyacağı etiketlerle.
      data: {
        Konaklama: stayLabel(folio.reservation),
        Folyo: folioDisplayName(folio),
        Tür: `${PAYMENT_KIND_LABELS[kind]} · ${PAYMENT_SOURCE_LABELS[source]}`,
        Yöntem: PAYMENT_METHOD_LABELS[input.method],
        Tutar: rate ? `${priced(signed.replace('-', ''), currency)} × ${rateLabel(rate)} = ${priced(folioAmount.replace('-', ''), folio.currency)}` : priced(signed.replace('-', ''), currency),
        ...(input.reference ? { Referans: input.reference } : {}),
        ...(input.note ? { Not: input.note } : {}),
        'Şu anki bakiye': priced(money(folio.balance), folio.currency),
        'Onaylanınca bakiye': priced(balanceAfter, folio.currency),
        Alan: receivedBy,
      },
      entityType: 'Payment',
      entityId: paymentId,
      requestedBy: receivedBy,
    }));
  }

  const now = new Date();
  const created = await tx.payment.create({
    data: {
      id: paymentId,
      hotelId,
      folioId: folio.id,
      reservationId: folio.reservationId,
      kind,
      status: pending ? 'PENDING' : 'POSTED',
      source,
      method: input.method,
      amount: signed,
      currency,
      exchangeRate: rate,
      folioAmount,
      businessDate: dayStart(businessDate),
      reference: input.reference ?? null,
      note: input.note ?? input.reason ?? null,
      sourceKey,
      receivedBy,
      receivedAt: now,
      postedAt: pending ? null : now,
      approvalId,
    },
    select: PAYMENT_SELECT,
  });
  await recordAudit(tx, { hotelId, entity: 'Payment', entityId: created.id, action: 'CREATE', after: paymentAudit(created) });
  if (pending) {
    await stage('payment.requested', { hotelId, folioId: folio.id, reservationId: folio.reservationId, paymentId, kind, approvalId });
  } else {
    await refreshFolioTotals(tx, [folio.id]);
    await stage('payment.received', {
      hotelId,
      folioId: folio.id,
      reservationId: folio.reservationId,
      paymentId,
      stayEnded: stayEnded(folio),
      method: input.method,
      source,
      amount: folioAmount,
      currency: folio.currency,
    });
  }
  return { paymentId, created: true, status: created.status, approvalId };
}

/** @param {string} hotelId @param {string} paymentId */
async function readPayment(hotelId, paymentId) {
  const row = await prisma.payment.findFirst({ where: { id: paymentId, hotelId }, select: PAYMENT_SELECT });
  if (!row) throw new NotFoundError('Ödeme bulunamadı');
  return toPaymentDto(row);
}

/* ══════════════════ Personel: ödeme, ön ödeme, iade, iptal ══════════════════ */

/**
 * Folyoya ödeme al. Eşik üstüyse onaya gider (`status: PENDING`). Aynı istek
 * kimliğiyle ikinci gönderim yeni satır açmaz (`created: false`).
 *
 * @param {string} hotelId
 * @param {string} folioId
 * @param {object} input `receivePaymentSchema` çıktısı
 */
export async function receivePayment(hotelId, folioId, input) {
  const [businessDate, hotel] = await Promise.all([businessDay(hotelId), getHotelSettings(hotelId)]);
  const actor = currentActor();
  try {
    const outcome = await writeWithEvents(async (tx, stage) => {
      if (!(await lockFolios(tx, hotelId, [folioId])).has(folioId)) throw new NotFoundError('Folyo bulunamadı');
      const folio = await findFolio(tx, hotelId, folioId);
      return writePayment(tx, stage, {
        hotelId,
        folio,
        kind: 'PAYMENT',
        source: paymentSourceForStay(folio.reservation.status),
        input,
        sourceKey: `manual:${input.requestId}`,
        receivedBy: actor,
        businessDate,
        hotel,
      });
    });
    return { payment: await readPayment(hotelId, outcome.paymentId), created: outcome.created };
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Konaklamaya ödeme (ön ödeme / depozito, rezervasyon ekranından): folyo
 * verilmezse konaklamanın ilk açık folyosuna; hiç açık folyosu yoksa açılır
 * (gelmemiş ya da içerideki konaklamada).
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {object} input `stayPaymentSchema` çıktısı
 */
export async function receiveStayPayment(hotelId, reservationId, input) {
  const [businessDate, hotel] = await Promise.all([businessDay(hotelId), getHotelSettings(hotelId)]);
  const actor = currentActor();
  try {
    const outcome = await writeWithEvents(async (tx, stage) => {
      if (!(await lockReservations(tx, hotelId, [reservationId])).has(reservationId)) throw new NotFoundError('Konaklama bulunamadı');
      const existing = await tx.payment.findFirst({ where: { hotelId, sourceKey: `manual:${input.requestId}` }, select: { id: true } });
      if (existing) return { paymentId: existing.id, created: false };
      const folioId = await stayPaymentFolio(tx, stage, { hotelId, reservationId, folioId: input.folioId ?? null });
      await lockFolios(tx, hotelId, [folioId]);
      const folio = await findFolio(tx, hotelId, folioId);
      return writePayment(tx, stage, {
        hotelId,
        folio,
        kind: 'PAYMENT',
        source: paymentSourceForStay(folio.reservation.status),
        input,
        sourceKey: `manual:${input.requestId}`,
        receivedBy: actor,
        businessDate,
        hotel,
      });
    });
    return { payment: await readPayment(hotelId, outcome.paymentId), created: outcome.created };
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/** Ödeme alınabilen (folyosu açılabilen) konaklama durumları. */
const PAYABLE_STAY_STATUSES = Object.freeze(['PENDING', 'CONFIRMED', 'CHECKED_IN']);

/**
 * Konaklamada ödemenin düşeceği folyo (rezervasyon kilitli). Yoksa açılır.
 * Birden fazla açık folyoda personel folyoyu seçmeli; giriş teminatı ise
 * misafirin ana penceresine (en küçük pencere) düşer (`firstOpen`).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {{ hotelId: string, reservationId: string, folioId: string | null, firstOpen?: boolean }} input
 * @returns {Promise<string>}
 */
async function stayPaymentFolio(tx, stage, { hotelId, reservationId, folioId, firstOpen = false }) {
  const stay = await tx.reservation.findFirst({
    where: { id: reservationId, hotelId },
    select: { id: true, guestId: true, currency: true, status: true },
  });
  if (!stay) throw new NotFoundError('Konaklama bulunamadı');
  const folios = await tx.folio.findMany({
    where: { hotelId, reservationId },
    select: { id: true, window: true, status: true },
    orderBy: { window: 'asc' },
  });
  if (folioId) {
    const chosen = folios.find((folio) => folio.id === folioId);
    if (!chosen) throw new NotFoundError('Folyo bu konaklamanın değil; ekranı yenileyin.');
    return chosen.id;
  }
  const open = folios.filter((folio) => folio.status === 'OPEN');
  // Birden fazla pencere (ör. oda ücreti şirkete, ekstralar misafire): para doğru pencereye düşmeli;
  // tahmin edilirse toplam sıfırlanır ama pencereler ters bakiyeyle açık kalır.
  if (open.length > 1 && !firstOpen) {
    throw new ConflictError(
      `Konaklamanın ${open.length} açık folyosu var; ödemeyi folyo ekranından ilgili folyoya alın.`,
      'FOLIO_REQUIRED',
      { folioIds: open.map((folio) => folio.id) },
    );
  }
  if (open.length > 0) return open[0].id;
  if (!PAYABLE_STAY_STATUSES.includes(stay.status)) {
    throw new ConflictError('Konaklamanın açık folyosu yok; ödeme için önce folyoyu yeniden açın.', 'FOLIO_NOT_OPEN');
  }
  const created = await createStayFolio(tx, stage, { hotelId, stay, windows: folios.map((folio) => folio.window) });
  await recordAudit(tx, { hotelId, entity: 'Folio', entityId: created.id, action: 'CREATE', after: { window: created.window, reason: 'Ödeme için açıldı' } });
  return created.id;
}

/**
 * İade isteği: her zaman ikinci bir yetkilinin onayına gider; onaylanınca eksi
 * ödeme olarak işlenir. Alınmamış para iade edilemez (folyonun net ödemesi,
 * bekleyen iadeler düşülmüş).
 *
 * @param {string} hotelId
 * @param {string} folioId
 * @param {object} input `refundRequestSchema` çıktısı
 */
export async function requestRefund(hotelId, folioId, input) {
  const [businessDate, hotel] = await Promise.all([businessDay(hotelId), getHotelSettings(hotelId)]);
  const actor = currentActor();
  try {
    const outcome = await writeWithEvents(async (tx, stage) => {
      if (!(await lockFolios(tx, hotelId, [folioId])).has(folioId)) throw new NotFoundError('Folyo bulunamadı');
      const folio = await findFolio(tx, hotelId, folioId);
      return writePayment(tx, stage, {
        hotelId,
        folio,
        kind: 'REFUND',
        source: paymentSourceForStay(folio.reservation.status),
        input,
        sourceKey: `manual:${input.requestId}`,
        receivedBy: actor,
        businessDate,
        hotel,
      });
    });
    return { payment: await readPayment(hotelId, outcome.paymentId), created: outcome.created };
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Ödeme iptali (hatalı giriş: yanlış tutar, yanlış folyo, çift giriş): ikinci
 * bir yetkilinin onayına gider; onaylanınca asıl satırın tersi işlenir. Misafire
 * para geri verilecekse bu değil iadedir.
 *
 * @param {string} hotelId
 * @param {string} paymentId
 * @param {{ reason: string }} input
 * @returns {Promise<{ approvalId: string }>}
 */
export async function requestPaymentVoid(hotelId, paymentId, { reason }) {
  const actor = currentActor();
  try {
    return await withPaymentFolioLock(hotelId, paymentId, async (tx, stage, payment) => {
      const folio = await findFolio(tx, hotelId, payment.folioId);
      assertFolioOpen(folio);
      const blocked = paymentVoidError({ ...payment, voidPending: Boolean(payment.voidRequestedAt) });
      if (blocked) throw new ConflictError(blocked, 'PAYMENT_RULE');
      if (payment.kind === 'PAYMENT') {
        const state = await folioPaymentState(tx, hotelId, folio.id);
        if (!voidLeavesRefundsCovered({ ...state, paymentFolioAmount: money(payment.folioAmount) })) {
          throw new ConflictError(
            'Bu ödemeden iade yapılmış ya da iade bekliyor; iptal edilirse iade edilen para karşılıksız kalır. Önce iadeyi düzeltin.',
            'PAYMENT_RULE',
          );
        }
      }

      const what = `${PAYMENT_KIND_LABELS[payment.kind]} ${priced(money(payment.amount).replace('-', ''), payment.currency)} ${PAYMENT_METHOD_LABELS[payment.method]}`;
      const { approvalId } = await requestApproval(tx, stage, {
        hotelId,
        type: 'PAYMENT_VOID',
        summary: `Ödeme iptali: ${folio.reservation.room?.number ?? '—'} · ${guestFullName(folio.reservation.guest)} — ${what}`.slice(0, 200),
        reason,
        amount: toMoneyString(toDecimal(money(payment.folioAmount)).abs()),
        currency: folio.currency,
        data: {
          Konaklama: stayLabel(folio.reservation),
          Folyo: folioDisplayName(folio),
          Satır: what,
          'Folyoya giren': priced(money(payment.folioAmount), folio.currency),
          ...(payment.reference ? { Referans: payment.reference } : {}),
          Alan: payment.receivedBy,
          'Alındığı an': payment.receivedAt.toISOString(),
          'Kasa günü': dotted(toIsoDay(payment.businessDate)),
        },
        entityType: 'Payment',
        entityId: payment.id,
        requestedBy: actor,
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { voidApprovalId: approvalId, voidRequestedAt: new Date(), voidRequestedBy: actor, voidReason: reason },
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'Payment',
        entityId: payment.id,
        action: 'UPDATE',
        before: { voidPending: false },
        after: { voidPending: true, approvalId, reason },
      });
      await stage('payment.void_requested', { hotelId, folioId: folio.id, reservationId: folio.reservationId, paymentId: payment.id, approvalId });
      return { approvalId };
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Ödemenin folyosunu kilitleyip işi yapar. Folyolar bu arada birleştirildiyse
 * (ödeme başka folyoya taşındıysa) yeni folyoyla yeniden dener.
 *
 * @template T
 * @param {string} hotelId
 * @param {string} paymentId
 * @param {(tx: any, stage: any, payment: any) => Promise<T>} work
 * @returns {Promise<T>}
 */
async function withPaymentFolioLock(hotelId, paymentId, work) {
  for (let attempt = 0; attempt < MAX_LOCK_ATTEMPTS; attempt += 1) {
    const seed = await prisma.payment.findFirst({ where: { id: paymentId, hotelId }, select: { folioId: true } });
    if (!seed) throw new NotFoundError('Ödeme bulunamadı');
    const outcome = await writeWithEvents(async (tx, stage) => {
      await lockFolios(tx, hotelId, [seed.folioId]);
      const payment = await tx.payment.findFirst({ where: { id: paymentId, hotelId }, select: { ...PAYMENT_SELECT, hotelId: true } });
      if (!payment) throw new NotFoundError('Ödeme bulunamadı');
      if (payment.folioId !== seed.folioId) return { retry: true };
      return { value: await work(tx, stage, payment) };
    });
    if (!outcome.retry) return outcome.value;
  }
  throw new ConflictError('Ödemenin folyosu aynı anda değişti; ekranı yenileyip tekrar deneyin.', 'FOLIO_CHANGED');
}

/* ══════════════════ Onay sonuçları ══════════════════ */

/** Bu modülün onay türleri. */
export const PAYMENT_APPROVAL_TYPES = Object.freeze(['LARGE_PAYMENT', 'REFUND', 'PAYMENT_VOID']);

/**
 * Onay kuyruğunun sonucu (servis dinleyicisi): büyük ödeme / iade onaylanınca
 * işlenir, reddedilince ya da süresi dolunca hiç işlenmez; ödeme iptali
 * onaylanınca iptal kaydı işlenir. İsteyenin ziline sonuç düşer. Aynı haber iki
 * kez gelse de bir kez uygulanır (satırdaki onay kimliği ve durum eşleşmezse
 * dokunulmaz).
 *
 * @param {{ hotelId: string, approvalId: string, type: string, decidedBy?: string }} payload
 * @param {{ name: string }} envelope
 * @returns {Promise<{ handled: boolean, applied?: boolean }>}
 */
export async function applyPaymentDecision(payload, envelope) {
  if (!PAYMENT_APPROVAL_TYPES.includes(payload.type)) return { handled: false };
  const approval = await prismaUnfiltered.approval.findFirst({
    where: { id: payload.approvalId, hotelId: payload.hotelId },
    select: { id: true, type: true, entityId: true, requestedBy: true, decidedBy: true, note: true, status: true, summary: true },
  });
  if (!approval?.entityId) return { handled: false };
  const hotelId = payload.hotelId;
  const granted = envelope.name === 'approval.granted';
  const outcomeName = envelope.name === 'approval.denied' ? 'DENIED' : 'EXPIRED';
  const businessDate = await businessDay(hotelId);
  const exists = await prisma.payment.findFirst({ where: { id: approval.entityId, hotelId }, select: { id: true } });
  if (!exists) return { handled: false };

  const outcome =
    approval.type === 'PAYMENT_VOID'
      ? await withPaymentFolioLock(hotelId, approval.entityId, (tx, stage, payment) =>
          applyVoid(tx, stage, { hotelId, approval, payment, granted, outcomeName, businessDate }),
        )
      : await withPaymentFolioLock(hotelId, approval.entityId, (tx, stage, payment) =>
          applyPending(tx, stage, { hotelId, approval, payment, granted, outcomeName, businessDate }),
        );

  if (!outcome.stale) {
    await alertRequester(hotelId, approval, granted ? (outcome.applied ? 'GRANTED' : 'FAILED') : envelope.name, outcome.folio);
  }
  return { handled: true, applied: Boolean(outcome.applied) };
}

/**
 * Onay bekleyen ödeme / iade kararı (folyo kilitli).
 * @param {any} tx
 * @param {any} stage
 * @param {{ hotelId: string, approval: any, payment: any, granted: boolean, outcomeName: 'DENIED' | 'EXPIRED', businessDate: string }} input
 */
async function applyPending(tx, stage, { hotelId, approval, payment, granted, outcomeName, businessDate }) {
  if (payment.approvalId !== approval.id || payment.status !== 'PENDING') return { stale: true };
  const folio = await findFolio(tx, hotelId, payment.folioId);
  const ref = { reservationId: folio.reservationId, folioId: folio.id };
  const event = { hotelId, folioId: folio.id, reservationId: folio.reservationId, paymentId: payment.id };

  if (granted && folio.status === 'OPEN') {
    const now = new Date();
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'POSTED', postedAt: now, businessDate: dayStart(businessDate) },
      select: PAYMENT_SELECT,
    });
    await refreshFolioTotals(tx, [folio.id]);
    await recordAudit(tx, {
      hotelId,
      entity: 'Payment',
      entityId: payment.id,
      action: 'UPDATE',
      before: { status: 'PENDING' },
      after: { ...paymentAudit(updated), approvalId: approval.id, decidedBy: approval.decidedBy },
    });
    if (payment.kind === 'REFUND') {
      await stage('payment.refunded', { ...event, stayEnded: stayEnded(folio), method: payment.method, amount: money(payment.folioAmount), currency: folio.currency, approvalId: approval.id });
    } else {
      await stage('payment.received', {
        ...event,
        stayEnded: stayEnded(folio),
        method: payment.method,
        source: payment.source,
        amount: money(payment.folioAmount),
        currency: folio.currency,
        approvalId: approval.id,
      });
    }
    return { applied: true, folio: ref };
  }

  // Reddedildi, süresi doldu ya da (yalnızca yarışla) folyo kapandı: satır işlenmez.
  await tx.payment.update({ where: { id: payment.id }, data: { status: 'DECLINED', declinedAt: new Date() } });
  await recordAudit(tx, {
    hotelId,
    entity: 'Payment',
    entityId: payment.id,
    action: 'UPDATE',
    before: { status: 'PENDING' },
    after: { status: 'DECLINED', outcome: granted ? 'FOLIO_NOT_OPEN' : outcomeName, approvalId: approval.id },
  });
  await stage('payment.declined', { ...event, kind: payment.kind, approvalId: approval.id, outcome: granted ? 'FOLIO_CLOSED' : outcomeName });
  return { applied: false, folio: ref };
}

/**
 * Ödeme iptali kararı (folyo kilitli): onaylandıysa iptal kaydı işlenir.
 * @param {any} tx
 * @param {any} stage
 * @param {{ hotelId: string, approval: any, payment: any, granted: boolean, outcomeName: 'DENIED' | 'EXPIRED', businessDate: string }} input
 */
async function applyVoid(tx, stage, { hotelId, approval, payment, granted, outcomeName, businessDate }) {
  if (payment.voidApprovalId !== approval.id || !payment.voidRequestedAt) return { stale: true };
  const folio = await findFolio(tx, hotelId, payment.folioId);
  const ref = { reservationId: folio.reservationId, folioId: folio.id };

  if (granted && folio.status === 'OPEN' && payment.status === 'POSTED' && !payment.voidedAt) {
    await reversePayment(tx, stage, {
      hotelId,
      payment,
      folio,
      reason: payment.voidReason ?? 'Onaylı iptal',
      businessDate,
      approvalId: approval.id,
      voidedBy: approval.decidedBy ?? currentActor(),
    });
    return { applied: true, folio: ref };
  }

  await tx.payment.update({
    where: { id: payment.id },
    data: { voidRequestedAt: null, voidRequestedBy: null, voidReason: null },
  });
  await recordAudit(tx, {
    hotelId,
    entity: 'Payment',
    entityId: payment.id,
    action: 'UPDATE',
    before: { voidPending: true },
    after: { voidPending: false, outcome: granted ? 'FOLIO_NOT_OPEN' : outcomeName, approvalId: approval.id },
  });
  if (granted) {
    // Kapanmış folyoya iptal kaydı düşmez (kapatma bekleyen iptal varken engelli; buraya yalnızca yarışla gelinir).
    await raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'FOLIO_ATTENTION',
      severity: 'WARNING',
      permission: PERMISSIONS.FOLIO_ADJUST,
      title: 'Onaylanan ödeme iptali uygulanamadı',
      body: `${approval.summary}: folyo kapalı. Folyoyu yeniden açıp iptali tekrar isteyin.`,
      link: `/folyolar/${folio.reservationId}?folyo=${folio.id}`,
      entityType: 'Payment',
      entityId: payment.id,
    });
  }
  await stage('payment.void_declined', {
    hotelId,
    folioId: folio.id,
    reservationId: folio.reservationId,
    paymentId: payment.id,
    approvalId: approval.id,
    outcome: granted ? 'FOLIO_CLOSED' : outcomeName,
  });
  return { applied: false, folio: ref };
}

/**
 * Ödeme satırının iptal kaydını işler (folyo kilitli, açık): ters tutar, aynı
 * kur ve yöntem; asıl satır "iptal edildi". Kasa etkisi asıl satırı alan kişinin
 * kasasına yazılır (para onun çekmecesindeydi).
 *
 * @param {any} tx
 * @param {any} stage
 * @param {{ hotelId: string, payment: any, folio: any, reason: string, businessDate: string, approvalId: string | null, voidedBy: string }} input
 */
async function reversePayment(tx, stage, { hotelId, payment, folio, reason, businessDate, approvalId, voidedBy }) {
  const now = new Date();
  const reversal = await tx.payment.create({
    data: {
      hotelId,
      folioId: folio.id,
      reservationId: payment.reservationId,
      kind: 'REVERSAL',
      status: 'POSTED',
      source: payment.source,
      method: payment.method,
      amount: toMoneyString(toDecimal(money(payment.amount)).negated()),
      currency: payment.currency,
      exchangeRate: payment.exchangeRate,
      folioAmount: toMoneyString(toDecimal(money(payment.folioAmount)).negated()),
      businessDate: dayStart(businessDate),
      reference: payment.reference,
      note: reason.slice(0, 200),
      sourceKey: `void:${payment.id}`,
      receivedBy: payment.receivedBy,
      receivedAt: now,
      postedAt: now,
      approvalId,
      reversalOfId: payment.id,
    },
    select: { id: true },
  });
  await tx.payment.update({
    where: { id: payment.id },
    data: { voidedAt: now, voidedBy, voidReason: reason, voidRequestedAt: null, voidRequestedBy: null },
  });
  await refreshFolioTotals(tx, [folio.id]);
  await recordAudit(tx, {
    hotelId,
    entity: 'Payment',
    entityId: payment.id,
    action: 'UPDATE',
    before: { voided: false },
    after: { voided: true, reversalId: reversal.id, approvalId, reason, voidedBy },
  });
  await stage('payment.voided', {
    hotelId,
    folioId: folio.id,
    reservationId: folio.reservationId,
    paymentId: payment.id,
    stayEnded: stayEnded(folio),
    reversalId: reversal.id,
    amount: toMoneyString(toDecimal(money(payment.folioAmount)).negated()),
    currency: folio.currency,
    approvalId,
  });
  return reversal.id;
}

/**
 * İsteyen personelin ziline sonuç (kişi bulunamazsa ödeme yetkilisine).
 * @param {string} hotelId
 * @param {{ id: string, type: string, requestedBy: string, note: string | null, summary: string }} approval
 * @param {string} outcome
 * @param {{ reservationId: string, folioId: string } | undefined} folio
 */
async function alertRequester(hotelId, approval, outcome, folio) {
  const staff = approval.requestedBy?.includes('@')
    ? await findActiveStaffByEmail(prismaUnfiltered, hotelId, approval.requestedBy.toLowerCase())
    : null;
  const label = APPROVAL_TYPE_LABELS[approval.type] ?? 'Onay';
  const titles = {
    GRANTED: `${label} onaylandı: ${approval.summary}`,
    FAILED: `${label} onaylandı ama uygulanamadı (folyo kapalı): ${approval.summary}`,
    'approval.denied': `${label} reddedildi: ${approval.summary}`,
    'approval.expired': `${label} onayının süresi doldu: ${approval.summary}`,
  };
  const pendingPayment = approval.type !== 'PAYMENT_VOID';
  const body =
    outcome === 'approval.denied'
      ? `Gerekçe: ${approval.note ?? '—'}${pendingPayment ? '. Ödeme işlenmedi; para alındıysa misafire geri verin ya da doğru tutarla yeniden girin.' : ''}`
      : outcome === 'approval.expired' && pendingPayment
        ? 'Ödeme işlenmedi. Gerekiyorsa yeniden girin.'
        : null;
  await writeWithEvents((tx, stage) =>
    raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'APPROVAL_DECIDED',
      severity: outcome === 'GRANTED' ? 'INFO' : 'WARNING',
      title: (titles[outcome] ?? approval.summary).slice(0, 200),
      body,
      link: folio ? `/folyolar/${folio.reservationId}?folyo=${folio.folioId}` : `/onaylar/gecmis?onay=${approval.id}`,
      userId: staff?.id ?? null,
      permission: staff ? null : PERMISSIONS.PAYMENT_RECEIVE,
      entityType: 'Approval',
      entityId: approval.id,
      dedupeKey: `approval-decided:${approval.id}`,
    }),
  );
}

/* ══════════════════ Giriş teminatı (aktör ve personel) ══════════════════ */

/**
 * Girişte alınan nakit / havale teminatını ödeme olarak işler (folyo yoksa
 * açılır). Kart provizyonu ödeme değildir. Anahtar konaklama + giriş anı: aynı
 * giriş için ikinci kez yazılmaz (aktör yeniden denese, personel düğmeye bassa
 * da); giriş geri alınıp yeniden yapılırsa yeni girişin teminatı ayrıca işlenir.
 * Eşik üstüyse onaya gider (isteyen girişi yapan kişi).
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @returns {Promise<{ skipped?: string, status?: string, amount?: string, currency?: string }>}
 */
export async function recordCheckInDeposit(hotelId, reservationId) {
  const [businessDate, hotel] = await Promise.all([businessDay(hotelId), getHotelSettings(hotelId)]);
  try {
    return await writeWithEvents(async (tx, stage) => {
      if (!(await lockReservations(tx, hotelId, [reservationId])).has(reservationId)) throw new NotFoundError('Konaklama bulunamadı');
      const stay = await tx.reservation.findFirst({
        where: { id: reservationId, hotelId },
        select: { status: true, checkedInAt: true, checkedInBy: true, depositMethod: true, depositAmount: true, depositReference: true },
      });
      if (stay?.status !== 'CHECKED_IN' || !stay.checkedInAt) return { skipped: 'Konaklama içeride değil (giriş geri alınmış)' };
      const method = DEPOSIT_PAYMENT_METHODS[stay.depositMethod ?? ''];
      if (!method || !stay.depositAmount) {
        return { skipped: stay.depositMethod === 'CARD_PREAUTH' ? 'Kart provizyonu ödeme değil' : 'Girişte teminat alınmamış' };
      }
      const sourceKey = depositKey(reservationId, stay.checkedInAt);
      if (await tx.payment.findFirst({ where: { hotelId, sourceKey }, select: { id: true } })) return { skipped: 'Teminat zaten işlenmiş' };

      const folioId = await stayPaymentFolio(tx, stage, { hotelId, reservationId, folioId: null, firstOpen: true });
      await lockFolios(tx, hotelId, [folioId]);
      const folio = await findFolio(tx, hotelId, folioId);
      const result = await writePayment(tx, stage, {
        hotelId,
        folio,
        kind: 'PAYMENT',
        source: 'CHECK_IN_DEPOSIT',
        input: { method, amount: money(stay.depositAmount), currency: folio.currency, reference: stay.depositReference ?? null, note: null },
        sourceKey,
        receivedBy: stay.checkedInBy ?? currentActor(),
        businessDate,
        hotel,
      });
      return { status: result.status, amount: money(stay.depositAmount), currency: folio.currency };
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Giriş teminatının tekrar işleme anahtarı.
 * @param {string} reservationId
 * @param {Date} checkedInAt
 */
const depositKey = (reservationId, checkedInAt) => `deposit:${reservationId}:${checkedInAt.getTime()}`;

/**
 * Yanlış giriş geri alındı: o girişin teminat ödemesi iptal kaydıyla düşer
 * (para misafire geri verilir ya da yeniden girişte tekrar girilir). Onay
 * bekleyen teminatın onayı geri çekilir. Geri almadan sonra yapılan yeni
 * girişin teminatına dokunulmaz (`occurredAt`).
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ reason: string, occurredAt: Date }} input
 * @returns {Promise<{ reversed: number, withdrawn: number }>}
 */
export async function reverseCheckInDeposits(hotelId, reservationId, { reason, occurredAt }) {
  const businessDate = await businessDay(hotelId);
  const actor = currentActor();
  const outcome = await writeWithEvents(async (tx, stage) => {
    await lockReservations(tx, hotelId, [reservationId]);
    const deposits = await tx.payment.findMany({
      where: {
        hotelId,
        reservationId,
        source: 'CHECK_IN_DEPOSIT',
        kind: 'PAYMENT',
        status: { in: ['POSTED', 'PENDING'] },
        voidedAt: null,
        receivedAt: { lt: occurredAt },
      },
      select: { ...PAYMENT_SELECT, hotelId: true },
    });
    if (deposits.length === 0) return { reversed: 0, withdraw: [] };
    await lockFolios(tx, hotelId, deposits.map((payment) => payment.folioId));
    let reversed = 0;
    const withdraw = [];
    for (const payment of deposits) {
      if (payment.status === 'PENDING') {
        if (payment.approvalId) withdraw.push(payment.approvalId);
        continue;
      }
      const folio = await findFolio(tx, hotelId, payment.folioId);
      if (folio.status === 'CLOSED') {
        await tx.folio.update({ where: { id: folio.id }, data: { status: 'OPEN', closedAt: null, closedBy: null } });
        await recordAudit(tx, { hotelId, entity: 'Folio', entityId: folio.id, action: 'UPDATE', before: { status: 'CLOSED' }, after: { status: 'OPEN', reason: 'Giriş geri alındı' } });
        await stage('folio.reopened', { hotelId, folioId: folio.id, reservationId: folio.reservationId, reason: 'Giriş geri alındı' });
      } else if (folio.status !== 'OPEN') {
        continue;
      }
      await reversePayment(tx, stage, {
        hotelId,
        payment,
        folio: { ...folio, status: 'OPEN' },
        reason: `Giriş geri alındı: ${reason}`,
        businessDate,
        approvalId: null,
        voidedBy: actor,
      });
      reversed += 1;
    }
    return { reversed, withdraw };
  });
  // Onay bekleyen teminatın isteği geri çekilir: karar dinleyicisi satırı "reddedildi" yapar.
  for (const approvalId of outcome.withdraw) {
    try {
      await decideApproval(hotelId, approvalId, 'DENIED', { note: `Giriş geri alındı: ${reason}`.slice(0, 500) });
    } catch (error) {
      // Bu arada karar verilmiş ya da süresi dolmuş: dinleyici zaten uyguladı.
      if (error?.code !== 'NOT_PENDING') throw error;
    }
  }
  return { reversed: outcome.reversed, withdrawn: outcome.withdraw.length };
}

/* ══════════════════ Okuma ══════════════════ */

/**
 * Folyonun ödemeleri (girildiği sırayla, imleçli) ve iade sınırı.
 * @param {string} hotelId
 * @param {string} folioId
 * @param {{ cursor?: string, limit: number }} query
 */
export async function listFolioPayments(hotelId, folioId, query) {
  const folio = await prisma.folio.findFirst({ where: { id: folioId, hotelId }, select: { id: true, currency: true } });
  if (!folio) throw new NotFoundError('Folyo bulunamadı');
  const cursor = parseCursor(query.cursor);
  const [rows, state] = await Promise.all([
    prisma.payment.findMany({
      where: { folioId, hotelId, ...(cursor ? newerThan('receivedAt', cursor) : {}) },
      select: PAYMENT_SELECT,
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
    }),
    folioPaymentState(prisma, hotelId, folioId),
  ]);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    payments: page.map(toPaymentDto),
    nextCursor: rows.length > query.limit && last ? encodeCursor({ at: last.receivedAt, id: last.id }) : null,
    currency: folio.currency,
    refundable: refundableAmount(state),
    pending: state.pending,
    pendingVoids: state.pendingVoids,
  };
}

/**
 * Konaklamanın onay bekleyen ödemeleri ve girişte alınan, henüz ödeme olarak
 * işlenmemiş teminat (folyo ekranı ve çıkış penceresi).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {{ id: string, status: string, checkedInAt: Date | null, depositMethod: string | null, depositAmount: unknown, depositReference: string | null }} stay
 */
export async function stayPaymentStatus(client, hotelId, stay) {
  const [pendingRows, depositRow] = await Promise.all([
    client.payment.groupBy({
      by: ['folioId', 'kind'],
      where: { hotelId, folio: { reservationId: stay.id }, status: 'PENDING' },
      _sum: { folioAmount: true },
      _count: { _all: true },
    }),
    stay.status === 'CHECKED_IN' && stay.checkedInAt && DEPOSIT_PAYMENT_METHODS[stay.depositMethod ?? '']
      ? client.payment.findFirst({ where: { hotelId, sourceKey: depositKey(stay.id, stay.checkedInAt) }, select: { id: true, status: true } })
      : Promise.resolve(undefined),
  ]);
  const pendingByFolio = new Map();
  let pendingPayments = toDecimal(0);
  let pendingRefunds = toDecimal(0);
  for (const row of pendingRows) {
    pendingByFolio.set(row.folioId, (pendingByFolio.get(row.folioId) ?? 0) + row._count._all);
    const sum = toDecimal(String(row._sum.folioAmount ?? 0));
    if (row.kind === 'REFUND') pendingRefunds = pendingRefunds.plus(sum);
    else pendingPayments = pendingPayments.plus(sum);
  }
  // Teminat yalnızca içerideki konaklamada anlamlı (çıkışta iade / provizyon hatırlatması).
  const inHouseDeposit = stay.status === 'CHECKED_IN' && stay.depositMethod && stay.depositMethod !== 'NONE';
  return {
    pendingByFolio,
    pendingPayments: toMoneyString(pendingPayments),
    pendingRefunds: toMoneyString(pendingRefunds),
    // `recorded`: kart provizyonunda `null` (ödeme değil); nakit / havalede işlenmediyse `false`, işlendiyse ödemenin durumu.
    deposit: !inHouseDeposit
      ? null
      : depositRow === undefined
        ? { method: stay.depositMethod, amount: money(stay.depositAmount), reference: stay.depositReference ?? null, recorded: null }
        : {
            method: stay.depositMethod,
            amount: money(stay.depositAmount),
            reference: stay.depositReference ?? null,
            recorded: depositRow ? depositRow.status : false,
          },
  };
}

/* ══════════════════ Kasa ══════════════════ */

/**
 * Kasa görünümü: günün işlenen hareketleri yöntem (ve döviz) bazında,
 * onay bekleyenler. Gün verilmezse iş günü. `mine`: yalnızca oturumdaki
 * kişinin aldıkları (kendi çekmecesi).
 *
 * @param {string} hotelId
 * @param {{ date?: string, mine: boolean }} query
 */
export async function getCashSummary(hotelId, query) {
  const [businessDate, hotel] = await Promise.all([businessDay(hotelId), getHotelSettings(hotelId)]);
  const date = query.date ?? businessDate;
  if (date > businessDate) throw new ValidationError('İleri tarihli kasa görüntülenmez.', { field: 'date' });
  const mine = query.mine ? currentActor() : null;
  const [rows, pendingRows, pendingCount] = await Promise.all([
    prisma.$queryRaw`
      SELECT p."method", p."currency", p."kind", COUNT(*)::int AS "count",
             SUM(p."amount")::text AS "amount", SUM(p."folioAmount")::text AS "folioAmount"
      FROM "Payment" p
      WHERE p."hotelId" = ${hotelId} AND p."businessDate" = ${date}::date AND p."status" = 'POSTED'
        AND p."deletedAt" IS NULL ${mine ? Prisma.sql`AND p."receivedBy" = ${mine}` : Prisma.empty}
      GROUP BY 1, 2, 3`,
    prisma.payment.findMany({
      where: { hotelId, status: 'PENDING', ...(mine ? { receivedBy: mine } : {}) },
      select: { ...PAYMENT_SELECT, reservation: { select: STAY_REF_SELECT } },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: CASH_PENDING_LIMIT,
    }),
    prisma.payment.count({ where: { hotelId, status: 'PENDING', ...(mine ? { receivedBy: mine } : {}) } }),
  ]);
  const summary = summarizeCash(rows, PAYMENT_METHODS);
  return {
    date,
    businessDate,
    isToday: date === businessDate,
    currency: hotel.currency,
    mine: Boolean(mine),
    ...summary,
    pending: {
      count: pendingCount,
      items: pendingRows.map((row) => ({ ...toPaymentDto(row), stay: stayRef(row.reservation) })),
    },
  };
}

/**
 * Kasa hareketleri: günün işlenen satırları (son işlenen önce), imleçli; yöntem,
 * tür ve "benim" süzgeciyle.
 * @param {string} hotelId
 * @param {{ date?: string, mine: boolean, method?: string, kind?: string, cursor?: string, limit: number }} query
 */
export async function listCashMovements(hotelId, query) {
  const businessDate = await businessDay(hotelId);
  const date = query.date ?? businessDate;
  const cursor = parseCursor(query.cursor);
  const rows = await prisma.payment.findMany({
    where: {
      hotelId,
      businessDate: dayStart(date),
      status: 'POSTED',
      ...(query.mine ? { receivedBy: currentActor() } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(cursor ? olderThan('postedAt', cursor) : {}),
    },
    select: { ...PAYMENT_SELECT, reservation: { select: STAY_REF_SELECT }, folio: { select: { window: true, payerName: true } } },
    orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
  });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    date,
    movements: page.map((row) => ({ ...toPaymentDto(row), stay: stayRef(row.reservation), folioName: folioDisplayName(row.folio) })),
    nextCursor: rows.length > query.limit && last?.postedAt ? encodeCursor({ at: last.postedAt, id: last.id }) : null,
  };
}
