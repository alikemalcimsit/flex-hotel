import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { currentActor, runWithContext } from '@hotelos/core';
import {
  APPROVAL_TYPE_LABELS,
  EDOC_REACHED_STATES,
  EDOC_RESENDABLE_STATES,
  EDOC_STATE_LABELS,
  INVOICE_CANCEL_APPROVAL_DAYS,
  INVOICE_DOCUMENT_TYPE_LABELS,
  INVOICE_SOURCE_LABELS,
  chooseInvoiceDocumentType,
  formatInvoiceNumber,
  invoiceBuyerName,
  invoiceBuyerProblems,
  invoiceDeadline,
  isForeignBuyer,
} from '@hotelos/hotel-contracts';
import { prismaUnfiltered } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, bulkItemFailure } from '../../lib/errors.js';
import { lockEvents, lockFolios, lockInvoices } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { sqlTimestamp } from '../../lib/sql-time.js';
import { findActiveStaffByEmail } from '../../lib/staff.js';
import { writeWithEvents } from '../../lib/write.js';
import { requestApproval } from '../approvals/service.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { kickEdocDispatcher } from './dispatcher.js';
import { providerFor } from './providers/index.js';
import {
  INVOICE_LIST_SELECT,
  addInvoiceLog,
  calendarToday,
  clockTime,
  dateOnly,
  day,
  dotted,
  hotelContext,
  invoiceLineView,
  invoicingStartsAt,
  invoiceListView,
  iso,
  lineRows,
  loadInvoiceSettings,
  loadTaxCodeMap,
  money,
  nextInvoiceSequence,
  priced,
  prisma,
} from './shared.js';
import { buyerFromAccount, composeInvoice, eventDefaultBuyer, eventSource, folioDefaultBuyer, folioSource, manualCharges } from './sources.js';
import { lookupTaxpayer } from './taxpayers.js';
import { buildUblInvoice } from './ubl.js';

/**
 * Faturalar (modül 16 çekirdeği + 49).
 *
 * Akış: taslak (kapanmış folyodan — folyo aktörü kapanışta açar —, faturaya hazır etkinlikten ya da cariye
 * serbest) → alıcı düzenlenir → **kesim**: kaynak yeniden okunur (taslaktan sonra değiştiyse taslak yenilenir,
 * kesim durur), mükellef sorgusuyla e-Fatura / e-Arşiv belirlenir, seri × yıl sırasıyla numara verilir
 * (kilit altında, boşluksuz), UBL-TR belgesi donar ve gönderim sırasına girer → gönderici entegratöre verir,
 * durum sorgusu GİB sonucunu yazar. Kesilmiş fatura değişmez; iptal onay kuyruğundan (dört göz): GİB'e
 * ulaşmamışsa yerelde, e-Arşiv entegratörden, e-Fatura GİB portalı referansıyla.
 *
 * Kilit sırası: fatura → kaynak (folyo / etkinlik). Folyo ve etkinlik başına tek geçerli fatura veritabanı
 * kısıtıyla (kısmi tekil index); aynı folyoya eşzamanlı iki taslak / kesim biri hatayla döner.
 */

const DETAIL_LOG_LIMIT = 100;

/** Otel para birimi TRY değilse fatura kesilmez (döviz faturası sonra). @param {{ currency: string }} context */
function assertTryHotel(context) {
  if (context.currency !== 'TRY') throw new ConflictError(`Fatura otel para birimi TRY iken kesilir (otel: ${context.currency}); döviz faturası henüz yok`, 'INVOICE_CURRENCY');
}

/** @param {string} hotelId */
async function requireSettings(hotelId) {
  const settings = await loadInvoiceSettings(prisma, hotelId);
  if (!settings) throw new ConflictError('Fatura ayarları girilmemiş: Faturalar → Ayarlar (satıcı bilgileri, seriler, vergi kodları)', 'INVOICE_SETTINGS_MISSING');
  return settings;
}

/** Alıcının liste / arama kolonları. @param {any} buyer */
const buyerColumns = (buyer) => ({
  buyerType: buyer?.type ?? null,
  buyerName: buyer ? invoiceBuyerName(buyer) || null : null,
  buyerTaxNumber: isForeignBuyer(buyer) ? null : (buyer?.taxNumber ?? null),
});

/** Toplam kolonları. @param {ReturnType<typeof composeInvoice>['totals']} totals */
const totalColumns = (totals) => ({
  grossTotal: totals.gross,
  discountTotal: totals.discount,
  netTotal: totals.lineExtension,
  taxTotal: totals.taxTotal,
  total: totals.payable,
  taxes: totals.taxes,
});

/** Satırları elle girilen (düzenlenebilir) taslak: serbest fatura ve iptal bedeli faturası. @param {{ source: string }} invoice @param {{ status: string } | null} event */
const linesEditable = (invoice, event) => invoice.source === 'MANUAL' || (invoice.source === 'EVENT' && event?.status === 'CANCELLED');

/* ═══════════════ Okuma ═══════════════ */

/**
 * Fatura listesi: kesilmişler (varsayılan; taslaklar `status=DRAFT` ile), kesim gününe göre yeniden eskiye.
 * Arama: numara (başı), alıcı adı, vergi no (başı). Sayaçlar: taslak ve dikkat isteyen e-belgeler.
 * @param {string} hotelId @param {any} query
 */
export async function listInvoices(hotelId, query) {
  /** @type {any} */
  const where = { hotelId };
  if (query.folioId) where.folioId = query.folioId;
  if (query.eventId) where.eventId = query.eventId;
  // Kaynağın faturaları (folyo / etkinlik ekranı) taslak dahil; genel liste kesilmişler.
  if (query.status) where.status = query.status;
  else if (!query.folioId && !query.eventId) where.status = { not: 'DRAFT' };
  if (query.documentType) where.documentType = query.documentType;
  if (query.edocState) where.edocState = query.edocState;
  if (query.source) where.source = query.source;
  if (query.from || query.to) where.issueDate = { ...(query.from ? { gte: dateOnly(query.from) } : {}), ...(query.to ? { lte: dateOnly(query.to) } : {}) };
  const search = query.search?.trim();
  if (search) {
    const digits = search.replace(/\s+/g, '');
    where.OR = [{ number: { startsWith: search.toUpperCase() } }, { buyerName: { contains: search, mode: 'insensitive' } }, ...(/^\d+$/.test(digits) ? [{ buyerTaxNumber: { startsWith: digits } }] : [])];
  }
  const orderBy = query.status === 'DRAFT' ? [{ createdAt: 'desc' }, { id: 'desc' }] : [{ issueDate: 'desc' }, { issuedAt: 'desc' }, { id: 'desc' }];
  // Taslakta alıcının kesime yeterliliği de döner (toplu kesimde eksik alıcılı taslak seçilemez).
  const drafts = query.status === 'DRAFT';
  const [rows, total, counts] = await Promise.all([
    prisma.invoice.findMany({ where, select: drafts ? { ...INVOICE_LIST_SELECT, buyer: true } : INVOICE_LIST_SELECT, orderBy, ...toSkipTake(query) }),
    prisma.invoice.count({ where }),
    prisma.$queryRaw`
      SELECT
        (SELECT count(*)::int FROM "Invoice" WHERE "hotelId" = ${hotelId} AND "status" = 'DRAFT') AS "drafts",
        (SELECT count(*)::int FROM "Invoice" WHERE "hotelId" = ${hotelId} AND "edocState" = 'FAILED') AS "failed",
        (SELECT count(*)::int FROM "Invoice" WHERE "hotelId" = ${hotelId} AND "edocState" = 'REJECTED') AS "rejected",
        (SELECT count(*)::int FROM "Invoice" WHERE "hotelId" = ${hotelId} AND "edocState" IN ('QUEUED', 'SENDING', 'SENT')) AS "pending",
        (SELECT count(*)::int FROM "Invoice" WHERE "hotelId" = ${hotelId} AND "status" = 'CANCEL_PENDING') AS "cancelPending"`,
  ]);
  const view = drafts ? (/** @type {any} */ row) => ({ ...invoiceListView(row), buyerProblems: Object.values(invoiceBuyerProblems(row.buyer)) }) : invoiceListView;
  return { ...buildPage(rows.map(view), total, query), counts: /** @type {any[]} */ (counts)[0] };
}

