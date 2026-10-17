import { randomUUID } from 'node:crypto';
import { currentActor, toDecimal, toMoneyString } from '@hotelos/core';
import { EVENT_DOCUMENT_KIND_LABELS, utcToZonedWallTime } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { openFile, removeFiles, saveFile } from '../../lib/file-storage.js';
import { lockEvents } from '../../lib/locks.js';
import { writeWithEvents } from '../../lib/write.js';
import { getActiveTaxes } from '../settings/service.js';
import { renderEventDocument } from './pdf.js';
import { documentDecisionError, documentIssueError, documentNumber, eventTotals, itemLine, offerValidUntil } from './rules.js';
import { dateOnly, day, hotelContext, iso, loadEventSettings, money, nextNumber, prisma, tiersOf } from './shared.js';

/**
 * Etkinlik belgeleri (modül 37): teklif → sözleşme → proforma.
 *
 * - Belge, üretildiği andaki dosyanın **anlık görüntüsüdür** (`snapshot`): müşteri,
 *   program, kalemler, vergi dökümü, ödeme planı, iptal koşulları. PDF bu görüntüden
 *   çizilip diskte saklanır; sonradan fiyat değişse de üretilmiş belge değişmez.
 * - Her türün tek **güncel** sürümü olur: yeni sürüm öncekini "yenisiyle değişti"
 *   yapar (veritabanında kısmi tekil index). Sürüm numarası aynı seriyi taşır
 *   ("TKL-2026-0007/2").
 * - Teklif kabul / ret, sözleşme imza tarihiyle işaretlenir. Politika istiyorsa
 *   etkinlik ancak güncel sözleşmesi imzalıyken kesinleşir.
 * - Proforma, borç kesinleşince (gerçekleşti / bedelli iptal) üretilir: etkinlik
 *   "faturaya hazır"dır; resmî fatura fatura modülünde kesilir.
 *
 * Belge üretimi etkinliği kilitler: görüntü ile numara aynı anın verisidir; aynı anda
 * iki üretim sırayla çalışır. PDF transaction içinde yazılır; transaction geri
 * alınırsa (ya da yeniden denenirse) yazılan dosyalar silinir.
 */

/** @typedef {Awaited<ReturnType<typeof buildSnapshot>>} DocumentSnapshot */

const FILE_PREFIX = 'banquet';

