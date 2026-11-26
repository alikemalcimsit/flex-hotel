import { currentActor, toDecimal, toMoneyString } from '@hotelos/core';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { lockReservations } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { writeWithEvents } from '../../lib/write.js';
import { stayBalances } from '../front-desk/folio.js';
import { enqueueTriggerNotifications, ensureTriggerTemplates } from '../notifications/service.js';
import { getHotelSettings } from '../settings/service.js';
import { LINK_INCLUDE, linkView, loadGatewaySettings, logLinkEvent, money, newLinkCode, payPageUrl, prisma } from './shared.js';

/**
 * Ödeme linkleri (modül 50): oluştur, gönder, iptal, liste, konaklamanın özeti. Link konaklamaya bağlıdır, tutarı ve süresi
 * bellidir, bir kez ödenir. Aynı istek kimliği ikinci link açmaz.
 */

const LINKABLE_STATUSES = Object.freeze(['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'NO_SHOW']);
const HOUR_MS = 3_600_000;

/** Ayar açık, sağlayıcı ve adresler hazır mı? @param {string} hotelId */
export async function assertGatewayReady(hotelId) {
  const settings = await loadGatewaySettings(prisma, hotelId);
  if (!settings.isEnabled) throw new ConflictError('Sanal POS ayarlarda kapalı', 'GATEWAY_DISABLED');
  if (!settings.apiPublicUrl) throw new ConflictError('Sanal POS ayarında sunucunun dış adresi yok', 'GATEWAY_URL_MISSING');
  if (settings.provider === 'IYZICO' && !settings.credentialsSealed) throw new ConflictError('iyzico anahtarları girilmemiş', 'GATEWAY_CREDENTIALS');
  return settings;
}

/**
 * Konaklamanın sanal POS özeti: önerilen tutar (açık bakiye; folyo yoksa konaklama tutarı), linkler.
 * @param {string} hotelId @param {string} reservationId
 */
export async function reservationGateway(hotelId, reservationId) {
  const [settings, reservation] = await Promise.all([
    loadGatewaySettings(prisma, hotelId),
    prisma.reservation.findFirst({ where: { id: reservationId, hotelId }, select: { id: true, status: true, currency: true, totalPrice: true, guest: { select: { email: true, phone: true } } } }),
  ]);
  if (!reservation) throw new NotFoundError('Rezervasyon bulunamadı');
  const [balances, links] = await Promise.all([
    stayBalances(prisma, hotelId, [reservationId]),
    prisma.paymentLink.findMany({ where: { hotelId, reservationId }, include: LINK_INCLUDE, orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  const balance = balances.get(reservationId);
  const suggested = balance ? (Number(balance.balance) > 0 ? money(balance.balance) : null) : money(reservation.totalPrice);
  return {
    program: { isEnabled: settings.isEnabled, provider: settings.provider, environment: settings.environment, linkTtlHours: settings.linkTtlHours },
    currency: reservation.currency,
    suggested: { amount: suggested, purpose: balance ? 'BALANCE' : 'PREPAYMENT' },
    canLink: LINKABLE_STATUSES.includes(reservation.status),
    contact: { hasEmail: Boolean(reservation.guest.email), hasPhone: Boolean(reservation.guest.phone) },
    links: await Promise.all(links.map(async (link) => ({ ...linkView(link), url: await payPageUrl(hotelId, link.code) }))),
  };
}

/**
 * Link oluşturur (personel, portal ya da widget). Aynı `requestId` ikinci link açmaz.
 * @param {string} hotelId @param {string} reservationId
 * @param {{ requestId: string, amount: string, purpose: string, description?: string | null, folioId?: string | null, ttlHours?: number | null }} input
 * @param {{ origin?: 'STAFF' | 'PORTAL' | 'WIDGET' }} [options]
 */
export async function createPaymentLink(hotelId, reservationId, input, { origin = 'STAFF' } = {}) {
  const settings = await assertGatewayReady(hotelId);
  if (!(await payPageUrl(hotelId, 'x'))) throw new ConflictError('Misafir portalı adresi tanımlı değil: Misafir portalı ayarlarından girin (ödeme sayfası orada açılır)', 'PORTAL_URL_MISSING');
  const actor = currentActor();
  const link = await writeWithEvents(async (tx, stage) => {
    const existing = await tx.paymentLink.findFirst({ where: { hotelId, requestId: input.requestId } });
    if (existing) return existing;
    if (!(await lockReservations(tx, hotelId, [reservationId])).has(reservationId)) throw new NotFoundError('Rezervasyon bulunamadı');
    const reservation = await tx.reservation.findFirst({ where: { id: reservationId, hotelId }, select: { status: true, currency: true, confirmationCode: true } });
    if (!LINKABLE_STATUSES.includes(reservation.status)) throw new ConflictError('İptal edilmiş rezervasyona ödeme linki açılmaz', 'INVALID_STATUS');
    if (input.folioId && !(await tx.folio.findFirst({ where: { id: input.folioId, hotelId, reservationId }, select: { id: true } }))) throw new NotFoundError('Folyo bu konaklamanın değil');
    const ttl = input.ttlHours ?? settings.linkTtlHours;
    const row = await tx.paymentLink.create({
      data: {
        hotelId,
        reservationId,
        folioId: input.folioId ?? null,
        code: newLinkCode(),
        requestId: input.requestId,
        purpose: input.purpose,
        origin,
        amount: toMoneyString(toDecimal(input.amount)),
        currency: reservation.currency,
        description: input.description ?? `${reservation.confirmationCode} ${input.purpose === 'PREPAYMENT' ? 'ön ödeme' : 'konaklama ödemesi'}`,
        expiresAt: new Date(Date.now() + ttl * HOUR_MS),
        provider: settings.provider,
        environment: settings.environment,
        createdBy: actor,
      },
    });
    await logLinkEvent(tx, stage, row, { kind: 'CREATED', ok: true, message: `${row.amount} ${row.currency} · ${ttl} saat geçerli`, actor });
    return row;
  });
  return getPaymentLink(hotelId, link.id);
}

/** @param {string} hotelId @param {string} linkId */
export async function getPaymentLink(hotelId, linkId) {
  const row = await prisma.paymentLink.findFirst({ where: { id: linkId, hotelId }, include: { ...LINK_INCLUDE, events: { orderBy: { createdAt: 'asc' } }, refunds: { orderBy: { createdAt: 'asc' } } } });
  if (!row) throw new NotFoundError('Ödeme linki bulunamadı');
  return {
    link: { ...linkView(row), url: await payPageUrl(hotelId, row.code) },
    events: row.events.map((event) => ({ id: event.id, kind: event.kind, ok: event.ok, code: event.code, message: event.message, actor: event.actor, createdAt: event.createdAt.toISOString() })),
    refunds: row.refunds.map((refund) => ({ id: refund.id, amount: money(refund.amount), reason: refund.reason, status: refund.status, providerRefundId: refund.providerRefundId, failureMessage: refund.failureMessage, requestedBy: refund.requestedBy, decidedBy: refund.decidedBy, createdAt: refund.createdAt.toISOString() })),
  };
}

/** Misafire gönderir (PAYMENT_LINK şablonu, açık kanallar). @param {string} hotelId @param {string} linkId */
export async function sendPaymentLink(hotelId, linkId) {
  const link = await prisma.paymentLink.findFirst({ where: { id: linkId, hotelId } });
  if (!link) throw new NotFoundError('Ödeme linki bulunamadı');
  if (link.status !== 'OPEN') throw new ConflictError('Yalnız ödeme bekleyen link gönderilir', 'LINK_STATE');
  const [url, hotel] = await Promise.all([payPageUrl(hotelId, link.code), getHotelSettings(hotelId)]);
  await ensureTriggerTemplates(hotelId, 'PAYMENT_LINK');
  const amountText = `${Number(link.amount).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${link.currency === 'TRY' ? 'TL' : link.currency}`;
  const expiry = new Intl.DateTimeFormat('tr-TR', { timeZone: hotel.timezone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(link.expiresAt);
  const result = await enqueueTriggerNotifications(hotelId, 'PAYMENT_LINK', { reservationId: link.reservationId, extraValues: { odemeLinki: url, odemeTutari: amountText, odemeSonTarihi: expiry }, dedupeSuffix: `link:${link.id}:${Date.now()}` });
  const channels = [...new Set(result.queued.filter((row) => row.status === 'PENDING').map((row) => row.channel))];
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    if (channels.length) await tx.paymentLink.update({ where: { id: link.id }, data: { sentAt: new Date(), sentVia: [...new Set([...link.sentVia, ...channels])] } });
    await logLinkEvent(tx, stage, link, { kind: 'SENT', ok: channels.length > 0, message: channels.length ? `Gönderildi: ${channels.join(', ')}` : `Gönderilemedi: ${result.skipped ?? 'açık kanal / iletişim yok'}`, actor });
  });
  if (!channels.length) throw new ConflictError(`Link gönderilemedi: ${result.skipped ?? 'misafir kartında e-posta / telefon ya da açık bildirim kanalı yok'}. Bağlantıyı kopyalayıp elle iletebilirsiniz.`, 'LINK_NOT_SENT');
  return getPaymentLink(hotelId, linkId);
}

/** Ödenmemiş linki iptal eder. @param {string} hotelId @param {string} linkId */
export async function cancelPaymentLink(hotelId, linkId) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const link = await tx.paymentLink.findFirst({ where: { id: linkId, hotelId } });
    if (!link) throw new NotFoundError('Ödeme linki bulunamadı');
    const { count } = await tx.paymentLink.updateMany({ where: { id: link.id, status: 'OPEN' }, data: { status: 'CANCELLED' } });
    if (count === 0) throw new ConflictError(link.status === 'PROCESSING' ? 'Misafir şu an ödüyor; sonuç gelince yeniden deneyin' : 'Yalnız ödeme bekleyen link iptal edilir', 'LINK_STATE');
    await logLinkEvent(tx, stage, link, { kind: 'CANCELLED', ok: true, message: 'Personel iptal etti', actor, status: 'CANCELLED' });
  });
  return getPaymentLink(hotelId, linkId);
}

/** @param {string} hotelId @param {any} query `paymentLinkListQuerySchema` çıktısı */
export async function listPaymentLinks(hotelId, query) {
  const createdAt = {
    ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
    ...(query.to ? { lt: new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}),
  };
  const where = {
    hotelId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.reservationId ? { reservationId: query.reservationId } : {}),
    ...(Object.keys(createdAt).length ? { createdAt } : {}),
    ...(query.search
      ? { OR: [{ reservation: { confirmationCode: { contains: query.search.toUpperCase() } } }, { reservation: { guest: { lastName: { contains: query.search, mode: 'insensitive' } } } }, { cardLast4: query.search }] }
      : {}),
  };
  const { skip, take } = toSkipTake(query);
  const [rows, total, summary] = await Promise.all([
    prisma.paymentLink.findMany({ where, include: LINK_INCLUDE, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip, take }),
    prisma.paymentLink.count({ where }),
    prisma.paymentLink.groupBy({ by: ['status'], where: { hotelId }, _count: { _all: true }, _sum: { paidAmount: true, refundedAmount: true } }),
  ]);
  const by = (status) => summary.find((row) => row.status === status);
  return {
    ...buildPage(rows.map(linkView), total, query),
    summary: {
      open: by('OPEN')?._count._all ?? 0,
      paid: by('PAID')?._count._all ?? 0,
      paidAmount: money(by('PAID')?._sum.paidAmount ?? 0),
      refundedAmount: money(summary.reduce((sum, row) => sum + Number(row._sum.refundedAmount ?? 0), 0)),
    },
  };
}
