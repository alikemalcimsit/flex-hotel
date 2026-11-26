import { z } from './locale.js';
import {
  API_SCOPES,
  API_SCOPE_HINTS,
  API_SCOPE_LABELS,
  PUBLIC_API_VERSION,
  WEBHOOK_API_VERSION,
  WEBHOOK_DISABLE_AFTER_FAILURES,
  WEBHOOK_DISABLE_AFTER_HOURS,
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_DELAYS_MINUTES,
  WEBHOOK_TEST_EVENT,
  WEBHOOK_TIMEOUT_MS,
  publicAvailabilityQuerySchema,
  publicAvailabilitySchema,
  publicErrorSchema,
  publicGuestListQuerySchema,
  publicGuestSchema,
  publicHotelSchema,
  publicIdParamSchema,
  publicPageSchema,
  publicReservationCancelSchema,
  publicReservationCreateSchema,
  publicReservationListQuerySchema,
  publicReservationSchema,
  publicReservationUpdateSchema,
  publicRoomTypeSchema,
} from './integrations.js';

/**
 * Açık API'nin tek tanımı (modül 61): yol, yöntem, kapsam, şemalar, açıklama.
 *
 * Sunucu uçları **bu tablodan** kaydeder (`backend/src/modules/public-api/routes.js`), OpenAPI dokümanı da bundan
 * üretilir: doküman koddan sapamaz. Yeni uç = buraya satır + sunucuda işleyici (eksikse sunucu açılmaz).
 */

const ERROR_RESPONSES = Object.freeze({
  400: 'Gönderilen veri geçersiz (`fields` alan alan açıklar)',
  401: 'Anahtar yok, biçimi yanlış, iptal edilmiş ya da süresi dolmuş',
  403: 'Anahtarın bu işlem için kapsamı yok ya da uygulama kapalı',
  429: 'Hız sınırı aşıldı (`Retry-After` saniye)',
});

/**
 * @typedef {{
 *   id: string,
 *   method: 'GET' | 'POST' | 'PATCH',
 *   path: string,
 *   scope: string | null,
 *   tag: string,
 *   summary: string,
 *   description?: string,
 *   params?: import('zod').ZodObject<any>,
 *   query?: import('zod').ZodTypeAny,
 *   body?: import('zod').ZodTypeAny,
 *   idempotent?: boolean,
 *   responses: Record<number, { description: string, schema?: import('zod').ZodTypeAny }>,
 * }} PublicApiRoute
 */

