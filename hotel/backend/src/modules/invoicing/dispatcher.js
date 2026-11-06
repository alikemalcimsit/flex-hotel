import { EDOC_STATE_LABELS, edocRetryAt } from '@hotelos/hotel-contracts';
import { prismaUnfiltered } from '../../db.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { startRecurringJobs } from '../../lib/recurring.js';
import { SQL_NOW, sqlTimestamp } from '../../lib/sql-time.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { EdocProviderError, providerFor } from './providers/index.js';
import { addInvoiceLog, loadInvoiceSettings, prisma } from './shared.js';

/**
 * e-belge göndericisi (modül 49).
 *
 * ### Üstlenme
 * Sırası gelen kesilmiş faturalar tek SQL ile "gönderiliyor"a alınır (`FOR UPDATE SKIP LOCKED`, kısmi index
 * `Invoice_edoc_queue_idx`): aynı faturayı iki süreç / iki tur göndermez. İptal onayı bekleyen fatura
 * üstlenilmez (karar çıkana kadar gönderim durur).
 *
 * ### Sonuç
 * - Entegratör aldı → "entegratörde"; durum sorgusu GİB sonucunu yazar (tamamlandı / reddedildi).
 * - Geçici hata (ağ, hız sınırı) → artan aralıkla yeniden (`EDOC_RETRY_DELAYS_MS`); hak bitince
 *   "gönderilemedi" ve uyarı.
 * - Kalıcı hata (belge reddedildi) → "reddedildi" ve uyarı; personel düzeltip tekrar gönderir ya da iptal
 *   edip yeniden keser.
 *
 * ### Takılı kalan
 * Süreç gönderirken kapanırsa fatura "gönderiliyor"da kalır; kurtarıcı süre sonra sıraya geri koyar. O ender
 * durumda entegratör belgeyi almış olabilir: ETTN aynı olduğundan entegratör ikinci gönderimi mükerrer
 * sayar (belge iki kez işlenmez).
 */

const DISPATCH_BATCH = 20;
const DISPATCH_CONCURRENCY = 4;
const MAX_ROUNDS_PER_RUN = 10;
/** "Gönderiliyor"da bu kadar kalan takılı sayılır. */
export const EDOC_STALE_SENDING_MS = 5 * 60_000;
/** Gönderimden sonra durum bu kadar süre sorulur; sonra "entegratörde" kalır, uyarı açılır. */
const STATUS_WINDOW_MS = 7 * 86_400_000;
/** Bir durum turunda en fazla sorgu (entegratör hız sınırı). */
const STATUS_BATCH = 200;
/** Aynı anda en fazla durum sorgusu: gerçek entegratörde istek başına 100–300 ms; sıralı tur dakikayı aşardı. */
const STATUS_CONCURRENCY = 4;
/** Gönderimden sonra ilk durum sorgusuna kadar bekleme (GİB işlesin). */
const STATUS_MIN_AGE_MS = 30_000;
const KICK_DEBOUNCE_MS = 150;

/** @param {number} limit */
export function claimDueEdocs(limit = DISPATCH_BATCH) {
  return prismaUnfiltered.$queryRaw`
    UPDATE "Invoice" i
    SET "edocState" = 'SENDING', "edocLockedAt" = ${SQL_NOW}, "edocAttempts" = i."edocAttempts" + 1
    WHERE i."id" IN (
      SELECT "id" FROM "Invoice"
      WHERE "edocState" = 'QUEUED' AND "status" = 'ISSUED' AND "edocNextAttemptAt" <= ${SQL_NOW}
      ORDER BY "edocNextAttemptAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING i."id", i."hotelId", i."documentType", i."number", i."uuid", i."receiverAlias", i."buyerTaxNumber",
              i."buyer"->>'email' AS "buyerEmail", i."edocProvider", i."edocAttempts", i."folioId", i."eventId"`;
}

