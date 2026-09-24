/**
 * Concierge ajanının araçları: şemalar (katı JSON şeması) ve korumalar.
 *
 * Saf dosya: veritabanına dokunmaz, test edilir. Aracı çalıştıran grafik
 * (graph.js) servisi çağırmadan önce buradaki kurallarla denetler.
 *
 * ### "Misafir evet demeden rezervasyon talebi basılmaz"
 *
 * İstemde yazması yetmez; model yanılabilir, misafir metninde talimat olabilir.
 * `request_reservation` ancak şu dördü birden doğruysa çalışır:
 * 1. Misafire bir teklif **sunulmuş** (`propose_reservation`) ve teklif kimliği tutuyor.
 * 2. Teklif **önceki** bir turda sunulmuş: misafir onu gördükten sonra yazmış.
 * 3. Router ajanı misafirin **son** mesajını teklife açık onay (`affirmative`) saymış.
 * 4. Aynı konuşmada cevabı beklenen başka istek yok.
 * Fiyat ve müsaitlik göndermeden hemen önce yeniden denetlenir.
 */

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** AI'ın açabileceği en uzun konaklama (daha uzunu personele). */
export const MAX_AI_NIGHTS = 30;
export const MAX_AI_ADULTS = 10;
export const MAX_AI_CHILDREN = 10;
/** En fazla bu kadar ileri tarih (yıllık fiyatlar hazır olmayabilir). */
export const MAX_AI_LEAD_DAYS = 540;
/** Teklifin geçerlilik süresi: sonrasında fiyat/müsaitlik yeniden sorulur. */
export const OFFER_TTL_MS = 30 * 60_000;

export const TOOL_NAMES = Object.freeze({
  CHECK_AVAILABILITY: 'check_availability',
  GET_HOTEL_INFO: 'get_hotel_info',
  PROPOSE: 'propose_reservation',
  REQUEST: 'request_reservation',
  HANDOFF: 'handoff_to_staff',
});

export const HOTEL_INFO_TOPICS = Object.freeze(['GENERAL', 'CHECK_IN_OUT', 'CANCELLATION', 'BOARD', 'FACILITIES', 'LOCATION', 'OTHER']);

const nullableString = { type: ['string', 'null'] };

