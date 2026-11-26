import { randomUUID } from 'node:crypto';

/**
 * Açık API ve webhook (modül 61) demo verisi.
 *
 * Sıfırlama (`resetIntegrationDemo`) demo sıfırlamasının EN BAŞINDA çalışır: rezervasyonun uygulama bağı (`apiClientId`)
 * uygulamaya kısıtlı (RESTRICT); demo uygulamalar silinmeden önce bağ çözülür (personelin demo uygulamanın anahtarıyla
 * açtığı rezervasyonlar da kalır, yalnız bağı düşer).
 *
 * Tohum (`seedIntegrationDemo`):
 * - "Kurumsal seyahat aracı (örnek)": açık; anahtarlar (geçerli, iptal edilmiş, süresi dolmuş), duraklatılmış webhook
 *   aboneliği ve son üç günün teslimat geçmişi (çoğu teslim, ikisi teslim edilemedi), API'den açılmış ileri tarihli
 *   rezervasyonlar ("Dış sistem (API)").
 * - "Eski web sitesi (örnek)": kapalı uygulama.
 * Anahtarlar gerçek biçimde üretilir ama metinleri hiçbir yerde tutulmaz: demo anahtarları kullanılamaz. Abonelik adresi
 * `.invalid` alan adındadır (asla çözülmez) ve duraklatılmıştır: canlı demo dışarıya istek atmaz.
 */

const CLIENT_NAME = 'Kurumsal seyahat aracı (örnek)';
const OLD_CLIENT_NAME = 'Eski web sitesi (örnek)';
const WEBHOOK_URL = 'https://api.ornek-seyahat.invalid/flexhotel/webhook';
const API_RESERVATIONS = 18;
const DELIVERY_DAYS = 3;

/** @param {any} tx @param {string} hotelId @param {string} actor */
export async function resetIntegrationDemo(tx, hotelId, actor) {
  const run = (sql) => tx.$executeRawUnsafe(sql, hotelId, actor);
  const clients = `SELECT "id" FROM "ApiClient" WHERE "hotelId" = $1 AND "createdBy" = $2`;
  await run(`UPDATE "Reservation" SET "apiClientId" = NULL WHERE "hotelId" = $1 AND "apiClientId" IN (${clients})`);
  await run(`DELETE FROM "WebhookDelivery" WHERE "hotelId" = $1 AND "subscriptionId" IN (SELECT "id" FROM "WebhookSubscription" WHERE "clientId" IN (${clients}))`);
  await run(`DELETE FROM "WebhookSubscription" WHERE "hotelId" = $1 AND "clientId" IN (${clients})`);
  await run(`DELETE FROM "ApiKey" WHERE "hotelId" = $1 AND "clientId" IN (${clients})`);
  await run(`DELETE FROM "ApiClient" WHERE "hotelId" = $1 AND "createdBy" = $2`);
}

/**
 * @param {{ prisma: any, contracts: any, hotelId: string, today: string, actor: string, codePrefix: string }} context
 */