/**
 * Sonucu yaz — yalnızca fatura hâlâ beklenen durumdaysa (kurtarıcı / iptal araya girmiş olabilir).
 * @param {{ id: string, hotelId: string, folioId: string | null, eventId: string | null }} row
 * @param {'SENDING' | 'SENT'} expected
 * @param {any} data
 * @param {{ log: { kind: string, state?: string, code?: string | null, message?: string | null }, alert?: { title: string, body: string } }} effects
 */
async function finish(row, expected, data, { log, alert }) {
  await writeWithEvents(async (tx, stage) => {
    const { count } = await tx.invoice.updateMany({ where: { id: row.id, hotelId: row.hotelId, edocState: expected }, data });
    if (count === 0) return;
    await addInvoiceLog(tx, { hotelId: row.hotelId, invoiceId: row.id, actor: 'system', ...log });
    if (alert) {
      await raiseStaffAlert(tx, stage, {
        hotelId: row.hotelId,
        kind: 'INVOICE',
        severity: 'WARNING',
        title: alert.title.slice(0, 200),
        body: alert.body,
        link: `/faturalar/${row.id}`,
        userId: null,
        permission: PERMISSIONS.INVOICES_ISSUE,
        entityType: 'Invoice',
        entityId: row.id,
        dedupeKey: `invoice-edoc:${row.id}:${log.kind}`,
      });
    }
    await stage('invoice.changed', { hotelId: row.hotelId, invoiceId: row.id, change: 'EDOC', folioId: row.folioId, eventId: row.eventId });
  });
}

/**
 * Bir faturayı entegratöre verir. Hata fırlatmaz; sonucu kayda yazar.
 * @param {any} row üstlenilmiş satır
 * @param {Date} [now]
 */
export async function deliverEdoc(row, now = new Date()) {
  const settings = await loadInvoiceSettings(prisma, row.hotelId);
  const provider = providerFor(row.edocProvider ?? settings?.provider ?? '');
  const document = await prisma.invoiceDocument.findUnique({ where: { invoiceId: row.id }, select: { xml: true } });
  try {
    if (!provider || !settings) throw new EdocProviderError('Entegratör ya da fatura ayarı tanımsız', { code: 'EDOC_CONFIG' });
    if (!document) throw new EdocProviderError('Faturanın e-belgesi yok', { code: 'EDOC_DOCUMENT' });
    const result = await provider.send(
      { client: prisma, hotelId: row.hotelId, settings },
      { documentType: row.documentType, number: row.number, uuid: row.uuid, xml: document.xml, receiverTaxNumber: row.buyerTaxNumber, receiverAlias: row.receiverAlias, buyerEmail: row.buyerEmail },
    );
    await finish(row, 'SENDING', { edocState: 'SENT', edocLockedAt: null, edocSentAt: now, edocProviderRef: result.ref, edocStatusCode: result.code, edocMessage: result.message, edocChecks: 0, edocCheckedAt: null, edocNextAttemptAt: null }, { log: { kind: 'SENT', state: 'SENT', code: result.code, message: result.message } });
  } catch (error) {
    const err = /** @type {any} */ (error);
    const retryable = err instanceof EdocProviderError ? err.retryable : true;
    const code = err?.code && typeof err.code === 'string' ? err.code : 'EDOC_ERROR';
    const message = String(err?.message ?? err).slice(0, 500);
    const retryAt = retryable ? edocRetryAt(row.edocAttempts, now) : null;
    if (retryAt) {
      await finish(row, 'SENDING', { edocState: 'QUEUED', edocLockedAt: null, edocNextAttemptAt: retryAt, edocStatusCode: code, edocMessage: message }, { log: { kind: 'RETRY', state: 'QUEUED', code, message: `${message} · ${row.edocAttempts}. deneme; sıradaki ${retryAt.toISOString()}` } });
    } else {
      const state = retryable ? 'FAILED' : 'REJECTED';
      await finish(
        row,
        'SENDING',
        { edocState: state, edocLockedAt: null, edocNextAttemptAt: null, edocStatusCode: code, edocMessage: message },
        {
          log: { kind: state, state, code, message },
          alert: { title: `e-belge ${EDOC_STATE_LABELS[state].toLowerCase()}: ${row.number}`, body: `${message} Fatura ekranından tekrar gönderin ya da iptal edip yeniden kesin.` },
        },
      );
    }
  }
}

