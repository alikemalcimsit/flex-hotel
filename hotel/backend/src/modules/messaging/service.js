import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { currentActor } from '@hotelos/core';
import {
  deliveryReportSchema,
  GUEST_REQUEST_ACTIVE_STATUSES,
  inboundMessageSchema,
  MESSAGING_CHANNELS,
  REPLY_WAIT_WARNING_MINUTES,
} from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { parseCursor } from '../../lib/cursor.js';
import { ConflictError, NotFoundError, rethrowPrismaError, StaleWriteError, ValidationError } from '../../lib/errors.js';
import { LIVE_SCOPES, liveVersion } from '../../lib/live-version.js';
import { lockConversations, lockMessages } from '../../lib/locks.js';
import { createReadCache } from '../../lib/read-cache.js';
import { SQL_NOW, sqlTimestamp } from '../../lib/sql-time.js';
import {
  containsText,
  isFuzzyToken,
  MATCH_NOTHING,
  matchGuestIds,
  matchReservationIdsByCode,
  matchRoomIdsByNumber,
  searchTokens,
} from '../../lib/search.js';
import { assertAssignableStaff, currentStaff, currentStaffCached } from '../../lib/staff.js';
import { writeWithEvents } from '../../lib/write.js';
import { channelActiveFor } from '../channels/service.js';
import { aiActiveFor } from '../concierge/settings.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { getHotelSettings } from '../settings/service.js';
import {
  deliveryAdvances,
  encodeCursor,
  messagePreview,
  normalizeEmail,
  olderThan,
  PHONE_MATCH_DIGITS,
  phoneMatchKey,
  phoneMatchScore,
} from './rules.js';

/**
 * Misafir mesajları servisi (modül 7).
 *
 * ### Kanal bağımsız
 *
 * Mesajı gerçekten taşıyan WhatsApp / web chat geçitleri modül 8'de. Bu
 * servis iki uçlu bir sözleşme sunar:
 *
 * - **Gelen:** geçit `receiveInboundMessage` çağırır. Konuşma yoksa açılır,
 *   misafir telefon/e-postadan eşleştirilir, içerideki (ya da yaklaşan)
 *   konaklamaya bağlanır. Aynı kanal mesajı iki kez gelirse tek kayıt olur.
 * - **Giden:** personel (`sendStaffMessage`) ya da AI (`appendAiReply`)
 *   yazınca mesaj "gönderim bekliyor" doğar ve `guest.message.reply`
 *   yayınlanır; geçit gönderip `markMessageDelivery` ile bildirir.
 *
 * Geçit henüz yokken cevaplar bekler — ekran bunu açıkça gösterir,
 * gönderilmiş gibi yapmaz (bkz. `lib/channels.js`).
 *
 * ### Eşzamanlılık
 *
 * Konuşma satırı sayaç ve özet taşır. Mesaj yazan her işlem önce konuşmayı
 * kilitler; aynı anda gelen iki mesaj sayacı ezmez. Yönetim işlemleri
 * (atama, kapatma, manuele alma) `stateVersion` ile korunur: iki personel aynı
 * anda farklı karar verirse ikincisi "kayıt değişti" uyarısı alır; bu arada
 * misafirin yazması çakışma sayılmaz.
 *
 * ### Yük
 *
 * Gelen kutusu listesi her satır için mesaj saymaz (özet konuşmada) ve
 * imleçle sayfalanır. Yan menü rozetini besleyen özet sürüm anahtarlı
 * önbellekten gelir (2500 açık panel aynı anda sormaz).
 */

/** Rozet özeti önbelleğinin ömrü. */
const SUMMARY_CACHE_TTL_MS = 30_000;
const SUMMARY_CACHE_MAX_ENTRIES = 5000;
const summaryCache = createReadCache({ ttlMs: SUMMARY_CACHE_TTL_MS, maxEntries: SUMMARY_CACHE_MAX_ENTRIES });

/**
 * Gelen kutusu ilk sayfası önbelleği. Aynı otelde açık duran panellerin çoğu
 * aynı şeye bakar (açık konuşmalar, filtre yok); yeni mesaj haberi gelince
 * hepsi aynı sorguyu atar — sürüm anahtarıyla tek hesaplamaya iner. Aramalı
 * ve "daha eski" sayfalar önbelleğe alınmaz (kişiye özgü, seyrek).
 */
const LIST_CACHE_TTL_MS = 15_000;
const LIST_CACHE_MAX_ENTRIES = 2000;
const listCache = createReadCache({ ttlMs: LIST_CACHE_TTL_MS, maxEntries: LIST_CACHE_MAX_ENTRIES });

const MINUTE_MS = 60_000;

/** Aynı istemci kimliğiyle tekrar gönderimin tanındığı süre. */
const CLIENT_RETRY_WINDOW_MS = 24 * 60 * MINUTE_MS;

/**
 * Oda numarasıyla aramada bakılan konaklamalar: içeridekiler ve yakında
 * çıkmış olanlar ("204'teki misafir yazdı mı?").
 */
const ROOM_SEARCH_LOOKBACK_MS = 30 * 24 * 60 * MINUTE_MS;

/** Oda numarasıyla bulunan en fazla konaklama. */
const ROOM_SEARCH_STAY_LIMIT = 500;

/** Telefonun son rakamları aynı olan en fazla bu kadar kart karşılaştırılır. */
const PHONE_MATCH_CANDIDATES = 20;

/** İçeride konaklama yoksa bağlanacak yaklaşan konaklama durumları. */
const UPCOMING_STAY_STATUSES = Object.freeze(['CONFIRMED', 'PENDING']);

const CONVERSATION_LIST_INCLUDE = Object.freeze({
  guest: { select: { id: true, firstName: true, lastName: true } },
  assignedTo: { select: { id: true, name: true } },
  reservation: {
    select: {
      id: true,
      confirmationCode: true,
      status: true,
      checkIn: true,
      checkOut: true,
      room: { select: { id: true, number: true } },
    },
  },
});

/* ══════════════════ Dönüştürücüler ══════════════════ */

/** @param {{ firstName: string, lastName: string } | null | undefined} guest */
const guestName = (guest) => (guest ? `${guest.firstName} ${guest.lastName}`.trim() : null);

/** @param {Date | null | undefined} value */
const iso = (value) => (value ? value.toISOString() : null);

/** @param {Date} value */
const isoDay = (value) => value.toISOString().slice(0, 10);