export async function seedIntegrationDemo({ prisma, contracts, hotelId, today, actor, codePrefix }) {
  const { generateApiKey, generateWebhookSecret } = await import('../src/lib/webhook-signature.js');
  const { sealSecret } = await import('../src/lib/secret-box.js');
  const summary = { clients: 0, keys: 0, webhooks: 0, deliveries: 0, reservations: 0, skipped: [] };
  const now = new Date();
  const ago = (hours) => new Date(now.getTime() - hours * 3_600_000);

  if (await prisma.apiClient.findFirst({ where: { hotelId, createdBy: actor } })) {
    summary.skipped.push('demo uygulaması zaten var');
    return summary;
  }

  const client = await prisma.apiClient.create({
    data: {
      hotelId,
      name: CLIENT_NAME,
      description: 'Şirket çalışanlarının iş seyahatlerini bu araçtan ayırtıyor; rezervasyonlar opsiyonlu düşer, resepsiyon kesinleştirir.',
      contactEmail: 'entegrasyon@ornek-seyahat.com',
      rateLimitPerMinute: 300,
      bookingStatus: 'PENDING',
      createdBy: actor,
      createdAt: ago(24 * 40),
    },
  });
  await prisma.apiClient.create({
    data: {
      hotelId,
      name: OLD_CLIENT_NAME,
      description: 'Yeni rezervasyon motoruna geçildi; kapatıldı, kayıt geçmiş için duruyor.',
      status: 'DISABLED',
      createdBy: actor,
      createdAt: ago(24 * 200),
    },
  });
  summary.clients = 2;

  const keys = [
    { name: 'Üretim sunucusu', scopes: ['availability:read', 'reservations:read', 'reservations:write'], createdAt: ago(24 * 38), lastUsedAt: ago(0.2), lastUsedIp: '203.0.113.24' },
    { name: 'Test ortamı', scopes: ['availability:read', 'reservations:read', 'reservations:write'], createdAt: ago(24 * 39), lastUsedAt: ago(24 * 20), lastUsedIp: '198.51.100.7', revokedAt: ago(24 * 18), revokedBy: actor },
    { name: 'Raporlama (geçici)', scopes: ['reservations:read'], createdAt: ago(24 * 35), expiresAt: ago(24 * 5), lastUsedAt: ago(24 * 6), lastUsedIp: '203.0.113.24' },
  ];
  for (const key of keys) {
    const generated = generateApiKey();
    await prisma.apiKey.create({ data: { hotelId, clientId: client.id, prefix: generated.prefix, secretHash: generated.secretHash, createdBy: actor, ...key } });
  }
  summary.keys = keys.length;

  // API'den açılmış görünen ileri tarihli rezervasyonlar (demo rezervasyonlarından; kaynak ve uygulama bağı).
  const future = await prisma.reservation.findMany({
    where: { hotelId, confirmationCode: { startsWith: codePrefix }, status: { in: ['PENDING', 'CONFIRMED'] }, checkIn: { gt: new Date(`${today}T00:00:00.000Z`) }, agencyId: null, groupId: null },
    select: { id: true, roomTypeId: true, checkIn: true, checkOut: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }],
    take: API_RESERVATIONS,
  });
  if (future.length) {
    await prisma.reservation.updateMany({ where: { id: { in: future.map((row) => row.id) } }, data: { source: 'API', apiClientId: client.id } });
  }
  summary.reservations = future.length;

  let sealed;
  try {
    sealed = sealSecret(generateWebhookSecret());
  } catch {
    summary.skipped.push('SETTINGS_SECRET_KEY yok; webhook aboneliği açılmadı');
    return summary;
  }
  const subscription = await prisma.webhookSubscription.create({
    data: {
      hotelId,
      clientId: client.id,
      url: WEBHOOK_URL,
      events: ['reservation.created', 'reservation.updated', 'reservation.cancelled', 'stay.checked_in', 'stay.checked_out'],
      secretSealed: sealed,
      status: 'PAUSED',
      lastSuccessAt: ago(5),
      lastFailureAt: ago(30),
      createdBy: actor,
      createdAt: ago(24 * 37),
    },
  });
  summary.webhooks = 1;

  // Son üç günün teslimatları: API rezervasyonlarının "açıldı" olayları + birkaç değişiklik / giriş.
  const deliveries = [];
  future.forEach((row, index) => {
    const createdAt = new Date(Math.min(now.getTime() - 3_600_000, Math.max(ago(24 * DELIVERY_DAYS).getTime(), row.createdAt.getTime())) - index * 7 * 60_000);
    const failed = index === 3 || index === 11;
    const types = index % 4 === 0 ? ['reservation.created', 'reservation.updated'] : ['reservation.created'];
    for (const type of types) {
      const source = type === 'reservation.created' ? 'reservation.created' : 'reservation.updated';
      const payload = { hotelId, reservationId: row.id, roomTypeId: row.roomTypeId, checkIn: row.checkIn, checkOut: row.checkOut, roomId: null, groupId: null, source: 'API', agencyId: null, changedFields: ['adults', 'totalPrice'] };
      const event = contracts.toWebhookEvent(source, payload);
      const eventId = randomUUID();
      // Teslim edilemeyenler iki gün önce: 8 denemenin (~45 sa) hepsi bitmiş olsun.
      const base = failed ? ago(50 + index) : createdAt;
      const at = type === 'reservation.updated' ? new Date(base.getTime() + 90 * 60_000) : base;
      const body = contracts.buildWebhookEnvelope({ eventId, type: event.type, occurredAt: at, hotelId, data: event.data });
      if (failed && type === 'reservation.created') {
        const attemptLog = contracts.WEBHOOK_RETRY_DELAYS_MINUTES.reduce(
          (log, minutes) => {
            const last = new Date(log.at(-1).at);
            return [...log, { at: new Date(last.getTime() + minutes * 60_000).toISOString(), status: 503, durationMs: 140, error: 'Alıcı 503 döndü' }];
          },
          [{ at: at.toISOString(), status: 503, durationMs: 152, error: 'Alıcı 503 döndü' }],
        );
        const lastAt = new Date(attemptLog.at(-1).at);
        if (lastAt > now) continue;
        deliveries.push({
          id: randomUUID(), hotelId, subscriptionId: subscription.id, eventId, eventType: event.type, payload: body, status: 'FAILED',
          attempts: attemptLog.length, lastAttemptAt: lastAt, responseStatus: 503, responseBody: '{"error":"bakımdayız"}', error: 'Alıcı 503 döndü', durationMs: 140, attemptLog, createdAt: at,
        });
      } else {
        const durationMs = 80 + ((index * 37) % 220);
        deliveries.push({
          id: randomUUID(), hotelId, subscriptionId: subscription.id, eventId, eventType: event.type, payload: body, status: 'SUCCEEDED',
          attempts: 1, lastAttemptAt: at, deliveredAt: at, responseStatus: 200, responseBody: '{"received":true}', durationMs,
          attemptLog: [{ at: at.toISOString(), status: 200, durationMs, error: null }], createdAt: at,
        });
      }
    }
  });
  if (deliveries.length) await prisma.webhookDelivery.createMany({ data: deliveries });
  summary.deliveries = deliveries.length;
  return summary;
}
