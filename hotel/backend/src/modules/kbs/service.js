import { currentActor, toIsoDay } from '@hotelos/core';
import { KBS_PROVIDERS, KBS_PROVIDER_LABELS, KBS_PROVIDER_READY } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { openSecret, sealSecret, secretKeyConfigured } from '../../lib/secret-box.js';
import { writeWithEvents } from '../../lib/write.js';
import { hotelContext } from '../banquet/shared.js';
import { kickKbsDispatcher } from './dispatcher.js';
import { kbsProviderFor } from './providers/index.js';
import { activeStretch, enqueueMissingCheckIns } from './queue.js';
import { zonedWallTimeToUtc } from '@hotelos/hotel-contracts';
import { iso, loadKbsSettings, prisma, settingsView } from './shared.js';

/**
 * KBS ekranlarının servisi (modül 58): ayar, bağlantı denemesi, bildirim listesi / ayrıntı, tekrar gönder, elle bildirildi,
 * günün özeti ve mutabakat (içerideki kişi ↔ bildirilmiş giriş).
 */

const providers = () => KBS_PROVIDERS.map((code) => ({ code, label: KBS_PROVIDER_LABELS[code], ready: KBS_PROVIDER_READY[code] }));

/** @param {string} hotelId */
export async function getKbsSettings(hotelId) {
  const settings = await loadKbsSettings(prisma, hotelId);
  return { settings: settingsView(settings), providers: providers(), secretKeyConfigured: secretKeyConfigured() };
}

/** @param {string} hotelId @param {any} input `kbsSettingsSchema` çıktısı */
export async function saveKbsSettings(hotelId, input) {
  const current = await loadKbsSettings(prisma, hotelId);
  if (input.expectedUpdatedAt && current.updatedAt && new Date(current.updatedAt).getTime() !== input.expectedUpdatedAt.getTime()) throw new StaleWriteError('Ayar bu arada değişti; yenileyip tekrar deneyin');
  const { expectedUpdatedAt, password, clearPassword, ...rest } = input;
  const passwordSealed = clearPassword ? null : password ? sealSecret(password) : current.passwordSealed;
  const data = { ...rest, passwordSealed, updatedBy: currentActor() };
  await writeWithEvents(async (tx, stage) => {
    await tx.kbsSettings.upsert({ where: { hotelId }, create: { hotelId, ...data }, update: data });
    await recordAudit(tx, { hotelId, entity: 'KbsSettings', entityId: hotelId, action: 'UPDATE', after: { ...rest, passwordChanged: Boolean(password) || clearPassword } });
    await stage('kbs.settings.changed', { hotelId, isEnabled: rest.isEnabled, provider: rest.provider });
  });
  // Ayar açıldı / düzeldi: bekleyenler hemen gitsin.
  if (rest.isEnabled) kickKbsDispatcher();
  return getKbsSettings(hotelId);
}

/** Kayıtlı ayarla sağlayıcıya bağlantı denemesi (bildirim göndermez). @param {string} hotelId */
export async function testKbsConnection(hotelId) {
  const settings = await loadKbsSettings(prisma, hotelId);
  const provider = kbsProviderFor(settings.provider);
  if (!provider) return { ok: false, message: 'Sağlayıcı tanımsız' };
  let password = null;
  try {
    password = settings.passwordSealed ? openSecret(settings.passwordSealed) : null;
  } catch {
    return { ok: false, message: 'Kayıtlı parola çözülemedi; parolayı yeniden girin' };
  }
  try {
    return await provider.testConnection({ hotelId, settings, password });
  } catch (error) {
    return { ok: false, message: /** @type {Error} */ (error).message };
  }
}

/** @param {any} row */
const notificationView = (row) => ({
  id: row.id,
  reservationId: row.reservationId,
  confirmationCode: row.reservation?.confirmationCode ?? null,
  guestId: row.guestId,
  guestName: row.guestName,
  documentMasked: row.documentMasked,
  nationality: row.nationality,
  kind: row.kind,
  state: row.state,
  roomNumber: row.roomNumber,
  previousRoomNumber: row.previousRoomNumber,
  attempts: row.attempts,
  nextAttemptAt: iso(row.nextAttemptAt),
  providerRef: row.providerRef,
  lastCode: row.lastCode,
  lastMessage: row.lastMessage,
  sentAt: iso(row.sentAt),
  resolvedBy: row.resolvedBy,
  resolvedNote: row.resolvedNote,
  dependsOnId: row.dependsOnId,
  createdAt: row.createdAt.toISOString(),
});

