import { randomBytes } from 'node:crypto';
import { currentActor } from '@hotelos/core';
import { prisma, prismaUnfiltered } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { cache } from '../../lib/cache.js';
import { isChannelConnected } from '../../lib/channels.js';
import { AppError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { openSecret, sealSecret } from '../../lib/secret-box.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';

/**
 * Mesaj kanalı bağlantıları (modül 8): WhatsApp Cloud API ve web chat balonu.
 *
 * - Sırlar (WhatsApp erişim token'ı, uygulama sırrı, webhook doğrulama
 *   token'ı) tek bir şifreli JSON olarak saklanır (`secret-box`); hiçbir
 *   cevapta dönmez, ekran yalnızca "kayıtlı mı" bilgisini görür. Boş gönderilen
 *   sır kayıtlı olanı korur.
 * - Webhook ve balon trafiği yoğundur (her mesaj): kanal kaydı kısa süre
 *   önbelleklenir, kayıtta silinir.
 * - Kanal "açık" demek: geçit süreçte kayıtlı **ve** otel kanalı açmış.
 */

const CACHE_TTL_MS = 60_000;
const DEFAULT_WEBCHAT = Object.freeze({ allowedOrigins: [], title: 'Canlı destek', greeting: null, accentColor: '#0f766e' });

const byHotelKey = (hotelId, channel) => `channels:${hotelId}:${channel}`;
const byIdKey = (id) => `channels:id:${id}`;
const byPublicKey = (key) => `channels:key:${key}`;
const ORIGINS_KEY = 'channels:webchat-origins';

/** Kanal ayarı değişti: bu kanalın bütün önbellek kayıtları silinir. */
function invalidate(hotelId, row) {
  cache.invalidatePrefix(`channels:${hotelId}:`);
  if (row?.id) cache.invalidatePrefix(byIdKey(row.id));
  if (row?.publicKey) cache.invalidatePrefix(byPublicKey(row.publicKey));
  cache.invalidatePrefix(ORIGINS_KEY);
}

/** @param {string | null} sealed */
function openSecrets(sealed) {
  if (!sealed) return {};
  try {
    return JSON.parse(openSecret(sealed));
  } catch (error) {
    if (error instanceof AppError) throw error;
    return {};
  }
}

const newPublicKey = () => `wc_${randomBytes(18).toString('base64url')}`;

/* ══════════════════ Okuma (önbellekli) ══════════════════ */

/**
 * @param {string} hotelId
 * @param {'WHATSAPP' | 'WEBCHAT'} channel
 */
export function messagingChannelFor(hotelId, channel) {
  return cache.getOrSet(byHotelKey(hotelId, channel), () => prisma.messagingChannel.findFirst({ where: { hotelId, channel } }), CACHE_TTL_MS);
}

/**
 * Bu otelde kanal mesaj gönderip alabilir mi? WhatsApp ve web chat için geçit
 * kayıtlı ve otel kanalı açmış olmalı; diğer kanallarda yalnızca geçit.
 *
 * @param {string} hotelId
 * @param {string} channel
 */
export async function channelActiveFor(hotelId, channel) {
  if (!isChannelConnected(channel)) return false;
  if (channel !== 'WHATSAPP' && channel !== 'WEBCHAT') return true;
  return Boolean((await messagingChannelFor(hotelId, channel))?.enabled);
}

/**
 * Gönderim için WhatsApp kimlik bilgileri (kanal açık ve eksiksizse).
 * @param {string} hotelId
 * @returns {Promise<null | { phoneNumberId: string, accessToken: string, graphVersion?: string }>}
 */
export async function whatsappCredentials(hotelId) {
  const row = await messagingChannelFor(hotelId, 'WHATSAPP');
  if (!row?.enabled || !row.externalAccountId) return null;
  const secrets = openSecrets(row.secret);
  if (!secrets.accessToken) return null;
  return { phoneNumberId: row.externalAccountId, accessToken: secrets.accessToken, ...(row.settings?.graphVersion ? { graphVersion: row.settings.graphVersion } : {}) };
}

/**
 * Webhook için kanal (adresteki kimlikle). Açık olmasa da döner: kanal
 * kapatılmış olsa bile Meta'nın getirdiği misafir mesajı kaybolmamalı.
 * @param {string} channelId
 */
export async function whatsappChannelById(channelId) {
  const row = await cache.getOrSet(
    byIdKey(channelId),
    () => prismaUnfiltered.messagingChannel.findFirst({ where: { id: channelId, channel: 'WHATSAPP' } }),
    CACHE_TTL_MS,
  );
  if (!row) return null;
  const secrets = openSecrets(row.secret);
  return {
    id: row.id,
    hotelId: row.hotelId,
    enabled: row.enabled,
    phoneNumberId: row.externalAccountId,
    appSecret: secrets.appSecret ?? null,
    verifyToken: secrets.verifyToken ?? null,
  };
}

/**
 * Balonun genel anahtarı → kanal.
 * @param {string} publicKey
 */
export function webchatChannelByKey(publicKey) {
  if (typeof publicKey !== 'string' || !/^wc_[A-Za-z0-9_-]{16,40}$/.test(publicKey)) return Promise.resolve(null);
  return cache.getOrSet(
    byPublicKey(publicKey),
    () => prismaUnfiltered.messagingChannel.findFirst({ where: { publicKey, channel: 'WEBCHAT' } }),
    CACHE_TTL_MS,
  );
}

/**
 * Socket sunucusunun (CORS) kabul edeceği site adresleri: açık web chat
 * kanallarının bütün adresleri. Her bağlantı ayrıca kendi otelinin listesine
 * göre denetlenir (bkz. webchat.js).
 */
export async function webchatOrigins() {
  return cache.getOrSet(
    ORIGINS_KEY,
    async () => {
      const rows = await prismaUnfiltered.messagingChannel.findMany({
        where: { channel: 'WEBCHAT', enabled: true },
        select: { settings: true },
      });
      return new Set(rows.flatMap((row) => row.settings?.allowedOrigins ?? []));
    },
    CACHE_TTL_MS,
  );
}

/* ══════════════════ Ayar ekranı ══════════════════ */

/** @param {object | null} row */
function whatsappDto(row) {
  const opened = row ? openSecretsSafe(row.secret) : {};
  const secrets = opened ?? {};
  return {
    id: row?.id ?? null,
    enabled: row?.enabled ?? false,
    phoneNumberId: row?.externalAccountId ?? null,
    displayPhone: row?.settings?.displayPhone ?? null,
    graphVersion: row?.settings?.graphVersion ?? null,
    hasAccessToken: Boolean(secrets.accessToken),
    hasAppSecret: Boolean(secrets.appSecret),
    hasVerifyToken: Boolean(secrets.verifyToken),
    secretReadable: opened !== null,
    webhookPath: row ? `/webhooks/whatsapp/${row.id}` : null,
    connected: isChannelConnected('WHATSAPP'),
    lastInboundAt: row?.lastInboundAt?.toISOString() ?? null,
    lastError: row?.lastError ?? null,
    lastErrorAt: row?.lastErrorAt?.toISOString() ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

/** Anahtar yoksa ekran patlamasın: "sırlar okunamıyor" gösterilir. */
function openSecretsSafe(sealed) {
  try {
    return openSecrets(sealed);
  } catch {
    return null;
  }
}

/** @param {object | null} row */
function webchatDto(row) {
  const settings = { ...DEFAULT_WEBCHAT, ...(row?.settings ?? {}) };
  return {
    id: row?.id ?? null,
    enabled: row?.enabled ?? false,
    publicKey: row?.publicKey ?? null,
    allowedOrigins: settings.allowedOrigins,
    title: settings.title,
    greeting: settings.greeting,
    accentColor: settings.accentColor,
    connected: isChannelConnected('WEBCHAT'),
    lastInboundAt: row?.lastInboundAt?.toISOString() ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

/** @param {string} hotelId */
export async function getMessagingChannels(hotelId) {
  const rows = await prisma.messagingChannel.findMany({ where: { hotelId } });
  const find = (channel) => rows.find((row) => row.channel === channel) ?? null;
  return { whatsapp: whatsappDto(find('WHATSAPP')), webchat: webchatDto(find('WEBCHAT')) };
}

/** Denetim izine giden hâl (sır yok). */
const auditShape = (row) => ({
  enabled: row.enabled,
  externalAccountId: row.externalAccountId,
  publicKey: row.publicKey,
  settings: row.settings,
  secretUpdatedAt: row.secretUpdatedAt?.toISOString() ?? null,
});

/**
 * Kanal satırını oluşturur ya da günceller (sürüm denetimli, denetim izli).
 * @param {string} hotelId
 * @param {'WHATSAPP' | 'WEBCHAT'} channel
 * @param {Date | null | undefined} expectedUpdatedAt
 * @param {(before: object | null) => object} build yazılacak alanlar
 */
async function upsertChannel(hotelId, channel, expectedUpdatedAt, build) {
  let saved;
  try {
    saved = await writeWithEvents(async (tx) => {
      const before = await tx.messagingChannel.findFirst({ where: { hotelId, channel } });
      if (Boolean(before) !== Boolean(expectedUpdatedAt)) throw new StaleWriteError();
      const data = { ...build(before), updatedBy: currentActor() };
      if (before) {
        await updateWithVersionCheck(tx, 'messagingChannel', { id: before.id, hotelId }, expectedUpdatedAt, data, 'Kanal bulunamadı');
      } else {
        await tx.messagingChannel.create({ data: { hotelId, channel, ...data } });
      }
      const after = await tx.messagingChannel.findFirst({ where: { hotelId, channel } });
      if (!after) throw new NotFoundError('Kanal bulunamadı');
      await recordAudit(tx, {
        hotelId,
        entity: 'MessagingChannel',
        entityId: after.id,
        action: before ? 'UPDATE' : 'CREATE',
        before: before ? auditShape(before) : null,
        after: auditShape(after),
      });
      return { before, after };
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  invalidate(hotelId, saved.before);
  invalidate(hotelId, saved.after);
  return saved.after;
}

/**
 * @param {string} hotelId
 * @param {object} input `whatsappChannelSchema` çıktısı
 */
export async function saveWhatsAppChannel(hotelId, input) {
  const row = await upsertChannel(hotelId, 'WHATSAPP', input.expectedUpdatedAt, (before) => {
    const current = openSecrets(before?.secret ?? null);
    const next = {
      accessToken: input.accessToken ?? current.accessToken ?? null,
      appSecret: input.appSecret ?? current.appSecret ?? null,
      verifyToken: input.verifyToken ?? current.verifyToken ?? null,
    };
    const changedSecret = Boolean(input.accessToken || input.appSecret || input.verifyToken);
    if (input.enabled) {
      const missing = [
        !input.phoneNumberId && 'phoneNumberId',
        !next.accessToken && 'accessToken',
        !next.appSecret && 'appSecret',
        !next.verifyToken && 'verifyToken',
      ].filter(Boolean);
      if (missing.length) {
        throw new ValidationError('Kanalı açmak için telefon numarası kimliği, erişim token\'ı, uygulama sırrı ve doğrulama token\'ı gerekli', {
          field: missing[0],
        });
      }
    }
    return {
      enabled: input.enabled,
      externalAccountId: input.phoneNumberId ?? null,
      settings: { displayPhone: input.displayPhone ?? null, graphVersion: input.graphVersion ?? null },
      ...(changedSecret ? { secret: sealSecret(JSON.stringify(next)), secretUpdatedAt: new Date() } : {}),
    };
  });
  return whatsappDto(row);
}

/**
 * @param {string} hotelId
 * @param {object} input `webchatChannelSchema` çıktısı
 */
export async function saveWebchatChannel(hotelId, input) {
  const row = await upsertChannel(hotelId, 'WEBCHAT', input.expectedUpdatedAt, (before) => ({
    enabled: input.enabled,
    publicKey: before?.publicKey ?? newPublicKey(),
    settings: {
      allowedOrigins: input.allowedOrigins,
      title: input.title,
      greeting: input.greeting ?? null,
      accentColor: input.accentColor,
    },
  }));
  return webchatDto(row);
}

/**
 * Balonun genel anahtarını yeniler: eski gömme kodu çalışmayı bırakır (anahtar
 * sızdıysa ya da site değiştiyse). Açık oturumlar yeniden bağlanamaz.
 * @param {string} hotelId
 * @param {{ expectedUpdatedAt: Date }} input
 */
export async function rotateWebchatKey(hotelId, { expectedUpdatedAt }) {
  const existing = await prisma.messagingChannel.findFirst({ where: { hotelId, channel: 'WEBCHAT' }, select: { id: true } });
  if (!existing) throw new NotFoundError('Web chat kanalı henüz kaydedilmedi');
  const row = await upsertChannel(hotelId, 'WEBCHAT', expectedUpdatedAt, () => ({ publicKey: newPublicKey() }));
  return webchatDto(row);
}

/**
 * Gelen mesaj zamanı (ekrandaki "son mesaj" bilgisi). Her mesajda yazmamak
 * için dakikada en fazla bir kez güncellenir.
 * @param {string} hotelId
 * @param {'WHATSAPP' | 'WEBCHAT'} channel
 */
export async function touchInbound(hotelId, channel) {
  const cutoff = new Date(Date.now() - 60_000);
  await prismaUnfiltered.messagingChannel.updateMany({
    where: { hotelId, channel, OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: cutoff } }] },
    data: { lastInboundAt: new Date() },
  });
}

/**
 * Kanalın kalıcı hatası (token geçersiz) ekranda görünsün.
 * @param {string} hotelId
 * @param {'WHATSAPP' | 'WEBCHAT'} channel
 * @param {string} error
 */
export async function recordChannelError(hotelId, channel, error) {
  await prismaUnfiltered.messagingChannel.updateMany({
    where: { hotelId, channel },
    data: { lastError: String(error).slice(0, 500), lastErrorAt: new Date() },
  });
  cache.invalidatePrefix(`channels:${hotelId}:`);
}
