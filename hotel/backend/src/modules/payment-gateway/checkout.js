import { runWithContext } from '@hotelos/core';
import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { recordGatewayPaymentInTx } from '../payments/service.js';
import { getHotelSettings } from '../settings/service.js';
import { GatewayProviderError, gatewayProviderFor } from './providers/index.js';
import { callbackUrl, loadGatewaySettings, logLinkEvent, money, payPageUrl, prisma, providerContext, testCheckoutUrl } from './shared.js';

/**
 * Misafirin ödemesi (modül 50), oturumsuz `/public/pay/:code`.
 *
 * 1. **Başlat:** link "ödeme bekliyor" ve süresi dolmamışsa "ödeme sürüyor"a alınır (deneme sayısı, konuşma kimliği
 *    `linkId:deneme`), sağlayıcıda ödeme oturumu açılır, misafir sağlayıcının sayfasına yönlenir.
 * 2. **Geri dönüş:** sağlayıcı yalnız token gönderir; sunucu sonucu sağlayıcıdan kendisi sorar ve imzayı, tutarı, para birimini,
 *    sepet ve konuşma kimliğini denetler. Ödendi → folyoya `VIRTUAL_POS` ödemesi (aynı sonuç iki kez gelse de tek). Başarısız ya
 *    da yarıda bırakıldı → link yine ödenebilir. Doğrulanamayan "ödendi" yazılmaz, personele zil.
 * 3. **Kurtarma** (iş): geri dönüşü gelmeyen "ödeme sürüyor" linkler sağlayıcıya sorularak sonuçlandırılır; önceki denemelerin
 *    oturumları da sorulur (misafir eski sekmeden ödemiş olabilir).
 * 4. **Folyoya yazılamayan ödeme** (ör. konaklamanın açık folyosu yok): link "ödendi" olur, `paymentId` boş kalır, kritik zil;
 *    iş yazımı yeniden dener. Link bir daha ödemeye açılmaz (çift çekim olmasın).
 *
 * Test ortamı: ödeme yalnız sunucunun açtığı güncel oturumla ve "ödeme sürüyor"dayken kabul edilir; para gerçek olmadığından
 * büyük ödeme eşiğine takılan tutar onaya gider (iç kötüye kullanım: TEST seçip "ödendi" yazmak dört gözü atlatmasın).
 * Link, açıldığı sağlayıcı / ortam ayarda değiştiyse ödenemez.
 */

const GUEST_ACTOR = 'guest:payment-link';
/** Oturum açılırken düşen süreç: token'sız "ödeme sürüyor" bu kadar sonra yeniden ödenebilir. */
const NO_SESSION_STALE_MS = 2 * 60_000;
/** Kurtarmada sorulan önceki oturum sayısı. */
const PREVIOUS_SESSIONS = 3;
/** Misafire gösterilen genel hata (iç ayrıntı sızmasın). */
const GUEST_SAFE_ERROR = 'Ödeme tamamlanamadı; yeniden deneyin ya da otelle görüşün.';
const SYSTEM_ACTOR = 'payment-gateway';
const cents = (value) => Math.round(Number(value ?? 0) * 100);

/** @param {string} code */
async function findByCode(code) {
  const link = await prisma.paymentLink.findFirst({ where: { code, reservation: { deletedAt: null } } });
  if (!link) throw new NotFoundError('Ödeme bağlantısı bulunamadı');
  return link;
}

/** Link açıldığı sağlayıcı / ortamla hâlâ geçerli mi? @param {any} link @param {any} settings */
const linkUsable = (link, settings) => settings.isEnabled && link.provider === settings.provider && link.environment === settings.environment;

/** Misafire gösterilen nedenler (sağlayıcının iç metni değil). */
const GUEST_ERROR_TEXT = Object.freeze({ 'T-DECLINED': 'Kart reddedildi; başka bir kartla deneyin.', 'T-ABANDONED': 'Ödeme yarıda kaldı; yeniden deneyebilirsiniz.', ABANDONED: 'Ödeme yarıda kaldı; yeniden deneyebilirsiniz.', NO_SESSION: 'Ödeme yarıda kaldı; yeniden deneyebilirsiniz.' });