const RESERVATION = { select: { confirmationCode: true } };

/** @param {string} hotelId @param {any} query `kbsNotificationListQuerySchema` çıktısı */
export async function listKbsNotifications(hotelId, query) {
  const ctx = await hotelContext(hotelId);
  const createdAt = {
    ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
    ...(query.to ? { lt: new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}),
  };
  const where = {
    hotelId,
    // Durum seçildiyse o geçerli; yoksa "açık olanlar".
    ...(query.state ? { state: query.state } : query.open === true ? { state: { in: ['PENDING', 'SENDING', 'FAILED'] } } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.reservationId ? { reservationId: query.reservationId } : {}),
    ...(Object.keys(createdAt).length ? { createdAt } : {}),
    ...(query.search
      ? { OR: [{ guestName: { contains: query.search, mode: 'insensitive' } }, { roomNumber: query.search }, { reservation: { confirmationCode: { contains: query.search.toUpperCase() } } }] }
      : {}),
  };
  const { skip, take } = toSkipTake(query);
  const [rows, total] = await Promise.all([
    prisma.kbsNotification.findMany({ where, include: { reservation: RESERVATION }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip, take }),
    prisma.kbsNotification.count({ where }),
  ]);
  return { ...buildPage(rows.map(notificationView), total, query), today: ctx.today };
}

/** @param {string} hotelId @param {string} notificationId */
export async function getKbsNotification(hotelId, notificationId) {
  const row = await prisma.kbsNotification.findFirst({ where: { id: notificationId, hotelId }, include: { reservation: RESERVATION, logs: { orderBy: { createdAt: 'asc' } }, dependsOn: { select: { id: true, kind: true, state: true } } } });
  if (!row) throw new NotFoundError('KBS bildirimi bulunamadı');
  return {
    notification: notificationView(row),
    dependsOn: row.dependsOn,
    logs: row.logs.map((log) => ({ id: log.id, ok: log.ok, code: log.code, message: log.message, actor: log.actor, createdAt: log.createdAt.toISOString() })),
  };
}

/** Durum değiştirir ve iz yazar. @param {string} hotelId @param {string} notificationId @param {string[]} from @param {any} data @param {string} message @param {string} code */
async function transition(hotelId, notificationId, from, data, message, code) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const row = await tx.kbsNotification.findFirst({ where: { id: notificationId, hotelId } });
    if (!row) throw new NotFoundError('KBS bildirimi bulunamadı');
    const { count } = await tx.kbsNotification.updateMany({ where: { id: row.id, state: { in: from } }, data });
    if (count === 0) throw new ConflictError(`Bu bildirim şu an "${row.state}" durumunda; bu işlem yapılamaz`, 'KBS_STATE', { state: row.state });
    await tx.kbsLog.create({ data: { hotelId, notificationId: row.id, ok: true, code, message, actor } });
    await stage('kbs.notification.changed', { hotelId, notificationId: row.id, reservationId: row.reservationId, kind: row.kind, state: data.state });
  });
  return getKbsNotification(hotelId, notificationId);
}

/** Gönderilemeyen bildirimi yeniden sıraya alır (kart düzeltildiyse kimlik güncel halinden gider). @param {string} hotelId @param {string} notificationId */
export async function retryKbsNotification(hotelId, notificationId) {
  const settings = await loadKbsSettings(prisma, hotelId);
  if (!settings.isEnabled) throw new ConflictError('KBS kapalı; önce ayarlardan açın', 'KBS_DISABLED');
  const result = await transition(hotelId, notificationId, ['FAILED'], { state: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastCode: null }, 'Personel tekrar gönderdi', 'RETRY');
  kickKbsDispatcher();
  return result;
}

/** KBS ekranından elle bildirildi (not zorunlu). @param {string} hotelId @param {string} notificationId @param {{ note: string }} input */
export async function markKbsManual(hotelId, notificationId, input) {
  const row = await prisma.kbsNotification.findFirst({ where: { id: notificationId, hotelId }, select: { dependsOn: { select: { kind: true, state: true } } } });
  if (!row) throw new NotFoundError('KBS bildirimi bulunamadı');
  // Zincirde sıra atlanmasın: bağlı olduğu bildirim (ör. giriş) tamamlanmadan bu halka elle kapatılamaz.
  if (row.dependsOn && !['SENT', 'MANUAL'].includes(row.dependsOn.state)) {
    throw new ConflictError('Önce bağlı olduğu bildirim (ör. giriş) bildirilmeli ya da elle bildirildi işaretlenmeli', 'KBS_DEPENDENCY', { dependsOn: row.dependsOn });
  }
  const result = await transition(hotelId, notificationId, ['PENDING', 'FAILED'], { state: 'MANUAL', nextAttemptAt: null, resolvedBy: currentActor(), resolvedNote: input.note }, `Elle bildirildi: ${input.note}`, 'MANUAL');
  // Buna bağlı çıkış / oda değişikliği artık gidebilir.
  kickKbsDispatcher();
  return result;
}

