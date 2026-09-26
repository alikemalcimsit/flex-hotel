import { addDays, currentActor, isZero, toDecimal, toIsoDay, toMoneyString, toUtcDayStart } from '@hotelos/core';
import {
  HOUSEKEEPING_STATUS_LABELS,
  PERMISSIONS,
  RESERVATION_COUNT_CAP,
  maskIdNumber,
  reservationActionError,
  utcToZonedWallTime,
} from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ConflictError, ForbiddenError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { LIVE_SCOPES, liveVersion } from '../../lib/live-version.js';
import { lockReservations, lockRooms, lockRoomTypes } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { createReadCache } from '../../lib/read-cache.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { guestFullName } from '../reservations/guests.js';
import { sameGuestName } from '../reservations/rules.js';
import { getReservation, reservationSearchConditions } from '../reservations/service.js';
import { assignRoomInTransaction, roomConflictForStay } from '../rooms/service.js';
import { getHotelSettings } from '../settings/service.js';
import { hasFolioActivity, stayBalances } from './folio.js';
import {
  amountDue,
  departurePlan,
  earlyCheckInCharge,
  hotelClock,
  hotelDayRange,
  identityShortfall,
  lateCheckOutCharge,
  priceAfterRelease,
  roomReadiness,
  sameAmount,
} from './rules.js';

/**
 * Ön büro: check-in / check-out (modül 6).
 *
 * ### Tek tık, ama güvenli
 *
 * Giriş ve çıkış tek işlemdir; kontroller aynı transaction'da, kilitler
 * modül 4'ün sırasıyla (rezervasyon → oda tipi → oda) alınır:
 * - **Giriş:** oda verilmemişse aynı işlemde verilir; odada hâlâ başka misafir
 *   varsa, oda arızalıysa ya da bu gecelerde başkasınaysa giriş olmaz; kirliyse
 *   personel onaylar. Kimlik (KBS) zorunlu, otel politikası isterse bütün
 *   yetişkinlerinki. Erken giriş ücreti otel saatine göre hesaplanır.
 * - **Çıkış:** tarihinden önce ayrılışta kalan geceler envantere ve fiyattan
 *   düşer (personel onayıyla). Geç çıkış ücreti hesaplanır. Folyo bakiyesi
 *   kapanmamışsa çıkış olmaz; yetkili gerekçeyle "bakiyeyle çıkış" yapabilir,
 *   yönetime uyarı düşer.
 *
 * Aynı konaklamaya aynı anda gelen iki giriş (iki resepsiyonist) rezervasyon
 * kilidinde sıraya girer; ikincisi "zaten giriş yapmış" alır. Aynı odaya iki
 * ayrı misafirin girişi oda kilidinde sıraya girer; ikincisi "odada misafir var" alır.
 *
 * ### Oda durumu
 *
 * Odanın doluluğunu bu servis yazmaz: `guest.checked_in` / `guest.checked_out`
 * (ve geri alma olayları) room-worker'a gider; doluluğun tek yazıcısı odur
 * (bkz. modül 3). Aktör kapalıysa iş manuel göreve düşer.
 *
 * ### Ücret ve bakiye
 *
 * Erken giriş / geç çıkış ücreti rezervasyona yazılır ve olay gövdesinde
 * taşınır; folyoya kalem olarak işlenmesi folyo modülünün (15) işidir. Bakiye
 * folyo tablolarından okunur (`folio.js`); konaklamanın folyosu yoksa bakiye
 * bilinmiyor demektir ve çıkış bunu açıkça söyler (sıfır saymaz).
 *
 * ### Geri alma
 *
 * Yanlış giriş ya da çıkış yalnızca aynı gün (otelin günü) geri alınır; sonra
 * yapılacak düzeltme rezervasyon düzenlemesiyle olur. Girişin geri alınması
 * folyoda hareket varsa engellenir.
 *
 * ### Kişisel veri
 *
 * Kimlik numarası listelerde ve denetim izinde maskelidir; tamamı yalnızca
 * giriş formunun önizlemesinde (giriş yetkisiyle) döner.
 */

/**
 * "Konaklama bu geceyi kapsıyor" — gün düzeyinde: giriş günü ≤ bugün < çıkış
 * günü. Tarihler saat taşıyabilir (veritabanı kısıtları da `date_trunc` ile gün
 * karşılaştırır; ör. demo verisi 11:00); gece yarısıyla doğrudan karşılaştırmak
 * bugün 11:00'de girecek misafiri "gelecek" saymaz, bugün 11:00'de çıkacak
 * olanı içeride sayardı. Gün sınırlarıyla yazılır: index'ten okunur.
 *
 * @param {Date} businessDate
 * @returns {[{ checkIn: { lt: Date } }, { checkOut: { gte: Date } }]}
 */
function stayCoversNight(businessDate) {
  const tomorrow = addDays(businessDate, 1);
  return [{ checkIn: { lt: tomorrow } }, { checkOut: { gte: tomorrow } }];
}

/** Özet sayılar önbelleği (sekme rozetleri sık sorar). */
const SUMMARY_TTL_MS = 10_000;
const summaryCache = createReadCache({ ttlMs: SUMMARY_TTL_MS, maxEntries: 2000 });

const NOT_READY_STATUSES = new Set(['DIRTY', 'CLEANING']);

const STAY_SELECT = Object.freeze({
  id: true,
  hotelId: true,
  confirmationCode: true,
  status: true,
  guestId: true,
  roomTypeId: true,
  roomId: true,
  roomSince: true,
  checkIn: true,
  checkOut: true,
  adults: true,
  children: true,
  boardType: true,
  totalPrice: true,
  currency: true,
  priceMode: true,
  notes: true,
  confirmedAt: true,
  checkedInAt: true,
  checkedInBy: true,
  checkedOutAt: true,
  checkedOutBy: true,
  earlyCheckInFee: true,
  lateCheckOutFee: true,
  vehiclePlate: true,
  depositMethod: true,
  depositAmount: true,
  depositReference: true,
  checkoutOpenBalance: true,
  openBalanceReason: true,
  updatedAt: true,
  guest: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      nationality: true,
      idType: true,
      idNumber: true,
      birthDate: true,
    },
  },
  roomType: { select: { id: true, code: true, name: true } },
  room: { select: { id: true, number: true, housekeepingStatus: true } },
  group: { select: { id: true, code: true, name: true } },
  _count: { select: { reservationGuests: { where: { isPrimary: false } } } },
});