/** @template T @param {T[]} items @param {number} limit @param {(item: T) => Promise<void>} fn */
async function runLimited(items, limit, fn) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Sırası gelen e-belgeleri gönderir.
 * @param {{ error?: Function }} [logger]
 * @returns {Promise<number>}
 */
export async function dispatchDueEdocs(logger) {
  let processed = 0;
  for (let round = 0; round < MAX_ROUNDS_PER_RUN; round += 1) {
    const rows = /** @type {any[]} */ (await claimDueEdocs(DISPATCH_BATCH));
    if (rows.length === 0) break;
    await runLimited(rows, DISPATCH_CONCURRENCY, async (row) => {
      try {
        await deliverEdoc(row);
      } catch (error) {
        logger?.error?.({ err: error, invoiceId: row.id }, 'e-belge sonucu yazılamadı');
      }
    });
    processed += rows.length;
    if (rows.length < DISPATCH_BATCH) break;
  }
  return processed;
}

/** Takılı kalan gönderimleri sıraya geri koyar. @param {Date} [now] */
export function recoverStaleEdocs(now = new Date()) {
  const cut = new Date(now.getTime() - EDOC_STALE_SENDING_MS);
  return prismaUnfiltered.$executeRaw`
    UPDATE "Invoice" SET "edocState" = 'QUEUED', "edocNextAttemptAt" = ${SQL_NOW}, "edocLockedAt" = NULL
    WHERE "edocState" = 'SENDING' AND "edocLockedAt" < ${sqlTimestamp(cut)}`;
}

/**
 * GİB sonucunu sorar: entegratörde bekleyenler (kısmi index `Invoice_edoc_poll_idx`), en uzun süredir
 * sorulmayan önce. Tamamlanan / reddedilen yazılır; penceresi dolan uyarı açar.
 * @param {{ error?: Function }} [logger] @param {Date} [now]
 * @returns {Promise<number>} sonucu kesinleşen
 */