/**
 * Günün özeti ve mutabakat: içerideki her kişinin bildirilmiş (ya da elle bildirilmiş) girişi var mı?
 * @param {string} hotelId
 */
export async function kbsSummary(hotelId) {
  const [ctx, settings] = await Promise.all([hotelContext(hotelId), loadKbsSettings(prisma, hotelId)]);
  const dayStart = zonedWallTimeToUtc(`${ctx.today}T00:00`, ctx.timezone);
  const [byState, sentToday, stays] = await Promise.all([
    prisma.kbsNotification.groupBy({ by: ['state'], where: { hotelId, state: { in: ['PENDING', 'SENDING', 'FAILED'] } }, _count: { _all: true } }),
    prisma.kbsNotification.count({ where: { hotelId, OR: [{ state: 'SENT', sentAt: { gte: dayStart } }, { state: 'MANUAL', updatedAt: { gte: dayStart } }] } }),
    prisma.reservation.findMany({
      where: { hotelId, status: 'CHECKED_IN', deletedAt: null },
      select: {
        id: true,
        confirmationCode: true,
        checkedInAt: true,
        room: { select: { number: true } },
        guestId: true,
        guest: { select: { id: true, firstName: true, lastName: true, idNumber: true } },
        reservationGuests: { where: { deletedAt: null }, select: { guest: { select: { id: true, firstName: true, lastName: true, idNumber: true } } } },
      },
    }),
  ]);
  const notifications = await prisma.kbsNotification.findMany({ where: { hotelId, reservationId: { in: stays.map((stay) => stay.id) }, state: { not: 'CANCELLED' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const count = (state) => byState.find((row) => row.state === state)?._count._all ?? 0;
  let persons = 0;
  let reported = 0;
  /** Belgesiz çocuk bildirilmez: sayıma girmez, ayrı söylenir. */
  let withoutDocument = 0;
  const missing = [];
  for (const stay of stays) {
    const people = stay.reservationGuests.length ? stay.reservationGuests.map((row) => row.guest) : [stay.guest];
    for (const person of people) {
      if (!person.idNumber) {
        withoutDocument += 1;
        continue;
      }
      persons += 1;
      const chain = notifications.filter((row) => row.reservationId === stay.id && row.guestId === person.id);
      const stretch = activeStretch(chain);
      const checkIn = stretch[0];
      if (checkIn && ['SENT', 'MANUAL'].includes(checkIn.state)) {
        reported += 1;
        continue;
      }
      missing.push({
        reservationId: stay.id,
        confirmationCode: stay.confirmationCode,
        roomNumber: stay.room?.number ?? null,
        guestId: person.id,
        guestName: `${person.firstName} ${person.lastName}`,
        notificationId: checkIn?.id ?? null,
        state: checkIn?.state ?? null,
        reason: checkIn ? (checkIn.lastMessage ?? 'Gönderilmeyi bekliyor') : settings.isEnabled ? 'Bildirim açılmamış' : 'KBS kapalı',
        checkedInAt: iso(stay.checkedInAt),
      });
    }
  }
  return {
    isEnabled: settings.isEnabled,
    provider: settings.provider,
    today: ctx.today,
    pending: count('PENDING') + count('SENDING'),
    failed: count('FAILED'),
    sentToday,
    inHouse: { persons, reported, withoutDocument, missing: missing.slice(0, 200) },
    generatedAt: new Date().toISOString(),
    businessDay: toIsoDay(dayStart),
  };
}

/** Mutabakattan: bildirimi açılmamış kişiler için giriş bildirimi. @param {string} hotelId @param {string} reservationId */
export async function enqueueMissing(hotelId, reservationId) {
  const settings = await loadKbsSettings(prisma, hotelId);
  if (!settings.isEnabled) throw new ConflictError('KBS kapalı; önce ayarlardan açın', 'KBS_DISABLED');
  return enqueueMissingCheckIns(hotelId, reservationId);
}
