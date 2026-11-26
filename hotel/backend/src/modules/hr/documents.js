import { currentActor, runWithContext } from '@hotelos/core';
import { EMPLOYEE_DOCUMENT_MAX_BYTES, EMPLOYEE_DOCUMENT_TYPE_LABELS, addDaysIso } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { openFile, removeFiles, saveFile } from '../../lib/file-storage.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { EMPLOYEE_SELECT, dateOnly, day, dotted, employeeView, fullName, hotelContext, iso, prisma, requireEmployee } from './shared.js';
import { loadHrSettings } from './shared.js';

/**
 * Özlük belgeleri (modül 52): kayıt veritabanında, dosya diskte (`hr/<otel>/<personel>/<belge>.<uzantı>`). Tarayıcı base64
 * gönderir; sunucu türü dosya imzasından doğrular. Silme yumuşaktır (kayıt kalır, dosya kalkar). Süresi dolacak belgeler
 * günlük işle İK'ya hatırlatılır (belge başına 7 günde bir).
 */

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const EXTENSIONS = Object.freeze({ 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });
const REMIND_EVERY_DAYS = 7;
const MAX_ALERT_EXAMPLES = 5;

/** Dosya imzası. @param {Buffer} buffer */
function sniffType(buffer) {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

const SELECT = Object.freeze({ id: true, employeeId: true, type: true, title: true, fileKey: true, fileName: true, contentType: true, size: true, issuedOn: true, expiresOn: true, note: true, uploadedBy: true, createdAt: true, employee: { select: EMPLOYEE_SELECT } });

/** @param {any} row @param {string} today */
const documentView = (row, today) => {
  const expiresOn = day(row.expiresOn);
  const daysLeft = expiresOn ? Math.round((Date.parse(`${expiresOn}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / 86_400_000) : null;
  return {
    id: row.id,
    employee: employeeView(row.employee),
    type: row.type,
    typeLabel: EMPLOYEE_DOCUMENT_TYPE_LABELS[row.type],
    title: row.title,
    hasFile: Boolean(row.fileKey),
    fileName: row.fileName,
    contentType: row.contentType,
    size: row.size,
    issuedOn: day(row.issuedOn),
    expiresOn,
    daysLeft,
    expired: daysLeft !== null && daysLeft < 0,
    note: row.note,
    uploadedBy: row.uploadedBy,
    createdAt: iso(row.createdAt),
  };
};

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, employeeId?: string, type?: string, expiringWithin?: number, search?: string }} query
 */
export async function listDocuments(hotelId, query) {
  const context = await hotelContext(hotelId);
  const where = {
    hotelId,
    deletedAt: null,
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.type ? { type: /** @type {any} */ (query.type) } : {}),
    ...(query.expiringWithin !== undefined ? { expiresOn: { lte: dateOnly(addDaysIso(context.today, query.expiringWithin)) } } : {}),
    ...(query.search ? { OR: [{ title: { contains: query.search, mode: 'insensitive' } }, { employee: { OR: [{ firstName: { contains: query.search, mode: 'insensitive' } }, { lastName: { contains: query.search, mode: 'insensitive' } }] } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.employeeDocument.findMany({ where, select: SELECT, orderBy: query.expiringWithin !== undefined ? [{ expiresOn: 'asc' }] : [{ createdAt: 'desc' }], ...toSkipTake(query) }),
    prisma.employeeDocument.count({ where }),
  ]);
  return { ...buildPage(rows.map((row) => documentView(row, context.today)), total, query), today: context.today };
}

/**
 * Belge ekle (dosya isteğe bağlı: yalnız kayıt da tutulabilir).
 * @param {string} hotelId @param {string} employeeId
 * @param {{ type: string, title: string, issuedOn: string | null, expiresOn: string | null, note: string | null, file: { name: string, contentType: string, data: string } | null }} input
 */
export async function addDocument(hotelId, employeeId, input) {
  const context = await hotelContext(hotelId);
  const employee = await requireEmployee(prisma, hotelId, employeeId);
  let buffer = null;
  if (input.file) {
    if (!BASE64.test(input.file.data)) throw new ValidationError('Dosya okunamadı (bozuk veri)', { fields: { file: 'Bozuk veri' } });
    buffer = Buffer.from(input.file.data, 'base64');
    if (buffer.length === 0) throw new ValidationError('Dosya boş', { fields: { file: 'Boş dosya' } });
    if (buffer.length > EMPLOYEE_DOCUMENT_MAX_BYTES) throw new ValidationError(`Dosya çok büyük (en fazla ${Math.floor(EMPLOYEE_DOCUMENT_MAX_BYTES / 1_000_000)} MB)`, { fields: { file: 'Çok büyük' } });
    const sniffed = sniffType(buffer);
    if (sniffed !== input.file.contentType) throw new ValidationError('Dosya türü bildirilenle uyuşmuyor (PDF, JPEG, PNG ya da WebP olmalı)', { fields: { file: 'Tür uyuşmuyor' } });
  }
  const created = await writeWithEvents(async (tx, stage) => {
    const row = await tx.employeeDocument.create({
      data: {
        hotelId,
        employeeId,
        type: /** @type {any} */ (input.type),
        title: input.title,
        issuedOn: input.issuedOn ? dateOnly(input.issuedOn) : null,
        expiresOn: input.expiresOn ? dateOnly(input.expiresOn) : null,
        note: input.note,
        fileName: input.file?.name ?? null,
        contentType: input.file?.contentType ?? null,
        size: buffer?.length ?? null,
        uploadedBy: currentActor(),
      },
      select: { id: true },
    });
    let fileKey = null;
    if (buffer && input.file) {
      fileKey = `hr/${hotelId}/${employeeId}/${row.id}.${EXTENSIONS[input.file.contentType]}`;
      await saveFile(fileKey, buffer);
      await tx.employeeDocument.update({ where: { id: row.id }, data: { fileKey } });
    }
    await recordAudit(tx, { hotelId, entity: 'EmployeeDocument', entityId: row.id, action: 'CREATE', after: { employeeId, type: input.type, title: input.title, expiresOn: input.expiresOn, file: Boolean(buffer) } });
    await stage('hr.changed', { hotelId, area: 'DOCUMENTS' });
    return row;
  });
  const row = await prisma.employeeDocument.findFirst({ where: { id: created.id }, select: SELECT });
  return { document: documentView(row, context.today), employee: employeeView(employee) };
}

/** @param {string} hotelId @param {string} documentId */
export async function openDocument(hotelId, documentId) {
  const row = await prisma.employeeDocument.findFirst({ where: { id: documentId, hotelId, deletedAt: null }, select: { fileKey: true, fileName: true, contentType: true } });
  if (!row?.fileKey) throw new NotFoundError('Belge dosyası yok');
  const file = await openFile(row.fileKey);
  if (!file) throw new NotFoundError('Belge dosyası diskte bulunamadı');
  return { ...file, fileName: row.fileName ?? 'belge', contentType: row.contentType ?? 'application/octet-stream' };
}

/** Yumuşak silme: kayıt kalır (kim, ne zaman), dosya diskten kalkar. @param {string} hotelId @param {string} documentId */
export async function removeDocument(hotelId, documentId) {
  const row = await prisma.employeeDocument.findFirst({ where: { id: documentId, hotelId, deletedAt: null }, select: { id: true, fileKey: true, employeeId: true, title: true } });
  if (!row) throw new NotFoundError('Belge bulunamadı');
  await writeWithEvents(async (tx, stage) => {
    await tx.employeeDocument.update({ where: { id: row.id }, data: { deletedAt: new Date(), fileKey: null } });
    await recordAudit(tx, { hotelId, entity: 'EmployeeDocument', entityId: row.id, action: 'DELETE', before: { employeeId: row.employeeId, title: row.title } });
    await stage('hr.changed', { hotelId, area: 'DOCUMENTS' });
  });
  if (row.fileKey) await removeFiles([row.fileKey]);
  return { removed: true };
}

/**
 * Süresi dolacak / dolmuş belgeler için İK'ya zil (otel başına tek özet; belge başına 7 günde bir). Günlük iş çağırır.
 * @param {string} hotelId
 */
export async function remindExpiringDocuments(hotelId) {
  const context = await hotelContext(hotelId);
  const settings = await loadHrSettings(prisma, hotelId, context.today);
  const horizon = addDaysIso(context.today, settings.documentReminderDays);
  const since = new Date(Date.now() - REMIND_EVERY_DAYS * 86_400_000);
  return runWithContext({ actor: 'sistem:ik' }, () =>
    writeWithEvents(async (tx, stage) => {
      const due = await tx.employeeDocument.findMany({
        where: { hotelId, deletedAt: null, expiresOn: { lte: dateOnly(horizon) }, OR: [{ remindedAt: null }, { remindedAt: { lt: since } }], employee: { status: 'ACTIVE' } },
        select: { id: true, title: true, type: true, expiresOn: true, employee: { select: { firstName: true, lastName: true } } },
        orderBy: { expiresOn: 'asc' },
        take: 200,
      });
      if (due.length === 0) return { alerted: 0 };
      const examples = due.slice(0, MAX_ALERT_EXAMPLES).map((row) => `${fullName(row.employee)} — ${EMPLOYEE_DOCUMENT_TYPE_LABELS[row.type]} (${dotted(/** @type {string} */ (day(row.expiresOn)))})`);
      const more = due.length > MAX_ALERT_EXAMPLES ? ` ve ${due.length - MAX_ALERT_EXAMPLES} belge daha` : '';
      const expired = due.filter((row) => /** @type {string} */ (day(row.expiresOn)) < context.today).length;
      await raiseStaffAlert(tx, stage, {
        hotelId,
        kind: 'HR',
        severity: expired > 0 ? 'WARNING' : 'INFO',
        title: `${due.length} özlük belgesinin süresi ${settings.documentReminderDays} gün içinde doluyor${expired ? ` (${expired} tanesi dolmuş)` : ''}`,
        body: `${examples.join('; ')}${more}.`,
        link: '/ik/belgeler?expiring=1',
        permission: PERMISSIONS.HR_MANAGE,
        dedupeKey: `hr-documents:${hotelId}:${context.today}`,
      });
      await tx.employeeDocument.updateMany({ where: { id: { in: due.map((row) => row.id) } }, data: { remindedAt: new Date() } });
      return { alerted: due.length };
    }),
  );
}