/** Sağlayıcıya verilen araç tanımları (katı şema: her alan zorunlu, isteğe bağlılar null olabilir). */
export const TOOL_SPECS = Object.freeze([
  {
    name: TOOL_NAMES.CHECK_AVAILABILITY,
    description:
      'Check real availability and the total price for given dates and party size. Always call this before quoting any price or availability. Dates are YYYY-MM-DD; check_out is the departure day.',
    parameters: {
      type: 'object',
      properties: {
        check_in: { type: 'string', description: 'Arrival date YYYY-MM-DD' },
        check_out: { type: 'string', description: 'Departure date YYYY-MM-DD' },
        adults: { type: 'integer' },
        children: { type: 'integer' },
      },
      required: ['check_in', 'check_out', 'adults', 'children'],
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAMES.GET_HOTEL_INFO,
    description: 'Get facts about the hotel (check-in/out times, cancellation policy, boards, facilities, location). Never invent hotel facts.',
    parameters: {
      type: 'object',
      properties: { topic: { type: 'string', enum: [...HOTEL_INFO_TOPICS] } },
      required: ['topic'],
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAMES.PROPOSE,
    description:
      'Prepare a booking proposal from an offer returned by check_availability, with the guest name and contact. After this, show the summary to the guest and ask them to confirm explicitly. This does NOT book.',
    parameters: {
      type: 'object',
      properties: {
        offer_id: { type: 'string' },
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        phone: nullableString,
        email: nullableString,
      },
      required: ['offer_id', 'first_name', 'last_name', 'phone', 'email'],
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAMES.REQUEST,
    description:
      'Send the booking request for the proposal the guest has just explicitly confirmed. Only call after the guest said yes to the proposal in their latest message.',
    parameters: {
      type: 'object',
      properties: { offer_id: { type: 'string' } },
      required: ['offer_id'],
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAMES.HANDOFF,
    description: 'Hand the conversation over to hotel staff (complaint, special request you cannot handle, group/long stay, payment questions, or guest asks for a person).',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
      additionalProperties: false,
    },
  },
]);

/** @param {string} day "YYYY-MM-DD" */
function parseDay(day) {
  if (!DATE_PATTERN.test(String(day ?? ''))) return null;
  const time = Date.parse(`${day}T00:00:00.000Z`);
  if (Number.isNaN(time)) return null;
  // 31 Şubat gibi taşan tarih kabul edilmez.
  return new Date(time).toISOString().slice(0, 10) === day ? time : null;
}

/**
 * Müsaitlik aracının argümanları. Hata metni modele gider (misafire
 * düzeltmesini ister), İngilizce ve kısa.
 *
 * @param {{ check_in?: unknown, check_out?: unknown, adults?: unknown, children?: unknown }} args
 * @param {string} today otelin bugünü "YYYY-MM-DD"
 * @returns {{ ok: true, value: { checkIn: string, checkOut: string, nights: number, adults: number, children: number } } | { ok: false, error: string }}
 */
export function validateStayArgs(args, today) {
  const checkIn = parseDay(args.check_in);
  const checkOut = parseDay(args.check_out);
  const now = parseDay(today);
  if (checkIn === null || checkOut === null) return { ok: false, error: 'Dates must be valid YYYY-MM-DD.' };
  if (checkIn < now) return { ok: false, error: `Arrival date is in the past (today is ${today}). Ask the guest for future dates.` };
  if (checkOut <= checkIn) return { ok: false, error: 'Departure must be after arrival.' };
  const nights = Math.round((checkOut - checkIn) / DAY_MS);
  if (nights > MAX_AI_NIGHTS) return { ok: false, error: `Stays longer than ${MAX_AI_NIGHTS} nights are handled by staff; offer to hand over.` };
  if ((checkIn - now) / DAY_MS > MAX_AI_LEAD_DAYS) return { ok: false, error: 'Dates are too far ahead; staff will handle this request.' };
  const adults = Number(args.adults);
  const children = Number(args.children ?? 0);
  if (!Number.isInteger(adults) || adults < 1 || adults > MAX_AI_ADULTS) {
    return { ok: false, error: `Adults must be 1-${MAX_AI_ADULTS}; larger groups are handled by staff.` };
  }
  if (!Number.isInteger(children) || children < 0 || children > MAX_AI_CHILDREN) return { ok: false, error: `Children must be 0-${MAX_AI_CHILDREN}.` };
  return {
    ok: true,
    value: { checkIn: args.check_in, checkOut: args.check_out, nights, adults, children },
  };
}

/**
 * Teklif kimliği: okunur ve sorguya özgü ("STD-2026-10-15-2026-10-18-2-0").
 * @param {{ code: string }} roomType
 * @param {{ checkIn: string, checkOut: string, adults: number, children: number }} stay
 */
export function offerIdOf(roomType, stay) {
  return `${roomType.code}-${stay.checkIn}-${stay.checkOut}-${stay.adults}-${stay.children}`;
}

/**
 * Müsaitlik sonucundan misafire sunulabilecek teklifler: kişi sayısı sığan ve
 * boş odası olan tipler, en ucuz önce.
 *
 * @param {{ roomTypes: Array<{ id: string, code: string, name: string, capacityAdults: number, capacityChildren: number, available: number, total: string }>, currency: string }} quote
 * @param {{ checkIn: string, checkOut: string, nights: number, adults: number, children: number }} stay
 */
export function offersFrom(quote, stay) {
  return quote.roomTypes
    .filter((type) => type.available > 0 && type.capacityAdults >= stay.adults && type.capacityAdults + type.capacityChildren >= stay.adults + stay.children)
    .map((type) => ({
      offerId: offerIdOf(type, stay),
      roomTypeId: type.id,
      roomTypeName: type.name,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      nights: stay.nights,
      adults: stay.adults,
      children: stay.children,
      totalPrice: type.total,
      currency: quote.currency,
      available: type.available,
    }))
    .sort((a, b) => Number(a.totalPrice) - Number(b.totalPrice));
}

/** Tekliflerin modele giden hâli (kısa, iç kimlik yok). */
export function offersForModel(offers) {
  return offers.map((offer) => ({
    offer_id: offer.offerId,
    room_type: offer.roomTypeName,
    nights: offer.nights,
    total_price: offer.totalPrice,
    currency: offer.currency,
    rooms_left: offer.available <= 3 ? offer.available : undefined,
  }));
}

/**
 * Teklif hâlâ geçerli mi (süre)?
 * @param {string | null | undefined} at ISO an
 * @param {number} now epoch ms
 */
export function offerFresh(at, now) {
  return Boolean(at) && now - Date.parse(at) <= OFFER_TTL_MS;
}

/**
 * Teklif hazırlığının argümanları: ad, soyad ve bir iletişim bilgisi.
 * WhatsApp gibi telefonu zaten bilinen kanalda telefon istenmez.
 *
 * @param {{ first_name?: unknown, last_name?: unknown, phone?: unknown, email?: unknown }} args
 * @param {{ knownPhone: string | null }} context
 */
export function validateGuestArgs(args, { knownPhone }) {
  const first = String(args.first_name ?? '').trim();
  const last = String(args.last_name ?? '').trim();
  const phone = String(args.phone ?? '').trim() || knownPhone || null;
  const email = String(args.email ?? '').trim() || null;
  if (!first || !last) return { ok: false, error: 'Ask the guest for first name and last name.' };
  if (first.length > 100 || last.length > 100) return { ok: false, error: 'Name is too long.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'Email address looks invalid; ask again.' };
  if (phone && phone.replace(/\D/g, '').length < 7) return { ok: false, error: 'Phone number looks invalid; ask again.' };
  if (!phone && !email) return { ok: false, error: 'Ask the guest for a phone number or an email address.' };
  return { ok: true, value: { firstName: first, lastName: last, phone, email } };
}

/**
 * `request_reservation` korumaları (bkz. dosya başı). Sebep modele gider.
 *
 * @param {{
 *   offerId: string,
 *   pendingOffer: { offerId: string, proposedAt: string } | null,
 *   latestGuestMessageAt: string,
 *   affirmative: boolean,
 *   pendingRequestId: string | null,
 * }} input
 * @returns {string | null} engel yoksa null
 */
export function requestBlocker({ offerId, pendingOffer, latestGuestMessageAt, affirmative, pendingRequestId }) {
  if (pendingRequestId) return 'A booking request for this conversation is already being processed. Tell the guest the confirmation is on its way.';
  if (!pendingOffer) return 'No proposal has been prepared. Use propose_reservation and ask the guest to confirm first.';
  if (pendingOffer.offerId !== offerId) return 'This offer was not proposed to the guest. Propose it and ask for confirmation first.';
  if (!(Date.parse(pendingOffer.proposedAt) < Date.parse(latestGuestMessageAt))) {
    return 'The guest has not seen this proposal yet. Show the summary and ask for explicit confirmation; do not book in the same message.';
  }
  if (!affirmative) return 'The guest has not explicitly confirmed the proposal in their latest message. Ask for a clear yes before booking.';
  return null;
}