/** Misafirin gördüğü özet (en az veri). @param {string} code */
export async function publicPaymentLink(code) {
  const link = await findByCode(code);
  const [hotel, settings, reservation] = await Promise.all([
    getHotelSettings(link.hotelId),
    loadGatewaySettings(prisma, link.hotelId),
    prisma.reservation.findFirst({ where: { id: link.reservationId }, select: { confirmationCode: true, checkIn: true, checkOut: true, guest: { select: { firstName: true, lastName: true } } } }),
  ]);
  const expired = link.status === 'OPEN' && link.expiresAt <= new Date();
  return {
    hotel: { name: hotel.name, phone: hotel.phone ?? null, currency: hotel.currency },
    link: {
      status: expired ? 'EXPIRED' : link.status,
      amount: money(link.amount),
      currency: link.currency,
      description: link.description,
      expiresAt: link.expiresAt.toISOString(),
      paidAt: link.paidAt?.toISOString() ?? null,
      card: link.cardLast4 ? { brand: link.cardBrand, last4: link.cardLast4 } : null,
      lastError: link.status === 'OPEN' && link.failureCode ? GUEST_ERROR_TEXT[link.failureCode] ?? GUEST_SAFE_ERROR : null,
    },
    guest: { name: `${reservation.guest.firstName} ${reservation.guest.lastName.slice(0, 1)}.`, confirmationCode: reservation.confirmationCode, checkIn: reservation.checkIn.toISOString().slice(0, 10), checkOut: reservation.checkOut.toISOString().slice(0, 10) },
    testMode: link.provider === 'TEST' || link.environment === 'SANDBOX',
    canPay: linkUsable(link, settings) && link.status === 'OPEN' && !expired,
  };
}

/**
 * Ödemeyi başlatır: misafirin yönleneceği adres.
 * @param {string} code @param {{ ip?: string | null, locale?: string | null }} meta
 */