/** @type {readonly PublicApiRoute[]} */
export const PUBLIC_API_ROUTES = Object.freeze([
  {
    id: 'getHotel',
    method: 'GET',
    path: '/v1/hotel',
    scope: null,
    tag: 'Otel',
    summary: 'Otel bilgisi',
    description: 'Ad, para birimi, saat dilimi, giriş / çıkış saatleri ve pansiyon tipleri. Her geçerli anahtar okuyabilir (bağlantıyı denemek için de kullanılır).',
    responses: { 200: { description: 'Otel', schema: publicHotelSchema } },
  },
  {
    id: 'listRoomTypes',
    method: 'GET',
    path: '/v1/room-types',
    scope: 'availability:read',
    tag: 'Müsaitlik',
    summary: 'Satılabilir oda tipleri',
    responses: { 200: { description: 'Oda tipleri', schema: z.object({ items: z.array(publicRoomTypeSchema) }) } },
  },
  {
    id: 'getAvailability',
    method: 'GET',
    path: '/v1/availability',
    scope: 'availability:read',
    tag: 'Müsaitlik',
    summary: 'Tarih aralığında müsaitlik ve fiyat',
    description:
      'Her oda tipinin bütün geceler boyunca boş oda sayısı ve konaklama toplamı (otelin fiyat motoru: sezon, fiyat planı, dinamik fiyat, varsa otomatik promosyon). Önizlemedir; rezervasyon açılırken müsaitlik kilitli olarak yeniden denetlenir.',
    query: publicAvailabilityQuerySchema,
    responses: { 200: { description: 'Müsaitlik', schema: publicAvailabilitySchema }, 422: { description: 'Geçmiş tarih' } },
  },
  {
    id: 'listReservations',
    method: 'GET',
    path: '/v1/reservations',
    scope: 'reservations:read',
    tag: 'Rezervasyon',
    summary: 'Rezervasyonlar (süzgeç / değişenler)',
    description:
      '`updatedSince` verilirse o andan sonra değişenler **değişiklik zamanına göre eskiden yeniye** döner: son sayfanın en son `updatedAt` değerini saklayıp bir sonraki çekişte `updatedSince` olarak verin (senkron). Verilmezse en son açılanlar önce. Sayfalama `nextCursor` ile.',
    query: publicReservationListQuerySchema,
    responses: { 200: { description: 'Sayfa', schema: publicPageSchema(publicReservationSchema) } },
  },
  {
    id: 'getReservation',
    method: 'GET',
    path: '/v1/reservations/:id',
    scope: 'reservations:read',
    tag: 'Rezervasyon',
    summary: 'Rezervasyon ayrıntısı',
    params: publicIdParamSchema,
    responses: { 200: { description: 'Rezervasyon', schema: publicReservationSchema }, 404: { description: 'Bulunamadı' } },
  },
  {
    id: 'createReservation',
    method: 'POST',
    path: '/v1/reservations',
    scope: 'reservations:write',
    tag: 'Rezervasyon',
    summary: 'Rezervasyon aç',
    description:
      'Paneldeki kurallarla açılır: fiyat otelin fiyat motorundan gelir (dışarıdan fiyat verilmez), müsaitlik kilitli denetlenir; yer yoksa 409 `NO_AVAILABILITY` (onaya gönderilmez). Durum uygulama ayarındandır (opsiyonlu ya da kesin). `Idempotency-Key` başlığı zorunludur: aynı anahtarla tekrar gönderim yeni rezervasyon açmaz, ilkini 200 ile döner (ağ kopması, zaman aşımı).',
    body: publicReservationCreateSchema,
    idempotent: true,
    responses: {
      201: { description: 'Açıldı', schema: publicReservationSchema },
      200: { description: 'Aynı `Idempotency-Key` ile daha önce açılmış olan', schema: publicReservationSchema },
      409: { description: 'Yer yok (`NO_AVAILABILITY`)' },
      422: { description: 'İş kuralı (geçmiş tarih, kapasite, kupon geçersiz, paket / oda tipi satışta değil)' },
    },
  },
  {
    id: 'updateReservation',
    method: 'PATCH',
    path: '/v1/reservations/:id',
    scope: 'reservations:write',
    tag: 'Rezervasyon',
    summary: 'Rezervasyonu değiştir',
    description:
      'Yalnız bu uygulamanın açtığı rezervasyon. Gönderilmeyen alan değişmez; tarih / oda tipi / kişi / pansiyon değişince fiyat paneldeki kuralla yeniden hesaplanır. `expectedUpdatedAt` okuduğunuz sürümdür: arada başkası değiştirdiyse 409 `STALE_WRITE` (yeniden okuyun).',
    params: publicIdParamSchema,
    body: publicReservationUpdateSchema,
    responses: {
      200: { description: 'Güncel rezervasyon', schema: publicReservationSchema },
      403: { description: 'Rezervasyonu bu uygulama açmadı (`NOT_OWNER`)' },
      404: { description: 'Bulunamadı' },
      409: { description: 'Sürüm eski (`STALE_WRITE`) ya da yer yok (`NO_AVAILABILITY`)' },
      422: { description: 'İş kuralı (giriş yapılmış rezervasyonun girişi değişmez vb.)' },
    },
  },
  {
    id: 'cancelReservation',
    method: 'POST',
    path: '/v1/reservations/:id/cancel',
    scope: 'reservations:write',
    tag: 'Rezervasyon',
    summary: 'Rezervasyonu iptal et',
    description: 'Yalnız bu uygulamanın açtığı rezervasyon. Otelin iptal politikasındaki ceza uygulanır (`cancellationFee`); API ile ceza silinemez.',
    params: publicIdParamSchema,
    body: publicReservationCancelSchema,
    responses: {
      200: { description: 'İptal edilen rezervasyon', schema: publicReservationSchema },
      403: { description: 'Rezervasyonu bu uygulama açmadı (`NOT_OWNER`)' },
      404: { description: 'Bulunamadı' },
      409: { description: 'Sürüm eski (`STALE_WRITE`)' },
      422: { description: 'İptal edilemez (giriş yapılmış, zaten iptal)' },
    },
  },
  {
    id: 'listGuests',
    method: 'GET',
    path: '/v1/guests',
    scope: 'guests:read',
    tag: 'Misafir',
    summary: 'Misafir kartları (süzgeç / değişenler)',
    description: 'Ad, iletişim ve uyruk. Kimlik belgesi bilgisi (tür, numara, doğum tarihi) API ile verilmez. `updatedSince` rezervasyondaki gibi çalışır.',
    query: publicGuestListQuerySchema,
    responses: { 200: { description: 'Sayfa', schema: publicPageSchema(publicGuestSchema) } },
  },
  {
    id: 'getGuest',
    method: 'GET',
    path: '/v1/guests/:id',
    scope: 'guests:read',
    tag: 'Misafir',
    summary: 'Misafir kartı',
    description: 'Birleştirilen kartın eski kimliği 404 döner; `guest.merged` webhook olayı yeni kimliği söyler.',
    params: publicIdParamSchema,
    responses: { 200: { description: 'Misafir', schema: publicGuestSchema }, 404: { description: 'Bulunamadı' } },
  },
]);

