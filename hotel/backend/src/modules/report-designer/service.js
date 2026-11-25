import { currentActor, toIsoDay } from '@hotelos/core';
import { DESIGNER_PREVIEW_ROWS, DESIGNER_SOURCE_LABELS, DESIGNER_SOURCE_PERMISSIONS, MAX_DESIGNS_PER_USER, MAX_REPORT_LIST, reportDesignSchema } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';
import { readOnly } from '../reports/queries.js';
import { buildDesignQuery, toDataset } from './query.js';

/**
 * Rapor tasarımcısı (modül 26): tasarımı çalıştır (önizleme / tam), kaydet, paylaş, çalıştır.
 *
 * - Sorgu rapor ekranlarıyla aynı **salt okunur** işlemde ve süre sınırıyla çalışır (`readOnly`).
 * - Kaynağın yetkisi her çalıştırmada ve kayıtta denetlenir: paylaşılan bir misafir raporunu misafir yetkisi olmayan
 *   göremez (listede "yetkiniz yok" olarak durur).
 * - Kayıtlı tasarımlar kişisel; paylaşılan rapor yetkisi olan herkese görünür; düzeltme / silme yalnız sahibinde.
 */

/** @param {readonly string[]} permissions @param {string} source */
const canUseSource = (permissions, source) => permissions.includes(DESIGNER_SOURCE_PERMISSIONS[source]);

/** @param {readonly string[]} permissions @param {string} source */
function assertSource(permissions, source) {
  if (!canUseSource(permissions, source)) throw new ForbiddenError(`"${DESIGNER_SOURCE_LABELS[source]}" kaynağını görme yetkiniz yok`);
}

/**
 * Tasarımı çalıştırır.
 * @param {string} hotelId @param {readonly string[]} permissions
 * @param {{ design: import('@hotelos/hotel-contracts').ReportDesign, preview: boolean }} input
 */
export async function runDesign(hotelId, permissions, { design, preview }) {
  assertSource(permissions, design.source);
  const [hotel, businessDate] = await Promise.all([prisma.hotel.findUnique({ where: { id: hotelId }, select: { timezone: true } }), getBusinessDate(hotelId)]);
  const limit = preview ? Math.min(DESIGNER_PREVIEW_ROWS, design.limit) : design.limit;
  // Bir fazlası: sınırda kesildi mi.
  const { query, outputs } = buildDesignQuery(design, { hotelId, timezone: hotel.timezone, today: toIsoDay(businessDate), limit: limit + 1 });
  const rows = await readOnly((tx) => tx.$queryRaw(query));
  const truncated = rows.length > limit;
  const dataset = toDataset(truncated ? rows.slice(0, limit) : rows, outputs);
  return { dataset, truncated, rowCount: dataset.rows.length };
}

/* ─────────────── Kayıtlı tasarımlar ─────────────── */