const TURKISH_ASCII = Object.freeze({ ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U' });
/** @param {string} text */
const asciiName = (text) => text.replace(/[çÇğĞıİöÖşŞüÜ]/g, (letter) => TURKISH_ASCII[letter]);

/** @param {string} hotelId @param {string} documentId */
const fileKey = (hotelId, documentId) => `${FILE_PREFIX}/${hotelId}/${documentId}.pdf`;

/**
 * Belgenin anlık görüntüsü (etkinlik kilitliyken).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ hotelId: string, eventId: string, kind: 'OFFER' | 'CONTRACT' | 'PROFORMA', hotel: any, timezone: string, today: string, number: string, version: number, note: string | null, issuedBy: string }} input
 */
async function buildSnapshot(tx, { hotelId, eventId, kind, hotel, timezone, today, number, version, note, issuedBy }) {
  const [event, settings] = await Promise.all([
    tx.event.findFirst({
      where: { id: eventId, hotelId },
      select: {
        code: true,
        name: true,
        type: true,
        status: true,
        expectedPax: true,
        guaranteedPax: true,
        actualPax: true,
        billablePax: true,
        currency: true,
        grandTotal: true,
        paidTotal: true,
        cancellationFee: true,
        cancellationTiers: true,
        firstStartAt: true,
        client: { select: { type: true, name: true, contactName: true, phone: true, email: true, taxOffice: true, taxNumber: true, address: true } },
        sessions: {
          orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
          select: { id: true, title: true, layout: true, pax: true, startAt: true, endAt: true, venue: { select: { name: true } } },
        },
        items: {
          orderBy: [{ sortOrder: 'asc' }],
          select: {
            sessionId: true,
            category: true,
            description: true,
            perPerson: true,
            billedQuantity: true,
            unit: true,
            unitPrice: true,
            discountPct: true,
            netAmount: true,
            taxAmount: true,
            total: true,
            taxLines: true,
          },
        },
        installments: { orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }], select: { label: true, dueDate: true, amount: true } },
      },
    }),
    loadEventSettings(tx, hotelId),
  ]);
  const sessionTitles = new Map(event.sessions.map((session) => [session.id, session.title]));
  const firstDay = event.firstStartAt ? utcToZonedWallTime(event.firstStartAt, timezone).slice(0, 10) : null;

  let items = event.items.map((item) => ({
    sessionTitle: item.sessionId ? sessionTitles.get(item.sessionId) ?? null : null,
    category: item.category,
    description: item.description,
    perPerson: item.perPerson,
    billedQuantity: toDecimal(String(item.billedQuantity)).toString(),
    unit: item.unit,
    unitPrice: money(item.unitPrice),
    discountPct: toDecimal(String(item.discountPct)).toString(),
    netAmount: money(item.netAmount),
    taxAmount: money(item.taxAmount),
    total: money(item.total),
    taxLines: /** @type {any[]} */ (item.taxLines),
  }));
  let cancellation = null;
  if (kind === 'PROFORMA' && event.status === 'CANCELLED') {
    // Bedelli iptalin proforması: tek satır, iptal bedeli (vergi "diğer" kategorisinden).
    const fee = money(event.cancellationFee);
    const pct = toDecimal(String(event.grandTotal)).isZero() ? '0' : toDecimal(fee).times(100).dividedBy(toDecimal(String(event.grandTotal))).toDecimalPlaces(2).toString();
    const line = itemLine({ perPerson: false, quantity: '1', unitPrice: fee, discountPct: '0', taxCategory: 'OTHER' }, 0, await getActiveTaxes(hotelId));
    items = [{ sessionTitle: null, category: 'OTHER', description: `İptal bedeli (%${pct}) — ${event.code} ${event.name}`, perPerson: false, unit: 'PACKAGE', unitPrice: fee, discountPct: '0', ...line }];
    cancellation = { fee, feePct: pct };
  }
  const totals = eventTotals(items);
  const paid = money(event.paidTotal);
  const tiers = event.cancellationTiers ? tiersOf(event.cancellationTiers) : settings.cancellationTiers;

  return {
    kind,
    number,
    version,
    issuedDay: today,
    issuedAt: new Date().toISOString(),
    issuedBy,
    note,
    currency: event.currency,
    hotel: { name: hotel.name, address: hotel.address ?? null, phone: hotel.phone ?? null, email: hotel.email ?? null },
    client: event.client,
    event: {
      code: event.code,
      name: event.name,
      type: event.type,
      status: event.status,
      expectedPax: event.expectedPax,
      guaranteedPax: event.guaranteedPax,
      actualPax: event.actualPax,
      billablePax: event.billablePax,
      firstDay,
    },
    sessions: event.sessions.map((session) => ({
      title: session.title,
      venueName: session.venue.name,
      layout: session.layout,
      pax: session.pax,
      startLocal: utcToZonedWallTime(session.startAt, timezone),
      endLocal: utcToZonedWallTime(session.endAt, timezone),
    })),
    items: items.map(({ taxLines, ...rest }) => rest),
    totals,
    installments: kind === 'PROFORMA' ? [] : event.installments.map((entry) => ({ label: entry.label, dueDate: day(entry.dueDate), amount: money(entry.amount) })),
    cancellationTiers: kind === 'CONTRACT' ? tiers : [],
    terms: kind === 'CONTRACT' ? settings.contractTerms : null,
    validUntil: kind === 'OFFER' ? offerValidUntil({ today, validityDays: settings.offerValidityDays, firstDay }) : null,
    cancellation,
    paid,
    balance: toMoneyString(toDecimal(totals.grandTotal).minus(toDecimal(paid))),
  };
}