/* ─────────────── Webhook olaylarının gövde şemaları (doküman + sözleşme testi) ─────────────── */

const id = z.string().uuid();
const dayText = z.string().describe('YYYY-MM-DD');
const stayData = { reservationId: id, roomTypeId: id, checkIn: dayText, checkOut: dayText };
const paymentData = z.object({ paymentId: id, folioId: id, reservationId: id, amount: z.string(), currency: z.string(), method: z.string() });

/** Her olayın `data` şeması. Tablodaki her olayın burada şeması olmalı (sözleşme testi). */
export const WEBHOOK_EVENT_DATA_SCHEMAS = Object.freeze({
  'reservation.created': z.object({
    ...stayData,
    roomId: id.nullable(),
    groupId: id.nullable(),
    source: z.string().nullable(),
    agencyId: id.nullable(),
  }),
  'reservation.updated': z.object({ ...stayData, changedFields: z.array(z.string()) }),
  'reservation.confirmed': z.object({ reservationId: id }),
  'reservation.cancelled': z.object(stayData),
  'reservation.no_show': z.object(stayData),
  'reservation.reinstated': z.object(stayData),
  'stay.checked_in': z.object({ ...stayData, roomId: id, guestId: id }),
  'stay.checked_out': z.object({ ...stayData, roomId: id, guestId: id, earlyDeparture: z.boolean() }),
  'stay.check_in_reverted': z.object({ ...stayData, roomId: id }),
  'stay.check_out_reverted': z.object({ ...stayData, roomId: id }),
  'guest.updated': z.object({ guestId: id }),
  'guest.merged': z.object({ sourceGuestId: id, targetGuestId: id }),
  'payment.received': paymentData,
  'payment.refunded': paymentData,
  'invoice.issued': z.object({
    invoiceId: id,
    number: z.string(),
    documentType: z.string(),
    folioId: id.nullable(),
    total: z.string(),
    taxTotal: z.string(),
    currency: z.string(),
    issuedOn: dayText,
  }),
  'invoice.cancelled': z.object({ invoiceId: id, number: z.string(), folioId: id.nullable() }),
  'room.status_changed': z.object({ roomId: id, roomNumber: z.string(), field: z.enum(['occupancy', 'housekeeping']), from: z.string(), to: z.string() }),
  [WEBHOOK_TEST_EVENT]: z.object({ message: z.string(), subscriptionId: id }),
});