export async function startPayment(code, meta = {}) {
  const link = await findByCode(code);
  return runWithContext({ correlationId: randomUUID(), actor: GUEST_ACTOR }, async () => {
    const settings = await loadGatewaySettings(prisma, link.hotelId);
    if (!linkUsable(link, settings)) throw new ConflictError('Bu ödeme bağlantısıyla şu an ödeme alınamıyor; otelle görüşün', 'GATEWAY_DISABLED');
    // Önceki deneme yarıda kaldıysa sağlayıcıya sorulur; sonucu belirsizse yeni deneme açılmaz (çift çekim olmasın).
    if (link.status === 'PROCESSING') await recoverLink(link.id).catch(() => null);
    const claimed = await writeWithEvents(async (tx, stage) => {
      await tx.$executeRaw`SELECT "id" FROM "PaymentLink" WHERE "id" = ${link.id} FOR UPDATE`;
      const row = await tx.paymentLink.findUnique({ where: { id: link.id } });
      if (row.status === 'OPEN' && row.expiresAt <= new Date()) {
        await tx.paymentLink.update({ where: { id: row.id }, data: { status: 'EXPIRED' } });
        await logLinkEvent(tx, stage, row, { kind: 'EXPIRED', ok: false, message: 'Misafir süresi dolan linki açtı', actor: GUEST_ACTOR, status: 'EXPIRED' });
        return { expired: true };
      }
      if (row.status === 'PROCESSING') throw new ConflictError('Ödemeniz doğrulanıyor; birkaç dakika sonra sayfayı yenileyin', 'LINK_PROCESSING');
      if (row.status !== 'OPEN') throw new ConflictError(row.status === 'PAID' ? 'Bu ödeme zaten yapıldı' : 'Bu ödeme bağlantısı artık geçerli değil; otelden yenisini isteyin', row.status === 'PAID' ? 'LINK_PAID' : 'LINK_CLOSED');
      const attempts = row.attempts + 1;
      const updated = await tx.paymentLink.update({ where: { id: row.id }, data: { status: 'PROCESSING', attempts, conversationId: `${row.id}:${attempts}`, startedAt: new Date(), providerToken: null, failureCode: null, failureMessage: null } });
      await logLinkEvent(tx, stage, updated, { kind: 'STARTED', ok: true, message: `${attempts}. deneme`, actor: GUEST_ACTOR, status: 'PROCESSING' });
      return { link: updated };
    });
    if (claimed.expired) throw new ConflictError('Bu ödeme bağlantısının süresi doldu; otelden yenisini isteyin', 'LINK_EXPIRED');
    const current = claimed.link;
    try {
      const provider = gatewayProviderFor(current.provider);
      if (!provider) throw new GatewayProviderError('Sağlayıcı tanımsız', { code: 'GATEWAY_CONFIG' });
      const [hotel, reservation] = await Promise.all([
        getHotelSettings(current.hotelId),
        prisma.reservation.findFirst({ where: { id: current.reservationId }, select: { guest: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, idType: true, idNumber: true, nationality: true } } } }),
      ]);
      const session = await provider.initialize(providerContext(current.hotelId, { ...settings, environment: current.environment }), {
        link: { id: current.id, amount: money(current.amount), currency: current.currency, description: current.description },
        guest: reservation.guest,
        hotel: { name: hotel.name, address: hotel.address ?? null, city: null, country: 'Turkey' },
        conversationId: current.conversationId,
        callbackUrl: callbackUrl(settings, current.code),
        testCheckoutUrl: testCheckoutUrl(settings, current.code),
        maxInstallment: settings.maxInstallment,
        // iyzico alıcı e-postası ister: misafirinki yoksa otelinki, o da yoksa sunucu alan adıyla.
        fallbackEmail: hotel.email || `odeme@${new URL(settings.apiPublicUrl).hostname}`,
        locale: meta.locale ?? 'tr',
        ip: meta.ip ?? null,
      });
      const saved = await writeWithEvents(async (tx, stage) => {
        const { count } = await tx.paymentLink.updateMany({ where: { id: current.id, status: 'PROCESSING', conversationId: current.conversationId }, data: { providerToken: session.token } });
        // Oturum token'ı izde: misafir eski sekmeden öderse kurtarma bunu da sorar.
        if (count) await logLinkEvent(tx, stage, current, { kind: 'SESSION', ok: true, code: session.token, message: 'Ödeme oturumu açıldı', actor: GUEST_ACTOR, status: 'PROCESSING' });
        return count;
      });
      if (!saved) throw new GatewayProviderError('Deneme bu arada geçersiz kaldı', { code: 'ATTEMPT_SUPERSEDED' });
      return { redirectUrl: session.redirectUrl };
    } catch (error) {
      const message = /** @type {Error} */ (error).message;
      await writeWithEvents(async (tx, stage) => {
        const { count } = await tx.paymentLink.updateMany({ where: { id: current.id, status: 'PROCESSING', conversationId: current.conversationId }, data: { status: 'OPEN', failureCode: /** @type {any} */ (error).code ?? 'GATEWAY_ERROR', failureMessage: message.slice(0, 300) } });
        if (count) await logLinkEvent(tx, stage, current, { kind: 'FAILED', ok: false, code: /** @type {any} */ (error).code ?? null, message: `Ödeme başlatılamadı: ${message}`, actor: GUEST_ACTOR, status: 'OPEN' });
      });
      throw new ConflictError('Ödeme sayfası açılamadı; biraz sonra yeniden deneyin', 'GATEWAY_START_FAILED');
    }
  });
}

/**
 * Sağlayıcının sonucunu yazar. Tarayıcıdan gelen yalnız token'dır; sonuç sağlayıcıdan sorulur.
 * @param {any} link @param {string} token @param {import('./providers/index.js').GatewayResult} result @param {string} actor
 * @returns {Promise<'PAID' | 'FAILED' | 'ABANDONED' | 'PENDING' | 'UNVERIFIED'>}
 */
