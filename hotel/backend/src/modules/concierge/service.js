import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { guessLanguage, handoffMessage } from '@hotelos/concierge-agent';
import { toDecimal } from '@hotelos/core';
import { MESSAGING_CHANNELS } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { lockConversations } from '../../lib/locks.js';
import { writeWithEvents } from '../../lib/write.js';
import { appendAiReply, handOffToStaff, writeSystemReplyInTx } from '../messaging/service.js';
import { quoteReservation } from '../reservations/service.js';
import { getHotelSettings } from '../settings/service.js';
import { getAiSettingsCached } from './settings.js';

/**
 * Router ve concierge ajanlarının veritabanı tarafı (modül 8).
 *
 * Ajan paketleri Prisma bilmez; bu dosya onlara servis nesnesi verir. İki
 * kural her fonksiyonda:
 *
 * - **Otel kapsamı.** Her sorgu `hotelId` ile; ajanın verdiği kimlik başka
 *   otelin kaydına dokunamaz.
 * - **Konuşma kilidi.** AI hafızasını (`ConversationAiState`) yazan her işlem
 *   önce konuşma satırını kilitler (mesaj servisiyle aynı sıra: konuşma →
 *   hafıza). Router'ın niyet kaydı, concierge'ın tur sonu kaydı ve
 *   rezervasyon sonucu aynı anda gelse de birbirini ezmez.
 *
 * Model çağrısı sırasında transaction açık tutulmaz: tur saniyeler sürer;
 * her yazım kısa, ayrı bir işlem.
 */

/** Tura yüklenen en fazla mesaj (özetlenmemiş son mesajlar; özet ondan öncesini taşır). */
export const HISTORY_WINDOW = 60;

/**
 * Gönderilen rezervasyon isteğinin cevabı bu süre içinde gelmezse (rezervasyon
 * aktörü kapalı, iş personele düşmüş) yeni istek engellenmez: aksi hâlde
 * misafir o konuşmada bir daha rezervasyon yapamazdı.
 */
export const REQUEST_STALE_MS = 30 * 60_000;

/** Misafir kartı yoksa tanınan ad yok: kanalın bildirdiği ad (WhatsApp profili) kimlik değildir. */
const guestNameOf = (guest) => (guest ? `${guest.firstName} ${guest.lastName}`.trim() : null);

/** @param {Date} value */
const dayKey = (value) => value.toISOString().slice(0, 10);

/** @param {string} day "YYYY-MM-DD" */
const dotted = (day) => day.split('-').reverse().join('.');

/** Pansiyon türünün modele giden (İngilizce) adı. */
const BOARD_NAMES = Object.freeze({
  RO: 'Room only',
  BB: 'Bed & breakfast',
  HB: 'Half board (breakfast and dinner)',
  FB: 'Full board (all main meals)',
  AI: 'All inclusive',
  UAI: 'Ultra all inclusive',
});

/**
 * Otelin iptal politikası (modele giden metin). Hesap `reservations/rules.js
 * → cancellationTerms` ile aynı kural: 0 gün ya da %0 ceza "ücretsiz".
 * @param {{ cancellationPolicyDays: number, cancellationPolicyPenaltyPct: string }} hotel
 */
export function cancellationText(hotel) {
  const days = Number(hotel.cancellationPolicyDays ?? 0);
  const penalty = toDecimal(hotel.cancellationPolicyPenaltyPct ?? '0');
  if (days <= 0 || penalty.isZero()) return 'Free cancellation.';
  return `Free cancellation until ${days} day${days === 1 ? '' : 's'} before arrival; later cancellations are charged ${penalty.toString()}% of the total price.`;
}

/** @param {string} board */
export function boardText(board) {
  return `${BOARD_NAMES[board] ?? board} (${board}) is included in the quoted prices. Other board options are arranged by staff.`;
}

/**
 * WhatsApp'ta misafirin yazdığı numara bilinir (Meta doğrular); diğer
 * kanallarda misafir kartındaki telefon.
 * @param {{ channel: string, externalId: string, guest: { phone: string | null } | null }} conversation
 */
export function knownPhoneOf(conversation) {
  if (conversation.channel === 'WHATSAPP' && /^\d{7,15}$/.test(conversation.externalId)) return `+${conversation.externalId}`;
  return conversation.guest?.phone ?? null;
}