const NIGHTS = Object.freeze({ select: { date: true, amount: true }, orderBy: { date: 'asc' } });

/** Prisma Decimal → "1234.50". */
const money = (value) => (value === null || value === undefined ? null : toMoneyString(String(value)));
const iso = (value) => (value ? value.toISOString() : null);
/** @param {Date | string} value */
const dotted = (value) => {
  const [year, month, day] = toIsoDay(value).split('-');
  return `${day}.${month}.${year}`;
};
/** @param {string} amount @param {string} currency */
const priced = (amount, currency) => `${toDecimal(amount).abs().toFixed(2)} ${currency}`;

const hasIdentity = (guest) => Boolean(guest?.idType && guest?.idNumber && guest?.nationality);

/* ══════════════════ Ortak ══════════════════ */

/**
 * Otel ayarı, iş günü ve otelin saati.
 * @param {string} hotelId
 * @param {Date} now
 */
async function loadClock(hotelId, now) {
  const [hotel, businessDate] = await Promise.all([getHotelSettings(hotelId), getBusinessDate(hotelId, now)]);
  return { hotel, businessDate, clock: hotelClock(hotel.timezone, now) };
}

/** @param {{ earlyCheckInFeeMode: string, earlyCheckInFeeValue: string }} hotel */
const earlyPolicy = (hotel) => ({ mode: hotel.earlyCheckInFeeMode, value: hotel.earlyCheckInFeeValue });
/** @param {{ lateCheckOutFeeMode: string, lateCheckOutFeeValue: string }} hotel */
const latePolicy = (hotel) => ({ mode: hotel.lateCheckOutFeeMode, value: hotel.lateCheckOutFeeValue });

/**
 * Rezervasyonu kilitler, sürümünü denetler ve gecelerle okur.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {Date | undefined} expectedUpdatedAt
 */
