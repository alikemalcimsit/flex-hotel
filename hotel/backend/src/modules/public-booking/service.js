import { BOARD_TYPE_LABELS, BOARD_TYPES, normalizeOrigin } from '@hotelos/hotel-contracts';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { webchatChannelByKey } from '../channels/service.js';
import { createFromChannelRequest, quoteReservation } from '../reservations/service.js';
import { getActiveRoomTypes, getHotelSettings } from '../settings/service.js';
import { widgetPrepaymentLink } from '../payment-gateway/integrations.js';
import { latestRateMap } from '../payments/service.js';
import { EXCHANGE_RATE_STALE_DAYS } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { trimQuoteForPublic } from './rules.js';

/**
 * Online rezervasyon motoru (modül 32) — public servis katmanı.
 *
 * Kimlik ve güvenlik modül 8'in web chat kanalından gelir: aynı genel anahtar
 * (`wc_...`), aynı izinli site listesi; ayrıca kanal ayarında `bookingEnabled`
 * açık olmalı. Uçlar mevcut servislerin ince sarmalayıcısıdır: teklif
 * `quoteReservation` (kırpılarak), kayıt `createFromChannelRequest`
 * (`source: WIDGET`, onaya gitmez, idempotent).
 */

/**
 * Anahtar → rezervasyon motoru açık web chat kanalı. Kapalı/bilinmeyen anahtar
 * aynı hatayı verir (anahtar taraması kanal varlığını öğrenemesin).
 * @param {string} key
 */
export async function resolveBookingChannel(key) {
  const channel = await webchatChannelByKey(key);
  if (!channel?.enabled || !channel.settings?.bookingEnabled) {
    throw new NotFoundError('Bu anahtar için online rezervasyon açık değil');
  }
  return channel;
}

/**
 * Origin denetimi: istek yalnız kanalın izinli sitelerinden gelebilir.
 * (Origin başlığı tarayıcı dışı istemcide taklit edilebilir; bu bir CSRF/karışık
 * site önlemidir, sır değildir — asıl sınırlar hız limiti ve dar sözleşmeler.)
 * @param {{ settings?: { allowedOrigins?: string[] } }} channel
 * @param {string | undefined} originHeader
 */
export function assertBookingOrigin(channel, originHeader) {
  const origin = normalizeOrigin(String(originHeader ?? ''));
  if (!origin || !(channel.settings?.allowedOrigins ?? []).includes(origin)) {
    throw new AppError('Bu site için online rezervasyon açık değil', { statusCode: 403, code: 'ORIGIN_NOT_ALLOWED' });
  }
}

/**
 * Widget'ın açılış verisi: otel adı/para birimi, oda tipleri (ad + kapasite),
 * pansiyon seçenekleri, görünüm ayarları. Fiyat yok (tarih ister).
 * @param {{ hotelId: string, settings?: object }} channel
 */
export async function publicOptions(channel) {
  const [hotel, roomTypes, rates, rateSettings] = await Promise.all([getHotelSettings(channel.hotelId), getActiveRoomTypes(channel.hotelId), latestRateMap(channel.hotelId), prisma.exchangeRateSettings.findUnique({ where: { hotelId: channel.hotelId }, select: { currencies: true } })]);
  return {
    hotel: { name: hotel.name, currency: hotel.currency, checkInTime: hotel.checkInTime, checkOutTime: hotel.checkOutTime },
    // Döviz gösterimi (modül 60): misafir fiyatın yaklaşık karşılığını görür; rezervasyon otelin para biriminde.
    // Yalnız güncel kurlar (ödemedeki eşik) ve kur ayarındaki dövizler (ayar yoksa girilmiş hepsi).
    currencies: [...rates.entries()]
      .filter(([code, row]) => code !== hotel.currency && (!rateSettings || rateSettings.currencies.includes(code)) && (Date.now() - new Date(`${row.date}T00:00:00Z`).getTime()) / 86_400_000 <= EXCHANGE_RATE_STALE_DAYS + 1)
      .map(([code, row]) => ({ code, rate: Number(row.rate).toFixed(6), date: row.date })),
    roomTypes: roomTypes.map((type) => ({
      id: type.id,
      code: type.code,
      name: type.name,
      capacityAdults: type.capacityAdults,
      capacityChildren: type.capacityChildren,
      description: type.description ?? null,
    })),
    boardTypes: BOARD_TYPES.map((value) => ({ value, label: BOARD_TYPE_LABELS[value] })),
    defaultBoardType: hotel.defaultBoardType,
    widget: {
      title: channel.settings?.title ?? null,
      accentColor: channel.settings?.accentColor ?? null,
    },
  };
}

/**
 * Public teklif: personel teklifinin kırpılmış hâli. `roomTypeId` verilirse
 * (ikinci adım) o tip kişi sayısıyla satır olarak fiyatlanır — kişi başı ek
 * dahil kesin toplam.
 *
 * @param {{ hotelId: string }} channel
 * @param {object} input `publicBookingQuoteSchema` çıktısı
 */
export async function publicQuote(channel, input) {
  const quote = await quoteReservation(channel.hotelId, {
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    boardType: input.boardType,
    couponCode: input.couponCode ?? null,
    source: 'WIDGET',
    lines: input.roomTypeId
      ? [{ roomTypeId: input.roomTypeId, quantity: 1, adults: input.adults, children: input.children, boardType: input.boardType }]
      : [],
    agencyId: null,
    excludeReservationId: null,
  });
  return trimQuoteForPublic(quote, { adults: input.adults, children: input.children });
}

/**
 * Public rezervasyon isteği: kanal isteği yoluyla (modül 8 ile aynı kapı) —
 * onaya gitmez (yer yoksa reddedilir), PENDING açılır (resepsiyon onaylar),
 * `requestId` idempotenstir. Red, sebepli 422 olarak döner (widget gösterir).
 *
 * @param {{ hotelId: string }} channel
 * @param {object} input `publicBookingReserveSchema` çıktısı
 */
export async function publicReserve(channel, input) {
  const result = await createFromChannelRequest({
    hotelId: channel.hotelId,
    guest: {
      firstName: input.guest.firstName,
      lastName: input.guest.lastName,
      phone: input.guest.phone ?? null,
      email: input.guest.email,
      nationality: null,
    },
    roomTypeId: input.roomTypeId,
    adults: input.adults,
    children: input.children,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    boardType: input.boardType,
    source: 'WIDGET',
    notes: input.notes ?? null,
    requestId: input.requestId,
    couponCode: input.couponCode ?? null,
  });
  if (result.outcome === 'REJECTED') {
    throw new AppError(result.reason, { statusCode: 422, code: result.code });
  }
  // Sanal POS (50): ayarda widget ön ödemesi açıksa misafir ödeme sayfasına yönlenir.
  const payment = result.reservationId ? await widgetPrepaymentLink(channel.hotelId, result.reservationId) : null;
  return { confirmationCode: result.confirmationCode, status: 'PENDING', payment };
}