/**
 * Faturalanacaklar: penceredeki (kapanış günü) kapanmış folyolar ya da faturaya hazır etkinlikler — geçerli
 * faturası olmayanlar, en eski önce (yasal 7 gün). Taslağı olanın taslağı gösterilir.
 * @param {string} hotelId @param {{ kind: 'FOLIO' | 'EVENT', days: number, overdueOnly: boolean, search?: string, page: number, pageSize: number }} query
 */
export async function listInvoiceables(hotelId, query) {
  const [context, settings] = await Promise.all([hotelContext(hotelId), loadInvoiceSettings(prisma, hotelId)]);
  const today = calendarToday(context.timezone);
  // Ayar (ve faturalama başlangıcı) girilmeden kuyruk boş: geçmişin bütün folyoları "süresi geçmiş" görünmez.
  if (!settings) return { ...buildPage([], 0, query), today, startDate: null };
  const startsAt = invoicingStartsAt(settings, context.timezone);
  const windowStart = new Date(dateOnly(today).getTime() - query.days * 86_400_000);
  const since = startsAt > windowStart ? startsAt : windowStart;
  const startDate = day(settings.startDate);
  const overdueBefore = new Date(dateOnly(today).getTime() - 7 * 86_400_000);
  // Ham SQL'de zaman UTC duvar saati, gün metin olarak (oturumun saat dilimi sınırı kaydırmasın).
  const sinceAt = sqlTimestamp(since);
  const overdueAt = sqlTimestamp(overdueBefore);
  const overdueDay = day(overdueBefore);
  const term = query.search?.trim() ? `%${query.search.trim().replace(/[\\%_]/g, (char) => `\\${char}`)}%` : null;
  const offset = (query.page - 1) * query.pageSize;

  if (query.kind === 'EVENT') {
    const rows = /** @type {any[]} */ (
      await prisma.$queryRaw`
        SELECT e."id", e."code", e."name", e."status", e."currency", e."grandTotal", e."cancellationFee",
               COALESCE(e."completedAt", e."cancelledAt") AS "closedAt", e."lastEndAt", c."name" AS "clientName",
               d."id" AS "draftId", count(*) OVER ()::int AS "total"
        FROM "Event" e
        JOIN "EventClient" c ON c."id" = e."clientId"
        LEFT JOIN "Invoice" d ON d."eventId" = e."id" AND d."status" = 'DRAFT'
        WHERE e."hotelId" = ${hotelId}
          AND ((e."status" = 'COMPLETED' AND e."completedAt" >= ${sinceAt}) OR (e."status" = 'CANCELLED' AND e."cancellationFee" > 0 AND e."cancelledAt" >= ${sinceAt}))
          AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i."eventId" = e."id" AND i."status" IN ('ISSUED', 'CANCEL_PENDING'))
          ${term ? Prisma.sql`AND (e."code" ILIKE ${term} OR e."name" ILIKE ${term} OR c."name" ILIKE ${term})` : Prisma.empty}
          ${query.overdueOnly ? Prisma.sql`AND COALESCE(e."lastEndAt", e."completedAt", e."cancelledAt") < ${overdueAt}` : Prisma.empty}
        ORDER BY COALESCE(e."completedAt", e."cancelledAt"), e."id"
        LIMIT ${query.pageSize} OFFSET ${offset}`
    );
    return {
      ...buildPage(
        rows.map((row) => {
          const serviceTo = day(row.lastEndAt ?? row.closedAt);
          return {
            kind: 'EVENT',
            id: row.id,
            label: `${row.code} · ${row.name}`,
            party: row.clientName,
            amount: money(row.status === 'COMPLETED' ? row.grandTotal : row.cancellationFee),
            currency: row.currency,
            closedAt: iso(row.closedAt),
            cancellation: row.status === 'CANCELLED',
            draftId: row.draftId,
            ...(serviceTo ? invoiceDeadline(serviceTo, today) : { deadline: null, daysLeft: null, overdue: false }),
          };
        }),
        rows[0]?.total ?? 0,
        query,
      ),
      today,
      startDate,
    };
  }

  // İki aşama: önce yalın küme (kimlik + kapanış; sayım buradan), rezervasyon / misafir / oda ve son hizmet
  // günü yalnız sayfadaki satırlar için. Bir yıllık birikimde binlerce folyo ayrıntıyla birleştirilmez.
  // Süresi geçen = son hizmet günü yasal sürenin dışında: o günden sonra hizmeti olmayan folyo (kalem
  // başına en büyük gün yerine yakın günlerin kalemlerine karşı anti-join).
  const rows = /** @type {any[]} */ (
    await prisma.$queryRaw`
      WITH base AS MATERIALIZED (
        SELECT f."id", f."closedAt"
        FROM "Folio" f
        ${term ? Prisma.sql`JOIN "Reservation" r ON r."id" = f."reservationId" JOIN "Guest" g ON g."id" = f."guestId" LEFT JOIN "Room" rm ON rm."id" = r."roomId"` : Prisma.empty}
        WHERE f."hotelId" = ${hotelId} AND f."status" = 'CLOSED' AND f."deletedAt" IS NULL AND f."closedAt" >= ${sinceAt} AND f."chargesTotal" > 0
          AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i."folioId" = f."id" AND i."status" IN ('ISSUED', 'CANCEL_PENDING'))
          ${term ? Prisma.sql`AND (r."confirmationCode" ILIKE ${term} OR g."firstName" ILIKE ${term} OR g."lastName" ILIKE ${term} OR rm."number" ILIKE ${term})` : Prisma.empty}
          ${query.overdueOnly ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM "FolioItem" i WHERE i."folioId" = f."id" AND i."deletedAt" IS NULL AND i."serviceDate" >= ${overdueDay}::date)` : Prisma.empty}
      ), page AS (
        SELECT "id", "closedAt" FROM base ORDER BY "closedAt", "id" LIMIT ${query.pageSize} OFFSET ${offset}
      )
      SELECT f."id", f."window", f."currency", f."chargesTotal", f."closedAt", r."confirmationCode", rm."number" AS "room",
             g."firstName", g."lastName", d."id" AS "draftId",
             (SELECT max(i."serviceDate") FROM "FolioItem" i WHERE i."folioId" = f."id" AND i."deletedAt" IS NULL) AS "lastServiceDate",
             (SELECT count(*) FROM base)::int AS "total"
      FROM page p
      JOIN "Folio" f ON f."id" = p."id"
      JOIN "Reservation" r ON r."id" = f."reservationId"
      JOIN "Guest" g ON g."id" = f."guestId"
      LEFT JOIN "Room" rm ON rm."id" = r."roomId"
      LEFT JOIN "Invoice" d ON d."folioId" = f."id" AND d."status" = 'DRAFT'
      ORDER BY p."closedAt", p."id"`
  );
  return {
    ...buildPage(
      rows.map((row) => {
        const serviceTo = day(row.lastServiceDate) ?? day(row.closedAt);
        return {
          kind: 'FOLIO',
          id: row.id,
          label: [row.room, `${row.firstName} ${row.lastName}`].filter(Boolean).join(' · '),
          party: row.confirmationCode + (row.window > 1 ? ` · ${row.window}. folyo` : ''),
          amount: money(row.chargesTotal),
          currency: row.currency,
          closedAt: iso(row.closedAt),
          cancellation: false,
          draftId: row.draftId,
          ...invoiceDeadline(serviceTo, today),
        };
      }),
      rows[0]?.total ?? 0,
      query,
    ),
    today,
    startDate,
  };
}

/**
 * Faturanın ayrıntısı: satırlar, zaman çizelgesi, kaynak, yasal süre; taslakta kesimi durduran sorunlar.
 * @param {string} hotelId @param {string} invoiceId
 */
export async function getInvoice(hotelId, invoiceId) {
  const row = await prisma.invoice.findFirst({
    where: { id: invoiceId, hotelId },
    include: {
      lines: { orderBy: { sortOrder: 'asc' } },
      logs: { orderBy: { createdAt: 'desc' }, take: DETAIL_LOG_LIMIT },
      folio: { select: { id: true, window: true, status: true, closedAt: true, reservation: { select: { id: true, confirmationCode: true, room: { select: { number: true } } } }, guest: { select: { firstName: true, lastName: true } } } },
      event: { select: { id: true, code: true, name: true, status: true, cancellationFee: true, completedAt: true, cancelledAt: true } },
      ledgerAccount: { select: { id: true, code: true, name: true } },
    },
  });
  if (!row) throw new NotFoundError('Fatura bulunamadı');
  const context = await hotelContext(hotelId);
  const today = calendarToday(context.timezone);
  /** @type {string[]} */
  const issueProblems = [];
  const settings = await loadInvoiceSettings(prisma, hotelId);
  if (row.status === 'DRAFT') {
    if (!settings) issueProblems.push('Fatura ayarları girilmemiş (Faturalar → Ayarlar)');
    for (const message of Object.values(invoiceBuyerProblems(/** @type {any} */ (row.buyer)))) issueProblems.push(`Alıcı: ${message}`);
    if (row.source === 'EVENT' && row.event?.status === 'CANCELLED' && money(row.total) !== money(row.event.cancellationFee)) {
      issueProblems.push(`Fatura toplamı (${priced(row.total, row.currency)}) iptal bedeliyle (${priced(row.event.cancellationFee, row.currency)}) aynı olmalı (cariye yazılan tutar)`);
    }
  }
  return {
    invoice: {
      ...invoiceListView(row),
      buyer: row.buyer,
      note: row.note,
      grossTotal: money(row.grossTotal),
      discountTotal: money(row.discountTotal),
      taxes: row.taxes,
      receiverAlias: row.receiverAlias,
      edocProvider: row.edocProvider,
      edocEnvironment: row.edocEnvironment,
      edocSentAt: iso(row.edocSentAt),
      edocCompletedAt: iso(row.edocCompletedAt),
      edocProviderRef: row.edocProviderRef,
      issuedBy: row.issuedBy,
      cancelReason: row.cancelReason,
      cancelReference: row.cancelReference,
      cancelRequestedAt: iso(row.cancelRequestedAt),
      cancelRequestedBy: row.cancelRequestedBy,
      cancelApprovalId: row.cancelApprovalId,
      cancelledAt: iso(row.cancelledAt),
      cancelledBy: row.cancelledBy,
      cancelMethod: row.cancelMethod,
    },
    lines: row.lines.map(invoiceLineView),
    logs: row.logs.map((log) => ({ id: log.id, kind: log.kind, state: log.state, code: log.code, message: log.message, actor: log.actor, at: iso(log.createdAt) })),
    source: {
      folio: row.folio ? { id: row.folio.id, window: row.folio.window, status: row.folio.status, reservationId: row.folio.reservation.id, confirmationCode: row.folio.reservation.confirmationCode, room: row.folio.reservation.room?.number ?? null, guest: `${row.folio.guest.firstName} ${row.folio.guest.lastName}` } : null,
      event: row.event ? { id: row.event.id, code: row.event.code, name: row.event.name, status: row.event.status } : null,
      ledgerAccount: row.ledgerAccount,
    },
    linesEditable: row.status === 'DRAFT' && linesEditable(row, row.event),
    deadline: row.serviceTo && row.status === 'DRAFT' ? invoiceDeadline(day(row.serviceTo) ?? today, today) : null,
    issueProblems,
    beforeStart: row.status === 'DRAFT' ? sourceBeforeStart(row, settings, context.timezone) : null,
    environment: settings?.environment ?? null,
    today,
  };
}

/**
 * Taslağın kaynağı faturalama başlangıcından önce kapandıysa başlangıç günü (uyarı: önceki sistemde
 * faturalanmış olabilir; kesim durmaz — geç istenen fatura meşrudur).
 * @param {any} row @param {any} settings @param {string} timezone
 * @returns {string | null}
 */
function sourceBeforeStart(row, settings, timezone) {
  if (!settings) return null;
  const closedAt = row.folio?.closedAt ?? row.event?.completedAt ?? row.event?.cancelledAt ?? null;
  return closedAt && closedAt < invoicingStartsAt(settings, timezone) ? day(settings.startDate) : null;
}

/* ═══════════════ Taslak ═══════════════ */

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId
 * @param {{ folioId?: string, eventId?: string }} link
 */
async function activeInvoiceOf(tx, hotelId, link) {
  return tx.invoice.findFirst({ where: { hotelId, ...link, status: { not: 'CANCELLED' } }, select: { id: true, status: true, number: true } });
}

/**
 * Taslak aç. Folyo / etkinlik için o kaynağın taslağı varsa onu döner (aynı folyoya ikinci taslak yok);
 * kesilmiş faturası varsa hata.
 * @param {string} hotelId @param {any} input @param {{ system?: boolean }} [options]
 * @returns {Promise<{ invoiceId: string, created: boolean }>}
 */
export async function createDraft(hotelId, input, { system = false } = {}) {
  const context = await hotelContext(hotelId);
  assertTryHotel(context);
  await requireSettings(hotelId);
  const actor = system ? 'system' : currentActor();
  try {
    return await writeWithEvents(async (tx, stage) => {
      const taxCodes = await loadTaxCodeMap(tx, hotelId);
      /** @type {any} */
      let data;
      /** @type {Array<any>} */
      let lines;
      if (input.source === 'FOLIO') {
        if (!(await lockFolios(tx, hotelId, [input.folioId])).has(input.folioId)) throw new NotFoundError('Folyo bulunamadı');
        const existing = await activeInvoiceOf(tx, hotelId, { folioId: input.folioId });
        if (existing?.status === 'DRAFT') return { invoiceId: existing.id, created: false };
        if (existing) throw new ConflictError(`Folyonun faturası kesilmiş: ${existing.number}`, 'FOLIO_ALREADY_INVOICED');
        const { folio, charges, expectedTotal } = await folioSource(tx, hotelId, input.folioId);
        if (folio.status !== 'CLOSED') throw new ConflictError('Folyo kapalı değil: bakiyesi kapanmış folyo faturalanır', 'FOLIO_NOT_CLOSED');
        const composed = composeInvoice({ source: 'FOLIO', charges, taxCodes, expectedTotal });
        if (composed.problems.length) throw new ConflictError(composed.problems.join(' · '), 'INVOICE_LINES');
        const buyer = await folioDefaultBuyer(tx, hotelId, folio);
        lines = composed.lines;
        data = {
          source: 'FOLIO',
          folioId: folio.id,
          guestId: buyer.guestId ?? folio.guestId,
          ledgerAccountId: buyer.ledgerAccountId,
          currency: folio.currency,
          serviceFrom: lines.map((line) => line.serviceFrom).filter(Boolean).sort()[0] ?? null,
          serviceTo: lines.map((line) => line.serviceTo).filter(Boolean).sort().at(-1) ?? null,
          buyer: buyer.buyer,
          totals: composed.totals,
        };
      } else if (input.source === 'EVENT') {
        if (!(await lockEvents(tx, hotelId, [input.eventId])).has(input.eventId)) throw new NotFoundError('Etkinlik bulunamadı');
        const existing = await activeInvoiceOf(tx, hotelId, { eventId: input.eventId });
        if (existing?.status === 'DRAFT') return { invoiceId: existing.id, created: false };
        if (existing) throw new ConflictError(`Etkinliğin faturası kesilmiş: ${existing.number}`, 'EVENT_ALREADY_INVOICED');
        const source = await eventSource(tx, hotelId, input.eventId, context.timezone);
        let composed;
        if (source.kind === 'COMPLETED') {
          composed = composeInvoice({ source: 'EVENT', charges: source.charges, taxCodes, expectedTotal: source.expectedTotal });
          if (composed.problems.length) throw new ConflictError(composed.problems.join(' · '), 'INVOICE_LINES');
        } else {
          // İptal bedeli: tek satır, vergi kategorisini personel doğrular (taslakta düzenlenir).
          const charges = await manualCharges(tx, hotelId, [{ description: `İptal bedeli · ${source.event.code} ${source.event.name}`, quantity: '1', unitCode: 'C62', unitAmount: source.expectedTotal, taxCategory: 'OTHER' }]);
          composed = composeInvoice({ source: 'EVENT', charges, taxCodes });
        }
        const buyer = await eventDefaultBuyer(tx, hotelId, source.event);
        lines = composed.lines;
        data = { source: 'EVENT', eventId: source.event.id, ledgerAccountId: buyer.ledgerAccountId, currency: source.event.currency, serviceFrom: source.serviceFrom, serviceTo: source.serviceTo, buyer: buyer.buyer, totals: composed.totals };
      } else {
        const account = await tx.ledgerAccount.findFirst({ where: { id: input.ledgerAccountId, hotelId }, select: { id: true, type: true, name: true, taxNumber: true, taxOffice: true, address: true, email: true, phone: true, isActive: true } });
        if (!account) throw new NotFoundError('Cari bulunamadı');
        if (!account.isActive) throw new ConflictError('Cari kullanımda değil', 'LEDGER_ACCOUNT_INACTIVE');
        const composed = composeInvoice({ source: 'MANUAL', charges: await manualCharges(tx, hotelId, input.lines), taxCodes });
        if (composed.problems.length) throw new ConflictError(composed.problems.join(' · '), 'INVOICE_LINES');
        const last = await tx.invoice.findFirst({ where: { hotelId, ledgerAccountId: account.id, status: 'ISSUED' }, orderBy: { issuedAt: 'desc' }, select: { buyer: true } });
        lines = composed.lines;
        data = { source: 'MANUAL', ledgerAccountId: account.id, currency: context.currency, serviceFrom: null, serviceTo: null, buyer: buyerFromAccount(account, /** @type {any} */ (last?.buyer?.type ? last.buyer : null)), totals: composed.totals, note: input.note ?? null };
      }
      const { totals, buyer, ...rest } = data;
      const created = await tx.invoice.create({
        data: {
          hotelId,
          ...rest,
          serviceFrom: rest.serviceFrom ? dateOnly(rest.serviceFrom) : null,
          serviceTo: rest.serviceTo ? dateOnly(rest.serviceTo) : null,
          buyer,
          ...buyerColumns(buyer),
          ...totalColumns(totals),
          createdBy: actor,
        },
        select: { id: true },
      });
      await tx.invoiceLine.createMany({ data: lineRows(hotelId, created.id, lines) });
      await addInvoiceLog(tx, { hotelId, invoiceId: created.id, kind: 'CREATED', message: `${INVOICE_SOURCE_LABELS[rest.source]} taslağı · ${priced(totals.payable, rest.currency)}`, actor });
      await recordAudit(tx, { hotelId, entity: 'Invoice', entityId: created.id, action: 'CREATE', after: { source: rest.source, folioId: rest.folioId ?? null, eventId: rest.eventId ?? null, total: totals.payable } });
      await stage('invoice.changed', { hotelId, invoiceId: created.id, change: 'CREATED', folioId: rest.folioId ?? null, eventId: rest.eventId ?? null });
      return { invoiceId: created.id, created: true };
    });
  } catch (error) {
    // Aynı folyoya / etkinliğe eşzamanlı ikinci taslak: kısmi tekil index; ilk açılanı döndür.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && (input.folioId || input.eventId)) {
      const existing = await prisma.invoice.findFirst({ where: { hotelId, ...(input.folioId ? { folioId: input.folioId } : { eventId: input.eventId }), status: { not: 'CANCELLED' } }, select: { id: true, status: true, number: true } });
      if (existing?.status === 'DRAFT') return { invoiceId: existing.id, created: false };
      if (existing) throw new ConflictError(`Faturası kesilmiş: ${existing.number}`, 'ALREADY_INVOICED');
    }
    throw error;
  }
}

/**
 * Taslağı düzenle: alıcı, not; elle girilen satırlar (serbest fatura, iptal bedeli).
 * @param {string} hotelId @param {string} invoiceId @param {any} input
 */
export async function updateDraft(hotelId, invoiceId, input) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    if (!(await lockInvoices(tx, hotelId, [invoiceId])).has(invoiceId)) throw new NotFoundError('Fatura bulunamadı');
    const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, hotelId }, select: { id: true, status: true, source: true, folioId: true, eventId: true, updatedAt: true, event: { select: { status: true } } } });
    if (!invoice) throw new NotFoundError('Fatura bulunamadı');
    if (invoice.status !== 'DRAFT') throw new ConflictError('Kesilmiş fatura değiştirilemez (iptal edip yeniden kesin)', 'INVOICE_NOT_DRAFT');
    if (invoice.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()) throw new StaleWriteError();
    /** @type {any} */
    const data = { buyer: input.buyer, ...buyerColumns(input.buyer), note: input.note ?? null };
    if (input.lines) {
      if (!linesEditable(invoice, invoice.event)) throw new ValidationError('Bu faturanın satırları kaynağından gelir; düzenlenemez', { field: 'lines' });
      const composed = composeInvoice({ source: invoice.source, charges: await manualCharges(tx, hotelId, input.lines), taxCodes: await loadTaxCodeMap(tx, hotelId) });
      if (composed.problems.length) throw new ValidationError(composed.problems.join(' · '), { field: 'lines' });
      Object.assign(data, totalColumns(composed.totals));
      await tx.invoiceLine.deleteMany({ where: { invoiceId } });
      await tx.invoiceLine.createMany({ data: lineRows(hotelId, invoiceId, composed.lines) });
    }
    await tx.invoice.update({ where: { id: invoiceId }, data });
    await addInvoiceLog(tx, { hotelId, invoiceId, kind: 'UPDATED', message: input.lines ? 'Alıcı ve satırlar düzenlendi' : 'Alıcı düzenlendi', actor });
    await stage('invoice.changed', { hotelId, invoiceId, change: 'UPDATED', folioId: invoice.folioId, eventId: invoice.eventId });
  });
  return getInvoice(hotelId, invoiceId);
}

/** Taslağı sil (folyo / etkinlik yeniden faturalanacaklar listesine döner). @param {string} hotelId @param {string} invoiceId */
export async function deleteDraft(hotelId, invoiceId) {
  await writeWithEvents(async (tx, stage) => {
    if (!(await lockInvoices(tx, hotelId, [invoiceId])).has(invoiceId)) throw new NotFoundError('Fatura bulunamadı');
    const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, hotelId }, select: { status: true, source: true, folioId: true, eventId: true, total: true } });
    if (!invoice) throw new NotFoundError('Fatura bulunamadı');
    if (invoice.status !== 'DRAFT') throw new ConflictError('Yalnız taslak silinir; kesilmiş fatura iptal edilir', 'INVOICE_NOT_DRAFT');
    await tx.invoice.delete({ where: { id: invoiceId } });
    await recordAudit(tx, { hotelId, entity: 'Invoice', entityId: invoiceId, action: 'DELETE', before: { source: invoice.source, folioId: invoice.folioId, eventId: invoice.eventId, total: money(invoice.total) } });
    await stage('invoice.changed', { hotelId, invoiceId, change: 'DELETED', folioId: invoice.folioId, eventId: invoice.eventId });
  });
}

/* ═══════════════ Kesim ═══════════════ */

/**
 * Taslağı kes: kaynak yeniden okunur, mükellef sorgusuyla belge türü, numara, UBL, gönderim sırası.
 * @param {string} hotelId @param {string} invoiceId @param {{ expectedUpdatedAt: string }} input
 */
export async function issueInvoice(hotelId, invoiceId, input) {
  await issueDraft(hotelId, invoiceId, input);
  return getInvoice(hotelId, invoiceId);
}

/**
 * Kesimin kendisi (tekli ve toplu kesim ortak).
 * @param {string} hotelId @param {string} invoiceId @param {{ expectedUpdatedAt: string | Date }} input
 * @returns {Promise<{ number: string }>}
 */
async function issueDraft(hotelId, invoiceId, input) {
  const context = await hotelContext(hotelId);
  assertTryHotel(context);
  const settings = await requireSettings(hotelId);
  const provider = providerFor(settings.provider);
  if (!provider) throw new ConflictError(`Tanımsız entegratör: ${settings.provider}`, 'EDOC_PROVIDER_UNKNOWN');
  const actor = currentActor();
  const draft = await prisma.invoice.findFirst({ where: { id: invoiceId, hotelId }, select: { status: true, buyer: true, updatedAt: true } });
  if (!draft) throw new NotFoundError('Fatura bulunamadı');
  if (draft.status !== 'DRAFT') throw new ConflictError('Fatura zaten kesilmiş', 'INVOICE_NOT_DRAFT');
  if (draft.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()) throw new StaleWriteError();
  const buyer = /** @type {any} */ (draft.buyer);
  const problems = invoiceBuyerProblems(buyer);
  if (Object.keys(problems).length) {
    throw new ValidationError(`Alıcı bilgileri eksik: ${Object.values(problems).join(' · ')}`, { fields: Object.fromEntries(Object.entries(problems).map(([key, message]) => [`buyer.${key}`, message])) });
  }

  // Belge türü işlem dışında (dış sorgu): kayıtlı mükellef → e-Fatura.
  const lookup = isForeignBuyer(buyer) ? { registered: false, aliases: [] } : await lookupTaxpayer(hotelId, settings, buyer.taxNumber);
  const documentType = chooseInvoiceDocumentType({ buyer, registered: lookup.registered, aliases: lookup.aliases });
  const receiverAlias = documentType === 'E_FATURA' ? (buyer.alias && lookup.aliases.includes(buyer.alias) ? buyer.alias : lookup.aliases[0]) : null;

  const outcome = await writeWithEvents(async (tx, stage) => {
    if (!(await lockInvoices(tx, hotelId, [invoiceId])).has(invoiceId)) throw new NotFoundError('Fatura bulunamadı');
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, hotelId },
      include: { lines: { orderBy: { sortOrder: 'asc' } }, event: { select: { status: true, cancellationFee: true } } },
    });
    if (!invoice || invoice.status !== 'DRAFT') throw new ConflictError('Fatura zaten kesilmiş', 'INVOICE_NOT_DRAFT');
    if (invoice.updatedAt.getTime() !== draft.updatedAt.getTime()) throw new StaleWriteError();
    const taxCodes = await loadTaxCodeMap(tx, hotelId);

    // Kaynak yeniden okunur: taslaktan sonra değiştiyse taslak yenilenir, kesim durur (personel kontrol eder).
    let composed;
    if (invoice.source === 'FOLIO') {
      await lockFolios(tx, hotelId, [/** @type {string} */ (invoice.folioId)]);
      const { folio, charges, expectedTotal } = await folioSource(tx, hotelId, /** @type {string} */ (invoice.folioId));
      if (folio.status !== 'CLOSED') throw new ConflictError('Folyo yeniden açılmış: kapatıldıktan sonra kesilir', 'FOLIO_NOT_CLOSED');
      composed = composeInvoice({ source: 'FOLIO', charges, taxCodes, expectedTotal });
    } else if (invoice.source === 'EVENT' && invoice.event?.status === 'COMPLETED') {
      await lockEvents(tx, hotelId, [/** @type {string} */ (invoice.eventId)]);
      const source = await eventSource(tx, hotelId, /** @type {string} */ (invoice.eventId), context.timezone);
      if (source.kind !== 'COMPLETED') throw new ConflictError('Etkinliğin durumu değişti: taslağı silip yeniden açın', 'EVENT_CHANGED');
      composed = composeInvoice({ source: 'EVENT', charges: source.charges, taxCodes, expectedTotal: source.expectedTotal });
    } else {
      if (invoice.source === 'EVENT') {
        await lockEvents(tx, hotelId, [/** @type {string} */ (invoice.eventId)]);
        const event = await tx.event.findFirst({ where: { id: /** @type {string} */ (invoice.eventId), hotelId }, select: { status: true, cancellationFee: true } });
        if (event?.status !== 'CANCELLED') throw new ConflictError('Etkinliğin durumu değişti: taslağı silip yeniden açın', 'EVENT_CHANGED');
      }
      const inputs = invoice.lines.map((line) => ({ description: line.description, quantity: String(line.quantity), unitCode: line.unitCode, unitAmount: money(line.unitAmount), taxCategory: /** @type {string} */ (line.taxCategory) }));
      composed = composeInvoice({
        source: invoice.source,
        charges: await manualCharges(tx, hotelId, inputs),
        taxCodes,
        expectedTotal: invoice.source === 'EVENT' ? money(invoice.event?.cancellationFee) : null,
      });
    }
    if (composed.problems.length) throw new ConflictError(composed.problems.join(' · '), 'INVOICE_LINES');
    if (composed.totals.payable !== money(invoice.total)) {
      await tx.invoiceLine.deleteMany({ where: { invoiceId } });
      await tx.invoiceLine.createMany({ data: lineRows(hotelId, invoiceId, composed.lines) });
      await tx.invoice.update({ where: { id: invoiceId }, data: totalColumns(composed.totals) });
      await addInvoiceLog(tx, { hotelId, invoiceId, kind: 'REFRESHED', message: `Kaynak değişti: ${priced(invoice.total)} → ${priced(composed.totals.payable, invoice.currency)}`, actor });
      await stage('invoice.changed', { hotelId, invoiceId, change: 'UPDATED', folioId: invoice.folioId, eventId: invoice.eventId });
      return { refreshed: { from: money(invoice.total), to: composed.totals.payable } };
    }

    const issuedAt = new Date();
    const issueDate = calendarToday(context.timezone);
    const prefix = documentType === 'E_FATURA' ? settings.eFaturaPrefix : settings.eArsivPrefix;
    const number = formatInvoiceNumber(prefix, Number(issueDate.slice(0, 4)), await nextInvoiceSequence(tx, hotelId, prefix, Number(issueDate.slice(0, 4))));
    const notes = [];
    if (invoice.note) notes.push(invoice.note);
    if (invoice.serviceFrom && invoice.serviceTo) notes.push(`Hizmet dönemi: ${dotted(/** @type {string} */ (day(invoice.serviceFrom)))} – ${dotted(/** @type {string} */ (day(invoice.serviceTo)))}`);
    if (settings.footerNote) notes.push(settings.footerNote);
    if (settings.bankInfo) notes.push(settings.bankInfo);
    const xml = buildUblInvoice({
      number,
      uuid: invoice.uuid,
      documentType,
      issueDate,
      issueTime: clockTime(issuedAt, context.timezone),
      currency: invoice.currency,
      serviceFrom: day(invoice.serviceFrom),
      serviceTo: day(invoice.serviceTo),
      notes,
      seller: settings,
      buyer,
      lines: composed.lines,
      totals: composed.totals,
    });

    await tx.invoiceLine.deleteMany({ where: { invoiceId } });
    await tx.invoiceLine.createMany({ data: lineRows(hotelId, invoiceId, composed.lines) });
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'ISSUED',
        number,
        documentType,
        issueDate: dateOnly(issueDate),
        issuedAt,
        issuedBy: actor,
        ...buyerColumns(buyer),
        ...totalColumns(composed.totals),
        receiverAlias,
        edocState: 'QUEUED',
        edocProvider: provider.name,
        edocEnvironment: settings.environment,
        edocAttempts: 0,
        edocNextAttemptAt: issuedAt,
      },
    });
    await tx.invoiceDocument.create({ data: { invoiceId, hotelId, xml, sha256: createHash('sha256').update(xml).digest('hex') } });
    await addInvoiceLog(tx, { hotelId, invoiceId, kind: 'ISSUED', message: `${number} · ${INVOICE_DOCUMENT_TYPE_LABELS[documentType]}${receiverAlias ? ` · ${receiverAlias}` : ''} · ${priced(composed.totals.payable, invoice.currency)}`, actor });
    await addInvoiceLog(tx, { hotelId, invoiceId, kind: 'QUEUED', state: 'QUEUED', message: settings.provider === 'TEST' ? provider.label : `${provider.label} · ${settings.environment === 'TEST' ? 'test ortamı' : 'canlı'}`, actor });
    await recordAudit(tx, { hotelId, entity: 'Invoice', entityId: invoiceId, action: 'UPDATE', before: { status: 'DRAFT' }, after: { status: 'ISSUED', number, documentType, total: composed.totals.payable } });
    await stage('invoice.issued', {
      hotelId,
      invoiceId,
      number,
      source: invoice.source,
      documentType,
      folioId: invoice.folioId,
      eventId: invoice.eventId,
      ledgerAccountId: invoice.ledgerAccountId,
      total: composed.totals.payable,
      taxTotal: composed.totals.taxTotal,
      currency: invoice.currency,
      issuedOn: issueDate,
    });
    await stage('invoice.changed', { hotelId, invoiceId, change: 'ISSUED', folioId: invoice.folioId, eventId: invoice.eventId });
    return { number };
  });
  if (outcome.refreshed) {
    throw new ConflictError(`Kaynak taslaktan sonra değişti (${outcome.refreshed.from} → ${outcome.refreshed.to}); taslak yenilendi, kontrol edip yeniden kesin`, 'INVOICE_SOURCE_CHANGED');
  }
  kickEdocDispatcher();
  return { number: /** @type {string} */ (outcome.number) };
}

/* ═══════════════ Toplu: taslak ve kesim ═══════════════ */

/** Toplu isteğin süre bütçesi: aşılınca kalan kayıtlar işlenmeden `pending` döner (kesim dış servise gider). */
const BULK_BUDGET_MS = 20_000;

/**
 * Kayıtları sırayla, her birini kendi işleminde işler; beklenen hata kayda yazılır (diğerleri durmaz), beklenmeyen
 * hata merkezi işleyiciye gider. Bütçe dolunca kalanlar `pending`.
 * @template T @param {T[]} items @param {(item: T) => string} idOf @param {(item: T) => Promise<object>} work @param {number} budgetMs
 */
async function runBatch(items, idOf, work, budgetMs) {
  const started = Date.now();
  const results = [];
  const pending = [];
  for (const item of items) {
    if (Date.now() - started > budgetMs) {
      pending.push(idOf(item));
      continue;
    }
    try {
      results.push({ id: idOf(item), ok: true, message: null, ...(await work(item)) });
    } catch (error) {
      results.push(bulkItemFailure(idOf(item), error));
    }
  }
  return { results, pending, succeeded: results.filter((row) => row.ok).length, failed: results.filter((row) => !row.ok).length };
}

/**
 * Toplu taslak (faturalanacaklardan seçilenler): her kaynak tek taslağın kuralıyla; taslağı olanın taslağı döner.
 * Alıcısı kesime yetmeyen taslak (VKN / TCKN, ünvan eksik) açılır ama sonuçta işaretlenir: kesimden önce tamamlanır.
 * @param {string} hotelId @param {{ kind: 'FOLIO' | 'EVENT', ids: string[] }} input @param {{ budgetMs?: number }} [options]
 */
export async function createDraftsBatch(hotelId, { kind, ids }, { budgetMs = BULK_BUDGET_MS } = {}) {
  const batch = await runBatch(
    ids,
    (id) => id,
    async (id) => {
      const { invoiceId, created } = await createDraft(hotelId, kind === 'FOLIO' ? { source: 'FOLIO', folioId: id } : { source: 'EVENT', eventId: id });
      return { invoiceId, created, message: created ? null : 'Taslağı zaten vardı' };
    },
    budgetMs,
  );
  const invoiceIds = batch.results.filter((row) => row.ok).map((row) => /** @type {any} */ (row).invoiceId);
  const drafts = invoiceIds.length ? await prisma.invoice.findMany({ where: { hotelId, id: { in: invoiceIds } }, select: { id: true, buyer: true } }) : [];
  const problems = new Map(drafts.map((draft) => [draft.id, Object.values(invoiceBuyerProblems(/** @type {any} */ (draft.buyer)))]));
  for (const row of /** @type {any[]} */ (batch.results)) {
    if (row.ok) row.buyerProblems = problems.get(row.invoiceId)?.length ? problems.get(row.invoiceId) : null;
  }
  return { ...batch, needsBuyer: batch.results.filter((row) => /** @type {any} */ (row).buyerProblems).length };
}

/**
 * Toplu kesim (taslaklardan seçilenler), seçim sırasıyla: her taslak tek kesimin kuralıyla (sürüm, alıcı, kaynağın
 * yeniden okunması, mükellef sorgusu, boşluksuz numara). Kesilemeyen sebebiyle döner; bütçe dolunca kalanlar
 * `pending` (ekran aynı sürümlerle yeniden ister).
 * @param {string} hotelId @param {Array<{ id: string, expectedUpdatedAt: string | Date }>} items @param {{ budgetMs?: number }} [options]
 */
export async function issueBatch(hotelId, items, { budgetMs = BULK_BUDGET_MS } = {}) {
  return runBatch(items, (item) => item.id, (item) => issueDraft(hotelId, item.id, item), budgetMs);
}

/* ═══════════════ Tekrar gönderim ═══════════════ */

/** Gönderilemedi / reddedildi → yeniden sıraya (aynı belge). @param {string} hotelId @param {string} invoiceId */
export async function resendInvoice(hotelId, invoiceId) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    if (!(await lockInvoices(tx, hotelId, [invoiceId])).has(invoiceId)) throw new NotFoundError('Fatura bulunamadı');
    const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, hotelId }, select: { status: true, edocState: true, folioId: true, eventId: true } });
    if (!invoice) throw new NotFoundError('Fatura bulunamadı');
    if (invoice.status !== 'ISSUED' || !EDOC_RESENDABLE_STATES.includes(/** @type {string} */ (invoice.edocState))) {
      throw new ConflictError(`Yalnız gönderilemeyen ya da reddedilen e-belge yeniden gönderilir (durum: ${EDOC_STATE_LABELS[/** @type {keyof typeof EDOC_STATE_LABELS} */ (invoice.edocState)] ?? '—'})`, 'EDOC_NOT_RESENDABLE');
    }
    await tx.invoice.update({ where: { id: invoiceId }, data: { edocState: 'QUEUED', edocAttempts: 0, edocNextAttemptAt: new Date(), edocChecks: 0, edocCheckedAt: null } });
    await addInvoiceLog(tx, { hotelId, invoiceId, kind: 'RESEND', state: 'QUEUED', message: 'Yeniden sıraya alındı', actor });
    await stage('invoice.changed', { hotelId, invoiceId, change: 'EDOC', folioId: invoice.folioId, eventId: invoice.eventId });
  });
  kickEdocDispatcher();
  return getInvoice(hotelId, invoiceId);
}

/* ═══════════════ İptal ═══════════════ */

/**
 * İptal iste (onay kuyruğu, dört göz). Gönderilirken istenmez; GİB'e ulaşmış e-Faturada portal referansı zorunlu.
 * İstek sürerken gönderim durur (gönderici iptal onayı bekleyeni üstlenmez).
 * @param {string} hotelId @param {string} invoiceId @param {{ reason: string, portalReference?: string | null }} input
 */
export async function requestCancel(hotelId, invoiceId, input) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    if (!(await lockInvoices(tx, hotelId, [invoiceId])).has(invoiceId)) throw new NotFoundError('Fatura bulunamadı');
    const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, hotelId }, select: { status: true, number: true, documentType: true, edocState: true, total: true, currency: true, buyerName: true, folioId: true, eventId: true, issueDate: true } });
    if (!invoice) throw new NotFoundError('Fatura bulunamadı');
    if (invoice.status === 'DRAFT') throw new ConflictError('Taslak iptal edilmez, silinir', 'INVOICE_NOT_ISSUED');
    if (invoice.status !== 'ISSUED') throw new ConflictError('Faturanın iptali zaten istenmiş ya da iptal edilmiş', 'INVOICE_CANCEL_EXISTS');
    if (invoice.edocState === 'SENDING') throw new ConflictError('Fatura şu anda entegratöre gönderiliyor; birkaç saniye sonra yeniden deneyin', 'EDOC_SENDING');
    const reached = EDOC_REACHED_STATES.includes(/** @type {string} */ (invoice.edocState));
    if (invoice.documentType === 'E_FATURA' && reached && !input.portalReference) {
      throw new ValidationError("GİB'e ulaşmış e-Fatura entegratörden iptal edilemez: GİB portalındaki iptal / itiraz referansını yazın", { field: 'portalReference' });
    }
    const method = !reached ? 'yerelde (GİB\'e ulaşmadı)' : invoice.documentType === 'E_ARSIV' ? 'entegratörden (e-Arşiv iptali)' : 'GİB portalı referansıyla';
    const { approvalId } = await requestApproval(tx, stage, {
      hotelId,
      type: 'INVOICE_CANCEL',
      summary: `Fatura iptali ${invoice.number}: ${invoice.buyerName ?? ''} — ${priced(invoice.total, invoice.currency)}`.slice(0, 200),
      reason: input.reason,
      amount: money(invoice.total),
      currency: invoice.currency,
      data: {
        Fatura: /** @type {string} */ (invoice.number),
        Tür: INVOICE_DOCUMENT_TYPE_LABELS[/** @type {'E_FATURA' | 'E_ARSIV'} */ (invoice.documentType)],
        Alıcı: invoice.buyerName ?? '—',
        Tarih: dotted(/** @type {string} */ (day(invoice.issueDate))),
        'GİB durumu': EDOC_STATE_LABELS[/** @type {keyof typeof EDOC_STATE_LABELS} */ (invoice.edocState)] ?? '—',
        'İptal yolu': method,
        ...(input.portalReference ? { 'Portal referansı': input.portalReference } : {}),
        İsteyen: actor,
      },
      entityType: 'Invoice',
      entityId: invoiceId,
      requestedBy: actor,
      expiresInMs: INVOICE_CANCEL_APPROVAL_DAYS * 86_400_000,
    });
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: 'CANCEL_PENDING', cancelReason: input.reason, cancelReference: input.portalReference ?? null, cancelRequestedAt: new Date(), cancelRequestedBy: actor, cancelApprovalId: approvalId },
    });
    await addInvoiceLog(tx, { hotelId, invoiceId, kind: 'CANCEL_REQUESTED', message: `${input.reason}${input.portalReference ? ` · portal: ${input.portalReference}` : ''}`, actor });
    await recordAudit(tx, { hotelId, entity: 'Invoice', entityId: invoiceId, action: 'UPDATE', before: { status: 'ISSUED' }, after: { status: 'CANCEL_PENDING', reason: input.reason, approvalId } });
    await stage('invoice.changed', { hotelId, invoiceId, change: 'CANCEL_REQUESTED', folioId: invoice.folioId, eventId: invoice.eventId });
  });
  return getInvoice(hotelId, invoiceId);
}

/**
 * Onay kuyruğunun kararı (`approval.granted|denied|expired`, tür `INVOICE_CANCEL`).
 * @param {any} payload @param {any} envelope
 */
export function onInvoiceApprovalDecision(payload, envelope) {
  if (payload?.type !== 'INVOICE_CANCEL') return Promise.resolve({ handled: false });
  return runWithContext({ correlationId: envelope.correlationId, causationId: envelope.id, actor: payload.decidedBy ?? 'system' }, () => applyCancelDecision(payload, envelope));
}

/**
 * İptal kararını uygular. Onayda: GİB'e ulaşmamışsa yerelde; e-Arşiv entegratörden (önce entegratör, sonra
 * kayıt — entegratör iptali başarısızsa fatura kesilmiş kalır, isteyene haber verilir); e-Fatura portal
 * referansıyla. Ret / süre dolumunda fatura kesilmiş durumuna döner, bekleyen gönderim sürer.
 * @param {any} payload @param {any} envelope
 */
export async function applyCancelDecision(payload, envelope) {
  const hotelId = payload.hotelId;
  const approval = await prismaUnfiltered.approval.findFirst({ where: { id: payload.approvalId, hotelId }, select: { id: true, type: true, entityId: true, requestedBy: true, decidedBy: true, note: true, summary: true } });
  if (!approval?.entityId) return { handled: false };
  const invoiceId = approval.entityId;
  const granted = envelope.name === 'approval.granted';
  const before = await prisma.invoice.findFirst({ where: { id: invoiceId, hotelId }, select: { status: true, cancelApprovalId: true, documentType: true, edocState: true, uuid: true, edocProviderRef: true, edocProvider: true, cancelReason: true } });
  if (!before || before.status !== 'CANCEL_PENDING' || before.cancelApprovalId !== approval.id) return { handled: true, stale: true };
  const decider = approval.decidedBy ?? 'system';

  let method = 'LOCAL';
  /** @type {string | null} */
  let problem = granted ? null : envelope.name === 'approval.denied' ? `Reddedildi: ${approval.note ?? '—'}` : 'Onayın süresi doldu';
  /** @type {{ code: string | null, message: string | null } | null} */
  let providerResult = null;
  if (granted && EDOC_REACHED_STATES.includes(/** @type {string} */ (before.edocState))) {
    method = before.documentType === 'E_ARSIV' ? 'INTEGRATOR' : 'PORTAL';
    if (method === 'INTEGRATOR') {
      const settings = await loadInvoiceSettings(prisma, hotelId);
      const provider = providerFor(before.edocProvider ?? settings?.provider ?? '');
      try {
        if (!provider) throw new Error('Entegratör tanımsız');
        providerResult = await provider.cancel({ client: prisma, hotelId, settings }, { documentType: 'E_ARSIV', uuid: before.uuid, ref: before.edocProviderRef, reason: before.cancelReason ?? '' });
      } catch (error) {
        problem = `Entegratör iptali yapılamadı: ${/** @type {Error} */ (error).message}`;
      }
    }
  }

  const outcome = await writeWithEvents(async (tx, stage) => {
    if (!(await lockInvoices(tx, hotelId, [invoiceId])).has(invoiceId)) return { stale: true };
    const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, hotelId }, select: { status: true, cancelApprovalId: true, number: true, source: true, folioId: true, eventId: true, ledgerAccountId: true, edocState: true, cancelReference: true } });
    if (!invoice || invoice.status !== 'CANCEL_PENDING' || invoice.cancelApprovalId !== approval.id) return { stale: true };
    if (problem) {
      await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'ISSUED', cancelApprovalId: null, cancelRequestedAt: null, cancelRequestedBy: null } });
      await addInvoiceLog(tx, { hotelId, invoiceId, kind: 'CANCEL_DECLINED', message: problem, actor: decider });
      await recordAudit(tx, { hotelId, entity: 'Invoice', entityId: invoiceId, action: 'UPDATE', before: { status: 'CANCEL_PENDING' }, after: { status: 'ISSUED', reason: problem, approvalId: approval.id } });
      await stage('invoice.changed', { hotelId, invoiceId, change: 'CANCEL_DECLINED', folioId: invoice.folioId, eventId: invoice.eventId });
      return { applied: false };
    }
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: decider, cancelMethod: method, edocState: 'CANCELLED', edocNextAttemptAt: null, edocLockedAt: null },
    });
    const detail = method === 'LOCAL' ? "GİB'e ulaşmadan iptal edildi" : method === 'INTEGRATOR' ? (providerResult?.message ?? 'e-Arşiv entegratörden iptal edildi') : `GİB portalında iptal edildi · ${invoice.cancelReference ?? ''}`;
    await addInvoiceLog(tx, { hotelId, invoiceId, kind: 'CANCELLED', state: 'CANCELLED', code: providerResult?.code ?? null, message: detail, actor: decider });
    await recordAudit(tx, { hotelId, entity: 'Invoice', entityId: invoiceId, action: 'UPDATE', before: { status: 'CANCEL_PENDING' }, after: { status: 'CANCELLED', method, approvalId: approval.id } });
    await stage('invoice.cancelled', { hotelId, invoiceId, number: /** @type {string} */ (invoice.number), source: invoice.source, folioId: invoice.folioId, eventId: invoice.eventId, ledgerAccountId: invoice.ledgerAccountId });
    await stage('invoice.changed', { hotelId, invoiceId, change: 'CANCELLED', folioId: invoice.folioId, eventId: invoice.eventId });
    return { applied: true };
  });
  if (!outcome.stale) {
    if (!outcome.applied) kickEdocDispatcher();
    await alertRequester(hotelId, approval, granted, invoiceId, outcome.applied ? null : problem);
  }
  return { handled: true, applied: Boolean(outcome.applied) };
}

/** @param {string} hotelId @param {any} approval @param {boolean} granted @param {string} invoiceId @param {string | null} problem */
async function alertRequester(hotelId, approval, granted, invoiceId, problem) {
  const staff = approval.requestedBy?.includes('@') ? await findActiveStaffByEmail(prismaUnfiltered, hotelId, approval.requestedBy.toLowerCase()) : null;
  const label = APPROVAL_TYPE_LABELS[approval.type] ?? 'Onay';
  const applied = granted && !problem;
  await writeWithEvents((tx, stage) =>
    raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'APPROVAL_DECIDED',
      severity: applied ? 'INFO' : 'WARNING',
      title: `${label} ${applied ? 'onaylandı, fatura iptal edildi' : granted ? 'onaylandı ama iptal edilemedi' : 'kabul edilmedi'}: ${approval.summary}`.slice(0, 200),
      body: applied ? 'Fatura iptal edildi; kaynağı yeniden faturalanabilir.' : `${problem ?? ''} Fatura kesilmiş olarak kaldı.`.trim(),
      link: `/faturalar/${invoiceId}`,
      userId: staff?.id ?? null,
      permission: staff ? null : PERMISSIONS.INVOICES_MANAGE,
      entityType: 'Approval',
      entityId: approval.id,
      dedupeKey: `approval-decided:${approval.id}`,
    }),
  );
}

/* ═══════════════ Yeniden kesim ve aktör ═══════════════ */

/**
 * İptal edilmiş faturadan yeni taslak: folyo / etkinlik kaynağından yeniden; serbest fatura satırları ve
 * alıcısıyla kopya.
 * @param {string} hotelId @param {string} invoiceId
 */
export async function copyInvoice(hotelId, invoiceId) {
  const original = await prisma.invoice.findFirst({ where: { id: invoiceId, hotelId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
  if (!original) throw new NotFoundError('Fatura bulunamadı');
  if (original.status !== 'CANCELLED') throw new ConflictError('Yalnız iptal edilmiş faturadan yeni taslak açılır', 'INVOICE_NOT_CANCELLED');
  if (original.source === 'FOLIO') return createDraft(hotelId, { source: 'FOLIO', folioId: original.folioId });
  if (original.source === 'EVENT') return createDraft(hotelId, { source: 'EVENT', eventId: original.eventId });
  const lines = original.lines.map((line) => ({ description: line.description, quantity: String(line.quantity), unitCode: line.unitCode, unitAmount: money(line.unitAmount), taxCategory: line.taxCategory }));
  const created = await createDraft(hotelId, { source: 'MANUAL', ledgerAccountId: original.ledgerAccountId, lines, note: original.note });
  const draft = await prisma.invoice.findFirst({ where: { id: created.invoiceId, hotelId }, select: { updatedAt: true } });
  await updateDraft(hotelId, created.invoiceId, { expectedUpdatedAt: draft?.updatedAt.toISOString(), buyer: original.buyer, note: original.note });
  return created;
}

/**
 * Folyo aktörü (`folio.closed`): kapanan folyonun fatura taslağı. Ayar yoksa / otomatik taslak kapalıysa ya
 * da folyo tutarsızsa iş yapmaz (sebebi döner).
 * @param {string} hotelId @param {string} folioId
 * @returns {Promise<{ created: boolean, skipped?: string, invoiceId?: string }>}
 */
export async function createFolioInvoiceDraft(hotelId, folioId) {
  const settings = await loadInvoiceSettings(prisma, hotelId);
  if (!settings) return { created: false, skipped: 'Fatura ayarları girilmemiş; taslak açılmadı' };
  if (!settings.autoDraft) return { created: false, skipped: 'Otomatik fatura taslağı kapalı' };
  const folio = await prisma.folio.findFirst({ where: { id: folioId, hotelId }, select: { status: true, chargesTotal: true } });
  if (!folio) return { created: false, skipped: 'Folyo bulunamadı' };
  if (folio.status !== 'CLOSED') return { created: false, skipped: 'Folyo bu arada yeniden açılmış' };
  if (Number(folio.chargesTotal) <= 0) return { created: false, skipped: 'Faturalanacak tutar yok' };
  const existing = await prisma.invoice.findFirst({ where: { hotelId, folioId, status: { in: ['ISSUED', 'CANCEL_PENDING'] } }, select: { number: true } });
  if (existing) return { created: false, skipped: `Faturası kesilmiş: ${existing.number}` };
  const result = await createDraft(hotelId, { source: 'FOLIO', folioId }, { system: true });
  return { created: result.created, invoiceId: result.invoiceId, ...(result.created ? {} : { skipped: 'Taslağı zaten var' }) };
}