async function settle(link, token, result, actor) {
  if (result.state === 'PENDING') return 'PENDING';
  if (result.state !== 'PAID') {
    await writeWithEvents(async (tx, stage) => {
      const { count } = await tx.paymentLink.updateMany({ where: { id: link.id, status: 'PROCESSING', providerToken: token }, data: { status: 'OPEN', failureCode: result.code, failureMessage: result.message?.slice(0, 300) ?? null } });
      if (count) await logLinkEvent(tx, stage, link, { kind: 'FAILED', ok: false, code: result.code, message: result.state === 'ABANDONED' ? `Yarıda bırakıldı: ${result.message}` : result.message, actor, status: 'OPEN' });
    });
    return result.state;
  }
  // Sonucu linke bağlayan sepet kimliğidir (konuşma kimliğini sağlayıcı sorudan aynen geri döndürür). Taksitte vade farkı
  // paidPrice'a eklenir; linkle karşılaştırılan price'tır.
  const problems = [
    !result.signatureValid && 'cevap imzası tutmadı',
    result.currency !== link.currency && `para birimi ${result.currency}`,
    cents(result.price ?? result.paidPrice) !== cents(link.amount) && `tutar ${result.price ?? result.paidPrice}`,
    result.basketId !== link.id && 'sepet kimliği farklı',
  ].filter(Boolean);
  if (problems.length) {
    await writeWithEvents(async (tx, stage) => {
      const { count } = await tx.paymentLink.updateMany({ where: { id: link.id, NOT: { failureCode: 'UNVERIFIED' } }, data: { failureCode: 'UNVERIFIED', failureMessage: `Sağlayıcı "ödendi" dedi ama doğrulanamadı: ${problems.join(', ')}` } });
      if (count === 0) return;
      await logLinkEvent(tx, stage, link, { kind: 'FAILED', ok: false, code: 'UNVERIFIED', message: `Doğrulanamadı: ${problems.join(', ')}`, actor });
      await raiseStaffAlert(tx, stage, { hotelId: link.hotelId, kind: 'PAYMENT_GATEWAY', severity: 'CRITICAL', title: 'Online ödeme doğrulanamadı', body: `Link ${link.description ?? link.id}: ${problems.join(', ')}. Sağlayıcı panelinden ödemeyi kontrol edin; folyoya yazılmadı.`, link: `/sanal-pos/linkler/${link.id}`, permission: PERMISSIONS.PAYMENT_GATEWAY_SEND, entityType: 'PaymentLink', entityId: link.id, dedupeKey: `gateway:${link.id}:unverified` });
    });
    return 'UNVERIFIED';
  }
  try {
    await postPaid(link, token, result, actor);
  } catch (error) {
    await markPaidNotPosted(link, token, result, actor, /** @type {Error} */ (error).message);
  }
  return 'PAID';
}

/** Ödenen ama folyoya yazılamayan: link "ödendi" (yeniden ödenmez), `paymentId` boş, kritik zil; iş yeniden dener. */
async function markPaidNotPosted(link, token, result, actor, reason) {
  await writeWithEvents(async (tx, stage) => {
    const { count } = await tx.paymentLink.updateMany({
      where: { id: link.id, status: { in: ['OPEN', 'PROCESSING', 'EXPIRED', 'CANCELLED'] } },
      data: { status: 'PAID', paidAt: new Date(), paidAmount: money(result.paidPrice), providerPaymentId: result.paymentId, providerItems: result.items ?? [], cardBrand: result.cardBrand, cardLast4: result.last4, installment: result.installment, paymentId: null, providerToken: token, failureCode: 'NOT_POSTED', failureMessage: `Ödeme alındı ama folyoya yazılamadı: ${reason}`.slice(0, 300) },
    });
    if (count === 0) return;
    await logLinkEvent(tx, stage, link, { kind: 'PAID', ok: false, code: 'NOT_POSTED', message: `Ödeme alındı (${result.paymentId}) ama folyoya yazılamadı: ${reason}`, actor, status: 'PAID' });
    await raiseStaffAlert(tx, stage, { hotelId: link.hotelId, kind: 'PAYMENT_GATEWAY', severity: 'CRITICAL', title: `Online ödeme folyoya yazılamadı: ${money(result.paidPrice)} ${link.currency}`, body: `${reason}. Para alındı; konaklamanın folyosunu açın, sistem yazımı yeniden dener.`, link: `/sanal-pos/linkler/${link.id}`, permission: PERMISSIONS.PAYMENT_GATEWAY_SEND, entityType: 'PaymentLink', entityId: link.id, dedupeKey: `gateway:${link.id}:not-posted` });
  });
}