export async function pollEdocStatuses(logger, now = new Date()) {
  const rows = /** @type {any[]} */ (
    await prismaUnfiltered.$queryRaw`
      SELECT "id", "hotelId", "documentType", "number", "uuid", "edocProviderRef", "edocProvider", "edocChecks", "edocSentAt", "buyerTaxNumber", "folioId", "eventId"
      FROM "Invoice"
      WHERE "edocState" = 'SENT' AND ("edocCheckedAt" IS NULL OR "edocCheckedAt" < ${sqlTimestamp(new Date(now.getTime() - STATUS_MIN_AGE_MS))})
      ORDER BY "edocCheckedAt" NULLS FIRST, "id"
      LIMIT ${STATUS_BATCH}`
  );
  let settled = 0;
  /** @type {Map<string, Promise<any>>} */
  const settingsByHotel = new Map();
  await runLimited(rows, STATUS_CONCURRENCY, async (row) => {
    try {
      if (row.edocSentAt && now.getTime() - row.edocSentAt.getTime() < STATUS_MIN_AGE_MS) return;
      if (!settingsByHotel.has(row.hotelId)) settingsByHotel.set(row.hotelId, loadInvoiceSettings(prisma, row.hotelId));
      const settings = await settingsByHotel.get(row.hotelId);
      const provider = providerFor(row.edocProvider ?? settings?.provider ?? '');
      if (!provider || !settings) return;
      if (row.edocSentAt && now.getTime() - row.edocSentAt.getTime() > STATUS_WINDOW_MS) {
        await finish(row, 'SENT', { edocCheckedAt: now, edocState: 'FAILED', edocStatusCode: 'EDOC_NO_RESULT', edocMessage: 'Entegratör 7 gün içinde sonuç bildirmedi' }, {
          log: { kind: 'FAILED', state: 'FAILED', code: 'EDOC_NO_RESULT', message: 'Entegratör 7 gün içinde sonuç bildirmedi; entegratör panelinden kontrol edin' },
          alert: { title: `e-belge sonucu gelmedi: ${row.number}`, body: 'Entegratör panelinden durumu kontrol edin; gerekiyorsa tekrar gönderin.' },
        });
        settled += 1;
        return;
      }
      const result = await provider.status({ client: prisma, hotelId: row.hotelId, settings }, { documentType: row.documentType, uuid: row.uuid, ref: row.edocProviderRef, checks: row.edocChecks, receiverTaxNumber: row.buyerTaxNumber });
      if (result.state === 'PROCESSING') {
        await prisma.invoice.updateMany({ where: { id: row.id, edocState: 'SENT' }, data: { edocCheckedAt: now, edocChecks: { increment: 1 }, edocStatusCode: result.code, edocMessage: result.message } });
        return;
      }
      const delivered = result.state === 'DELIVERED';
      await finish(
        row,
        'SENT',
        { edocState: delivered ? 'DELIVERED' : 'REJECTED', edocCheckedAt: now, edocChecks: { increment: 1 }, edocCompletedAt: delivered ? now : null, edocStatusCode: result.code, edocMessage: result.message },
        {
          log: { kind: delivered ? 'DELIVERED' : 'REJECTED', state: delivered ? 'DELIVERED' : 'REJECTED', code: result.code, message: result.message },
          ...(delivered ? {} : { alert: { title: `e-belge reddedildi: ${row.number}`, body: `${result.message ?? ''} Faturayı iptal edip yeniden kesin ya da düzeltip tekrar gönderin.`.trim() } }),
        },
      );
      settled += 1;
    } catch (error) {
      // Geçici sorgu hatası: bir sonraki turda yeniden (sorgu zamanı ilerler ki diğerleri beklemesin).
      await prisma.invoice.updateMany({ where: { id: row.id, edocState: 'SENT' }, data: { edocCheckedAt: now } }).catch(() => {});
      logger?.error?.({ err: error, invoiceId: row.id }, 'e-belge durumu sorulamadı');
    }
  });
  return settled;
}

/* ═══════════════ Tetikleme ve zamanlama ═══════════════ */

let kickTimer = null;
let running = false;
let rerun = false;
/** @type {{ error?: Function } | undefined} */
let kickLogger;

/** Yeni e-belge sıraya girdi: kısa bekleme sonra gönder (HTTP isteğini tutmaz). */
export function kickEdocDispatcher() {
  if (kickTimer) return;
  kickTimer = setTimeout(async () => {
    kickTimer = null;
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      do {
        rerun = false;
        await dispatchDueEdocs(kickLogger);
      } while (rerun);
    } catch (error) {
      kickLogger?.error?.({ err: error }, 'e-belge gönderici turu başarısız');
    } finally {
      running = false;
    }
  }, KICK_DEBOUNCE_MS);
  kickTimer.unref?.();
}

/** Testler ve kapanış: bekleyen tetiklemeyi iptal et. */
export function stopEdocDispatcher() {
  if (kickTimer) clearTimeout(kickTimer);
  kickTimer = null;
}

/**
 * Sunucu işleri: gönderim (geçici hatanın sırası gelince), durum sorgusu, takılı kurtarma.
 * @param {{ error: Function }} logger
 */
export function startInvoiceJobs(logger) {
  kickLogger = logger;
  return startRecurringJobs(logger, [
    { name: 'edoc-dispatch', intervalMs: 30_000, run: async () => (running ? 0 : dispatchDueEdocs(logger)) },
    { name: 'edoc-status', intervalMs: 60_000, run: () => pollEdocStatuses(logger) },
    { name: 'edoc-recover', intervalMs: 5 * 60_000, run: () => recoverStaleEdocs() },
  ]);
}
