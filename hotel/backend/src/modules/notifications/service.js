import { randomUUID } from 'node:crypto';
import { currentActor } from '@hotelos/core';
import {
  DEFAULT_NOTIFICATION_LANGUAGE,
  DEFAULT_NOTIFICATION_TEMPLATES,
  internationalPhone,
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_LANGUAGES,
  NOTIFICATION_RESENDABLE_STATUSES,
  NOTIFICATION_TRIGGERS,
  notificationLanguageFor,
  quietHoursRelease,
  renderTemplate,
  sanitizeSmsValue,
  smsInfo,
} from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { encodeCursor, olderThan, parseCursor } from '../../lib/cursor.js';
import { ConflictError, NotFoundError, rethrowPrismaError, StaleWriteError, ValidationError } from '../../lib/errors.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { sealSecret, secretKeyConfigured } from '../../lib/secret-box.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';
import { getHotelSettings } from '../settings/service.js';
import { channelAvailable, resetProviderConnections } from './providers/index.js';
import {
  failureAlertKey,
  guestOptedOut,
  notificationDedupeKey,
  recipientFor,
  smsQuietHours,
  smsSafeVariables,
  stayVariables,
  triggerSkipReason,
} from './rules.js';
import { raiseStaffAlert } from './staff-alerts.js';

/**
 * Bildirim merkezi servisi (modül 9).
 *
 * ### Akış
 *
 * 1. Olay olur (rezervasyon, oda ataması, giriş, çıkış). notification-worker
 *    `enqueueTriggerNotifications` çağırır: açık kanallar ve etkin şablonlar
 *    için metin üretilir, **dondurulur** ve kuyruğa (`Notification`) yazılır.
 * 2. Gönderici (`dispatcher.js`) sırası gelenleri üstlenir, sağlayıcıya verir,
 *    sonucu yazar; geçici hatada artan aralıklarla yeniden dener.
 * 3. Bütün denemelere rağmen gitmeyen bildirim personele uyarı olarak düşer.
 *
 * Gönderim HTTP isteğinin yolunda değildir: oda atamasını yapan resepsiyonist
 * yavaş bir SMTP sunucusunu beklemez.
 *
 * ### Sırlar
 *
 * SMTP parolası ve SMS API parolası şifreli saklanır, hiçbir API cevabında
 * dönmez; ekran yalnızca "kayıtlı" bilgisini görür.
 */

const MINUTE_MS = 60_000;

/** Geçmiş satırında gösterilen metin uzunluğu. */
const BODY_PREVIEW_LENGTH = 160;

/** Detayda gösterilen tekrar gönderim sayısı. */
const DETAIL_RESEND_LIMIT = 10;

/** Özet ekranının baktığı süre. */
const SUMMARY_WINDOW_MS = 24 * 60 * MINUTE_MS;

/** Kanal ayarında hangi alanlar sır değildir (API'de görünür). */
const CHANNEL_SETTING_FIELDS = Object.freeze({
  EMAIL: ['host', 'port', 'security', 'username', 'fromName', 'fromAddress', 'replyTo'],
  SMS: ['provider', 'username', 'sender', 'quietHoursStart', 'quietHoursEnd'],
  WHATSAPP: [],
});

/** Henüz kaydedilmemiş kanalın ekrandaki başlangıç değerleri. */
const CHANNEL_DEFAULTS = Object.freeze({
  EMAIL: Object.freeze({
    host: '',
    port: 587,
    security: 'STARTTLS',
    username: '',
    fromName: '',
    fromAddress: '',
    replyTo: '',
  }),
  SMS: Object.freeze({ provider: 'NETGSM', username: '', sender: '', quietHoursStart: null, quietHoursEnd: null }),
  WHATSAPP: Object.freeze({}),
});

