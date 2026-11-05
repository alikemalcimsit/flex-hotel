import { randomBytes, randomUUID } from 'node:crypto';
import { toIsoDay } from '@hotelos/core';
import {
  COUNTRY_CODES,
  GUEST_PORTAL_LANGUAGES,
  GUEST_PORTAL_TEXT_KEYS,
  ONLINE_CHECKIN_MAX_PHOTOS_PER_PERSON,
  guestPortalLanguageFor,
  guestPortalText,
  maskIdNumber,
  onlineCheckinWindow,
} from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, rethrowPrismaError } from '../../lib/errors.js';
import { removeFiles, saveFile } from '../../lib/file-storage.js';
import { lockReservations } from '../../lib/locks.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { writeWithEvents } from '../../lib/write.js';
import { insertPortalRequest } from '../guest-requests/service.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { getLink as getRoomServiceLink, issueLink as issueRoomServiceLink } from '../pos/room-service-guest.js';
import { loadPosSettings } from '../pos/shared.js';
import { getHotelSettings } from '../settings/service.js';
import { decodeSignature, detachReplacedDocuments, signatureKey } from './documents.js';
import { resolvePortalToken, touchPortalLink } from './links.js';
import { iso, prisma, shortGuestName } from './shared.js';

/**
 * Misafir portalının uçları (modül 53), `/public/portal/:token` altında. Oturumsuzdur; kimlik bağlantının imzasıdır,
 * hız sınırı route'ta bağlantı başına (üstünde IP tavanı). Misafire en az veri gider: adının baş harfli kısa hâli, rezervasyonun özeti; daha
 * önce gönderdiği belge numarası maskeli, belge fotoğrafı hiç (yalnız sayısı). Hata mesajları Türkçedir; portal
 * `code`'a bakıp misafirin dilinde yazar.
 */

/** Misafire gösterilen son istekler. */
const GUEST_RECENT_REQUESTS = 20;
/** Folyo başına misafire gösterilen en fazla kalem (uzun konaklama). */
const GUEST_FOLIO_ITEMS = 300;
/** Folyo başına misafire gösterilen en fazla ödeme satırı. */
const GUEST_FOLIO_PAYMENTS = 100;
/** İsteğin başlığı açıklamanın başından. */
const REQUEST_TITLE_LENGTH = 60;
/** Aynı metnin bu kadar dakika içinde ikinci gönderimi tekrar sayılır. */
const REQUEST_DUPLICATE_MINUTES = 10;

/** @param {any} reservation `PORTAL_RESERVATION_SELECT` */
const reservationDays = (reservation) => ({ status: reservation.status, checkIn: toIsoDay(reservation.checkIn), checkOut: toIsoDay(reservation.checkOut) });

/** @param {string} hotelId @param {string | null} publicBaseUrl */
async function webchatKeyFor(hotelId, publicBaseUrl) {
  if (!publicBaseUrl) return null;
  const channel = await prisma.messagingChannel.findFirst({ where: { hotelId, channel: 'WEBCHAT', enabled: true }, select: { publicKey: true, settings: true } });
  const origin = new URL(publicBaseUrl).origin;
  return channel?.publicKey && (channel.settings?.allowedOrigins ?? []).includes(origin) ? channel.publicKey : null;
}

/**
 * Portalın ana sayfası: otel, rezervasyon özeti, online check-in durumu ve açık özellikler.
 * @param {string} token
 */