/** @param {any} row */
const toDocumentDto = (row) => ({
  id: row.id,
  eventId: row.eventId,
  kind: row.kind,
  kindLabel: EVENT_DOCUMENT_KIND_LABELS[row.kind],
  number: row.number,
  version: row.version,
  status: row.status,
  grandTotal: money(row.grandTotal),
  validUntil: day(row.validUntil),
  decisionDate: day(row.decisionDate),
  decidedBy: row.decidedBy,
  note: row.note,
  fileSize: row.fileSize,
  issuedBy: row.issuedBy,
  createdAt: iso(row.createdAt),
});

const DOCUMENT_SELECT = Object.freeze({
  id: true,
  eventId: true,
  kind: true,
  number: true,
  version: true,
  status: true,
  grandTotal: true,
  validUntil: true,
  decisionDate: true,
  decidedBy: true,
  note: true,
  fileSize: true,
  issuedBy: true,
  createdAt: true,
});

/**
 * Belge üretir (yeni sürüm). Önceki güncel sürüm "yenisiyle değişti" olur.
 *
 * @param {string} hotelId
 * @param {string} eventId
 * @param {{ expectedUpdatedAt: Date, kind: 'OFFER' | 'CONTRACT' | 'PROFORMA', note?: string | null }} input
 */