const NOTIFICATION_LIST_SELECT = Object.freeze({
  id: true,
  channel: true,
  source: true,
  language: true,
  recipient: true,
  recipientName: true,
  subject: true,
  body: true,
  status: true,
  attempts: true,
  nextAttemptAt: true,
  provider: true,
  errorCode: true,
  error: true,
  sentAt: true,
  deliveredAt: true,
  failedAt: true,
  cancelledAt: true,
  cancelReason: true,
  resendOfId: true,
  guestId: true,
  reservationId: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  reservation: { select: { confirmationCode: true } },
});

/** @param {Date | null | undefined} value */
const iso = (value) => (value ? value.toISOString() : null);

/**
 * @param {Record<string, unknown>} source
 * @param {readonly string[]} fields
 */
function pick(source, fields) {
  return Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));
}

/* ══════════════════ Dönüştürücüler ══════════════════ */

/**
 * @param {object} row
 * @param {{ full?: boolean }} [options]
 */
function toNotificationDto(row, { full = false } = {}) {
  const preview = row.body.length > BODY_PREVIEW_LENGTH ? `${row.body.slice(0, BODY_PREVIEW_LENGTH - 1)}…` : row.body;
  return {
    id: row.id,
    channel: row.channel,
    source: row.source,
    language: row.language,
    recipient: row.recipient,
    recipientName: row.recipientName,
    subject: row.subject,
    ...(full ? { body: row.body } : { preview }),
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.status === 'PENDING' ? iso(row.nextAttemptAt) : null,
    provider: row.provider,
    errorCode: row.errorCode,
    error: row.error,
    sentAt: iso(row.sentAt),
    deliveredAt: iso(row.deliveredAt),
    failedAt: iso(row.failedAt),
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
    resendOfId: row.resendOfId,
    guestId: row.guestId,
    reservationId: row.reservationId,
    confirmationCode: row.reservation?.confirmationCode ?? null,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toTemplateDto(row) {
  return {
    id: row.id,
    key: row.key,
    channel: row.channel,
    language: row.language,
    subject: row.subject,
    body: row.body,
    isActive: row.isActive,
    updatedBy: row.updatedBy,
    updatedAt: iso(row.updatedAt),
  };
}

/**
 * @param {string} channel
 * @param {object | null} row
 */
function toChannelDto(channel, row) {
  return {
    channel,
    enabled: row?.enabled ?? false,
    settings: { ...CHANNEL_DEFAULTS[channel], ...pick(row?.settings ?? {}, CHANNEL_SETTING_FIELDS[channel]) },
    hasSecret: Boolean(row?.secret),
    secretUpdatedAt: iso(row?.secretUpdatedAt),
    lastTestAt: iso(row?.lastTestAt),
    lastTestOk: row?.lastTestOk ?? null,
    lastTestError: row?.lastTestError ?? null,
    lastFailureAt: iso(row?.lastFailureAt),
    lastFailureError: row?.lastFailureError ?? null,
    updatedAt: iso(row?.updatedAt),
    available: channelAvailable(channel),
  };
}

/** Denetim izi: sır görünmez, yalnızca değiştiği anlaşılır. */
function channelSnapshot(row) {
  return {
    enabled: row.enabled,
    settings: row.settings,
    secretUpdatedAt: iso(row.secretUpdatedAt),
  };
}

/**
 * Tekillik kısıtına takılan eşzamanlı ilk kayıt "başkası değiştirdi" demektir.
 * @param {unknown} error
 * @param {string} constraint
 */
function rethrowAsStale(error, constraint) {
  const target = /** @type {{ code?: string, meta?: { target?: unknown } }} */ (error);
  if (target?.code === 'P2002' || String(target?.meta?.target ?? '').includes(constraint)) {
    throw new StaleWriteError();
  }
  rethrowPrismaError(error);
}

/* ══════════════════ Kanal ayarları ══════════════════ */

/** @param {string} hotelId */
export async function getChannelConfigs(hotelId) {
  // Otel başına en fazla kanal sayısı kadar satır.
  const rows = await prisma.notificationChannelConfig.findMany({ where: { hotelId } });
  const byChannel = new Map(rows.map((row) => [row.channel, row]));
  return {
    items: NOTIFICATION_CHANNELS.map((channel) => toChannelDto(channel, byChannel.get(channel) ?? null)),
    secretKeyConfigured: secretKeyConfigured(),
  };
}

/** @param {string} channel @param {Record<string, unknown>} settings */
function channelNeedsSecret(channel, settings) {
  if (channel === 'SMS') return true;
  if (channel === 'EMAIL') return Boolean(settings.username);
  return false;
}

/**
 * Kanal ayarını kaydeder. Parola gönderilmezse kayıtlı parola korunur.
 *
 * @param {string} hotelId
 * @param {object} input `channelConfigSchema`
 */
export async function saveChannelConfig(hotelId, input) {
  const { channel, enabled, password, expectedUpdatedAt, ...rest } = input;
  const settings = pick(rest, CHANNEL_SETTING_FIELDS[channel]);

  if (enabled && !channelAvailable(channel)) {
    throw new ConflictError(
      `${NOTIFICATION_CHANNEL_LABELS[channel]} geçidi henüz bağlı değil (modül 8); kanal açılamaz.`,
      'CHANNEL_UNAVAILABLE',
    );
  }
  // Parola varsa önce şifrelenir: anahtar yoksa hiçbir şey yazılmadan reddedilir.
  const sealed = password ? sealSecret(password) : null;

  let dto;
  try {
    dto = await writeWithEvents(async (tx, stage) => {
      const before = await tx.notificationChannelConfig.findFirst({ where: { hotelId, channel } });
      if (Boolean(before) !== Boolean(expectedUpdatedAt)) throw new StaleWriteError();

      const hasSecret = Boolean(sealed) || Boolean(before?.secret);
      if (enabled && channelNeedsSecret(channel, settings) && !hasSecret) {
        throw new ValidationError('Kanalı açmak için parolayı girin', { field: 'password' });
      }

      const data = {
        enabled,
        settings,
        updatedBy: currentActor(),
        ...(sealed ? { secret: sealed, secretUpdatedAt: new Date() } : {}),
      };
      if (before) {
        await updateWithVersionCheck(
          tx,
          'notificationChannelConfig',
          { id: before.id, hotelId },
          expectedUpdatedAt,
          data,
          'Kanal ayarı bulunamadı',
        );
      } else {
        await tx.notificationChannelConfig.create({ data: { hotelId, channel, ...data } });
      }

      const after = await tx.notificationChannelConfig.findFirst({ where: { hotelId, channel } });
      const auditedFields = await recordAudit(tx, {
        hotelId,
        entity: 'NotificationChannelConfig',
        entityId: after.id,
        action: before ? 'UPDATE' : 'CREATE',
        before: before ? channelSnapshot(before) : null,
        after: channelSnapshot(after),
      });
      const changedFields = before ? auditedFields : Object.keys(channelSnapshot(after));

      await stage('notification.channel.updated', { hotelId, channel, enabled, changedFields });
      return toChannelDto(channel, after);
    });
  } catch (error) {
    rethrowAsStale(error, 'NotificationChannelConfig_active_unique');
  }

  // Ayar değişti: açık SMTP bağlantıları yeni bilgilerle kurulsun.
  resetProviderConnections(hotelId, channel);
  return dto;
}

/* ══════════════════ Şablonlar ══════════════════ */

/**
 * Bütün olay × kanal × dil birleşimleri; kaydı olmayanın yanında varsayılan
 * metin (ekran "varsayılandan oluştur" gösterir). Satır sayısı sabit ve küçük.
 *
 * @param {string} hotelId
 */
export async function listTemplates(hotelId) {
  const rows = await prisma.notificationTemplate.findMany({ where: { hotelId } });
  const byKey = new Map(rows.map((row) => [`${row.key}:${row.channel}:${row.language}`, row]));
  const defaults = new Map(DEFAULT_NOTIFICATION_TEMPLATES.map((t) => [`${t.key}:${t.channel}:${t.language}`, t]));

  const items = [];
  for (const key of NOTIFICATION_TRIGGERS) {
    for (const channel of NOTIFICATION_CHANNELS) {
      for (const language of NOTIFICATION_LANGUAGES) {
        const id = `${key}:${channel}:${language}`;
        const fallback = defaults.get(id);
        items.push({
          key,
          channel,
          language,
          template: byKey.has(id) ? toTemplateDto(byKey.get(id)) : null,
          defaultTemplate: fallback ? { subject: fallback.subject, body: fallback.body } : null,
        });
      }
    }
  }
  return { items };
}

/**
 * Şablonu oluşturur ya da günceller (olay × kanal × dil başına tek kayıt).
 *
 * @param {string} hotelId
 * @param {object} input `notificationTemplateSchema`
 */
export async function saveTemplate(hotelId, input) {
  const { key, channel, language, subject, body, isActive, expectedUpdatedAt } = input;
  try {
    return await writeWithEvents(async (tx, stage) => {
      const identity = { hotelId, key, channel, language };
      const before = await tx.notificationTemplate.findFirst({ where: identity });
      if (Boolean(before) !== Boolean(expectedUpdatedAt)) throw new StaleWriteError();

      const data = { subject: channel === 'EMAIL' ? subject : null, body, isActive, updatedBy: currentActor() };
      if (before) {
        await updateWithVersionCheck(
          tx,
          'notificationTemplate',
          { id: before.id, hotelId },
          expectedUpdatedAt,
          data,
          'Şablon bulunamadı',
        );
      } else {
        await tx.notificationTemplate.create({ data: { ...identity, ...data } });
      }
      const after = await tx.notificationTemplate.findFirst({ where: identity });
      const snapshot = (row) => ({ subject: row.subject, body: row.body, isActive: row.isActive });
      const changedFields = await recordAudit(tx, {
        hotelId,
        entity: 'NotificationTemplate',
        entityId: after.id,
        action: before ? 'UPDATE' : 'CREATE',
        before: before ? snapshot(before) : null,
        after: snapshot(after),
      });
      await stage('notification.template.saved', {
        hotelId,
        templateId: after.id,
        key,
        channel,
        language,
        changedFields: before ? changedFields : ['subject', 'body', 'isActive'],
      });
      return toTemplateDto(after);
    });
  } catch (error) {
    rethrowAsStale(error, 'NotificationTemplate_active_unique');
  }
}

/**
 * Otel kurulurken varsayılan şablonları ekler; var olana dokunmaz.
 * @param {string} hotelId
 * @param {import('@prisma/client').PrismaClient} [client]
 * @returns {Promise<number>} eklenen şablon
 */
export async function ensureDefaultTemplates(hotelId, client = prisma) {
  const result = await client.notificationTemplate.createMany({
    data: DEFAULT_NOTIFICATION_TEMPLATES.map((template) => ({
      hotelId,
      key: template.key,
      channel: template.channel,
      language: template.language,
      subject: template.subject,
      body: template.body,
      isActive: true,
      updatedBy: 'kurulum',
    })),
    skipDuplicates: true,
  });
  return result.count;
}

/* ══════════════════ Kuyruğa yazma ══════════════════ */

const RESERVATION_CONTEXT_SELECT = Object.freeze({
  id: true,
  status: true,
  checkIn: true,
  checkOut: true,
  confirmationCode: true,
  roomId: true,
  guest: {
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, nationality: true, preferences: true },
  },
  roomType: { select: { name: true } },
  room: { select: { id: true, number: true } },
});

/**
 * Personele "misafire ulaşılamadı" uyarısı. Aynı kanal ve hata günde tek
 * uyarıda toplanır (yanlış SMTP parolası yüz e-postayı düşürür, yüz uyarı değil).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Function} stage
 * @param {{ hotelId: string, channel: string, errorCode: string | null, error: string | null, notificationId: string }} failure
 */
export function raiseDeliveryFailureAlert(tx, stage, { hotelId, channel, errorCode, error, notificationId }) {
  return raiseStaffAlert(tx, stage, {
    hotelId,
    kind: 'NOTIFICATION_FAILED',
    severity: 'WARNING',
    title: `${NOTIFICATION_CHANNEL_LABELS[channel]} bildirimi misafire ulaşmadı`,
    body: error,
    link: '/bildirimler/gecmis?durum=FAILED',
    permission: PERMISSIONS.NOTIFICATIONS_MANAGE,
    entityType: 'Notification',
    entityId: notificationId,
    dedupeKey: failureAlertKey(channel, errorCode, new Date()),
  });
}

/**
 * Olay için misafir bildirimlerini kuyruğa yazar.
 *
 * - Yalnızca **açık** kanallar ve **etkin** şablonlar. Misafirin dilinde
 *   şablon yoksa varsayılan dile düşülür.
 * - Aynı olay iki kez işlense de ikinci bildirim açılmaz (tekillik anahtarı).
 * - Misafir kanalı istemiyorsa satır "gönderilmedi" olarak yazılır (iz kalsın).
 * - SMS sessiz saatlere denk gelirse sabaha ertelenir.
 *
 * @param {string} hotelId
 * @param {string} trigger `NOTIFICATION_TRIGGERS`
 * @param {{ reservationId: string, roomId?: string | null }} subject
 * @returns {Promise<{ queued: Array<{ id: string, channel: string, status: string }>, skipped: string | null, duplicates: number }>}
 */
export async function enqueueTriggerNotifications(hotelId, trigger, { reservationId, roomId = null }) {
  const [hotel, businessDate, reservation] = await Promise.all([
    getHotelSettings(hotelId),
    getBusinessDate(hotelId),
    prisma.reservation.findFirst({ where: { id: reservationId, hotelId }, select: RESERVATION_CONTEXT_SELECT }),
  ]);
  if (!reservation) throw new NotFoundError('Rezervasyon bulunamadı');

  const skip = triggerSkipReason(trigger, reservation, businessDate);
  if (skip) return { queued: [], skipped: skip, duplicates: 0 };
  // Oda ataması event'i gecikmeli işlendi ve oda bu arada yine değiştiyse
  // eskisini bildirme; yeni atamanın kendi event'i gelecek.
  if (trigger === 'ROOM_ASSIGNED' && roomId && reservation.roomId !== roomId) {
    return { queued: [], skipped: 'Oda bu arada yeniden değişti', duplicates: 0 };
  }

  const [templates, configs] = await Promise.all([
    prisma.notificationTemplate.findMany({
      where: { hotelId, key: trigger, isActive: true },
      select: { id: true, channel: true, language: true, subject: true, body: true },
    }),
    prisma.notificationChannelConfig.findMany({
      where: { hotelId, enabled: true },
      select: { channel: true, settings: true },
    }),
  ]);

  const language = notificationLanguageFor(reservation.guest.nationality);
  const values = stayVariables({
    hotel,
    reservation,
    guest: reservation.guest,
    roomTypeName: reservation.roomType?.name,
    roomNumber: reservation.room?.number,
    today: businessDate,
  });
  const now = new Date();
  const actor = currentActor();
  const rows = [];
  const notes = [];

  for (const config of configs) {
    const channel = config.channel;
    const label = NOTIFICATION_CHANNEL_LABELS[channel];
    if (!label) continue;
    const template =
      templates.find((t) => t.channel === channel && t.language === language) ??
      templates.find((t) => t.channel === channel && t.language === DEFAULT_NOTIFICATION_LANGUAGE);
    if (!template) {
      notes.push(`${label}: etkin şablon yok`);
      continue;
    }
    const recipient = recipientFor(channel, reservation.guest, hotel.phoneCountryCode);
    if (!recipient) {
      notes.push(`${label}: misafir kartında ${channel === 'EMAIL' ? 'e-posta' : 'telefon'} yok`);
      continue;
    }

    const channelValues = channel === 'EMAIL' ? values : smsSafeVariables(values);
    const body = renderTemplate(template.body, channelValues);
    const row = {
      id: randomUUID(),
      hotelId,
      channel,
      source: trigger,
      language: template.language,
      recipient,
      recipientName: values.misafirAdi,
      subject: template.subject ? renderTemplate(template.subject, channelValues) : null,
      body,
      params: channelValues,
      status: 'PENDING',
      nextAttemptAt: now,
      templateId: template.id,
      guestId: reservation.guest.id,
      reservationId: reservation.id,
      dedupeKey: notificationDedupeKey(trigger, { reservationId: reservation.id, roomId: reservation.roomId }, channel),
      createdBy: actor,
    };

    if (guestOptedOut(reservation.guest.preferences, channel)) {
      Object.assign(row, {
        status: 'CANCELLED',
        cancelledAt: now,
        cancelReason: `Misafir ${label} ile bildirim istemiyor`,
        nextAttemptAt: null,
      });
    } else if (channel === 'SMS' && smsInfo(body).tooLong) {
      Object.assign(row, {
        status: 'FAILED',
        failedAt: now,
        errorCode: 'SMS_TOO_LONG',
        error: `SMS ${smsInfo(body).length} karakter; en fazla ${smsInfo(body).maxLength} olabilir (şablonu kısaltın)`,
        nextAttemptAt: null,
      });
    } else if (channel === 'SMS') {
      row.nextAttemptAt = quietHoursRelease(now, hotel.timezone, smsQuietHours(config.settings)) ?? now;
    }
    rows.push(row);
  }

  if (rows.length === 0) {
    return { queued: [], skipped: notes.join('; ') || 'Açık bildirim kanalı yok', duplicates: 0 };
  }

  return writeWithEvents(async (tx, stage) => {
    const created = await tx.notification.createManyAndReturn({
      data: rows,
      skipDuplicates: true,
      select: { id: true, channel: true, status: true, errorCode: true, error: true },
    });
    for (const row of created) {
      if (row.status === 'PENDING') {
        await stage('notification.send.requested', { hotelId, notificationId: row.id, channel: row.channel, source: trigger });
      } else if (row.status === 'CANCELLED') {
        await stage('notification.cancelled', { hotelId, notificationId: row.id, channel: row.channel });
      } else {
        await stage('notification.failed', {
          hotelId,
          notificationId: row.id,
          channel: row.channel,
          errorCode: row.errorCode,
          final: true,
        });
        await raiseDeliveryFailureAlert(tx, stage, { hotelId, ...row, notificationId: row.id });
      }
    }
    return {
      queued: created.map(({ id, channel, status }) => ({ id, channel, status })),
      skipped: notes.join('; ') || null,
      duplicates: rows.length - created.length,
    };
  });
}

/* ══════════════════ Geçmiş ══════════════════ */

/**
 * @param {string} hotelId
 * @param {object} query `notificationHistoryQuerySchema`
 */
export async function listNotifications(hotelId, query) {
  const cursor = parseCursor(query.cursor);
  const search = query.search?.trim();
  const and = [];
  if (search) {
    and.push({
      OR: [
        { recipient: { contains: search.replace(/^\+/, ''), mode: 'insensitive' } },
        { recipientName: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
        { reservation: { confirmationCode: { contains: search, mode: 'insensitive' } } },
      ],
    });
  }
  if (cursor) and.push(olderThan('createdAt', cursor));

  const rows = await prisma.notification.findMany({
    where: {
      hotelId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.reservationId ? { reservationId: query.reservationId } : {}),
      ...(and.length ? { AND: and } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    select: NOTIFICATION_LIST_SELECT,
  });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => toNotificationDto(row)),
    nextCursor: rows.length > query.limit && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
  };
}

/**
 * @param {string} hotelId
 * @param {string} notificationId
 */
export async function getNotification(hotelId, notificationId) {
  const row = await prisma.notification.findFirst({
    where: { id: notificationId, hotelId },
    select: {
      ...NOTIFICATION_LIST_SELECT,
      providerMessageId: true,
      resends: {
        select: { id: true, status: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }],
        take: DETAIL_RESEND_LIMIT,
      },
    },
  });
  if (!row) throw new NotFoundError('Bildirim bulunamadı');
  return {
    ...toNotificationDto(row, { full: true }),
    providerMessageId: row.providerMessageId,
    resends: row.resends.map((resend) => ({ id: resend.id, status: resend.status, createdAt: iso(resend.createdAt) })),
  };
}