/** @param {import('zod').ZodTypeAny} data */
const envelopeOf = (type, data) =>
  z.object({
    id: z.string().describe('Olay kimliği — tekrar gelen teslimatı tanımak için'),
    type: z.literal(type),
    apiVersion: z.literal(WEBHOOK_API_VERSION),
    createdAt: z.string().describe('Olayın zamanı (ISO 8601, UTC)'),
    hotelId: id,
    data,
  });

/* ─────────────── OpenAPI üretimi ─────────────── */

const toOpenApiPath = (path) => path.replace(/:([A-Za-z]+)/g, '{$1}');

/** @param {import('zod').ZodTypeAny} schema @param {'input' | 'output'} io */
function jsonSchema(schema, io) {
  const result = z.toJSONSchema(schema, { io, unrepresentable: 'any' });
  delete result.$schema;
  return result;
}

/**
 * Nesne şemasını sorgu / yol parametrelerine çevirir.
 * @param {import('zod').ZodTypeAny} schema @param {'query' | 'path'} where
 */
function parametersOf(schema, where) {
  const json = jsonSchema(schema, 'input');
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {}).map(([name, property]) => {
    const { description, ...rest } = /** @type {Record<string, unknown>} */ (property);
    return {
      name,
      in: where,
      required: where === 'path' ? true : required.has(name) && rest.default === undefined,
      ...(description ? { description } : {}),
      schema: rest,
    };
  });
}

const jsonContent = (schema, io) => ({ 'application/json': { schema: jsonSchema(schema, io) } });

const INTRO = `Otelin rezervasyon, müsaitlik ve misafir verisine dış sistemlerden erişim.

## Kimlik doğrulama
Her istekte \`Authorization: Bearer fhk_…\` başlığı. Anahtarı panelde **Entegrasyon → Uygulamalar** ekranında otel yöneticisi oluşturur; yalnız oluşturulduğu an bir kez gösterilir. Anahtarın kapsamları (scope) işlemi sınırlar:

${API_SCOPES.map((scope) => `- \`${scope}\` — **${API_SCOPE_LABELS[scope]}**. ${API_SCOPE_HINTS[scope]}`).join('\n')}

## Hız sınırı
Uygulama başına dakikalık sınır (bütün anahtarlarının toplamı; panelden ayarlanır). Cevapta \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\`, \`X-RateLimit-Reset\`; aşılınca 429 ve \`Retry-After\`.

## Hatalar
Hata gövdesi \`{ success: false, error, code, fields? }\`. \`error\` gösterilebilir açıklamadır (Türkçe); dallanmak için \`code\` kullanın.

## Değişenleri çekmek
Liste uçlarında \`updatedSince\` + \`nextCursor\`. Webhook ile "değişti" haberini alıp ayrıntıyı bu uçlardan çekmek önerilen yoldur.

## Webhook
Abonelik panelden kurulur (adres + olaylar). Her teslimat \`POST\`, gövde JSON (\`id, type, apiVersion, createdAt, hotelId, data\`); gövde incedir (kimlikler, durum, tarih, tutar — kişisel veri yok).

Başlıklar: \`X-FlexHotel-Event\`, \`X-FlexHotel-Delivery\` (teslimat kimliği), \`X-FlexHotel-Signature: t=<unix saniye>,v1=<imza>\`. İmza: abonelik sırrıyla \`HMAC-SHA256(t + "." + ham gövde)\`, onaltılık. Sır yenilendiyse geçiş süresince ikinci bir \`v1=\` de gelir; herhangi biri tutarsa geçerlidir. Zamanı 5 dakikadan eski imzayı reddedin (tekrar oynatma).

\`\`\`js
const [t, ...sigs] = header.split(',').map((part) => part.split('=')); // [['t','…'], ['v1','…'], …]
const expected = crypto.createHmac('sha256', SECRET).update(\`\${t[1]}.\${rawBody}\`).digest('hex');
const ok = sigs.some(([k, v]) => k === 'v1' && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(expected)));
\`\`\`

2xx dışındaki cevap ya da ${WEBHOOK_TIMEOUT_MS / 1000} saniyede cevap gelmemesi başarısızdır; ${WEBHOOK_RETRY_DELAYS_MINUTES.join(', ')} dakika arayla toplam ${WEBHOOK_MAX_ATTEMPTS} deneme yapılır (429 / 503'te \`Retry-After\`'a uyulur). Yönlendirme (3xx) takip edilmez. Sıra garanti değildir: \`createdAt\`'e ve kaydın \`updatedAt\`'ine bakın. Aynı olay birden fazla gelebilir: \`id\` ile tekrarı ayıklayın. Uzun süre (art arda ${WEBHOOK_DISABLE_AFTER_FAILURES} deneme ve ${WEBHOOK_DISABLE_AFTER_HOURS} saat) hiç başarı olmazsa abonelik kendiliğinden kapanır, otelin yöneticisine haber gider.`;