/**
 * Hafıza satırını yazar (yoksa açar). Çağıran konuşmayı kilitlemiş olmalı:
 * "güncelle, yoksa ekle" iki eşzamanlı yazıcıda yarışsız kalır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} conversationId
 * @param {object} data
 */
async function writeAiState(tx, hotelId, conversationId, data) {
  const { count } = await tx.conversationAiState.updateMany({ where: { conversationId, hotelId }, data });
  if (count === 0) await tx.conversationAiState.create({ data: { conversationId, hotelId, ...data } });
}

/** @param {object | null | undefined} value */
const jsonOrNull = (value) => (value == null ? Prisma.DbNull : value);

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} conversationId
 */
async function lockConversation(tx, hotelId, conversationId) {
  if (!(await lockConversations(tx, hotelId, [conversationId])).has(conversationId)) {
    throw new NotFoundError('Konuşma bulunamadı');
  }
}

/**
 * Bekleyen teklifin router'a giden kısa hâli ("evet" neye evet?).
 * @param {object | null} offer
 */
function describeOffer(offer) {
  if (!offer) return null;
  return `${offer.roomTypeName}, ${offer.checkIn} → ${offer.checkOut}, ${offer.adults} adults${offer.children ? `, ${offer.children} children` : ''}, ${offer.totalPrice} ${offer.currency}`;
}

/* ══════════════════ Router ajanı ══════════════════ */

/** @type {import('@hotelos/router-agent').RouterService} */
export const routerService = {
  /**
   * @param {string} hotelId
   * @param {string} messageId
   */
  async loadMessage(hotelId, messageId) {
    const message = await prisma.message.findFirst({
      where: { id: messageId, hotelId, direction: 'IN' },
      select: {
        text: true,
        createdAt: true,
        conversationId: true,
        conversation: { select: { mode: true, status: true, aiState: { select: { language: true, pendingOffer: true } } } },
      },
    });
    if (!message) return null;
    // Misafirin "evet"i neye cevap: ondan önceki son giden mesaj (konuşma + zaman index'i).
    const lastAssistant = await prisma.message.findFirst({
      where: { hotelId, conversationId: message.conversationId, direction: 'OUT', internal: false, createdAt: { lt: message.createdAt } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { text: true },
    });
    const state = message.conversation.aiState;
    return {
      conversationId: message.conversationId,
      mode: message.conversation.mode,
      status: message.conversation.status,
      text: message.text,
      language: state?.language ?? null,
      pendingOffer: describeOffer(state?.pendingOffer ?? null),
      lastAssistantMessage: lastAssistant?.text ?? null,
    };
  },

  /** @param {string} hotelId */
  settings: (hotelId) => getAiSettingsCached(hotelId),

  /**
   * Niyet mesaja ve hafızaya yazılır, concierge'a olay gider — tek işlemde.
   * @param {string} hotelId
   * @param {{ conversationId: string, messageId: string, intent: string, confidence: number, language: string, affirmative: boolean }} intent
   */
  async recordIntent(hotelId, intent) {
    await writeWithEvents(async (tx, stage) => {
      await lockConversation(tx, hotelId, intent.conversationId);
      await tx.$executeRaw`
        UPDATE "Message"
        SET "meta" = "meta" || ${JSON.stringify({ intent: intent.intent, intentConfidence: intent.confidence })}::jsonb
        WHERE "id" = ${intent.messageId} AND "hotelId" = ${hotelId}`;
      await writeAiState(tx, hotelId, intent.conversationId, { language: intent.language, lastIntent: intent.intent });
      await stage('guest.intent.detected', { hotelId, ...intent });
    });
  },

  /**
   * AI kullanılamıyor (bütçe, anahtar, sağlayıcı) ya da ajan düştü: misafire
   * kısa bilgi, konuşma personele.
   * @param {string} hotelId
   * @param {string} conversationId
   * @param {{ reason: string, detail?: string }} handoff
   */
  async handOff(hotelId, conversationId, { reason, detail }) {
    // Dil: router daha önce belirlediyse o; ilk mesajda model hiç çalışmadıysa
    // (bütçe, anahtar) misafirin son mesajından modelsiz tahmin.
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, hotelId },
      select: { lastMessagePreview: true, aiState: { select: { language: true } } },
    });
    const language = conversation?.aiState?.language ?? guessLanguage(conversation?.lastMessagePreview);
    await handOffToStaff(hotelId, conversationId, {
      reason,
      detail: detail ?? null,
      notice: handoffMessage('UNAVAILABLE', language),
      severity: reason === 'BUDGET' ? 'WARNING' : 'INFO',
    });
  },
};