/**
 * Son 24 saatin durum sayıları ve sıradaki toplam (sekme rozetleri). Kanal
 * testleri sayılmaz: "misafire ulaşmadı" sayısını yöneticinin denemesi şişirmesin.
 * @param {string} hotelId
 */
export async function getNotificationSummary(hotelId) {
  const since = new Date(Date.now() - SUMMARY_WINDOW_MS);
  const [byStatus, pending] = await Promise.all([
    prisma.notification.groupBy({
      by: ['status'],
      // groupBy soft-delete filtresinin dışında: koşul açıkça yazılı.
      where: { hotelId, createdAt: { gte: since }, source: { not: 'CHANNEL_TEST' }, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.notification.count({ where: { hotelId, status: { in: ['PENDING', 'SENDING'] } } }),
  ]);
  return {
    last24h: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    pending,
    secretKeyConfigured: secretKeyConfigured(),
  };
}

/**
 * Bildirimi yeniden gönderir (yeni kayıt; eskisi olduğu gibi kalır).
 * Misafir kartı değiştiyse (adres düzeltildi) güncel adrese gider.
 *
 * @param {string} hotelId
 * @param {string} notificationId
 */
export async function resendNotification(hotelId, notificationId) {
  const hotel = await getHotelSettings(hotelId);
  const id = await writeWithEvents(async (tx, stage) => {
    const original = await tx.notification.findFirst({
      where: { id: notificationId, hotelId },
      include: { guest: { select: { email: true, phone: true } } },
    });
    if (!original) throw new NotFoundError('Bildirim bulunamadı');
    if (!NOTIFICATION_RESENDABLE_STATUSES.includes(original.status)) {
      throw new ConflictError('Sırada ya da gönderilmekte olan bildirim yeniden gönderilemez.', 'NOT_RESENDABLE');
    }
    if (original.source === 'CHANNEL_TEST') {
      throw new ConflictError('Test iletisi yeniden gönderilmez; kanal ayarından yeni test yapın.', 'NOT_RESENDABLE');
    }

    const recipient = (original.guest && recipientFor(original.channel, original.guest, hotel.phoneCountryCode)) ?? original.recipient;
    const created = await tx.notification.create({
      data: {
        hotelId,
        channel: original.channel,
        source: original.source,
        language: original.language,
        recipient,
        recipientName: original.recipientName,
        subject: original.subject,
        body: original.body,
        params: original.params ?? {},
        status: 'PENDING',
        nextAttemptAt: new Date(),
        templateId: original.templateId,
        guestId: original.guestId,
        reservationId: original.reservationId,
        resendOfId: original.id,
        createdBy: currentActor(),
      },
      select: { id: true, channel: true, source: true, recipient: true },
    });
    await recordAudit(tx, {
      hotelId,
      entity: 'Notification',
      entityId: created.id,
      action: 'CREATE',
      after: { resendOf: original.id, channel: created.channel, recipient: created.recipient },
    });
    await stage('notification.send.requested', {
      hotelId,
      notificationId: created.id,
      channel: created.channel,
      source: created.source,
    });
    return created.id;
  });
  return getNotification(hotelId, id);
}

/**
 * Sıradaki bildirimi iptal eder (gönderilmekte olan iptal edilemez).
 * @param {string} hotelId
 * @param {string} notificationId
 * @param {{ reason: string }} input
 */
export async function cancelNotification(hotelId, notificationId, { reason }) {
  await writeWithEvents(async (tx, stage) => {
    const { count } = await tx.notification.updateMany({
      where: { id: notificationId, hotelId, status: 'PENDING' },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, nextAttemptAt: null },
    });
    const row = await tx.notification.findFirst({ where: { id: notificationId, hotelId }, select: { channel: true } });
    if (!row) throw new NotFoundError('Bildirim bulunamadı');
    if (count === 0) {
      throw new ConflictError('Yalnızca sırada bekleyen bildirim iptal edilebilir.', 'NOT_PENDING');
    }
    await recordAudit(tx, {
      hotelId,
      entity: 'Notification',
      entityId: notificationId,
      action: 'UPDATE',
      before: { status: 'PENDING' },
      after: { status: 'CANCELLED', cancelReason: reason },
    });
    await stage('notification.cancelled', { hotelId, notificationId, channel: row.channel });
  });
  return getNotification(hotelId, notificationId);
}

/* ══════════════════ Kanal testi ══════════════════ */

/**
 * Test iletisini hazırlar: satır doğrudan "gönderiliyor" durumunda yazılır ki
 * arka plandaki gönderici üstlenmeye çalışmasın; gönderimi çağıran yapar.
 *
 * @param {string} hotelId
 * @param {{ channel: 'EMAIL' | 'SMS', to: string }} input
 * @returns {Promise<{ id: string }>}
 */
export async function prepareChannelTest(hotelId, { channel, to }) {
  const [hotel, config] = await Promise.all([
    getHotelSettings(hotelId),
    prisma.notificationChannelConfig.findFirst({ where: { hotelId, channel }, select: { id: true } }),
  ]);
  if (!config) throw new ValidationError('Önce kanal ayarını kaydedin', { field: 'channel' });

  const recipient = channel === 'EMAIL' ? to.trim().toLowerCase() : internationalPhone(to, hotel.phoneCountryCode);
  if (!recipient) throw new ValidationError('Geçerli bir telefon numarası girin', { field: 'to' });

  const hotelName = channel === 'SMS' ? sanitizeSmsValue(hotel.name) : hotel.name;
  const body =
    channel === 'EMAIL'
      ? `Bu ileti ${hotelName} bildirim ayarlarını denemek için gönderildi.\n\nBu iletiyi aldıysanız e-posta kanalı çalışıyor.`
      : `${hotelName}: bildirim ayarları test mesajı. Bu mesajı aldıysanız SMS kanalı çalışıyor.`;

  const now = new Date();
  return writeWithEvents(async (tx) => {
    const row = await tx.notification.create({
      data: {
        hotelId,
        channel,
        source: 'CHANNEL_TEST',
        language: DEFAULT_NOTIFICATION_LANGUAGE,
        recipient,
        subject: channel === 'EMAIL' ? `${hotelName} — bildirim testi` : null,
        body,
        status: 'SENDING',
        attempts: 1,
        lockedAt: now,
        nextAttemptAt: null,
        createdBy: currentActor(),
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      hotelId,
      entity: 'Notification',
      entityId: row.id,
      action: 'CREATE',
      after: { source: 'CHANNEL_TEST', channel, recipient },
    });
    return row;
  });
}

/**
 * Test sonucunu kanal ayarına yazar. `updatedAt` değişmez: yönetici formu
 * açıkken test yapınca kaydetme "başkası değiştirdi" hatası vermesin.
 *
 * @param {string} hotelId
 * @param {string} channel
 * @param {{ ok: boolean, error: string | null }} result
 */
export async function recordChannelTest(hotelId, channel, { ok, error }) {
  await prisma.$executeRaw`
    UPDATE "NotificationChannelConfig"
    SET "lastTestAt" = now(), "lastTestOk" = ${ok}, "lastTestError" = ${error}
    WHERE "hotelId" = ${hotelId} AND "channel" = ${channel}::"NotificationChannel" AND "deletedAt" IS NULL`;
}