async function lockStay(tx, hotelId, reservationId, expectedUpdatedAt) {
  if (!(await lockReservations(tx, hotelId, [reservationId])).has(reservationId)) {
    throw new NotFoundError('Rezervasyon bulunamadı');
  }
  const row = await readStay(tx, hotelId, reservationId);
  if (expectedUpdatedAt && row.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
  return row;
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {string} reservationId
 */
async function readStay(client, hotelId, reservationId) {
  const row = await client.reservation.findFirst({
    where: { id: reservationId, hotelId },
    select: { ...STAY_SELECT, nights: NIGHTS },
  });
  if (!row) throw new NotFoundError('Rezervasyon bulunamadı');
  return row;
}

/**
 * @param {'checkIn' | 'checkOut'} action
 * @param {object} row
 * @param {Date} businessDate
 */
function assertStayAction(action, row, businessDate) {
  const reason = reservationActionError(action, row, businessDate);
  if (reason) throw new ConflictError(reason, 'INVALID_STATUS', { status: row.status });
}

/** @param {Array<{ date: Date, amount: unknown }>} nights */
const nightRows = (nights) => nights.map((night) => ({ date: toIsoDay(night.date), amount: money(night.amount) }));

/** Olay gövdesi: kimlik ve envanter etkisi. */
const stayPayload = (row) => ({
  hotelId: row.hotelId,
  reservationId: row.id,
  roomTypeId: row.roomTypeId,
  checkIn: row.checkIn,
  checkOut: row.checkOut,
});

/**
 * Denetim izine yazılan alanlar. Kimlik numarası maskelidir (KVKK); teminat
 * referansı yazılır (kart numarası şemada reddedilir).
 */
function stayAudit(row) {
  return {
    status: row.status,
    roomId: row.roomId,
    checkIn: toIsoDay(row.checkIn),
    checkOut: toIsoDay(row.checkOut),
    totalPrice: money(row.totalPrice),
    checkedInAt: iso(row.checkedInAt),
    checkedOutAt: iso(row.checkedOutAt),
    earlyCheckInFee: money(row.earlyCheckInFee),
    lateCheckOutFee: money(row.lateCheckOutFee),
    vehiclePlate: row.vehiclePlate ?? null,
    depositMethod: row.depositMethod ?? null,
    depositAmount: money(row.depositAmount),
    depositReference: row.depositReference ?? null,
    checkoutOpenBalance: money(row.checkoutOpenBalance),
    openBalanceReason: row.openBalanceReason ?? null,
  };
}

/**
 * Oda odada başka misafir var mı (girişi yapılmış, çıkışı yapılmamış)?
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} roomId
 * @param {string} reservationId hariç tutulan (kendisi)
 */
function findOccupant(tx, hotelId, roomId, reservationId) {
  return tx.reservation.findFirst({
    where: { hotelId, roomId, status: 'CHECKED_IN', id: { not: reservationId } },
    select: { id: true, confirmationCode: true, guest: { select: { firstName: true, lastName: true } } },
  });
}

/**
 * @param {{ number: string }} room
 * @param {{ confirmationCode: string, guest: { firstName: string, lastName: string } }} occupant
 * @param {string} advice
 */
function occupiedError(room, occupant, advice) {
  return new ConflictError(
    `${room.number} numaralı odada ${guestFullName(occupant.guest)} (${occupant.confirmationCode}) hâlâ içeride. ${advice}`,
    'ROOM_OCCUPIED',
    { confirmationCode: occupant.confirmationCode },
  );
}

/**
 * Oda girişe uygun mu (çağıranın transaction'ında, oda kilitli)?
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {object} stay
 * @param {{ businessDate: Date, acceptRoomNotReady: boolean }} options
 */
async function assertRoomForCheckIn(tx, hotelId, stay, { businessDate, acceptRoomNotReady }) {
  await lockRooms(tx, hotelId, [stay.roomId]);
  const room = await tx.room.findFirst({ where: { id: stay.roomId, hotelId }, select: { id: true, number: true, housekeepingStatus: true } });
  if (!room) throw new NotFoundError('Oda bulunamadı');

  const occupant = await findOccupant(tx, hotelId, room.id, stay.id);
  if (occupant) throw occupiedError(room, occupant, 'Önce onun çıkışını yapın ya da misafire başka oda verin.');

  // Arıza / hizmet dışı kaydı, başka rezervasyon, kapasite: kalan geceler için.
  const stayFrom = new Date(Math.max(toUtcDayStart(stay.checkIn), businessDate.getTime()));
  const conflict = await roomConflictForStay(tx, hotelId, room.id, stay, { stayFrom });
  if (conflict) throw conflict;

  if (NOT_READY_STATUSES.has(room.housekeepingStatus) && !acceptRoomNotReady) {
    const label = (HOUSEKEEPING_STATUS_LABELS[room.housekeepingStatus] ?? room.housekeepingStatus).toLocaleLowerCase('tr');
    throw new ConflictError(
      `${room.number} numaralı oda henüz hazır değil (${label}). Kat hizmetleri bitmeden giriş yapılacaksa onaylayın ya da başka oda verin.`,
      'ROOM_NOT_READY',
      { housekeepingStatus: room.housekeepingStatus, roomNumber: room.number },
    );
  }
  return room;
}

/**
 * Refakatçileri yazar. Belge numarasıyla kayıtlı misafir varsa (ve adı
 * tutuyorsa) o kart kullanılır; tutmuyorsa numara yanlış yazılmış olabilir,
 * personele söylenir. Konaklamanın eski refakatçi bağlantıları (geri alınıp
 * yeniden yapılan giriş) yenileriyle değişir.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {object} stay
 * @param {Array<object>} companions
 */
async function saveCompanions(tx, hotelId, stay, companions) {
  await tx.reservationGuest.deleteMany({ where: { hotelId, reservationId: stay.id } });
  await tx.reservationGuest.create({ data: { hotelId, reservationId: stay.id, guestId: stay.guestId, isPrimary: true } });
  if (companions.length === 0) return;

  const numbers = companions.map((companion) => companion.idNumber).filter(Boolean);
  const duplicate = numbers.find((number, index) => numbers.indexOf(number) !== index);
  if (duplicate) {
    throw new ValidationError(`${maskIdNumber(duplicate)} numaralı belge iki kez girilmiş`, { field: 'companions' });
  }
  const known = numbers.length
    ? await tx.guest.findMany({
        where: { hotelId, idNumber: { in: numbers }, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, idNumber: true, nationality: true },
        orderBy: { createdAt: 'asc' },
      })
    : [];

  const guestIds = [];
  for (const [index, companion] of companions.entries()) {
    const identity = {
      idType: companion.idType ?? null,
      idNumber: companion.idNumber ?? null,
      nationality: companion.nationality ?? null,
      // Boş bırakılan doğum tarihi kayıtlı olanı silmez.
      ...(companion.birthDate ? { birthDate: companion.birthDate } : {}),
    };
    const match = companion.idNumber
      ? known.find((guest) => guest.idNumber === companion.idNumber && (!guest.nationality || guest.nationality === companion.nationality))
      : null;
    if (match) {
      if (match.id === stay.guestId) {
        throw new ValidationError('Refakatçi, rezervasyon sahibiyle aynı kişi olamaz (aynı belge numarası)', { field: `companions.${index}.idNumber` });
      }
      if (!sameGuestName(match, companion)) {
        throw new ConflictError(
          `${maskIdNumber(companion.idNumber)} numaralı belge ${guestFullName(match)} adına kayıtlı; ` +
            `${guestFullName(companion)} ile eşleşmiyor. Numarayı kontrol edin.`,
          'COMPANION_ID_MISMATCH',
          { index },
        );
      }
      await tx.guest.update({ where: { id: match.id }, data: identity });
      guestIds.push(match.id);
    } else {
      const created = await tx.guest.create({
        data: { hotelId, firstName: companion.firstName, lastName: companion.lastName, ...identity },
        select: { id: true },
      });
      guestIds.push(created.id);
    }
  }
  await tx.reservationGuest.createMany({
    data: guestIds.map((guestId) => ({ hotelId, reservationId: stay.id, guestId, isPrimary: false })),
    skipDuplicates: true,
  });
}

/* ══════════════════ Giriş ══════════════════ */

/**
 * Giriş formunun önizlemesi: misafirin kimliği (tam), refakatçiler, odanın
 * hazırlığı, erken giriş ücreti, yapılamıyorsa sebebi.
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ now?: Date }} [options]
 */
export async function getCheckInPreview(hotelId, reservationId, { now = new Date() } = {}) {
  const { hotel, businessDate, clock } = await loadClock(hotelId, now);
  const stay = await prisma.reservation.findFirst({
    where: { id: reservationId, hotelId },
    select: {
      ...STAY_SELECT,
      nights: { ...NIGHTS, take: 1 },
      reservationGuests: {
        where: { isPrimary: false },
        orderBy: { createdAt: 'asc' },
        select: {
          guest: {
            select: { id: true, firstName: true, lastName: true, idType: true, idNumber: true, nationality: true, birthDate: true },
          },
        },
      },
    },
  });
  if (!stay) throw new NotFoundError('Rezervasyon bulunamadı');

  const [roomState] = stay.room ? await roomStates(hotelId, [stay], businessDate) : [null];
  const early = earlyCheckInCharge({
    policy: earlyPolicy(hotel),
    checkInTime: hotel.checkInTime,
    clock,
    arrivalDay: toIsoDay(stay.checkIn),
    firstNightAmount: money(stay.nights[0]?.amount),
  });

  return {
    reservation: stayRow(stay, { businessDate, clock, timezone: hotel.timezone }),
    blocker: reservationActionError('checkIn', stay, businessDate),
    guest: {
      id: stay.guest.id,
      firstName: stay.guest.firstName,
      lastName: stay.guest.lastName,
      phone: stay.guest.phone,
      email: stay.guest.email,
      idType: stay.guest.idType,
      idNumber: stay.guest.idNumber,
      nationality: stay.guest.nationality,
      birthDate: stay.guest.birthDate ? toIsoDay(stay.guest.birthDate) : null,
    },
    companions: stay.reservationGuests.map(({ guest }) => ({
      firstName: guest.firstName,
      lastName: guest.lastName,
      idType: guest.idType,
      idNumber: guest.idNumber,
      nationality: guest.nationality,
      birthDate: guest.birthDate ? toIsoDay(guest.birthDate) : null,
    })),
    room: roomState,
    identityPolicy: hotel.checkInIdentityPolicy,
    earlyCheckIn: { ...early, mode: hotel.earlyCheckInFeeMode, checkInTime: hotel.checkInTime },
    currency: stay.currency,
    businessDate: toIsoDay(businessDate),
  };
}

/**
 * Check-in.
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {object} input `checkInSchema` çıktısı
 * @param {{ now?: Date }} [options] `now`: test ve yeniden oynatma için
 */
export async function checkIn(hotelId, reservationId, input, { now = new Date() } = {}) {
  const { hotel, businessDate, clock } = await loadClock(hotelId, now);
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      let stay = await lockStay(tx, hotelId, reservationId, input.expectedUpdatedAt);
      assertStayAction('checkIn', stay, businessDate);

      const shortfall = identityShortfall({
        policy: hotel.checkInIdentityPolicy,
        adults: stay.adults,
        children: stay.children,
        companions: input.companions,
      });
      if (shortfall) throw new ValidationError(shortfall, { field: 'companions' });

      if (input.roomId && input.roomId !== stay.roomId) {
        await assignRoomInTransaction(tx, stage, hotelId, stay.id, input.roomId, { businessDate, reason: 'Girişte oda verildi' });
        stay = await readStay(tx, hotelId, stay.id);
      }
      if (!stay.roomId) {
        throw new ValidationError('Misafire henüz oda verilmemiş; girişten önce oda seçin.', { field: 'roomId' });
      }
      await assertRoomForCheckIn(tx, hotelId, stay, { businessDate, acceptRoomNotReady: input.acceptRoomNotReady });

      const early = earlyCheckInCharge({
        policy: earlyPolicy(hotel),
        checkInTime: hotel.checkInTime,
        clock,
        arrivalDay: toIsoDay(stay.checkIn),
        firstNightAmount: money(stay.nights[0]?.amount),
      });
      const fee = early.fee && !input.waiveEarlyFee ? early.fee : null;
      if (fee && !sameAmount(fee, input.expectedEarlyFee)) {
        throw new ConflictError(
          `Erken giriş ücreti ${priced(fee, stay.currency)}. Tutarı gördükten sonra yeniden onaylayın ya da ücreti uygulamayın.`,
          'FEE_CHANGED',
          { earlyCheckInFee: fee },
        );
      }

      const { guest } = input;
      await tx.guest.update({
        where: { id: stay.guestId },
        data: { idType: guest.idType, idNumber: guest.idNumber, nationality: guest.nationality, birthDate: guest.birthDate ?? undefined },
      });
      await saveCompanions(tx, hotelId, stay, input.companions);

      const deposit = input.deposit.method === 'NONE' ? null : input.deposit;
      const updated = await tx.reservation.update({
        where: { id: stay.id },
        data: {
          status: 'CHECKED_IN',
          checkedInAt: now,
          checkedInBy: actor,
          confirmedAt: stay.confirmedAt ?? now,
          earlyCheckInFee: fee,
          vehiclePlate: input.vehiclePlate ?? null,
          depositMethod: deposit?.method ?? null,
          depositAmount: deposit ? toMoneyString(deposit.amount) : null,
          depositReference: deposit?.reference ?? null,
        },
        select: STAY_SELECT,
      });

      await recordAudit(tx, {
        hotelId,
        entity: 'Reservation',
        entityId: stay.id,
        action: 'UPDATE',
        before: stayAudit(stay),
        after: {
          ...stayAudit(updated),
          earlyCheckInPolicyFee: early.fee,
          earlyFeeWaived: Boolean(early.fee && input.waiveEarlyFee),
          roomNotReadyAccepted: input.acceptRoomNotReady,
          guestIdentity: { idType: guest.idType, idNumber: maskIdNumber(guest.idNumber), nationality: guest.nationality },
          companions: input.companions.length,
        },
      });
      await stage('guest.checked_in', {
        ...stayPayload(updated),
        roomId: updated.roomId,
        guestId: updated.guestId,
        earlyCheckInFee: fee,
        deposit: deposit
          ? { method: deposit.method, amount: toMoneyString(deposit.amount), reference: deposit.reference ?? null }
          : null,
      });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getReservation(hotelId, reservationId);
}

/* ══════════════════ Çıkış ══════════════════ */

/**
 * Çıkış formunun önizlemesi: erken ayrılışın etkisi, geç çıkış ücreti, folyo
 * bakiyesi, alınan teminat (iade hatırlatması), yapılamıyorsa sebebi.
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ now?: Date }} [options]
 */
export async function getCheckOutPreview(hotelId, reservationId, { now = new Date() } = {}) {
  const { hotel, businessDate, clock } = await loadClock(hotelId, now);
  const stay = await readStay(prisma, hotelId, reservationId);
  const nights = nightRows(stay.nights);
  const plan = departurePlan({ checkIn: stay.checkIn, checkOut: stay.checkOut, businessDate });
  const price = priceAfterRelease(nights, plan.releasedNights);
  const late =
    plan.kind === 'ON_TIME'
      ? lateCheckOutCharge({
          policy: latePolicy(hotel),
          checkOutTime: hotel.checkOutTime,
          clock,
          departureDay: toIsoDay(stay.checkOut),
          lastNightAmount: nights.at(-1)?.amount ?? null,
        })
      : { applies: false, fee: null };
  const folio = (await stayBalances(prisma, hotelId, [stay.id])).get(stay.id) ?? null;

  return {
    reservation: stayRow(stay, { businessDate, clock, timezone: hotel.timezone }),
    blocker: reservationActionError('checkOut', stay, businessDate),
    departure: {
      kind: plan.kind,
      plannedCheckOut: toIsoDay(stay.checkOut),
      checkOut: toIsoDay(plan.checkOut),
      releasedNights: plan.releasedNights,
      overdueDays: plan.overdueDays,
      totalPrice: price.total,
      releasedAmount: price.released,
    },
    lateCheckOut: { ...late, mode: hotel.lateCheckOutFeeMode, checkOutTime: hotel.checkOutTime },
    folio,
    // Geç çıkış ücreti uygulanırsa ödenecek (personel ücreti kaldırırsa ekran düşer).
    due: amountDue(folio, [late.fee]),
    deposit: stay.depositMethod
      ? { method: stay.depositMethod, amount: money(stay.depositAmount), reference: stay.depositReference }
      : null,
    currency: stay.currency,
    businessDate: toIsoDay(businessDate),
  };
}

/**
 * Check-out.
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {object} input `checkOutSchema` çıktısı
 * @param {{ now?: Date, canAllowOpenBalance?: boolean }} [options]
 *   `canAllowOpenBalance`: isteği yapanın `stays.checkout_open_balance` izni var (route denetler)
 */
export async function checkOut(hotelId, reservationId, input, { now = new Date(), canAllowOpenBalance = false } = {}) {
  const { hotel, businessDate, clock } = await loadClock(hotelId, now);
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      const stay = await lockStay(tx, hotelId, reservationId, input.expectedUpdatedAt);
      assertStayAction('checkOut', stay, businessDate);
      if (!stay.roomId) {
        throw new ConflictError('Konaklamanın odası kayıtlı değil; önce oda planından odayı işaretleyin.', 'ROOM_REQUIRED');
      }

      const nights = nightRows(stay.nights);
      const plan = departurePlan({ checkIn: stay.checkIn, checkOut: stay.checkOut, businessDate });
      const early = plan.kind === 'EARLY';
      const price = priceAfterRelease(nights, plan.releasedNights);
      if (early && !input.confirmEarlyDeparture) {
        throw new ConflictError(
          `Misafir ${dotted(stay.checkOut)} yerine ${dotted(businessDate)} ayrılıyor: ${plan.releasedNights.length} gece ` +
            `bırakılır, konaklama tutarı ${priced(price.total, stay.currency)} olur. Onaylayıp tekrar deneyin.`,
          'EARLY_DEPARTURE',
          { checkOut: toIsoDay(plan.checkOut), releasedNights: plan.releasedNights, totalPrice: price.total, releasedAmount: price.released },
        );
      }

      const kept = early ? nights.filter((night) => !plan.releasedNights.includes(night.date)) : nights;
      const late =
        plan.kind === 'ON_TIME'
          ? lateCheckOutCharge({
              policy: latePolicy(hotel),
              checkOutTime: hotel.checkOutTime,
              clock,
              departureDay: toIsoDay(stay.checkOut),
              lastNightAmount: kept.at(-1)?.amount ?? null,
            })
          : { applies: false, fee: null };
      const lateFee = late.fee && !input.waiveLateFee ? late.fee : null;
      if (lateFee && !sameAmount(lateFee, input.expectedLateFee)) {
        throw new ConflictError(
          `Geç çıkış ücreti ${priced(lateFee, stay.currency)} oldu (çıkış saati ${hotel.checkOutTime} geçti). Tutarı gördükten sonra yeniden onaylayın ya da ücreti uygulamayın.`,
          'FEE_CHANGED',
          { lateCheckOutFee: lateFee },
        );
      }

      const folio = (await stayBalances(tx, hotelId, [stay.id])).get(stay.id) ?? null;
      const due = amountDue(folio, [lateFee]);
      let openBalance = null;
      if (due !== null && !isZero(due)) {
        if (!input.allowOpenBalance) {
          const owes = toDecimal(due).isPositive();
          throw new ConflictError(
            owes
              ? `Folyoda ${priced(due, stay.currency)} ödenmemiş bakiye var. Tahsil edip tekrar deneyin ya da yetkiliyle bakiyeyle çıkış yapın.`
              : `Misafire ${priced(due, stay.currency)} iade edilecek. İadeyi yapıp tekrar deneyin ya da yetkiliyle bakiyeyle çıkış yapın.`,
            'BALANCE_DUE',
            { due, balance: folio.balance },
          );
        }
        if (!canAllowOpenBalance) throw new ForbiddenError('Bakiyesi kapanmadan çıkış yapma yetkiniz yok', { permission: PERMISSIONS.STAYS_OPEN_BALANCE });
        openBalance = due;
      }

      if (early) {
        // Bırakılan geceler: envanter oda tipi kilidiyle döner, fiyattan düşer.
        await lockRoomTypes(tx, hotelId, [stay.roomTypeId]);
        await tx.reservationNight.deleteMany({ where: { hotelId, reservationId: stay.id, date: { gte: plan.checkOut } } });
      }
      const updated = await tx.reservation.update({
        where: { id: stay.id },
        data: {
          status: 'CHECKED_OUT',
          checkedOutAt: now,
          checkedOutBy: actor,
          lateCheckOutFee: lateFee,
          checkoutOpenBalance: openBalance,
          openBalanceReason: openBalance ? input.openBalanceReason : null,
          ...(early ? { checkOut: plan.checkOut, totalPrice: price.total } : {}),
        },
        select: STAY_SELECT,
      });

      await recordAudit(tx, {
        hotelId,
        entity: 'Reservation',
        entityId: stay.id,
        action: 'UPDATE',
        before: stayAudit(stay),
        after: {
          ...stayAudit(updated),
          departure: plan.kind,
          releasedNights: plan.releasedNights,
          overdueDays: plan.overdueDays,
          lateCheckOutPolicyFee: late.fee,
          lateFeeWaived: Boolean(late.fee && input.waiveLateFee),
          folioBalance: folio?.balance ?? null,
        },
      });
      await stage('guest.checked_out', {
        ...stayPayload(updated),
        roomId: updated.roomId,
        guestId: updated.guestId,
        lateCheckOutFee: lateFee,
        earlyDeparture: early,
        openBalance,
      });

      if (openBalance) {
        const owes = toDecimal(openBalance).isPositive();
        await raiseStaffAlert(tx, stage, {
          hotelId,
          kind: 'CHECKOUT_OPEN_BALANCE',
          severity: 'WARNING',
          permission: PERMISSIONS.STAYS_OPEN_BALANCE,
          title: `${updated.room?.number ?? '—'} · ${guestFullName(updated.guest)}: bakiyeyle çıkış`,
          body: `${owes ? 'Tahsil edilecek' : 'İade edilecek'} ${priced(openBalance, updated.currency)} — ${input.openBalanceReason} (${actor})`,
          link: `/rezervasyonlar/${updated.id}`,
          entityType: 'Reservation',
          entityId: updated.id,
        });
      }
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getReservation(hotelId, reservationId);
}

/* ══════════════════ Geri alma ══════════════════ */

/**
 * Yanlış girişi geri alır (aynı gün, folyoda hareket yoksa). Rezervasyon
 * onaylıya döner; oda aynı kalır (yeniden giriş aynı odaya yapılabilir),
 * room-worker odayı boş yapar. Kimlik bilgisi misafir kartında kalır.
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ expectedUpdatedAt: Date, reason: string }} input
 * @param {{ now?: Date }} [options]
 */
export async function revertCheckIn(hotelId, reservationId, input, { now = new Date() } = {}) {
  const { hotel, clock } = await loadClock(hotelId, now);
  try {
    await writeWithEvents(async (tx, stage) => {
      const stay = await lockStay(tx, hotelId, reservationId, input.expectedUpdatedAt);
      if (stay.status !== 'CHECKED_IN') {
        throw new ConflictError('Yalnızca içerideki misafirin girişi geri alınır', 'INVALID_STATUS', { status: stay.status });
      }
      if (hotelClock(hotel.timezone, stay.checkedInAt).day !== clock.day) {
        throw new ConflictError(
          'Yalnızca bugün yapılan giriş geri alınır. Sonraki düzeltmeler çıkış ya da rezervasyon düzenlemesiyle yapılır.',
          'REVERT_WINDOW_CLOSED',
        );
      }
      if (await hasFolioActivity(tx, hotelId, stay.id)) {
        throw new ConflictError(
          'Folyoya kalem ya da ödeme işlenmiş; giriş geri alınamaz. Önce folyodaki hareketleri düzeltin.',
          'FOLIO_ACTIVITY',
        );
      }

      const updated = await tx.reservation.update({
        where: { id: stay.id },
        data: {
          status: 'CONFIRMED',
          checkedInAt: null,
          checkedInBy: null,
          earlyCheckInFee: null,
          depositMethod: null,
          depositAmount: null,
          depositReference: null,
        },
        select: STAY_SELECT,
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'Reservation',
        entityId: stay.id,
        action: 'UPDATE',
        before: stayAudit(stay),
        after: { ...stayAudit(updated), revertedCheckIn: true, reason: input.reason },
      });
      await stage('guest.check_in_reverted', { ...stayPayload(updated), roomId: stay.roomId, reason: input.reason });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getReservation(hotelId, reservationId);
}

/**
 * Yanlış çıkışı geri alır (aynı gün): misafir yine içeride. Oda bu arada
 * başka misafire girişle verildiyse geri alınamaz. Erken ayrılışta bırakılan
 * geceler geri gelmez: misafir kalacaksa konaklama düzenlemeyle uzatılır
 * (yeni geceler güncel fiyatla, kapasite denetimiyle).
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ expectedUpdatedAt: Date, reason: string }} input
 * @param {{ now?: Date }} [options]
 */
export async function revertCheckOut(hotelId, reservationId, input, { now = new Date() } = {}) {
  const { hotel, businessDate, clock } = await loadClock(hotelId, now);
  try {
    await writeWithEvents(async (tx, stage) => {
      const stay = await lockStay(tx, hotelId, reservationId, input.expectedUpdatedAt);
      if (stay.status !== 'CHECKED_OUT') {
        throw new ConflictError('Yalnızca çıkış yapmış misafirin çıkışı geri alınır', 'INVALID_STATUS', { status: stay.status });
      }
      if (hotelClock(hotel.timezone, stay.checkedOutAt).day !== clock.day) {
        throw new ConflictError('Yalnızca bugün yapılan çıkış geri alınır.', 'REVERT_WINDOW_CLOSED');
      }

      if (!stay.roomId) {
        throw new ConflictError('Konaklamanın odası kayıtlı değil; çıkış geri alınamaz.', 'ROOM_REQUIRED');
      }
      await lockRoomTypes(tx, hotelId, [stay.roomTypeId]);
      await lockRooms(tx, hotelId, [stay.roomId]);
      const occupant = await findOccupant(tx, hotelId, stay.roomId, stay.id);
      if (occupant) {
        throw occupiedError(stay.room, occupant, 'Çıkış geri alınamaz; misafiri başka odaya almak için yeni rezervasyon ya da oda değişikliği gerekir.');
      }
      if (toUtcDayStart(stay.checkOut) > businessDate.getTime()) {
        const conflict = await roomConflictForStay(tx, hotelId, stay.roomId, { ...stay, status: 'CHECKED_IN' }, { stayFrom: businessDate });
        if (conflict) throw conflict;
      }

      const updated = await tx.reservation.update({
        where: { id: stay.id },
        data: {
          status: 'CHECKED_IN',
          checkedOutAt: null,
          checkedOutBy: null,
          lateCheckOutFee: null,
          checkoutOpenBalance: null,
          openBalanceReason: null,
        },
        select: STAY_SELECT,
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'Reservation',
        entityId: stay.id,
        action: 'UPDATE',
        before: stayAudit(stay),
        after: { ...stayAudit(updated), revertedCheckOut: true, reason: input.reason },
      });
      await stage('guest.check_out_reverted', { ...stayPayload(updated), roomId: stay.roomId, reason: input.reason });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getReservation(hotelId, reservationId);
}

/* ══════════════════ Listeler ══════════════════ */

/**
 * Liste satırı. Kimlik numarası maskeli.
 * @param {object} row `STAY_SELECT`
 * @param {{ businessDate: Date, clock: { day: string }, timezone: string }} context
 */
function stayRow(row, { businessDate, clock, timezone }) {
  const today = businessDate.getTime();
  const checkIn = toUtcDayStart(row.checkIn);
  const checkOut = toUtcDayStart(row.checkOut);
  const sameDay = (instant) => Boolean(instant) && hotelClock(timezone, instant).day === clock.day;
  /** Otelin saatiyle "14:32" (ekran tarayıcının diliminde değil otelinkinde gösterir). */
  const wallTime = (instant) => (instant ? utcToZonedWallTime(instant, timezone).slice(11, 16) : null);
  return {
    id: row.id,
    confirmationCode: row.confirmationCode,
    status: row.status,
    updatedAt: iso(row.updatedAt),
    guest: {
      id: row.guest.id,
      name: guestFullName(row.guest),
      phone: row.guest.phone,
      nationality: row.guest.nationality,
      hasIdentity: hasIdentity(row.guest),
      idMasked: maskIdNumber(row.guest.idNumber),
    },
    roomType: { code: row.roomType.code, name: row.roomType.name },
    room: row.room ? { id: row.room.id, number: row.room.number, housekeepingStatus: row.room.housekeepingStatus } : null,
    checkIn: toIsoDay(row.checkIn),
    checkOut: toIsoDay(row.checkOut),
    nights: Math.round((checkOut - checkIn) / 86_400_000),
    adults: row.adults,
    children: row.children,
    companions: row._count?.reservationGuests ?? 0,
    boardType: row.boardType,
    totalPrice: money(row.totalPrice),
    currency: row.currency,
    notes: row.notes,
    group: row.group ? { code: row.group.code, name: row.group.name } : null,
    checkedInAt: iso(row.checkedInAt),
    checkedInTime: wallTime(row.checkedInAt),
    checkedInBy: row.checkedInBy,
    checkedOutAt: iso(row.checkedOutAt),
    checkedOutTime: wallTime(row.checkedOutAt),
    checkedOutBy: row.checkedOutBy,
    earlyCheckInFee: money(row.earlyCheckInFee),
    lateCheckOutFee: money(row.lateCheckOutFee),
    vehiclePlate: row.vehiclePlate,
    depositMethod: row.depositMethod,
    depositAmount: money(row.depositAmount),
    checkoutOpenBalance: money(row.checkoutOpenBalance),
    /** Giriş günü geçmiş, hâlâ bekleniyor (geç gelen). */
    lateArrival: ['PENDING', 'CONFIRMED'].includes(row.status) && checkIn < today,
    /** Çıkış günü geçmiş, hâlâ içeride (çıkış yapılmamış). */
    overdue: row.status === 'CHECKED_IN' && checkOut < today,
    departsToday: checkOut === today,
    canRevertCheckIn: row.status === 'CHECKED_IN' && sameDay(row.checkedInAt),
    canRevertCheckOut: row.status === 'CHECKED_OUT' && sameDay(row.checkedOutAt),
  };
}

/**
 * Odaların girişe hazırlığı (tek sorguda: odada kalan misafir ve bugünkü arıza kaydı).
 * @param {string} hotelId
 * @param {Array<{ id: string, room: { id: string, number: string, housekeepingStatus: string } | null }>} stays
 * @param {Date} businessDate
 */
async function roomStates(hotelId, stays, businessDate) {
  const roomIds = [...new Set(stays.map((stay) => stay.room?.id).filter(Boolean))];
  if (roomIds.length === 0) return stays.map(() => null);
  const tomorrow = new Date(businessDate.getTime() + 86_400_000);
  const [occupants, blocks] = await Promise.all([
    prisma.reservation.findMany({
      where: { hotelId, roomId: { in: roomIds }, status: 'CHECKED_IN' },
      select: { id: true, roomId: true, confirmationCode: true, guest: { select: { firstName: true, lastName: true } } },
    }),
    prisma.roomBlock.findMany({
      where: {
        hotelId,
        roomId: { in: roomIds },
        deletedAt: null,
        startDate: { lt: tomorrow },
        OR: [{ endDate: null }, { endDate: { gt: businessDate } }],
      },
      select: { roomId: true, type: true, reason: true, endDate: true },
    }),
  ]);
  return stays.map((stay) => {
    if (!stay.room) return null;
    const occupant = occupants.find((row) => row.roomId === stay.room.id && row.id !== stay.id) ?? null;
    const block = blocks.find((row) => row.roomId === stay.room.id) ?? null;
    return {
      id: stay.room.id,
      number: stay.room.number,
      housekeepingStatus: stay.room.housekeepingStatus,
      readiness: roomReadiness(stay.room, { occupied: Boolean(occupant), blocked: Boolean(block) }),
      occupant: occupant ? { confirmationCode: occupant.confirmationCode, guestName: guestFullName(occupant.guest) } : null,
      block: block ? { type: block.type, reason: block.reason, until: block.endDate ? toIsoDay(block.endDate) : null } : null,
    };
  });
}

/**
 * Sayfalı liste.
 * @param {object} where
 * @param {object[]} orderBy
 * @param {{ page: number, pageSize: number }} query
 */
async function pageOf(where, orderBy, query) {
  const [rows, counted] = await Promise.all([
    prisma.reservation.findMany({ where, orderBy, ...toSkipTake(query), select: STAY_SELECT }),
    prisma.reservation.count({ where, take: RESERVATION_COUNT_CAP + 1 }),
  ]);
  const totalCapped = counted > RESERVATION_COUNT_CAP;
  return { rows, total: totalCapped ? RESERVATION_COUNT_CAP : counted, totalCapped };
}

/**
 * @param {string} hotelId
 * @param {string | undefined} search
 * @param {object[]} and
 */
async function scoped(hotelId, search, and) {
  const conditions = await reservationSearchConditions(hotelId, search);
  return { hotelId, AND: [...and, ...conditions] };
}

/**
 * Gelecekler. `EXPECTED`: girişi bugün (ya da geçmiş, hâlâ bekleniyor) ve
 * konaklaması sürüyor — geç gelenler üstte. `CHECKED_IN`: bugün giriş yapanlar.
 *
 * @param {string} hotelId
 * @param {{ view: 'EXPECTED' | 'CHECKED_IN', search?: string, page: number, pageSize: number }} query
 * @param {{ now?: Date }} [options]
 */
export async function listArrivals(hotelId, query, { now = new Date() } = {}) {
  const { hotel, businessDate, clock } = await loadClock(hotelId, now);
  const context = { businessDate, clock, timezone: hotel.timezone };
  let page;
  if (query.view === 'CHECKED_IN') {
    const { start, end } = hotelDayRange(clock.day, hotel.timezone);
    const where = await scoped(hotelId, query.search, [{ checkedInAt: { gte: start, lt: end } }]);
    page = await pageOf(where, [{ checkedInAt: 'desc' }, { id: 'desc' }], query);
  } else {
    const where = await scoped(hotelId, query.search, [
      { status: { in: ['PENDING', 'CONFIRMED'] } },
      // Gün düzeyinde (saat içeren kayıt da doğru sayılsın): girişi yarından önce, çıkışı yarın ya da sonra.
      ...stayCoversNight(businessDate),
    ]);
    page = await pageOf(where, [{ checkIn: 'asc' }, { id: 'asc' }], query);
  }
  const rooms = query.view === 'EXPECTED' ? await roomStates(hotelId, page.rows, businessDate) : page.rows.map(() => null);
  const items = page.rows.map((row, index) => ({ ...stayRow(row, context), roomState: rooms[index] }));
  return withMeta(buildPage(items, page.total, query), page.totalCapped, businessDate);
}

/**
 * Gidecekler. `EXPECTED`: içeride ve çıkışı bugün ya da geçmiş (gecikmiş
 * çıkışlar üstte). `CHECKED_OUT`: bugün çıkış yapanlar. Satırlarda folyo bakiyesi.
 *
 * @param {string} hotelId
 * @param {{ view: 'EXPECTED' | 'CHECKED_OUT', search?: string, page: number, pageSize: number }} query
 * @param {{ now?: Date }} [options]
 */
export async function listDepartures(hotelId, query, { now = new Date() } = {}) {
  const { hotel, businessDate, clock } = await loadClock(hotelId, now);
  const context = { businessDate, clock, timezone: hotel.timezone };
  let page;
  if (query.view === 'CHECKED_OUT') {
    const { start, end } = hotelDayRange(clock.day, hotel.timezone);
    const where = await scoped(hotelId, query.search, [{ checkedOutAt: { gte: start, lt: end } }]);
    page = await pageOf(where, [{ checkedOutAt: 'desc' }, { id: 'desc' }], query);
  } else {
    const where = await scoped(hotelId, query.search, [{ status: 'CHECKED_IN' }, { checkOut: { lt: addDays(businessDate, 1) } }]);
    page = await pageOf(where, [{ checkOut: 'asc' }, { id: 'asc' }], query);
  }
  return withBalances(hotelId, page, query, context);
}

/**
 * Konaklayanlar: şu an içeride olan herkes.
 * @param {string} hotelId
 * @param {{ search?: string, sort: string, page: number, pageSize: number }} query
 * @param {{ now?: Date }} [options]
 */
export async function listInHouse(hotelId, query, { now = new Date() } = {}) {
  const { hotel, businessDate, clock } = await loadClock(hotelId, now);
  const context = { businessDate, clock, timezone: hotel.timezone };
  const where = await scoped(hotelId, query.search, [{ status: 'CHECKED_IN' }]);
  const orderBy =
    query.sort === 'CHECK_IN_DESC'
      ? [{ checkedInAt: 'desc' }, { id: 'desc' }]
      : query.sort === 'ROOM_ASC'
        ? [{ room: { number: 'asc' } }, { id: 'asc' }]
        : [{ checkOut: 'asc' }, { id: 'asc' }];
  const page = await pageOf(where, orderBy, query);
  return withBalances(hotelId, page, query, context);
}

/**
 * @param {string} hotelId
 * @param {{ rows: object[], total: number, totalCapped: boolean }} page
 * @param {{ page: number, pageSize: number }} query
 * @param {{ businessDate: Date, clock: { day: string }, timezone: string }} context
 */
async function withBalances(hotelId, page, query, context) {
  const balances = await stayBalances(prisma, hotelId, page.rows.map((row) => row.id));
  const items = page.rows.map((row) => ({ ...stayRow(row, context), balance: balances.get(row.id)?.balance ?? null }));
  return withMeta(buildPage(items, page.total, query), page.totalCapped, context.businessDate);
}

/**
 * @param {{ items: object[], meta: object }} page
 * @param {boolean} totalCapped
 * @param {Date} businessDate
 */
function withMeta(page, totalCapped, businessDate) {
  return { ...page, meta: { ...page.meta, totalCapped, businessDate: toIsoDay(businessDate) } };
}

/**
 * Sekme rozetleri ve günün özeti: beklenen / yapılan giriş ve çıkış, içeride,
 * gecikmiş çıkış, odası verilmemiş gelecek. Kısa süre önbellekli (canlı sürüm
 * değişince yenilenir).
 *
 * @param {string} hotelId
 * @param {{ now?: Date }} [options]
 */
export async function getFrontDeskSummary(hotelId, { now = new Date() } = {}) {
  const { hotel, businessDate, clock } = await loadClock(hotelId, now);
  const key = JSON.stringify([hotelId, liveVersion(LIVE_SCOPES.RESERVATIONS, hotelId), clock.day, toIsoDay(businessDate)]);
  return summaryCache.get(key, async () => {
    const { start, end } = hotelDayRange(clock.day, hotel.timezone);
    const count = (where) => prisma.reservation.count({ where: { hotelId, ...where }, take: RESERVATION_COUNT_CAP + 1 });
    const [coversIn, coversOut] = stayCoversNight(businessDate);
    const expectedArrival = { status: { in: ['PENDING', 'CONFIRMED'] }, ...coversIn, ...coversOut };
    const [arrivalsExpected, arrivalsUnassigned, checkedInToday, departuresExpected, departuresOverdue, checkedOutToday, inHouse] =
      await Promise.all([
        count(expectedArrival),
        count({ ...expectedArrival, roomId: null }),
        count({ checkedInAt: { gte: start, lt: end } }),
        count({ status: 'CHECKED_IN', checkOut: { lt: addDays(businessDate, 1) } }),
        count({ status: 'CHECKED_IN', checkOut: { lt: businessDate } }),
        count({ checkedOutAt: { gte: start, lt: end } }),
        count({ status: 'CHECKED_IN' }),
      ]);
    return {
      businessDate: toIsoDay(businessDate),
      arrivals: { expected: arrivalsExpected, unassigned: arrivalsUnassigned, checkedIn: checkedInToday },
      departures: { expected: departuresExpected, overdue: departuresOverdue, checkedOut: checkedOutToday },
      inHouse,
      countCap: RESERVATION_COUNT_CAP,
    };
  });
}

/** Sağlık ucu için. */
export function frontDeskCacheStats() {
  return summaryCache.stats();
}

/** Testler için. */
export function clearFrontDeskCache() {
  summaryCache.clear();
}