/* ══════════════════ Concierge ajanı ══════════════════ */

/** @type {import('@hotelos/concierge-agent').ConciergeService} */
export const conciergeService = {
  /**
   * Turun bağlamı: konuşma, otel, ayar, hafıza ve özetlenmemiş son mesajlar.
   * Beş sorgu, hepsi index'li (konuşma PK, mesaj `conversationId + createdAt`,
   * otel ve AI ayarı önbellekli).
   *
   * @param {string} hotelId
   * @param {string} conversationId
   */
  async loadTurn(hotelId, conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, hotelId },
      select: {
        id: true,
        mode: true,
        status: true,
        channel: true,
        externalId: true,
        guestId: true,
        guest: { select: { firstName: true, lastName: true, phone: true, email: true } },
        aiState: true,
      },
    });
    if (!conversation) return null;
    const state = conversation.aiState;

    const [hotel, settings, today, recent] = await Promise.all([
      getHotelSettings(hotelId),
      getAiSettingsCached(hotelId),
      getBusinessDate(hotelId),
      prisma.message.findMany({
        where: {
          hotelId,
          conversationId,
          internal: false,
          ...(state?.summarizedUntil ? { createdAt: { gt: state.summarizedUntil } } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: HISTORY_WINDOW,
        select: { id: true, author: true, direction: true, text: true, createdAt: true },
      }),
    ]);

    const latestGuest = recent.find((message) => message.direction === 'IN') ?? null;
    // Cevaplanmış: son misafir mesajından sonra AI ya da personel yazmış
    // (sistem mesajı — onay kodu, devir bilgisi — misafirin sorusunun cevabı değil).
    const answered = latestGuest
      ? recent.some((message) => message.direction === 'OUT' && ['AI', 'STAFF'].includes(message.author) && message.createdAt > latestGuest.createdAt)
      : true;
    const requestFresh = state?.pendingRequestId && state.requestedAt && Date.now() - state.requestedAt.getTime() < REQUEST_STALE_MS;

    return {
      conversation: {
        id: conversation.id,
        mode: conversation.mode,
        status: conversation.status,
        channel: conversation.channel,
        guestId: conversation.guestId,
        guestName: guestNameOf(conversation.guest),
        knownPhone: knownPhoneOf(conversation),
        guestEmail: conversation.guest?.email ?? null,
      },
      hotel: {
        name: hotel.name,
        currency: hotel.currency,
        checkInTime: hotel.checkInTime,
        checkOutTime: hotel.checkOutTime,
        cancellation: cancellationText(hotel),
        boards: boardText(hotel.defaultBoardType),
        info: settings.hotelInfo,
        today: dayKey(today),
      },
      settings: {
        conciergeModel: settings.conciergeModel,
        routerModel: settings.routerModel,
        maxRepliesPerConversationDay: settings.maxRepliesPerConversationDay,
        reservationStatus: settings.reservationStatus,
      },
      memory: {
        language: state?.language ?? null,
        summary: state?.summary ?? null,
        offers: Array.isArray(state?.offers) ? state.offers : [],
        offersAt: state?.offersAt ? state.offersAt.toISOString() : null,
        pendingOffer: state?.pendingOffer ?? null,
        pendingRequestId: requestFresh ? state.pendingRequestId : null,
        repliesToday: state?.repliesDay && dayKey(state.repliesDay) === dayKey(today) ? state.repliesCount : 0,
      },
      messages: [...recent].reverse().map((message) => ({
        id: message.id,
        author: message.author,
        text: message.text,
        at: message.createdAt.toISOString(),
      })),
      latestGuest: latestGuest ? { id: latestGuest.id, at: latestGuest.createdAt.toISOString() } : null,
      unanswered: !answered,
    };
  },

  /**
   * Müsaitlik ve fiyat: rezervasyon formunun kullandığı önizlemenin aynısı
   * (aynı fiyat kuralı, aynı envanter takvimi).
   * @param {string} hotelId
   * @param {{ checkIn: string, checkOut: string }} stay
   */
  async checkAvailability(hotelId, stay) {
    const quote = await quoteReservation(hotelId, {
      checkIn: new Date(`${stay.checkIn}T00:00:00.000Z`),
      checkOut: new Date(`${stay.checkOut}T00:00:00.000Z`),
      lines: [],
    });
    return {
      currency: quote.currency,
      roomTypes: quote.roomTypes.map((type) => ({
        id: type.id,
        code: type.code,
        name: type.name,
        capacityAdults: type.capacityAdults,
        capacityChildren: type.capacityChildren,
        available: type.available,
        total: type.total,
      })),
    };
  },

  /**
   * Misafirin onayladığı teklif → rezervasyon isteği. İstek kimliği hafızaya,
   * personelin göreceği iç not konuşmaya, istek olayı rezervasyon aktörüne —
   * tek işlemde. Aynı konuşmada cevabı beklenen istek varsa ikincisi açılmaz.
   *
   * @param {string} hotelId
   * @param {string} conversationId
   * @param {{ offer: object, guest: { firstName: string, lastName: string, phone: string | null, email: string | null }, status: 'CONFIRMED' | 'PENDING' }} request
   */
  async requestReservation(hotelId, conversationId, { offer, guest, status }) {
    return writeWithEvents(async (tx, stage) => {
      await lockConversation(tx, hotelId, conversationId);
      const conversation = await tx.conversation.findFirst({
        where: { id: conversationId, hotelId },
        select: { channel: true, guestId: true, aiState: { select: { pendingRequestId: true, requestedAt: true } } },
      });
      const pending = conversation.aiState;
      if (pending?.pendingRequestId && pending.requestedAt && Date.now() - pending.requestedAt.getTime() < REQUEST_STALE_MS) {
        return { requestId: pending.pendingRequestId };
      }
      if (!MESSAGING_CHANNELS.includes(conversation.channel)) {
        throw new ConflictError('Bu kanaldan AI rezervasyon isteği gönderilemez.', 'CHANNEL_NOT_SUPPORTED');
      }

      const requestId = randomUUID();
      await writeAiState(tx, hotelId, conversationId, { pendingRequestId: requestId, requestedAt: new Date(), pendingOffer: Prisma.DbNull });
      const party = `${offer.adults} yetişkin${offer.children ? `, ${offer.children} çocuk` : ''}`;
      await tx.message.create({
        data: {
          hotelId,
          conversationId,
          direction: 'OUT',
          author: 'SYSTEM',
          text: `AI rezervasyon isteği gönderdi: ${offer.roomTypeName}, ${dotted(offer.checkIn)} – ${dotted(offer.checkOut)}, ${party}, ${offer.totalPrice} ${offer.currency} · ${guest.firstName} ${guest.lastName}`,
          internal: true,
          delivery: 'SENT',
          sentAt: new Date(),
          meta: { requestId },
        },
      });
      await stage('reservation.requested', {
        hotelId,
        requestId,
        source: conversation.channel,
        guest: { firstName: guest.firstName, lastName: guest.lastName, phone: guest.phone, email: guest.email, nationality: null },
        roomTypeId: offer.roomTypeId,
        checkIn: offer.checkIn,
        checkOut: offer.checkOut,
        adults: offer.adults,
        children: offer.children,
        boardType: null,
        notes: `AI asistanı ile ${conversation.channel === 'WHATSAPP' ? 'WhatsApp' : 'web chat'} konuşmasından.`,
        status,
        // Konuşma bir misafir kartına bağlıysa o kart (yeni kart açılmaz).
        guestId: conversation.guestId ?? null,
      });
      return { requestId };
    });
  },

  /**
   * Tur sonu hafıza. Cevap sayacı otelin iş gününe göre döner.
   * @param {string} hotelId
   * @param {string} conversationId
   * @param {{ summary?: string, summarizedUntil?: string, language: string | null, lastIntent: string, offers: object[],
   *           offersAt: string | null, pendingOffer: object | null, countReply: boolean }} patch
   */
  async saveMemory(hotelId, conversationId, patch) {
    const today = await getBusinessDate(hotelId);
    await writeWithEvents(async (tx) => {
      await lockConversation(tx, hotelId, conversationId);
      const data = {
        language: patch.language ?? null,
        lastIntent: patch.lastIntent ?? null,
        offers: patch.offers ?? [],
        offersAt: patch.offersAt ? new Date(patch.offersAt) : null,
        pendingOffer: jsonOrNull(patch.pendingOffer),
        ...(patch.summary ? { summary: patch.summary, summarizedUntil: new Date(patch.summarizedUntil) } : {}),
      };
      if (patch.countReply) {
        const current = await tx.conversationAiState.findFirst({
          where: { conversationId, hotelId },
          select: { repliesDay: true, repliesCount: true },
        });
        const sameDay = current?.repliesDay && dayKey(current.repliesDay) === dayKey(today);
        Object.assign(data, { repliesDay: today, repliesCount: sameDay ? current.repliesCount + 1 : 1 });
      }
      await writeAiState(tx, hotelId, conversationId, data);
    });
  },

  /**
   * @param {string} hotelId
   * @param {string} conversationId
   * @param {string} text
   * @param {object} meta
   */
  async reply(hotelId, conversationId, text, meta) {
    const message = await appendAiReply(hotelId, conversationId, { text, meta });
    return { messageId: message.id };
  },

  /**
   * @param {string} hotelId
   * @param {string} conversationId
   * @param {{ reason: string, detail?: string, notice?: string | null, severity?: 'INFO' | 'WARNING' | 'CRITICAL' }} handoff
   */
  async handOff(hotelId, conversationId, handoff) {
    await handOffToStaff(hotelId, conversationId, handoff);
  },

  /**
   * İsteği gönderen konuşma (tekil index `pendingRequestId`).
   * @param {string} hotelId
   * @param {string} requestId
   */
  async findRequest(hotelId, requestId) {
    const state = await prisma.conversationAiState.findFirst({
      where: { pendingRequestId: requestId, hotelId },
      select: { conversationId: true, language: true },
    });
    return state ? { conversationId: state.conversationId, language: state.language } : null;
  },

  /**
   * Onay mesajının alanları (tutar ve kod veritabanından; model yazmaz).
   * @param {string} hotelId
   * @param {string} reservationId
   */
  async reservationSummary(hotelId, reservationId) {
    const [reservation, hotel] = await Promise.all([
      prisma.reservation.findFirst({
        where: { id: reservationId, hotelId },
        select: {
          confirmationCode: true,
          status: true,
          checkIn: true,
          checkOut: true,
          adults: true,
          children: true,
          totalPrice: true,
          requestId: true,
          roomType: { select: { name: true } },
        },
      }),
      getHotelSettings(hotelId),
    ]);
    if (!reservation) return null;
    return {
      requestId: reservation.requestId,
      confirmationCode: reservation.confirmationCode,
      status: reservation.status,
      checkIn: dayKey(reservation.checkIn),
      checkOut: dayKey(reservation.checkOut),
      roomTypeName: reservation.roomType.name,
      adults: reservation.adults,
      children: reservation.children,
      totalPrice: reservation.totalPrice.toFixed(2),
      currency: hotel.currency,
    };
  },

  /**
   * Rezervasyon açıldı: istek kapanır, onay kodu misafire yazılır, konuşma
   * rezervasyona bağlanır — tek işlemde. İstek zaten kapandıysa (olay tekrar
   * geldi) hiçbir şey yapılmaz: misafir kodu bir kez alır.
   *
   * @param {string} hotelId
   * @param {string} conversationId
   * @param {{ requestId: string, reservationId: string, text: string }} done
   */
  async completeRequest(hotelId, conversationId, { requestId, reservationId, text }) {
    await writeWithEvents(async (tx, stage) => {
      await lockConversation(tx, hotelId, conversationId);
      const { count } = await tx.conversationAiState.updateMany({
        where: { conversationId, hotelId, pendingRequestId: requestId },
        data: { pendingRequestId: null, requestedAt: null },
      });
      if (count === 0) return;
      await writeSystemReplyInTx(tx, stage, { hotelId, conversationId, text, meta: { requestId, reservationId }, reservationId });
    });
  },

  /**
   * İstek karşılanamadı: istek kapanır, misafire sebebi yazılır.
   * @param {string} hotelId
   * @param {string} conversationId
   * @param {{ requestId: string, text: string }} failed
   */
  async failRequest(hotelId, conversationId, { requestId, text }) {
    await writeWithEvents(async (tx, stage) => {
      await lockConversation(tx, hotelId, conversationId);
      const { count } = await tx.conversationAiState.updateMany({
        where: { conversationId, hotelId, pendingRequestId: requestId },
        data: { pendingRequestId: null, requestedAt: null },
      });
      if (count === 0) return;
      await writeSystemReplyInTx(tx, stage, { hotelId, conversationId, text, meta: { requestId, rejected: true } });
    });
  },
};