/** @param {any} row @param {string} me @param {readonly string[]} permissions */
const toDefinitionDto = (row, me, permissions) => ({
  id: row.id,
  title: row.title,
  source: row.source,
  design: row.design,
  shared: row.shared,
  owner: row.owner,
  isMine: row.owner === me,
  allowed: canUseSource(permissions, row.source),
  lastRunAt: row.lastRunAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** Görülebilen tasarım (sahibi ya da paylaşılmış). @param {string} hotelId @param {string} id */
async function visibleDefinition(hotelId, id) {
  const me = currentActor();
  const row = await prisma.reportDefinition.findFirst({ where: { id, hotelId, OR: [{ owner: me }, { shared: true }] } });
  if (!row) throw new NotFoundError('Rapor bulunamadı');
  return { row, me };
}

/** @param {string} hotelId @param {readonly string[]} permissions @param {{ scope: 'MINE' | 'SHARED' }} query */
export async function listDefinitions(hotelId, permissions, { scope }) {
  const me = currentActor();
  const rows = await prisma.reportDefinition.findMany({
    where: scope === 'MINE' ? { hotelId, owner: me } : { hotelId, shared: true },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: MAX_REPORT_LIST,
  });
  return { items: rows.map((row) => toDefinitionDto(row, me, permissions)) };
}

/** @param {string} hotelId @param {readonly string[]} permissions @param {string} id */
export async function getDefinition(hotelId, permissions, id) {
  const { row, me } = await visibleDefinition(hotelId, id);
  return toDefinitionDto(row, me, permissions);
}

/**
 * @param {string} hotelId @param {readonly string[]} permissions
 * @param {{ title: string, shared: boolean, design: import('@hotelos/hotel-contracts').ReportDesign }} input
 */
export async function createDefinition(hotelId, permissions, { title, shared, design }) {
  assertSource(permissions, design.source);
  const me = currentActor();
  const owned = await prisma.reportDefinition.count({ where: { hotelId, owner: me } });
  if (owned >= MAX_DESIGNS_PER_USER) throw new ConflictError(`En fazla ${MAX_DESIGNS_PER_USER} rapor tasarımı kaydedebilirsiniz; eskilerden silin`, 'TOO_MANY_SAVED');
  const row = await writeWithEvents(async (tx, stage) => {
    const created = await tx.reportDefinition.create({ data: { hotelId, owner: me, title, source: design.source, design, shared } });
    await stage('report.definition.changed', { hotelId, definitionId: created.id, change: 'CREATED' });
    return created;
  });
  return toDefinitionDto(row, me, permissions);
}

/** Sahibinin tasarımı. @param {string} hotelId @param {string} id */
async function ownedDefinition(hotelId, id) {
  const found = await visibleDefinition(hotelId, id);
  if (found.row.owner !== found.me) throw new ForbiddenError('Bu raporu yalnız sahibi değiştirebilir');
  return found;
}

/**
 * @param {string} hotelId @param {readonly string[]} permissions @param {string} id
 * @param {{ expectedUpdatedAt: Date, title?: string, shared?: boolean, design?: import('@hotelos/hotel-contracts').ReportDesign }} input
 */
export async function updateDefinition(hotelId, permissions, id, { expectedUpdatedAt, ...data }) {
  const { me } = await ownedDefinition(hotelId, id);
  if (data.design) assertSource(permissions, data.design.source);
  const patch = { ...data, ...(data.design ? { source: data.design.source } : {}) };
  await writeWithEvents(async (tx, stage) => {
    await updateWithVersionCheck(tx, 'reportDefinition', { id, hotelId }, expectedUpdatedAt, patch, 'Rapor bulunamadı');
    await stage('report.definition.changed', { hotelId, definitionId: id, change: 'UPDATED' });
  });
  return toDefinitionDto(await prisma.reportDefinition.findFirst({ where: { id, hotelId } }), me, permissions);
}

/** @param {string} hotelId @param {string} id */
export async function deleteDefinition(hotelId, id) {
  await ownedDefinition(hotelId, id);
  await writeWithEvents(async (tx, stage) => {
    await tx.reportDefinition.delete({ where: { id } });
    await stage('report.definition.changed', { hotelId, definitionId: id, change: 'DELETED' });
  });
}

/**
 * Kayıtlı tasarımı çalıştır (tam; satır sınırı tasarımdan). Saklanan tasarım bugünkü sözleşmeyle yeniden doğrulanır
 * (katalogdan kalkan sütun açık hata verir).
 * @param {string} hotelId @param {readonly string[]} permissions @param {string} id
 */
export async function runDefinition(hotelId, permissions, id) {
  const { row, me } = await visibleDefinition(hotelId, id);
  const parsed = reportDesignSchema.safeParse(row.design);
  if (!parsed.success) throw new ValidationError(`Kayıtlı tasarım artık geçerli değil: ${parsed.error.issues[0].message}. Raporu düzenleyip yeniden kaydedin.`);
  const result = await runDesign(hotelId, permissions, { design: parsed.data, preview: false });
  // Son çalıştırma sürüm damgasını değiştirmesin (açık düzenleme formu bayatlamasın): ham güncelleme.
  await prisma.$executeRaw`UPDATE "ReportDefinition" SET "lastRunAt" = now() WHERE "id" = ${id}`;
  return { report: toDefinitionDto({ ...row, lastRunAt: new Date() }, me, permissions), ...result };
}