function toConversationDto(row) {
  const stay = row.reservation;
  return {
    id: row.id,
    channel: row.channel,
    address: row.externalId,
    // Misafir kartı eşleştiyse gerçek ad; yoksa kanalın bildirdiği ad, o da yoksa adres.
    contactName: guestName(row.guest) ?? row.displayName ?? row.externalId,
    guest: row.guest ? { id: row.guest.id, name: guestName(row.guest) } : null,
    stay: stay
      ? {
          reservationId: stay.id,
          confirmationCode: stay.confirmationCode,
          status: stay.status,
          checkIn: isoDay(stay.checkIn),
          checkOut: isoDay(stay.checkOut),
          roomId: stay.room?.id ?? null,
          roomNumber: stay.room?.number ?? null,
        }
      : null,
    status: row.status,
    mode: row.mode,
    assignedTo: row.assignedTo ? { id: row.assignedTo.id, name: row.assignedTo.name } : null,
    unreadCount: row.unreadCount,
    lastMessageAt: iso(row.lastMessageAt),
    lastMessagePreview: row.lastMessagePreview,
    lastMessageAuthor: row.lastMessageAuthor,
    awaitingReplySince: iso(row.awaitingReplySince),
    stateVersion: row.stateVersion,
    updatedAt: iso(row.updatedAt),
  };
}

function toMessageDto(row) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    direction: row.direction,
    author: row.author,
    actorName: row.actorName,
    text: row.text,
    internal: row.internal,
    // İç not kanala gitmez; teslim durumu gösterilmez.
    delivery: row.internal ? null : row.delivery,
    failureReason: row.failureReason,
    sentAt: iso(row.sentAt),
    deliveredAt: iso(row.deliveredAt),
    createdAt: iso(row.createdAt),
    /** Router ajanının belirlediği niyet (modül 8; yalnızca misafir mesajında). */
    intent: row.meta?.intent ?? null,
  };
}

/* ══════════════════ Yardımcılar ══════════════════ */

/**
 * Kanal adresinden misafir kartı.
 *
 * Telefon yazım biçiminden bağımsız eşleşir ("0532 111 00 01" kartı,
 * WhatsApp'ın "905321110001"i). Aynı numaraya birden fazla kart varsa önce
 * birebir aynı yazılan, sonra en son güncellenen alınır (tekrarlanan kartları
 * birleştirmek modül 22'nin işi).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {{ channel: string, externalId: string }} input
 * @param {string} phoneCountryCode otelin telefon ülke kodu
 */
async function matchGuest(tx, hotelId, { channel, externalId }, phoneCountryCode) {
  if (channel === 'EMAIL') {
    const email = normalizeEmail(externalId);
    if (!email) return null;
    // Kartta büyük harfle yazılmış adres de eşleşir. İfade
    // `Guest_hotelId_email_lower_idx` ile birebir aynı (büyük/küçük harf
    // duyarsız eşitlik index'siz tabloyu baştan sona tarıyordu).
    const [row] = await tx.$queryRaw`
      SELECT "id" FROM "Guest"
      WHERE "hotelId" = ${hotelId}
        AND "email" IS NOT NULL
        AND "deletedAt" IS NULL
        AND lower("email") = ${email}
      ORDER BY "updatedAt" DESC
      LIMIT 1`;
    return row ? { id: row.id } : null;
  }
  if (channel === 'WHATSAPP' || channel === 'SMS') {
    const key = phoneMatchKey(externalId);
    if (!key) return null;
    // İfade `Guest_phone_match_idx` ile birebir aynı olmalı (sayı sabit yazılır,
    // parametre olursa dizin kullanılmaz). Aday az: son rakamları aynı kartlar.
    const candidates = await tx.$queryRaw`
      SELECT "id", "phone" FROM "Guest"
      WHERE "hotelId" = ${hotelId}
        AND "phone" IS NOT NULL
        AND "deletedAt" IS NULL
        AND right(regexp_replace("phone", '[^0-9]', '', 'g'), ${Prisma.raw(String(PHONE_MATCH_DIGITS))}) = ${key}
      ORDER BY "updatedAt" DESC
      LIMIT ${PHONE_MATCH_CANDIDATES}`;
    let best = null;
    let bestScore = 0;
    for (const row of candidates) {
      const score = phoneMatchScore(row.phone, externalId, phoneCountryCode);
      if (score > bestScore) {
        best = row;
        bestScore = score;
      }
    }
    return best ? { id: best.id } : null;
  }
  // Web chat oturumu kimlik taşımaz; misafir personel tarafından bağlanır.
  return null;
}

/**
 * Misafirin şu anki (içerideyse) ya da en yakın (gelecekse) konaklaması.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} guestId
 * @param {Date} businessDate
 */
async function findCurrentStay(tx, hotelId, guestId, businessDate) {
  const inHouse = await tx.reservation.findFirst({
    where: { hotelId, guestId, status: 'CHECKED_IN' },
    orderBy: [{ checkIn: 'desc' }],
    select: { id: true },
  });
  if (inHouse) return inHouse;
  return tx.reservation.findFirst({
    where: { hotelId, guestId, status: { in: [...UPCOMING_STAY_STATUSES] }, checkOut: { gt: businessDate } },
    orderBy: [{ checkIn: 'asc' }],
    select: { id: true },
  });
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {string} conversationId
 */
async function loadConversation(client, hotelId, conversationId) {
  const row = await client.conversation.findFirst({
    where: { id: conversationId, hotelId },
    include: CONVERSATION_LIST_INCLUDE,
  });
  if (!row) throw new NotFoundError('Konuşma bulunamadı');
  return row;
}

/**
 * Gelen kutusu görünümü → sorgu.
 * @param {string} view
 * @param {{ id: string } | null} staff
 */
function viewWhere(view, staff) {
  switch (view) {
    case 'WAITING':
      return { status: 'OPEN', awaitingReplySince: { not: null } };
    case 'MINE':
      // Kimliği bilinmeyen kullanıcıya boş liste: başkasının işini "benim" diye göstermeyelim.
      return { status: 'OPEN', assignedToId: staff?.id ?? '00000000-0000-0000-0000-000000000000' };
    case 'UNASSIGNED':
      return { status: 'OPEN', assignedToId: null };
    case 'CLOSED':
      return { status: 'CLOSED' };
    case 'ALL':
      return {};
    default:
      return { status: 'OPEN' };
  }
}

/**
 * Gelen kutusu araması: her kelime konuşmanın adında, adresinde, son
 * mesajında, bağlı misafirin adında, konaklamanın onay kodunda ya da oda
 * numarasında geçmeli. İlişkiler önceden bulunur (bkz. `lib/search.js`).
 *
 * @param {string} hotelId
 * @param {string | undefined} search
 */
async function searchWhere(hotelId, search) {
  const tokens = searchTokens(search);
  if (tokens.length === 0) return {};
  return { AND: await Promise.all(tokens.map((token) => searchTokenWhere(hotelId, token))) };
}

/** @param {string} hotelId @param {string} token */
async function searchTokenWhere(hotelId, token) {
  const or = [];
  const roomIds = await matchRoomIdsByNumber(prisma, hotelId, token);
  if (roomIds.length > 0) {
    const stays = await prisma.reservation.findMany({
      where: {
        hotelId,
        roomId: { in: roomIds },
        checkOut: { gte: new Date(Date.now() - ROOM_SEARCH_LOOKBACK_MS) },
      },
      select: { id: true },
      take: ROOM_SEARCH_STAY_LIMIT,
    });
    if (stays.length > 0) or.push({ reservationId: { in: stays.map((stay) => stay.id) } });
  }
  if (isFuzzyToken(token)) {
    const [guestIds, reservationIds] = await Promise.all([
      matchGuestIds(prisma, hotelId, token),
      matchReservationIdsByCode(prisma, hotelId, token),
    ]);
    or.push(
      { displayName: containsText(token) },
      { externalId: containsText(token) },
      { lastMessagePreview: containsText(token) },
    );
    if (guestIds.length > 0) or.push({ guestId: { in: guestIds } });
    if (reservationIds.length > 0) or.push({ reservationId: { in: reservationIds } });
  }
  return or.length > 0 ? { OR: or } : MATCH_NOTHING;
}

/* ══════════════════ Gelen kutusu ══════════════════ */

/**
 * @param {string} hotelId
 * @param {{ view: string, channel?: string, search?: string, cursor?: string, limit: number }} query
 */
export async function listConversations(hotelId, query) {
  const cursor = parseCursor(query.cursor, 'cursor');
  const staff = query.view === 'MINE' ? await currentStaffCached(prisma, hotelId) : null;

  if (cursor || query.search) return queryConversations(hotelId, query, cursor, staff);

  const key = JSON.stringify([
    hotelId,
    liveVersion(LIVE_SCOPES.MESSAGING, hotelId),
    query.view,
    query.channel ?? '',
    query.limit,
    staff?.id ?? '',
  ]);
  return listCache.get(key, () => queryConversations(hotelId, query, null, staff));
}

/**
 * @param {string} hotelId
 * @param {{ view: string, channel?: string, search?: string, limit: number }} query
 * @param {{ at: Date, id: string } | null} cursor
 * @param {{ id: string } | null} staff
 */
async function queryConversations(hotelId, query, cursor, staff) {
  const search = await searchWhere(hotelId, query.search);
  const rows = await prisma.conversation.findMany({
    where: {
      hotelId,
      ...viewWhere(query.view, staff),
      ...(query.channel ? { channel: query.channel } : {}),
      AND: [search, cursor ? olderThan('lastMessageAt', cursor) : {}],
    },
    include: CONVERSATION_LIST_INCLUDE,
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
  });

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toConversationDto),
    nextCursor: rows.length > query.limit && last ? encodeCursor({ at: last.lastMessageAt, id: last.id }) : null,
  };
}