/** @param {any} link @param {string} token @param {any} result @param {string} actor */
async function postPaid(link, token, result, actor) {
  await writeWithEvents(async (tx, stage) => {
    await tx.$executeRaw`SELECT "id" FROM "PaymentLink" WHERE "id" = ${link.id} FOR UPDATE`;
    const row = await tx.paymentLink.findUnique({ where: { id: link.id } });
    const duplicate = row.status === 'PAID' && row.providerPaymentId && row.providerPaymentId !== result.paymentId;
    if (row.status === 'PAID' && !duplicate && row.paymentId) return;
    const paymentId = await recordGatewayPaymentInTx(tx, stage, {
      hotelId: row.hotelId,
      reservationId: row.reservationId,
      folioId: row.folioId,
      sourceKey: `gateway:${row.id}:${result.paymentId}`,
      amount: money(row.amount),
      currency: row.currency,
      // Test ortamında para gerçek değil: eşik üstü tutar onaya gider.
      settled: row.provider !== 'TEST',
      reference: String(result.paymentId).slice(0, 60),
      note: `Sanal POS${row.provider === 'TEST' ? ' (test ortamı)' : ''}: ${result.cardBrand ?? 'kart'} •••• ${result.last4 ?? '—'}${result.installment > 1 ? `, ${result.installment} taksit` : ''}`,
    });
    if (duplicate) {
      await logLinkEvent(tx, stage, row, { kind: 'PAID', ok: false, code: 'DUPLICATE', message: `Aynı linke ikinci ödeme (${result.paymentId}) folyoya yazıldı; misafire iade edin`, actor });
      await raiseStaffAlert(tx, stage, { hotelId: row.hotelId, kind: 'PAYMENT_GATEWAY', severity: 'WARNING', title: 'Aynı linke ikinci ödeme', body: `${row.description ?? ''}: misafir iki kez ödedi (${money(result.paidPrice)} ${row.currency}). İkinci ödeme folyoya yazıldı; iade edin.`, link: `/sanal-pos/linkler/${row.id}`, permission: PERMISSIONS.PAYMENT_GATEWAY_SEND, entityType: 'PaymentLink', entityId: row.id, dedupeKey: `gateway:${row.id}:dup:${result.paymentId}` });
      return;
    }
    await tx.paymentLink.update({
      where: { id: row.id },
      data: { status: 'PAID', paidAt: row.paidAt ?? new Date(), paidAmount: money(result.paidPrice), providerPaymentId: result.paymentId, providerItems: result.items ?? [], cardBrand: result.cardBrand, cardLast4: result.last4, installment: result.installment, paymentId, failureCode: null, failureMessage: null, providerToken: token },
    });
    await logLinkEvent(tx, stage, row, { kind: 'PAID', ok: true, code: result.code, message: `${money(result.paidPrice)} ${row.currency} · ${result.cardBrand ?? 'kart'} •••• ${result.last4 ?? '—'} · ödeme ${result.paymentId}`, actor, status: 'PAID' });
    await raiseStaffAlert(tx, stage, { hotelId: row.hotelId, kind: 'PAYMENT_GATEWAY', severity: 'INFO', title: `Online ödeme alındı: ${money(result.paidPrice)} ${row.currency}`, body: `${row.description ?? ''} — folyoya sanal POS ödemesi olarak yazıldı.`, link: `/sanal-pos/linkler/${row.id}`, permission: PERMISSIONS.PAYMENT_GATEWAY_VIEW, entityType: 'PaymentLink', entityId: row.id, dedupeKey: `gateway:${row.id}:paid` });
  });
}