export async function portalOverview(token) {
  const { link, reservation, settings, today } = await resolvePortalToken(prisma, token);
  const hotelId = link.hotelId;
  const [hotel, submission, posSettings, webchatKey] = await Promise.all([
    getHotelSettings(hotelId),
    prisma.onlineCheckin.findUnique({ where: { reservationId: reservation.id }, select: { status: true, rejectReason: true, submittedAt: true } }),
    loadPosSettings(prisma, hotelId),
    webchatKeyFor(hotelId, settings.publicBaseUrl),
  ]);
  const days = reservationDays(reservation);
  const window = onlineCheckinWindow(days, { today, openDays: settings.checkinOpenDays, submission, enabled: settings.enabled });
  const inHouse = reservation.status === 'CHECKED_IN';
  await touchPortalLink(link);
  return {
    hotel: { name: hotel.name, phone: hotel.phone ?? null, email: hotel.email ?? null, address: hotel.address ?? null, checkInTime: hotel.checkInTime, checkOutTime: hotel.checkOutTime, currency: hotel.currency, timezone: hotel.timezone },
    language: guestPortalLanguageFor(reservation.guest?.nationality),
    welcome: Object.fromEntries(GUEST_PORTAL_LANGUAGES.map((language) => [language, guestPortalText(settings.texts, language, 'welcome', hotel)])),
    guestName: shortGuestName(reservation.guest),
    reservation: {
      confirmationCode: reservation.confirmationCode,
      status: reservation.status,
      checkIn: days.checkIn,
      checkOut: days.checkOut,
      adults: reservation.adults,
      children: reservation.children,
      boardType: reservation.boardType,
      roomTypeName: reservation.roomType?.name ?? null,
      roomNumber: inHouse ? (reservation.room?.number ?? null) : null,
    },
    checkin: { ...window, status: submission?.status ?? null, rejectReason: submission?.status === 'REJECTED' ? submission.rejectReason : null, submittedAt: iso(submission?.submittedAt) },
    features: {
      checkin: !['CHECKED_IN', 'CHECKED_OUT'].includes(reservation.status),
      folio: inHouse || reservation.status === 'CHECKED_OUT',
      requests: inHouse,
      roomService: inHouse && Boolean(posSettings.guestOrderingEnabled),
      chatKey: webchatKey,
      // Modül 62 (dijital anahtar) ve 50 (sanal POS) gelince açılır.
      digitalKey: false,
      payOnline: false,
    },
  };
}

/**
 * Online check-in formunun verisi: pencere, kişi sayıları, rezervasyon sahibinin adı ve uyruğu (ön dolum), metinler
 * (dört dil) ve önceki gönderimin maskeli özeti.
 * @param {string} token
 */
export async function checkinForm(token) {
  const { link, reservation, settings, today } = await resolvePortalToken(prisma, token);
  const [hotel, submission] = await Promise.all([
    getHotelSettings(link.hotelId),
    prisma.onlineCheckin.findUnique({ where: { reservationId: reservation.id }, include: { documents: { where: { purgedAt: null }, select: { person: true } } } }),
  ]);
  const window = onlineCheckinWindow(reservationDays(reservation), { today, openDays: settings.checkinOpenDays, submission, enabled: settings.enabled });
  const photos = (person) => submission?.documents.filter((doc) => doc.person === person).length ?? 0;
  const masked = (row, index) => ({ firstName: row.firstName ?? null, lastName: row.lastName ?? null, isChild: Boolean(row.isChild), idType: row.idType ?? null, idNumber: maskIdNumber(row.idNumber), nationality: row.nationality ?? null, photos: photos(index) });
  return {
    window,
    // Uyruk seçeneği: sunucunun kabul ettiği liste (misafir uygulaması adları kendi dilinde yazar).
    countries: COUNTRY_CODES,
    party: { adults: reservation.adults, children: reservation.children },
    primary: { firstName: reservation.guest?.firstName ?? null, lastName: reservation.guest?.lastName ?? null, nationality: reservation.guest?.nationality ?? null },
    maxPhotosPerPerson: ONLINE_CHECKIN_MAX_PHOTOS_PER_PERSON,
    texts: Object.fromEntries(
      GUEST_PORTAL_LANGUAGES.map((language) => [language, Object.fromEntries(GUEST_PORTAL_TEXT_KEYS.filter((key) => key !== 'welcome').map((key) => [key, guestPortalText(settings.texts, language, key, hotel)]))]),
    ),
    submission: submission
      ? {
          status: submission.status,
          rejectReason: submission.status === 'REJECTED' ? submission.rejectReason : null,
          submittedAt: iso(submission.submittedAt),
          people: [masked(submission.guest ?? {}, 0), ...(submission.companions ?? []).map((row, index) => masked(row, index + 1))],
          arrivalTime: submission.arrivalTime,
          vehiclePlate: submission.vehiclePlate,
          paymentPreference: submission.paymentPreference,
        }
      : null,
  };
}

/**
 * Online check-in'i gönderir (ilk kez ya da düzeltme). Kişi sayıları rezervasyonu aşamaz; her fotoğraf bu rezervasyona
 * yüklenmiş, silinmemiş olmalı. İmza yeni sürüm anahtarıyla önce diske, sonra kayıt; eski imza ve kullanılmayan
 * eski fotoğraflar commit'ten sonra silinir. Resepsiyonun ziline "inceleme bekliyor" düşer. İşlem kaydına kimlik
 * numarası yazılmaz (KVKK): yalnız kişi / fotoğraf sayısı.
 *
 * @param {string} token @param {any} input `onlineCheckinSubmitSchema`
 */