/**
 * Açık konuşmaların kime atandığı: personel → sayı. Sürüm başına **tek**
 * gruplu sorgu; 2500 panel her yeni mesajda rozetini tazelediğinde 2500 ayrı
 * sayım yapılmaz.
 *
 * @param {string} hotelId
 * @param {number} version
 * @returns {Promise<Map<string, number>>}
 */
function assignedCounts(hotelId, version) {
  return summaryCache.get(JSON.stringify(['inbox-assigned', hotelId, version]), async () => {
    const rows = await prisma.conversation.groupBy({
      by: ['assignedToId'],
      where: { hotelId, status: 'OPEN', assignedToId: { not: null } },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.assignedToId, row._count._all]));
  });
}

/**
 * Yan menü rozeti ve gelen kutusu sekmelerinin sayıları.
 *
 * İki parçalı önbellek: otel geneli sayılar (sürüm + dakika anahtarlı —
 * "uzun süredir bekleyen" zamanla değişir) bütün personelde ortaktır; "bana
 * atanan" da personel başına sayı tablosundan okunur (sürüm başına tek
 * sorgu). Böylece bir otelde 2500 panel açıkken değişiklik başına 2500 değil,
 * 2 hesaplama yapılır.
 *
 * @param {string} hotelId
 */
export async function getInboxSummary(hotelId) {
  const staff = await currentStaffCached(prisma, hotelId);
  const version = liveVersion(LIVE_SCOPES.MESSAGING, hotelId);
  const minute = Math.floor(Date.now() / MINUTE_MS);
  const open = { hotelId, status: 'OPEN' };

  const [shared, mine] = await Promise.all([
    summaryCache.get(JSON.stringify(['inbox', hotelId, version, minute]), async () => {
      const warnBefore = new Date(minute * MINUTE_MS - REPLY_WAIT_WARNING_MINUTES * MINUTE_MS);
      const [openCount, waiting, waitingTooLong, unassigned, totals] = await Promise.all([
        prisma.conversation.count({ where: open }),
        prisma.conversation.count({ where: { ...open, awaitingReplySince: { not: null } } }),
        prisma.conversation.count({ where: { ...open, awaitingReplySince: { lt: warnBefore } } }),
        prisma.conversation.count({ where: { ...open, assignedToId: null } }),
        prisma.conversation.aggregate({
          where: open,
          _sum: { unreadCount: true },
          _min: { awaitingReplySince: true },
        }),
      ]);
      return {
        open: openCount,
        waiting,
        waitingTooLong,
        unassigned,
        unread: totals._sum.unreadCount ?? 0,
        oldestWaitingSince: iso(totals._min.awaitingReplySince),
      };
    }),
    staff ? assignedCounts(hotelId, version).then((counts) => counts.get(staff.id) ?? 0) : 0,
  ]);

  return {
    ...shared,
    mine,
    replyWarningMinutes: REPLY_WAIT_WARNING_MINUTES,
    autoResponderAvailable: await aiActiveFor(hotelId),
  };
}

/** Sağlık ucu için önbellek isabet bilgisi. */
export function messagingCacheStats() {
  return { list: listCache.stats(), summary: summaryCache.stats() };
}

/**
 * Konuşma detayı: başlık bilgisi, misafir iletişimi, açık istek sayısı ve
 * kanalın bağlı olup olmadığı.
 *
 * @param {string} hotelId
 * @param {string} conversationId
 */
export async function getConversation(hotelId, conversationId) {
  const row = await prisma.conversation.findFirst({
    where: { id: conversationId, hotelId },
    include: {
      ...CONVERSATION_LIST_INCLUDE,
      guest: {
        select: { id: true, firstName: true, lastName: true, phone: true, email: true, nationality: true },
      },
      _count: { select: { requests: { where: { deletedAt: null, status: { in: [...GUEST_REQUEST_ACTIVE_STATUSES] } } } } },
    },
  });
  if (!row) throw new NotFoundError('Konuşma bulunamadı');

  return {
    ...toConversationDto(row),
    guestContact: row.guest
      ? { phone: row.guest.phone, email: row.guest.email, nationality: row.guest.nationality }
      : null,
    openRequestCount: row._count.requests,
    closedAt: iso(row.closedAt),
    closedBy: row.closedBy,
    lastReadAt: iso(row.lastReadAt),
    createdAt: iso(row.createdAt),
    channelConnected: await channelActiveFor(hotelId, row.channel),
    // AI yalnızca WhatsApp ve web chat'te cevap verir ("AI'a devret" düğmesi buna bakar).
    autoResponderAvailable: MESSAGING_CHANNELS.includes(row.channel) && (await aiActiveFor(hotelId)),
  };
}