/**
 * Folyoya yazılamamış ödemeleri yeniden yazar (iş). Sağlayıcıya yeniden sormaz: sonuç doğrulanmış ve linke yazılmıştı.
 * @returns {Promise<number>} yazılan
 */
export async function postPendingPaidLinks() {
  const rows = await prisma.paymentLink.findMany({ where: { status: 'PAID', paymentId: null, failureCode: 'NOT_POSTED' }, take: 50 });
  let posted = 0;
  for (const row of rows) {
    try {
      await runWithContext({ correlationId: randomUUID(), actor: SYSTEM_ACTOR }, () =>
        postPaid(row, row.providerToken, { paymentId: row.providerPaymentId, paidPrice: money(row.paidAmount), items: row.providerItems, cardBrand: row.cardBrand, last4: row.cardLast4, installment: row.installment, code: 'REPOSTED' }, SYSTEM_ACTOR),
      );
      posted += 1;
    } catch {
      // Folyo hâlâ açılamıyor: zil açık, sonraki tur.
    }
  }
  return posted;
}

/** @param {any} link @param {string} token @param {Record<string, string>} [callbackFields] */
async function retrieveAndSettle(link, token, callbackFields, actor) {
  const settings = await loadGatewaySettings(prisma, link.hotelId);
  // Test ortamı: sonucu tarayıcı söyler; yalnız sunucunun açtığı güncel oturum, "ödeme sürüyor"dayken ve ayar hâlâ test iken.
  if (link.provider === 'TEST' && (link.status !== 'PROCESSING' || link.providerToken !== token || settings.provider !== 'TEST' || !settings.isEnabled)) return 'FAILED';
  const provider = gatewayProviderFor(link.provider);
  if (!provider) throw new GatewayProviderError('Sağlayıcı tanımsız', { code: 'GATEWAY_CONFIG' });
  const result = await provider.retrieve(providerContext(link.hotelId, { ...settings, environment: link.environment }), {
    token,
    conversationId: link.conversationId ?? `${link.id}:${link.attempts}`,
    expected: { amount: money(link.amount), currency: link.currency, basketId: link.id },
    callbackFields,
  });
  return settle(link, token, result, actor);
}

/**
 * Sağlayıcının geri dönüşü (tarayıcı POST'u). Hata fırlatmaz: misafiri her durumda sonuç sayfasına yollar.
 * @param {string} code @param {Record<string, string>} fields
 * @returns {Promise<string>} misafirin yönleneceği adres
 */
export async function handleCallback(code, fields) {
  const link = await findByCode(code);
  const page = (await payPageUrl(link.hotelId, code)) ?? '/';
  const token = String(fields?.token ?? '');
  if (!token) return `${page}?sonuc=hata`;
  try {
    const outcome = await runWithContext({ correlationId: randomUUID(), actor: GUEST_ACTOR }, () => retrieveAndSettle(link, token, fields, GUEST_ACTOR));
    const label = { PAID: 'odendi', FAILED: 'basarisiz', ABANDONED: 'yarida', PENDING: 'bekliyor', UNVERIFIED: 'bekliyor' }[outcome];
    return `${page}?sonuc=${label}`;
  } catch {
    // Sağlayıcıya ulaşılamadı: link "ödeme sürüyor"da kalır, kurtarma işi sonuçlandırır.
    return `${page}?sonuc=bekliyor`;
  }
}

/**
 * Takılan linki sağlayıcıya sorarak sonuçlandırır; güncel oturum ödenmemişse önceki oturumlar da sorulur.
 * @param {string} linkId
 */