export async function submitCheckin(token, input) {
  const seed = await resolvePortalToken(prisma, token);
  const hotelId = seed.link.hotelId;
  const reservationId = seed.reservation.id;
  const signature = decodeSignature(input.signature);
  const existing = await prisma.onlineCheckin.findUnique({ where: { reservationId }, select: { id: true, submitCount: true, signatureKey: true } });
  const id = existing?.id ?? randomUUID();
  const version = (existing?.submitCount ?? 0) + 1;
  const newSignatureKey = signatureKey(hotelId, id, `${version}${randomBytes(4).toString('hex')}`);
  await saveFile(newSignatureKey, signature);

  const people = [
    { index: 0, ids: input.primary.documentIds },
    ...input.companions.map((row, index) => ({ index: index + 1, ids: row.documentIds })),
  ];
  const allIds = people.flatMap((person) => person.ids);
  let staleKeys = [];
  try {
    await writeWithEvents(async (tx, stage) => {
      await lockReservations(tx, hotelId, [reservationId]);
      const { reservation, settings, today } = await resolvePortalToken(tx, token);
      const current = await tx.onlineCheckin.findUnique({ where: { reservationId }, select: { id: true, status: true, submitCount: true, signatureKey: true } });
      if ((current?.submitCount ?? 0) + 1 !== version) throw new ConflictError('Online check-in az önce başka bir sekmeden gönderildi; sayfayı yenileyin.', 'STALE_WRITE');
      const window = onlineCheckinWindow(reservationDays(reservation), { today, openDays: settings.checkinOpenDays, submission: current, enabled: settings.enabled });
      if (!window.open) throw new ConflictError('Online check-in şu an açık değil.', `CHECKIN_${window.reason}`);

      const adultCompanions = input.companions.filter((row) => !row.person.isChild).length;
      const childCompanions = input.companions.length - adultCompanions;
      if (adultCompanions > reservation.adults - 1 || childCompanions > reservation.children) {
        throw new ConflictError('Kişi sayısı rezervasyondakinden fazla; değişiklik için otelle görüşün.', 'PARTY_MISMATCH');
      }
      if (allIds.length) {
        const docs = await tx.onlineCheckinDocument.findMany({ where: { id: { in: allIds }, reservationId, purgedAt: null, OR: [{ onlineCheckinId: null }, { onlineCheckinId: id }] }, select: { id: true } });
        if (docs.length !== allIds.length) throw new ConflictError('Fotoğraflardan biri bulunamadı; lütfen yeniden yükleyin.', 'DOCUMENT_MISSING');
      }

      const now = new Date();
      const identity = (row) => ({ idType: row.idType, idNumber: row.idNumber, nationality: row.nationality, birthDate: row.birthDate ? toIsoDay(row.birthDate) : null });
      const data = {
        status: 'SUBMITTED',
        arrivalDate: new Date(`${toIsoDay(reservation.checkIn)}T00:00:00.000Z`),
        searchText: [reservation.confirmationCode, reservation.guest.firstName, reservation.guest.lastName, ...input.companions.flatMap(({ person }) => [person.firstName, person.lastName])].join(' '),
        guest: { firstName: reservation.guest.firstName, lastName: reservation.guest.lastName, ...identity(input.primary.identity) },
        companions: input.companions.map(({ person }) => ({ firstName: person.firstName, lastName: person.lastName, isChild: person.isChild, ...identity(person) })),
        vehiclePlate: input.vehiclePlate ?? null,
        arrivalTime: input.arrivalTime ?? null,
        paymentPreference: input.paymentPreference,
        note: input.note ?? null,
        language: input.language,
        consents: { privacyAt: now.toISOString(), rulesAt: now.toISOString(), documentPhotosAt: now.toISOString(), marketing: input.consents.marketing },
        signatureKey: newSignatureKey,
        submittedAt: now,
        reviewedAt: null,
        reviewedBy: null,
        rejectReason: null,
        documentsPurgedAt: null,
      };
      if (current) await tx.onlineCheckin.update({ where: { id }, data: { ...data, submitCount: version } });
      else await tx.onlineCheckin.create({ data: { id, hotelId, reservationId, ...data } });
      for (const person of people) {
        if (person.ids.length) await tx.onlineCheckinDocument.updateMany({ where: { id: { in: person.ids } }, data: { onlineCheckinId: id, person: person.index } });
      }
      staleKeys = await detachReplacedDocuments(tx, id, allIds, now);
      if (current?.signatureKey && current.signatureKey !== newSignatureKey) staleKeys.push(current.signatureKey);

      await recordAudit(tx, {
        hotelId,
        entity: 'OnlineCheckin',
        entityId: id,
        action: current ? 'UPDATE' : 'CREATE',
        before: current ? { status: current.status } : null,
        after: { status: 'SUBMITTED', reservation: reservation.confirmationCode, people: people.length, photos: allIds.length, submitCount: version, language: input.language },
      });
      await stage('online_checkin.changed', { hotelId, onlineCheckinId: id, reservationId, status: 'SUBMITTED', change: 'SUBMITTED' });
      await raiseStaffAlert(tx, stage, {
        hotelId,
        kind: 'ONLINE_CHECKIN',
        severity: 'INFO',
        title: `Online check-in: ${reservation.confirmationCode}`,
        body: `${toIsoDay(reservation.checkIn).split('-').reverse().join('.')} girişli rezervasyon${current ? ' düzeltilip yeniden' : ''} gönderildi (${people.length} kişi). Belgeyi görüp onaylayın ya da düzeltme isteyin.`,
        link: '/on-buro/online-check-in',
        permission: PERMISSIONS.GUEST_PORTAL_MANAGE,
        entityType: 'OnlineCheckin',
        entityId: id,
        dedupeKey: 'online-checkin:submitted',
      });
    });
  } catch (error) {
    await removeFiles([newSignatureKey]);
    rethrowPrismaError(error);
  }
  if (staleKeys.length) await removeFiles(staleKeys);
  await touchPortalLink(seed.link);
  return checkinForm(token);
}