/**
 * Konuşma geçmişi — en yeniden eskiye, imleçle. Ekran ters çevirip çizer ve
 * yukarı kaydırınca bir önceki sayfayı ister.
 *
 * @param {string} hotelId
 * @param {string} conversationId
 * @param {{ before?: string, limit: number }} query
 */
export async function listMessages(hotelId, conversationId, query) {
  const cursor = parseCursor(query.before, 'before');
  const exists = await prisma.conversation.findFirst({ where: { id: conversationId, hotelId }, select: { id: true } });
  if (!exists) throw new NotFoundError('Konuşma bulunamadı');

  const rows = await prisma.message.findMany({
    where: { hotelId, conversationId, ...(cursor ? olderThan('createdAt', cursor) : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
  });

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toMessageDto),
    nextCursor: rows.length > query.limit && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
  };
}

/* ══════════════════ Giden mesaj ══════════════════ */

/**
 * Konuşmaya giden mesaj yazar (personel ya da AI). Ortak kısım.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {{
 *   hotelId: string, conversation: object, text: string, author: 'STAFF' | 'AI' | 'SYSTEM',
 *   internal: boolean, actorName: string | null, meta: object,
 * }} input
 */
async function writeOutgoing(tx, stage, { hotelId, conversation, text, author, internal, actorName, meta }) {
  const now = new Date();
  const message = await tx.message.create({
    data: {
      hotelId,
      conversationId: conversation.id,
      direction: 'OUT',
      author,
      text,
      actorName,
      internal,
      // İç not kanala gitmez: kuyruğa düşmesin diye doğrudan "işlendi".
      delivery: internal ? 'SENT' : 'PENDING',
      sentAt: internal ? now : null,
      meta,
    },
  });

  if (internal) return { message, changedFields: [] };

  const changes = {
    lastMessageAt: now,
    lastMessagePreview: messagePreview(text),
    lastMessageAuthor: author,
    // Cevap verildi: bekleme biter, okunmamışlar okunmuş sayılır.
    awaitingReplySince: null,
    unreadCount: 0,
    lastReadAt: now,
  };
  const changedFields = [];
  // Sistem mesajı (ör. rezervasyon onay kodu) kapalı konuşmayı açmaz: yeni bir iş doğurmaz.
  if (conversation.status === 'CLOSED' && author !== 'SYSTEM') {
    Object.assign(changes, { status: 'OPEN', closedAt: null, closedBy: null });
    changedFields.push('status');
  }
  // Personel yazdıysa konuşmayı devralmıştır: AI aynı anda cevap vermesin.
  if (author === 'STAFF' && conversation.mode === 'AI') {
    changes.mode = 'MANUAL';
    changedFields.push('mode');
  }

  if (changedFields.length > 0) changes.stateVersion = { increment: 1 };
  const updated = await tx.conversation.update({ where: { id: conversation.id }, data: changes });

  await stage('guest.message.reply', {
    hotelId,
    conversationId: conversation.id,
    messageId: message.id,
    channel: conversation.channel,
    recipient: conversation.externalId,
    author,
  });
  if (changedFields.length > 0) {
    await stage('conversation.updated', {
      hotelId,
      conversationId: conversation.id,
      changedFields,
      mode: updated.mode,
      status: updated.status,
    });
  }

  return { message, changedFields };
}

/**
 * Personelin cevabı ya da iç notu.
 *
 * - Cevap "gönderim bekliyor" doğar; kanal gönderince güncellenir.
 * - Kapalı konuşmaya yazmak konuşmayı açar; AI modundaki konuşmaya yazmak
 *   konuşmayı personele alır.
 * - Aynı `clientMessageId` ile tekrar gelen istek (çift tık, ağ tekrarı) ilk
 *   mesajı döndürür.
 *
 * @param {string} hotelId
 * @param {string} conversationId
 * @param {{ text: string, internal: boolean, clientMessageId?: string }} input
 */
export async function sendStaffMessage(hotelId, conversationId, input) {
  return writeWithEvents(async (tx, stage) => {
    if (!(await lockConversations(tx, hotelId, [conversationId])).has(conversationId)) {
      throw new NotFoundError('Konuşma bulunamadı');
    }

    if (input.clientMessageId) {
      // Tekrar gönderim ekran açıkken olur; pencere, uzun konuşmada bütün
      // geçmişin JSON'unu taramamak için (konuşma + zaman index'i).
      const duplicate = await tx.message.findFirst({
        where: {
          conversationId,
          createdAt: { gte: new Date(Date.now() - CLIENT_RETRY_WINDOW_MS) },
          meta: { path: ['clientMessageId'], equals: input.clientMessageId },
        },
      });
      if (duplicate) return toMessageDto(duplicate);
    }

    const conversation = await tx.conversation.findFirst({ where: { id: conversationId, hotelId } });
    const staff = await currentStaff(tx, hotelId);
    const { message } = await writeOutgoing(tx, stage, {
      hotelId,
      conversation,
      text: input.text,
      author: 'STAFF',
      internal: input.internal,
      actorName: staff?.name ?? currentActor(),
      meta: input.clientMessageId ? { clientMessageId: input.clientMessageId } : {},
    });
    return toMessageDto(message);
  });
}

/**
 * AI asistanının cevabı (modül 8'in concierge ajanı çağırır).
 *
 * Konuşma personele alınmışsa (manuel) ya da kapalıysa yazılmaz: personel
 * konuşmayı devraldıktan sonra AI'ın araya girmesi misafiri şaşırtır.
 *
 * @param {string} hotelId
 * @param {string} conversationId
 * @param {{ text: string, meta?: object }} input
 */
export async function appendAiReply(hotelId, conversationId, { text, meta = {} }) {
  return writeWithEvents(async (tx, stage) => {
    if (!(await lockConversations(tx, hotelId, [conversationId])).has(conversationId)) {
      throw new NotFoundError('Konuşma bulunamadı');
    }
    const conversation = await tx.conversation.findFirst({ where: { id: conversationId, hotelId } });
    if (conversation.mode !== 'AI' || conversation.status !== 'OPEN') {
      throw new ConflictError('Konuşma personele alınmış ya da kapalı; AI cevabı yazılmadı.', 'CONVERSATION_MANUAL');
    }
    const { message } = await writeOutgoing(tx, stage, {
      hotelId,
      conversation,
      text,
      author: 'AI',
      internal: false,
      actorName: null,
      meta,
    });
    return toMessageDto(message);
  });
}

/**
 * Sistemin misafire yazdığı mesaj (modül 8): rezervasyon onay kodu, isteğin
 * açılamadığı bilgisi. AI modunda olmayan konuşmaya da gider — misafirin
 * isteğinin sonucu personel konuşmayı devralmış olsa da ona ulaşmalı.
 *
 * @param {string} hotelId
 * @param {string} conversationId
 * @param {{ text: string, meta?: object }} input
 */