export async function recoverLink(linkId) {
  const link = await prisma.paymentLink.findUnique({ where: { id: linkId } });
  if (!link || link.status !== 'PROCESSING') return 'SKIPPED';
  if (link.failureCode === 'UNVERIFIED') return 'UNVERIFIED';
  if (!link.providerToken) {
    // Oturum açılıyor olabilir: yalnız bayatsa yeniden ödenebilir yapılır.
    if (!link.startedAt || Date.now() - link.startedAt.getTime() < NO_SESSION_STALE_MS) return 'PENDING';
    // Oturum hiç açılmadı (başlatırken süreç düştü): yeniden ödenebilir.
    await writeWithEvents(async (tx, stage) => {
      const { count } = await tx.paymentLink.updateMany({ where: { id: link.id, status: 'PROCESSING', providerToken: null }, data: { status: 'OPEN' } });
      if (count) await logLinkEvent(tx, stage, link, { kind: 'FAILED', ok: false, code: 'NO_SESSION', message: 'Ödeme oturumu açılmamıştı; link yeniden ödenebilir', actor: SYSTEM_ACTOR, status: 'OPEN' });
    });
    return 'ABANDONED';
  }
  return runWithContext({ correlationId: randomUUID(), actor: SYSTEM_ACTOR }, async () => {
    const outcome = await retrieveAndSettle(link, link.providerToken, undefined, SYSTEM_ACTOR);
    if (outcome !== 'ABANDONED' && outcome !== 'FAILED') return outcome;
    if (link.provider === 'TEST') return outcome;
    // Misafir eski bir sekmeden (önceki oturum) ödemiş olabilir.
    const sessions = await prisma.paymentLinkEvent.findMany({ where: { linkId: link.id, kind: 'SESSION', code: { not: link.providerToken } }, orderBy: { createdAt: 'desc' }, take: PREVIOUS_SESSIONS, select: { code: true } });
    for (const { code } of sessions) {
      const fresh = await prisma.paymentLink.findUnique({ where: { id: link.id } });
      const previous = await retrieveAndSettle({ ...fresh, status: 'PROCESSING' }, code, undefined, SYSTEM_ACTOR).catch(() => 'FAILED');
      if (previous === 'PAID') return 'PAID';
    }
    return outcome;
  });
}

/** Test ortamının taklit ödeme sayfası (yalnız TEST sağlayıcısı). @param {string} code @param {string} token */
export async function testCheckoutPage(code, token) {
  const link = await findByCode(code);
  if (link.provider !== 'TEST') throw new NotFoundError('Sayfa bulunamadı');
  const settings = await loadGatewaySettings(prisma, link.hotelId);
  const action = callbackUrl(settings, code);
  const safe = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
  const page = (await payPageUrl(link.hotelId, code)) ?? '/';
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test ödeme sayfası</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f4f5;margin:0;padding:24px;color:#18181b}main{max-width:420px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px #0002}
.warn{background:#fef3c7;color:#92400e;padding:10px 12px;border-radius:8px;font-size:14px}button{width:100%;padding:12px;border:0;border-radius:8px;font-size:16px;margin-top:12px;cursor:pointer}
.pay{background:#16a34a;color:#fff}a{display:block;text-align:center;margin-top:12px;color:#52525b}</style></head><body><main>
<p class="warn">Test ortamı — gerçek ödeme alınmaz, kart bilgisi istenmez.</p><h1 style="font-size:20px">${safe(link.description ?? 'Ödeme')}</h1>
<p style="font-size:28px;font-weight:700">${safe(money(link.amount))} ${safe(link.currency)}</p>
<form method="post" action="${safe(action)}"><input type="hidden" name="token" value="${safe(token)}"><input type="hidden" name="testOutcome" value="pay"><button class="pay" type="submit">Test kartıyla öde</button></form>
<a href="${safe(page)}?sonuc=yarida">Vazgeç</a></main></body></html>`;
}