export async function issueDocument(hotelId, eventId, { expectedUpdatedAt, kind, note }) {
  const { hotel, timezone, today } = await hotelContext(hotelId);
  const actor = currentActor();
  /** Bu çağrıda diske yazılan dosyalar (yeniden denemede birden fazla olabilir). */
  const written = [];
  let created;
  try {
    created = await writeWithEvents(async (tx, stage) => {
      await lockEvents(tx, hotelId, [eventId]);
      const event = await tx.event.findFirst({
        where: { id: eventId, hotelId },
        select: { id: true, code: true, status: true, cancellationFee: true, updatedAt: true, _count: { select: { sessions: true, items: true } } },
      });
      if (!event) throw new NotFoundError('Etkinlik bulunamadı');
      // Belge görüntüsü ekranın gördüğü dosyadan çıkmalı: arada kalem / program değiştiyse yeniden bakılır.
      if (expectedUpdatedAt && event.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
      const blocked = documentIssueError({
        kind,
        status: event.status,
        sessionCount: event._count.sessions,
        itemCount: event._count.items,
        cancellationFee: event.cancellationFee === null ? null : String(event.cancellationFee),
      });
      if (blocked) throw new ConflictError(blocked, 'DOCUMENT_RULE');

      const previous = await tx.eventDocument.findFirst({ where: { eventId, kind }, orderBy: { version: 'desc' }, select: { id: true, number: true, version: true, status: true } });
      const version = (previous?.version ?? 0) + 1;
      const number = await documentNumber({
        previousNumber: previous?.number ?? null,
        version,
        freshNumber: () => nextNumber(tx, hotelId, kind, Number(today.slice(0, 4))),
      });
      const snapshot = await buildSnapshot(tx, { hotelId, eventId, kind, hotel, timezone, today, number, version, note: note ?? null, issuedBy: actor });
      const pdf = await renderEventDocument(snapshot);
      const id = randomUUID();
      const key = fileKey(hotelId, id);
      written.push(key);
      await saveFile(key, pdf);

      const superseded = await tx.eventDocument.updateMany({ where: { eventId, kind, status: { not: 'SUPERSEDED' } }, data: { status: 'SUPERSEDED' } });
      const row = await tx.eventDocument.create({
        data: {
          id,
          hotelId,
          eventId,
          kind,
          number,
          version,
          status: 'ISSUED',
          snapshot,
          fileKey: key,
          fileSize: pdf.length,
          grandTotal: snapshot.totals.grandTotal,
          validUntil: snapshot.validUntil ? dateOnly(snapshot.validUntil) : null,
          note: note ?? null,
          issuedBy: actor,
        },
        select: DOCUMENT_SELECT,
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'EventDocument',
        entityId: id,
        action: 'CREATE',
        after: { event: event.code, kind, number, version, grandTotal: snapshot.totals.grandTotal, validUntil: snapshot.validUntil, superseded: superseded.count ? previous?.number : null },
      });
      await stage('banquet.document.changed', { hotelId, eventId, documentId: id, change: 'ISSUED' });
      return row;
    });
  } catch (error) {
    await removeFiles(written);
    rethrowPrismaError(error);
  }
  // Yeniden denemelerde yazılıp kullanılmayan dosyalar.
  const orphans = written.filter((key) => key !== fileKey(hotelId, created.id));
  if (orphans.length) await removeFiles(orphans);
  return toDocumentDto(created);
}

/**
 * Teklif kabul / ret, sözleşme imza (tarihli). Karar günü verilmezse iş günü.
 *
 * @param {string} hotelId
 * @param {string} eventId
 * @param {string} documentId
 * @param {{ decision: 'ACCEPTED' | 'DECLINED' | 'SIGNED', date?: Date, note?: string | null }} input
 */
export async function decideDocument(hotelId, eventId, documentId, { decision, date, note }) {
  const { today } = await hotelContext(hotelId);
  const actor = currentActor();
  const decisionDay = date ? day(date) : today;
  const row = await writeWithEvents(async (tx, stage) => {
    await lockEvents(tx, hotelId, [eventId]);
    const document = await tx.eventDocument.findFirst({ where: { id: documentId, eventId, hotelId }, select: { ...DOCUMENT_SELECT } });
    if (!document) throw new NotFoundError('Belge bulunamadı');
    const blocked = documentDecisionError({
      kind: document.kind,
      status: document.status,
      decision,
      date: decisionDay,
      issuedDay: day(document.createdAt),
      validUntil: day(document.validUntil),
      today,
    });
    if (blocked?.field) throw new ValidationError(blocked.message, { field: blocked.field });
    if (blocked) throw new ConflictError(blocked.message, 'DOCUMENT_RULE');
    const updated = await tx.eventDocument.update({
      where: { id: documentId },
      data: { status: decision, decisionDate: dateOnly(decisionDay), decidedBy: actor, decidedAt: new Date() },
      select: DOCUMENT_SELECT,
    });
    await recordAudit(tx, {
      hotelId,
      entity: 'EventDocument',
      entityId: documentId,
      action: 'UPDATE',
      before: { status: document.status },
      after: { status: decision, decisionDate: decisionDay, note: note ?? null, number: document.number },
    });
    await stage('banquet.document.changed', { hotelId, eventId, documentId, change: decision });
    return updated;
  });
  return toDocumentDto(row);
}

/**
 * Belgenin PDF'i (yetki route'ta). Kayıt ya da dosya yoksa 404.
 * @param {string} hotelId
 * @param {string} eventId
 * @param {string} documentId
 */
export async function openDocument(hotelId, eventId, documentId) {
  const document = await prisma.eventDocument.findFirst({ where: { id: documentId, eventId, hotelId }, select: { fileKey: true, number: true, kind: true } });
  if (!document) throw new NotFoundError('Belge bulunamadı');
  const file = await openFile(document.fileKey);
  if (!file) throw new NotFoundError('Belge dosyası bulunamadı');
  // Dosya adı başlıkta ASCII olmalı: Türkçe harf sadeleşir, kalan güvensiz karakter tire olur ("Sözleşme" + "SZL-2026-0007/2" → "Sozlesme-SZL-2026-0007-2.pdf").
  const fileName = `${asciiName(EVENT_DOCUMENT_KIND_LABELS[document.kind])}-${document.number}`.replace(/[^A-Za-z0-9-]+/g, '-') + '.pdf';
  return { ...file, fileName };
}