/**
 * OpenAPI 3.1 dokümanı.
 * @param {{ serverUrl: string }} options sunucunun kök adresi (ör. https://hotel.flexai.tr/api)
 */
export function buildPublicApiDocument({ serverUrl }) {
  /** @type {Record<string, Record<string, object>>} */
  const paths = {};
  for (const route of PUBLIC_API_ROUTES) {
    const parameters = [
      ...(route.params ? parametersOf(route.params, 'path') : []),
      ...(route.query ? parametersOf(route.query, 'query') : []),
      ...(route.idempotent
        ? [{ name: 'Idempotency-Key', in: 'header', required: true, description: 'İstemcinin ürettiği tekil değer (UUID önerilir), 8–100 karakter', schema: { type: 'string', minLength: 8, maxLength: 100 } }]
        : []),
    ];
    const responses = {};
    for (const [status, response] of Object.entries(route.responses)) {
      const isError = Number(status) >= 400;
      responses[status] = {
        description: response.description,
        ...(response.schema ? { content: jsonContent(response.schema, 'output') } : isError ? { content: jsonContent(publicErrorSchema, 'output') } : {}),
      };
    }
    for (const [status, description] of Object.entries(ERROR_RESPONSES)) {
      if (responses[status]) continue;
      if (status === '400' && !route.query && !route.body && !route.params) continue;
      responses[status] = { description, content: jsonContent(publicErrorSchema, 'output') };
    }
    const operation = {
      operationId: route.id,
      tags: [route.tag],
      summary: route.summary,
      description: [route.description, route.scope ? `Kapsam: \`${route.scope}\`` : 'Kapsam gerekmez (geçerli anahtar yeter).'].filter(Boolean).join('\n\n'),
      ...(parameters.length ? { parameters } : {}),
      ...(route.body ? { requestBody: { required: true, content: jsonContent(route.body, 'input') } } : {}),
      responses,
      security: [{ apiKey: route.scope ? [route.scope] : [] }],
    };
    const key = toOpenApiPath(route.path);
    paths[key] = { ...(paths[key] ?? {}), [route.method.toLowerCase()]: operation };
  }

  const webhooks = {};
  for (const type of [...WEBHOOK_EVENTS, WEBHOOK_TEST_EVENT]) {
    webhooks[type] = {
      post: {
        summary: type === WEBHOOK_TEST_EVENT ? 'Deneme olayı (panelden "Deneme gönder")' : WEBHOOK_EVENT_LABELS[type],
        requestBody: { content: jsonContent(envelopeOf(type, WEBHOOK_EVENT_DATA_SCHEMAS[type]), 'output') },
        responses: { 200: { description: 'Alındı (2xx dönün; gövde okunmaz)' } },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: { title: 'FlexHotel açık API', version: PUBLIC_API_VERSION, description: INTRO },
    servers: [{ url: serverUrl }],
    tags: [
      { name: 'Otel', description: 'Bağlantı ve otel bilgisi' },
      { name: 'Müsaitlik', description: 'Oda tipleri, boş oda, fiyat' },
      { name: 'Rezervasyon', description: 'Okuma, açma, değiştirme, iptal' },
      { name: 'Misafir', description: 'Misafir kartları (iletişim)' },
    ],
    components: {
      securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'fhk_<önek>_<sır>', description: 'Panelden alınan API anahtarı' } },
    },
    paths,
    webhooks,
  };
}