export async function appendSystemReply(hotelId, conversationId, { text, meta = {} }) {
  return writeWithEvents(async (tx, stage) => {
    if (!(await lockConversations(tx, hotelId, [conversationId])).has(conversationId)) {
      throw new NotFoundError('Konuşma bulunamadı');
    }
    const conversation = await tx.conversation.findFirst({ where: { id: conversationId, hotelId } });
    const { message } = await writeOutgoing(tx, stage, { hotelId, conversation, text, author: 'SYSTEM', internal: false, actorName: null, meta });
    return toMessageDto(message);
  });
}

/**
 * Sistem mesajını **çağıranın transaction'ında** yazar ve istenirse konuşmayı
 * rezervasyona bağlar (modül 8: onay kodu, isteğin sonucu). Çağıran kendi
 * kaydını (ör. AI isteğinin kapanması) aynı işlemde yazar; yarıda kalırsa
 * ne mesaj gider ne istek kapanır — tekrar denemede misafir kodu bir kez alır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {{ hotelId: string, conversationId: string, text: string, meta?: object, reservationId?: string | null }} input
 */
export async function writeSystemReplyInTx(tx, stage, { hotelId, conversationId, text, meta = {}, reservationId = null }) {
  if (!(await lockConversations(tx, hotelId, [conversationId])).has(conversationId)) {
    throw new NotFoundError('Konuşma bulunamadı');
  }
  let conversation = await tx.conversation.findFirst({ where: { id: conversationId, hotelId } });
  if (reservationId && !conversation.reservationId) {
    const reservation = await tx.reservation.findFirst({ where: { id: reservationId, hotelId }, select: { id: true, guestId: true } });
    if (reservation && (!conversation.guestId || conversation.guestId === reservation.guestId)) {
      conversation = await tx.conversation.update({
        where: { id: conversationId },
        data: { reservationId: reservation.id, guestId: reservation.guestId, stateVersion: { increment: 1 } },
      });
      await stage('conversation.updated', {
        hotelId,
        conversationId,
        changedFields: ['reservationId', 'guestId'],
        mode: conversation.mode,
        status: conversation.status,
      });
    }
  }
  const { message } = await writeOutgoing(tx, stage, { hotelId, conversation, text, author: 'SYSTEM', internal: false, actorName: null, meta });
  return toMessageDto(message);
}

/** Devir sebebinin personelin gördüğü açıklaması. */
const HANDOFF_REASONS = Object.freeze({
  COMPLAINT: 'Misafir şikâyet ediyor',
  HUMAN: 'Misafir personelle görüşmek istedi',
  BUDGET: 'Günlük AI bütçesi doldu',
  NOT_CONFIGURED: 'AI anahtarı tanımlı değil',
  DISABLED: 'AI kapalı',
  NO_PRICE: 'AI modelinin fiyatı ayarlanmamış',
  PROVIDER: 'AI sağlayıcısı kullanılamıyor',
  LIMIT: 'Konuşmanın günlük AI cevap sınırı doldu',
  LOOP: 'AI cevap üretemedi',
  EMPTY: 'AI cevap üretemedi',
  MODEL: 'AI konuşmayı personele devretti',
  AGENT_FAILED: 'AI ajanı kapalı ya da hata verdi',
  STALLED: 'AI zamanında cevap veremedi',
  REQUEST_FAILED: 'AI\'ın rezervasyon isteği açılamadı',
});

/**
 * AI konuşmayı personele devreder (modül 8): tek işlemde
 * 1. misafire kısa bilgi (verildiyse; AI modundaysa),
 * 2. personelin konuşmada göreceği iç not (sebep),
 * 3. mod → personel; konuşma "cevap bekliyor" kalır (bilgi mesajı misafirin
 *    isteğini karşılamadı, personel ilgilenmeli),
 * 4. zile uyarı (atanan kişiye ya da mesaj yetkisi olanlara); bütçe dolduysa
 *    ayrıca yönetime günde bir uyarı.
 * Konuşma zaten personeldeyse hiçbir şey yapmaz (tekrar edilebilir).
 *
 * @param {string} hotelId
 * @param {string} conversationId
 * @param {{ reason: string, detail?: string | null, notice?: string | null, severity?: 'INFO' | 'WARNING' | 'CRITICAL' }} input
 * @returns {Promise<{ changed: boolean }>}
 */
export async function handOffToStaff(hotelId, conversationId, { reason, detail = null, notice = null, severity = 'INFO' }) {
  const today = (await getBusinessDate(hotelId)).toISOString().slice(0, 10);
  return writeWithEvents(async (tx, stage) => {
    if (!(await lockConversations(tx, hotelId, [conversationId])).has(conversationId)) {
      throw new NotFoundError('Konuşma bulunamadı');
    }
    let conversation = await tx.conversation.findFirst({ where: { id: conversationId, hotelId } });
    if (conversation.mode !== 'AI') return { changed: false };

    const waitingSince = conversation.awaitingReplySince ?? new Date();
    const label = HANDOFF_REASONS[reason] ?? 'AI konuşmayı devretti';
    if (notice && conversation.status === 'OPEN') {
      await writeOutgoing(tx, stage, { hotelId, conversation, text: notice, author: 'AI', internal: false, actorName: null, meta: { handoff: reason } });
    }
    await tx.message.create({
      data: {
        hotelId,
        conversationId,
        direction: 'OUT',
        author: 'SYSTEM',
        text: `AI konuşmayı devretti: ${label}${detail && detail !== label ? ` (${detail})` : ''}`,
        internal: true,
        delivery: 'SENT',
        sentAt: new Date(),
        meta: { handoff: reason },
      },
    });
    conversation = await tx.conversation.update({
      where: { id: conversationId },
      data: { mode: 'MANUAL', awaitingReplySince: waitingSince, stateVersion: { increment: 1 } },
    });
    await recordAudit(tx, {
      hotelId,
      entity: 'Conversation',
      entityId: conversationId,
      action: 'UPDATE',
      before: { mode: 'AI' },
      after: { mode: 'MANUAL', handoff: reason },
    });
    await stage('conversation.updated', { hotelId, conversationId, changedFields: ['mode'], mode: 'MANUAL', status: conversation.status });

    const who = conversation.displayName ?? conversation.externalId;
    await raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'AI_HANDOFF',
      severity,
      title: `${who}: ${label}`,
      body: 'Konuşma personele geçti; misafir cevap bekliyor.',
      link: `/mesajlar/${conversationId}`,
      ...(conversation.assignedToId ? { userId: conversation.assignedToId } : { permission: 'messages.reply' }),
      entityType: 'Conversation',
      entityId: conversationId,
      dedupeKey: `ai-handoff:${conversationId}`,
    });
    if (reason === 'BUDGET') {
      await raiseStaffAlert(tx, stage, {
        hotelId,
        kind: 'AI_BUDGET',
        severity: 'WARNING',
        title: 'Günlük AI bütçesi doldu',
        body: 'Yeni misafir mesajları bugün personele düşüyor. Bütçe Ayarlar → AI asistanı ekranından artırılabilir.',
        link: '/ayarlar/ai',
        permission: 'settings.manage',
        dedupeKey: `ai-budget:${today}`,
      });
    }
    return { changed: true };
  });
}