/**
 * Misafirin folyoları (içeride ya da çıkışta): kalemler (iptal edilenler hariç), ödemeler, bakiye.
 *
 * Yalnız misafirin kendi ödediği pencereler: ödeyeni şirket / acente olan pencere (`payerName` dolu; acente kontratlı
 * oda fiyatı, şirketin harcama kalemleri) misafire gösterilmez, yalnız sayısı döner. Ödeme satırı folyonun para
 * biriminde ve işaretlidir (iade, iptal eksi); dövizli ödemenin kendi tutarı ayrıca verilir.
 * @param {string} token
 */
export async function portalFolio(token) {
  const { link, reservation } = await resolvePortalToken(prisma, token);
  if (!['CHECKED_IN', 'CHECKED_OUT'].includes(reservation.status)) throw new ConflictError('Folyo konaklama başlayınca görünür.', 'FOLIO_NOT_YET');
  const where = { hotelId: link.hotelId, reservationId: reservation.id, deletedAt: null, mergedIntoId: null };
  const [folios, otherPayerAccounts] = await Promise.all([
    prisma.folio.findMany({
      where: { ...where, payerName: null },
      orderBy: { window: 'asc' },
      select: {
        id: true,
        window: true,
        status: true,
        currency: true,
        chargesTotal: true,
        paymentsTotal: true,
        balance: true,
        items: { where: { deletedAt: null, voidedAt: null }, orderBy: [{ serviceDate: 'asc' }, { createdAt: 'asc' }], take: GUEST_FOLIO_ITEMS + 1, select: { serviceDate: true, description: true, quantity: true, total: true } },
        payments: {
          where: { status: 'POSTED' },
          orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
          take: GUEST_FOLIO_PAYMENTS + 1,
          select: { receivedAt: true, method: true, kind: true, amount: true, currency: true, folioAmount: true },
        },
      },
    }),
    prisma.folio.count({ where: { ...where, payerName: { not: null } } }),
  ]);
  await touchPortalLink(link);
  return {
    otherPayerAccounts,
    folios: folios.map((folio) => ({
      window: folio.window,
      status: folio.status,
      currency: folio.currency,
      chargesTotal: folio.chargesTotal.toFixed(2),
      paymentsTotal: folio.paymentsTotal.toFixed(2),
      balance: folio.balance.toFixed(2),
      truncated: folio.items.length > GUEST_FOLIO_ITEMS || folio.payments.length > GUEST_FOLIO_PAYMENTS,
      items: folio.items.slice(0, GUEST_FOLIO_ITEMS).map((item) => ({ date: toIsoDay(item.serviceDate), description: item.description, quantity: item.quantity, total: item.total.toFixed(2) })),
      payments: folio.payments.slice(0, GUEST_FOLIO_PAYMENTS).map((payment) => ({
        date: iso(payment.receivedAt),
        method: payment.method,
        kind: payment.kind,
        folioAmount: payment.folioAmount.toFixed(2),
        amount: payment.amount.toFixed(2),
        currency: payment.currency,
      })),
    })),
  };
}

