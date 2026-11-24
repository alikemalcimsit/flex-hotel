import { currentActor } from '@hotelos/core';
import { IMPORT_KIND_LABELS, IMPORT_KIND_PERMISSIONS, IMPORT_KINDS } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { ForbiddenError, ValidationError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';
import { checkGuests, writeGuests } from './guests.js';
import { checkRatePlans, writeRatePlans } from './rate-plans.js';

/**
 * Excel'den toplu yükleme (modül 26). Tarayıcı dosyayı okur ve sütunları alanlarla eşleştirir; sunucu satırları
 * denetler (önizleme) ve hatasızsa tek işlemde yazar.
 *
 * - **Ya hep ya hiç:** hatalı satır varken yazılmaz; atlanan (zaten var) satırlar yazılmadan raporlanır.
 * - **İdempotent:** yükleme kimliği `DataImport` kaydının kimliğidir — aynı yükleme ikinci kez gelirse yazılmaz,
 *   önceki sonuç döner (çift tık, kopan istek).
 */

const IMPORTERS = Object.freeze({
  GUESTS: { check: checkGuests, write: (tx, _stage, hotelId, rows) => writeGuests(tx, hotelId, rows) },
  RATE_PLANS: { check: checkRatePlans, write: writeRatePlans },
});

/** @param {readonly string[]} permissions @param {string} kind */
function assertKind(permissions, kind) {
  if (!permissions.includes(IMPORT_KIND_PERMISSIONS[kind])) throw new ForbiddenError(`${IMPORT_KIND_LABELS[kind]} yükleme yetkiniz yok`);
}

/** @param {Array<{ status: string }>} rows */
const summarize = (rows) => ({
  total: rows.length,
  ok: rows.filter((row) => row.status === 'OK').length,
  skipped: rows.filter((row) => row.status === 'SKIP').length,
  errors: rows.filter((row) => row.status === 'ERROR').length,
});

/** Önceki (yazılmış) yükleme. @param {any} row */
const replayOf = (row) => ({ dryRun: false, kind: row.kind, replayed: true, created: row.created, skipped: row.skipped, rows: row.result, summary: summarize(row.result) });

/**
 * @param {string} hotelId @param {readonly string[]} permissions @param {string} kind
 * @param {{ requestId: string, dryRun: boolean, fileName: string | null, rows: Array<Record<string, unknown>> }} input
 */
export async function runImport(hotelId, permissions, kind, input) {
  assertKind(permissions, kind);
  const previous = await prisma.dataImport.findFirst({ where: { id: input.requestId, hotelId } });
  if (previous) {
    if (previous.kind !== kind) throw new ValidationError('Bu yükleme kimliği başka bir türde kullanılmış');
    return replayOf(previous);
  }

  const importer = IMPORTERS[kind];
  const checked = await importer.check(hotelId, input.rows);
  const rows = checked.map(({ data, ...row }) => row);
  const summary = summarize(rows);
  const report = { dryRun: input.dryRun, kind, replayed: false, created: 0, skipped: summary.skipped, rows, summary };
  if (input.dryRun) return report;
  if (summary.errors > 0) throw new ValidationError(`${summary.errors} satırda hata var; düzeltip yeniden yükleyin`);

  const writable = checked.filter((row) => row.status === 'OK').map((row) => row.data);
  try {
    const created = await writeWithEvents(async (tx, stage) => {
      const count = await importer.write(tx, stage, hotelId, writable);
      await tx.dataImport.create({
        data: {
          id: input.requestId,
          hotelId,
          kind,
          fileName: input.fileName,
          total: summary.total,
          created: count,
          skipped: summary.skipped,
          result: rows.map((row) => ({ index: row.index, status: row.status, errors: [], note: row.note, preview: row.preview })),
          createdBy: currentActor(),
        },
      });
      await stage('data.import.completed', { hotelId, importId: input.requestId, kind, created: count, skipped: summary.skipped });
      return count;
    });
    return { ...report, created };
  } catch (error) {
    // Aynı yükleme aynı anda iki kez: ikincisi kimlik çakışmasına düşer (işlemi geri alınır) — yazılmış olanı döndür.
    const raced = await prisma.dataImport.findFirst({ where: { id: input.requestId, hotelId } });
    if (raced) return replayOf(raced);
    throw error;
  }
}

/** Kullanıcının yükleyebildiği türlerin son yüklemeleri. @param {string} hotelId @param {readonly string[]} permissions */
export async function listImports(hotelId, permissions) {
  const kinds = IMPORT_KINDS.filter((kind) => permissions.includes(IMPORT_KIND_PERMISSIONS[kind]));
  const rows = await prisma.dataImport.findMany({
    where: { hotelId, kind: { in: kinds } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, kind: true, fileName: true, total: true, created: true, skipped: true, createdBy: true, createdAt: true },
  });
  return { items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) };
}