/** Sahiplenmenin geçerlilik süresi: gönderen süreç çökerse mesaj takılı kalmasın. */
const CLAIM_TTL_MS = 2 * 60_000;

/**
 * Kanal geçidi giden mesajı göndermeden önce **sahiplenir**: aynı mesaj hem
 * olayla hem "bekleyenleri gönder" işiyle gelse bile bir kez gider. Mesaj
 * gönderilmişse, iç notsa, başka kanaldansa ya da başkası sahiplendiyse null.
 *
 * @param {string} hotelId
 * @param {string} messageId
 * @param {'WHATSAPP' | 'WEBCHAT'} channel
 * @returns {Promise<null | { messageId: string, conversationId: string, externalId: string, text: string, author: string, createdAt: Date, lastInboundAt: Date | null }>}
 */
export async function claimOutgoingMessage(hotelId, messageId, channel) {
  const cutoff = new Date(Date.now() - CLAIM_TTL_MS).toISOString();
  const [row] = await prisma.$queryRaw`
    UPDATE "Message" m
    SET "meta" = m."meta" || jsonb_build_object('claimedAt', ${new Date().toISOString()}::text)
    FROM "Conversation" c
    WHERE m."id" = ${messageId} AND m."hotelId" = ${hotelId} AND m."deletedAt" IS NULL
      AND m."direction" = 'OUT' AND m."internal" = false AND m."delivery" = 'PENDING'
      AND c."id" = m."conversationId" AND c."channel" = ${channel}::"NotificationChannel"
      AND (m."meta"->>'claimedAt' IS NULL OR m."meta"->>'claimedAt' < ${cutoff})
    RETURNING m."id" AS "messageId", m."conversationId", c."externalId", m."text", m."author"::text AS "author", m."createdAt"`;
  if (!row) return null;
  const [lastInbound] = await prisma.message.findMany({
    where: { conversationId: row.conversationId, direction: 'IN' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: { createdAt: true },
  });
  return { ...row, lastInboundAt: lastInbound?.createdAt ?? null };
}

/**
 * Sahipliği bırakır (geçici hata: tekrar denenecek).
 * @param {string} hotelId
 * @param {string} messageId
 */
export async function releaseOutgoingMessage(hotelId, messageId) {
  await prisma.$executeRaw`
    UPDATE "Message" SET "meta" = "meta" - 'claimedAt'
    WHERE "id" = ${messageId} AND "hotelId" = ${hotelId} AND "delivery" = 'PENDING'`;
}

/**
 * Gönderim bekleyen giden mesajlar (kanal açılınca ya da geçici hatadan sonra
 * gönderilecekler). Kısmi index'li (`Message_pending_outgoing_idx`).
 *
 * Yalnızca kanalı **açık** otellerin mesajları: kanalı kapalı bir otelin
 * bekleyen yüzlerce mesajı her turda listenin başını tutup diğer otellerin
 * mesajlarını bekletmesin. Şu an başka bir işin elindeki (sahiplenilmiş)
 * mesaj da atlanır.
 *
 * @param {'WHATSAPP' | 'WEBCHAT'} channel
 * @param {{ olderThanMs: number, limit: number }} options
 * @returns {Promise<Array<{ id: string, hotelId: string }>>}
 */
export function pendingOutgoingMessages(channel, { olderThanMs, limit }) {
  const claimCutoff = new Date(Date.now() - CLAIM_TTL_MS).toISOString();
  return prisma.$queryRaw`
    SELECT m."id", m."hotelId"
    FROM "Message" m
    JOIN "Conversation" c ON c."id" = m."conversationId"
    JOIN "MessagingChannel" mc ON mc."hotelId" = m."hotelId" AND mc."channel" = c."channel" AND mc."enabled" = true
    WHERE m."delivery" = 'PENDING' AND m."direction" = 'OUT' AND m."internal" = false AND m."deletedAt" IS NULL
      AND m."createdAt" < ${sqlTimestamp(new Date(Date.now() - olderThanMs))}
      AND c."channel" = ${channel}::"NotificationChannel"
      AND (m."meta"->>'claimedAt' IS NULL OR m."meta"->>'claimedAt' < ${claimCutoff})
    ORDER BY m."createdAt" ASC
    LIMIT ${limit}`;
}

/**
 * Kanalın mesaj kimliğiyle mesaj (teslim bildirimi).
 * @param {string} hotelId
 * @param {string} externalId
 */
export async function findMessageIdByExternalId(hotelId, externalId) {
  const row = await prisma.message.findFirst({ where: { hotelId, externalId, direction: 'OUT' }, select: { id: true } });
  return row?.id ?? null;
}

/**
 * Kanaldaki misafirin gördüğü konuşma (web chat balonunun geçmişi): iç notlar
 * yok, en yeni `limit` mesaj eskiden yeniye. Konuşma yoksa boş.
 *
 * @param {string} hotelId
 * @param {'WEBCHAT'} channel
 * @param {string} externalId oturum kimliği
 * @param {{ limit: number }} options
 * @returns {Promise<Array<{ id: string, author: string, text: string, at: string }>>}
 */
export async function conversationTranscript(hotelId, channel, externalId, { limit }) {
  const conversation = await prisma.conversation.findFirst({
    where: { hotelId, channel, externalId },
    select: { id: true },
  });
  if (!conversation) return [];
  const rows = await prisma.message.findMany({
    where: { hotelId, conversationId: conversation.id, internal: false },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: { id: true, author: true, text: true, createdAt: true },
  });
  return rows.reverse().map((row) => ({ id: row.id, author: row.author, text: row.text, at: row.createdAt.toISOString() }));
}

/**
 * Misafir kanalda mesajları gördü (web chat balonu): yalnızca **bu
 * oturumun** konuşmasındaki giden mesajlar "okundu" olur — başka konuşmanın
 * mesaj kimliğini gönderen biri ona dokunamaz. Tek işlem, tek güncelleme;
 * durum yalnızca ileri gider.
 *
 * @param {string} hotelId
 * @param {'WEBCHAT'} channel
 * @param {string} externalId
 * @param {string[]} messageIds
 * @returns {Promise<number>} okundu yapılan mesaj
 */
export async function markChannelMessagesRead(hotelId, channel, externalId, messageIds) {
  if (messageIds.length === 0) return 0;
  return writeWithEvents(async (tx, stage) => {
    const conversation = await tx.conversation.findFirst({ where: { hotelId, channel, externalId }, select: { id: true } });
    if (!conversation) return 0;
    const updated = await tx.$queryRaw`
      UPDATE "Message"
      SET "delivery" = 'READ', "deliveredAt" = COALESCE("deliveredAt", ${SQL_NOW}), "sentAt" = COALESCE("sentAt", ${SQL_NOW}), "updatedAt" = ${SQL_NOW}
      WHERE "hotelId" = ${hotelId} AND "conversationId" = ${conversation.id}
        AND "id" IN (${Prisma.join(messageIds)})
        AND "direction" = 'OUT' AND "internal" = false AND "deletedAt" IS NULL
        AND "delivery" IN ('PENDING', 'SENT', 'DELIVERED')
      RETURNING "id"`;
    for (const row of updated) {
      await stage('guest.message.delivery', { hotelId, conversationId: conversation.id, messageId: row.id, delivery: 'READ' });
    }
    return updated.length;
  });
}

/* ══════════════════ Kanal sözleşmesi (modül 8) ══════════════════ */

/**
 * Kanaldan gelen misafir mesajı.
 *
 * Kanal geçidi (webhook) çağırır; HTTP ucu yoktur — kimliği doğrulanmamış bir
 * uçtan "misafir mesajı" yazdırmak sahte mesaj demektir. Geçit kendi
 * imza/token doğrulamasını yapıp bunu çağırır.
 *
 * @param {string} hotelId
 * @param {object} raw `inboundMessageSchema`
 * @returns {Promise<{ duplicate: boolean, conversationId: string, mode?: string, message: object }>}
 */
export async function receiveInboundMessage(hotelId, raw) {
  const parsed = inboundMessageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Gelen mesaj geçersiz');
  }
  const input = parsed.data;
  const [businessDate, hotel, aiOn] = await Promise.all([getBusinessDate(hotelId), getHotelSettings(hotelId), aiActiveFor(hotelId)]);
  // AI yalnızca konuşarak rezervasyon yapılabilen kanallarda cevap verir (modül 8).
  const aiActive = aiOn && MESSAGING_CHANNELS.includes(input.channel);

  try {
    return await writeWithEvents(async (tx, stage) => {
      // Konuşmayı yarışsız aç: aynı numaradan aynı anda iki mesaj gelirse ikisi
      // de aynı konuşmaya yazılmalı (benzersiz anahtar + ON CONFLICT).
      await tx.$executeRaw`
        INSERT INTO "Conversation" ("id", "hotelId", "channel", "externalId", "displayName", "mode", "updatedAt")
        VALUES (${randomUUID()}, ${hotelId}, ${input.channel}::"NotificationChannel", ${input.externalId},
                ${input.displayName ?? null}, ${aiActive ? 'AI' : 'MANUAL'}::"ConversationMode", ${SQL_NOW})
        ON CONFLICT ("hotelId", "channel", "externalId") DO NOTHING`;

      const [locked] = await tx.$queryRaw`
        SELECT "id", "deletedAt" FROM "Conversation"
        WHERE "hotelId" = ${hotelId} AND "channel" = ${input.channel}::"NotificationChannel" AND "externalId" = ${input.externalId}
        FOR UPDATE`;
      const conversationId = locked.id;
      if (locked.deletedAt) {
        // `deletedAt` koşulu açıkça yazılı: yoksa soft-delete eklentisi silinmiş
        // satırı filtreler ve geri alma hiçbir şey yapmaz.
        await tx.conversation.updateMany({
          where: { id: conversationId, deletedAt: { not: null } },
          data: { deletedAt: null },
        });
      }

      const duplicate = await tx.message.findFirst({
        where: { conversationId, externalId: input.externalMessageId },
      });
      if (duplicate) return { duplicate: true, conversationId, message: toMessageDto(duplicate) };

      const conversation = await tx.conversation.findFirst({ where: { id: conversationId, hotelId } });

      // Misafir henüz bağlı değilse kanal adresinden bulmayı dene.
      const link = {};
      if (!conversation.guestId) {
        const guest = await matchGuest(tx, hotelId, input, hotel.phoneCountryCode);
        if (guest) {
          link.guestId = guest.id;
          const stay = await findCurrentStay(tx, hotelId, guest.id, businessDate);
          if (stay && !conversation.reservationId) link.reservationId = stay.id;
        }
      }

      const now = new Date();
      const message = await tx.message.create({
        data: {
          hotelId,
          conversationId,
          direction: 'IN',
          author: 'GUEST',
          text: input.text,
          actorName: input.displayName ?? null,
          delivery: 'RECEIVED',
          externalId: input.externalMessageId,
          sentAt: input.sentAt ?? null,
        },
      });

      const reopened = conversation.status === 'CLOSED';
      // AI modundaki konuşmaya cevap verecek asistan yoksa (otel AI'ı kapattı,
      // sunucuda anahtar yok) misafir cevapsız beklemesin: konuşma personele geçer.
      const toStaff = conversation.mode === 'AI' && !aiActive;
      const updated = await tx.conversation.update({
        where: { id: conversationId },
        data: {
          ...link,
          ...(input.displayName && !conversation.displayName ? { displayName: input.displayName } : {}),
          lastMessageAt: now,
          lastMessagePreview: messagePreview(input.text),
          lastMessageAuthor: 'GUEST',
          unreadCount: { increment: 1 },
          // İlk cevapsız mesajın zamanı korunur: bekleme süresi ondan sayılır.
          awaitingReplySince: conversation.awaitingReplySince ?? now,
          ...(reopened ? { status: 'OPEN', closedAt: null, closedBy: null } : {}),
          ...(toStaff ? { mode: 'MANUAL' } : {}),
          ...(reopened || link.guestId || toStaff ? { stateVersion: { increment: 1 } } : {}),
        },
      });

      await stage('guest.message.received', {
        hotelId,
        conversationId,
        messageId: message.id,
        channel: input.channel,
        guestId: updated.guestId,
        mode: updated.mode,
      });
      if (reopened || link.guestId || toStaff) {
        await stage('conversation.updated', {
          hotelId,
          conversationId,
          changedFields: [...(reopened ? ['status'] : []), ...(toStaff ? ['mode'] : []), ...Object.keys(link)],
          mode: updated.mode,
          status: updated.status,
        });
      }

      return { duplicate: false, conversationId, mode: updated.mode, message: toMessageDto(message) };
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Kanalın giden mesaj için bildirdiği teslim durumu.
 *
 * Durum yalnızca ileri gider; geç gelen bildirim (READ'den sonra SENT)
 * yok sayılır. İşlem tekrar edilebilir.
 *
 * @param {string} hotelId
 * @param {string} messageId
 * @param {object} raw `deliveryReportSchema`
 */
export async function markMessageDelivery(hotelId, messageId, raw) {
  const parsed = deliveryReportSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Teslim bildirimi geçersiz');
  }
  const report = parsed.data;

  try {
    return await writeWithEvents(async (tx, stage) => {
      // Kilit: aynı mesaj için eşzamanlı gelen bildirimler sırayla karar verir;
      // "okundu" yazıldıktan sonra işlenen "gönderildi" durumu geri almaz.
      if (!(await lockMessages(tx, hotelId, [messageId])).has(messageId)) {
        throw new NotFoundError('Mesaj bulunamadı');
      }
      const message = await tx.message.findFirst({ where: { id: messageId, hotelId } });
      if (message.direction !== 'OUT' || message.internal) {
        throw new ConflictError('Yalnızca misafire giden mesajın teslim durumu değişir.', 'NOT_OUTBOUND');
      }
      if (!deliveryAdvances(message.delivery, report.delivery)) return toMessageDto(message);

      const at = report.at ?? new Date();
      const updated = await tx.message.update({
        where: { id: messageId },
        data: {
          delivery: report.delivery,
          ...(report.externalMessageId && !message.externalId ? { externalId: report.externalMessageId } : {}),
          ...(report.delivery === 'SENT' && !message.sentAt ? { sentAt: at } : {}),
          ...(['DELIVERED', 'READ'].includes(report.delivery) ? { deliveredAt: message.deliveredAt ?? at } : {}),
          failureReason: report.delivery === 'FAILED' ? report.failureReason ?? 'Kanal gönderemedi' : null,
        },
      });

      await stage('guest.message.delivery', {
        hotelId,
        conversationId: message.conversationId,
        messageId,
        delivery: report.delivery,
      });
      return toMessageDto(updated);
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/* ══════════════════ Yönetim ══════════════════ */

/**
 * Konuşma okundu. Sayaç zaten sıfırsa yazma yapılmaz (her tıklamada event
 * üretmemek için).
 *
 * @param {string} hotelId
 * @param {string} conversationId
 */
export async function markConversationRead(hotelId, conversationId) {
  return writeWithEvents(async (tx, stage) => {
    const { count } = await tx.conversation.updateMany({
      where: { id: conversationId, hotelId, unreadCount: { gt: 0 } },
      data: { unreadCount: 0, lastReadAt: new Date() },
    });
    if (count === 0) {
      const exists = await tx.conversation.findFirst({ where: { id: conversationId, hotelId }, select: { id: true } });
      if (!exists) throw new NotFoundError('Konuşma bulunamadı');
      return { changed: false };
    }
    await stage('conversation.read', { hotelId, conversationId });
    return { changed: true };
  });
}

/**
 * Kapatma / yeniden açma, AI ↔ personel, atama, konaklama bağlama.
 *
 * @param {string} hotelId
 * @param {string} conversationId
 * @param {{ status?: string, mode?: string, assignedToId?: string | null, reservationId?: string | null, expectedStateVersion: number }} input
 */
export async function updateConversation(hotelId, conversationId, input) {
  await writeWithEvents(async (tx, stage) => {
    if (!(await lockConversations(tx, hotelId, [conversationId])).has(conversationId)) {
      throw new NotFoundError('Konuşma bulunamadı');
    }
    const before = await tx.conversation.findFirst({ where: { id: conversationId, hotelId } });
    // Yalnızca yönetim sürümü karşılaştırılır: bu arada gelen mesaj çakışma değildir.
    if (before.stateVersion !== input.expectedStateVersion) {
      throw new StaleWriteError(
        'Bu konuşma siz bakarken başka biri tarafından güncellendi (atama, durum ya da mod). Ekran yenilendi; tekrar deneyin.',
      );
    }

    const data = {};

    if (input.status !== undefined && input.status !== before.status) {
      if (input.status === 'CLOSED') {
        // Kapatmak "ilgilenildi" demektir: bekleme ve okunmamış sayacı sıfırlanır.
        Object.assign(data, {
          status: 'CLOSED',
          closedAt: new Date(),
          closedBy: currentActor(),
          awaitingReplySince: null,
          unreadCount: 0,
        });
      } else {
        Object.assign(data, { status: 'OPEN', closedAt: null, closedBy: null });
      }
    }

    if (input.mode !== undefined && input.mode !== before.mode) {
      if (input.mode === 'AI' && !MESSAGING_CHANNELS.includes(before.channel)) {
        throw new ConflictError('AI asistanı yalnızca WhatsApp ve web chat konuşmalarına cevap verir.', 'AI_CHANNEL_NOT_SUPPORTED');
      }
      if (input.mode === 'AI' && !(await aiActiveFor(hotelId))) {
        throw new ConflictError(
          'AI asistanı bu otelde açık değil (Ayarlar → AI asistanı); konuşma personelde kalmalı, yoksa misafir cevapsız kalır.',
          'NO_AUTO_RESPONDER',
        );
      }
      data.mode = input.mode;
    }

    if (input.assignedToId !== undefined && input.assignedToId !== before.assignedToId) {
      await assertAssignableStaff(tx, hotelId, input.assignedToId);
      data.assignedToId = input.assignedToId;
    }

    if (input.reservationId !== undefined && input.reservationId !== before.reservationId) {
      if (input.reservationId) {
        const reservation = await tx.reservation.findFirst({
          where: { id: input.reservationId, hotelId },
          select: { id: true, guestId: true },
        });
        if (!reservation) throw new ValidationError('Konaklama bulunamadı', { field: 'reservationId' });
        if (before.guestId && reservation.guestId !== before.guestId) {
          throw new ValidationError('Bu konaklama konuşmadaki misafire ait değil.', { field: 'reservationId' });
        }
        data.reservationId = reservation.id;
        // Konaklamayı bağlamak misafiri de tanımlar (web chat gibi kimliksiz kanallar).
        if (!before.guestId) data.guestId = reservation.guestId;
      } else {
        data.reservationId = null;
      }
    }

    const changedFields = Object.keys(data).filter((key) =>
      ['status', 'mode', 'assignedToId', 'reservationId', 'guestId'].includes(key),
    );
    if (changedFields.length === 0) return;

    const after = await tx.conversation.update({
      where: { id: conversationId },
      data: { ...data, stateVersion: { increment: 1 } },
    });

    await recordAudit(tx, {
      hotelId,
      entity: 'Conversation',
      entityId: conversationId,
      action: 'UPDATE',
      before: {
        status: before.status,
        mode: before.mode,
        assignedToId: before.assignedToId,
        reservationId: before.reservationId,
        guestId: before.guestId,
      },
      after: {
        status: after.status,
        mode: after.mode,
        assignedToId: after.assignedToId,
        reservationId: after.reservationId,
        guestId: after.guestId,
      },
    });
    await stage('conversation.updated', {
      hotelId,
      conversationId,
      changedFields,
      mode: after.mode,
      status: after.status,
    });
  });

  return getConversation(hotelId, conversationId);
}

/**
 * Konuşmayı yükle (başka modüller için: istek servisi konuşmadan istek açar).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} conversationId
 */
export function loadConversationForRequest(tx, hotelId, conversationId) {
  return loadConversation(tx, hotelId, conversationId);
}