/** @param {string} hotelId @param {string} reservationId */
async function guestRequests(hotelId, reservationId) {
  const rows = await prisma.guestRequest.findMany({
    where: { hotelId, reservationId, deletedAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: GUEST_RECENT_REQUESTS,
    select: { id: true, category: true, title: true, description: true, status: true, createdAt: true, completedAt: true },
  });
  return rows.map((row) => ({ id: row.id, category: row.category, title: row.title, description: row.description, status: row.status, createdAt: iso(row.createdAt), completedAt: iso(row.completedAt) }));
}

/** Misafirin istekleri (son 20). @param {string} token */
export async function portalRequests(token) {
  const { link, reservation } = await resolvePortalToken(prisma, token);
  return { requests: await guestRequests(link.hotelId, reservation.id) };
}

/**
 * Misafirin isteği (içerideyken): resepsiyonun istek listesine kaynak "Misafir portalı" ile düşer. Aynı konaklamadan
 * son `REQUEST_DUPLICATE_MINUTES` dakikada aynı konu ve metinle gelen ikinci gönderim yeni istek açmaz (çift dokunuş,
 * kopan bağlantıda yeniden gönderim); rezervasyon kilidi altında denetlenir.
 * @param {string} token @param {{ category: string, description: string }} input
 */
export async function createPortalRequest(token, input) {
  const seed = await resolvePortalToken(prisma, token);
  const hotelId = seed.link.hotelId;
  const reservationId = seed.reservation.id;
  const text = input.description.trim();
  await writeWithEvents(async (tx, stage) => {
    await lockReservations(tx, hotelId, [reservationId]);
    const { reservation } = await resolvePortalToken(tx, token);
    if (reservation.status !== 'CHECKED_IN' || !reservation.roomId) throw new ConflictError('İstek konaklama süresince gönderilebilir.', 'NOT_IN_HOUSE');
    const duplicate = await tx.guestRequest.findFirst({
      where: { hotelId, reservationId, source: 'PORTAL', category: input.category, description: text, createdAt: { gte: new Date(Date.now() - REQUEST_DUPLICATE_MINUTES * 60_000) } },
      select: { id: true },
    });
    if (duplicate) return;
    await insertPortalRequest(tx, stage, hotelId, {
      reservationId,
      guestId: reservation.guest.id,
      roomId: reservation.roomId,
      category: input.category,
      title: text.length > REQUEST_TITLE_LENGTH ? `${text.slice(0, REQUEST_TITLE_LENGTH - 1)}…` : text,
      description: text,
    });
  });
  await touchPortalLink(seed.link);
  return { requests: await guestRequests(hotelId, reservationId) };
}

/**
 * Oda servisi sayfasına geçiş: konaklamanın geçerli oda servisi bağlantısı (41); yoksa ya da oda değiştiyse yenisi
 * verilir. Bağlantı odaya bağlıdır; sipariş kuralları 41'in.
 * @param {string} token
 */
export async function portalRoomService(token) {
  const { link, reservation } = await resolvePortalToken(prisma, token);
  if (reservation.status !== 'CHECKED_IN') throw new ConflictError('Oda servisi konaklama süresince açılır.', 'NOT_IN_HOUSE');
  let current = await getRoomServiceLink(link.hotelId, reservation.id);
  if (!current.guestOrderingEnabled) throw new ConflictError('Oda servisi siparişi şu an bu sayfadan alınmıyor.', 'GUEST_ORDERING_CLOSED');
  if (!current.link?.valid) {
    try {
      current = await issueRoomServiceLink(link.hotelId, reservation.id);
    } catch (error) {
      // Aynı anda iki sekme: diğerinin bağlantısı.
      if (error?.code !== 'CONFLICT' && error?.statusCode !== 409) throw error;
      current = await getRoomServiceLink(link.hotelId, reservation.id);
    }
  }
  return { path: current.link?.path ?? null };
}
