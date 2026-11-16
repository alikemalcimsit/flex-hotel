import { currentActor } from '@hotelos/core';
import { MAX_SAVED_REPORTS_PER_USER } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';
import { runReportSpec } from './run.js';

/**
 * Kayıtlı raporlar (modül 24). Soru cevabının rapor tanımı + grafiği saklanır; "çalıştır" AI'sız ve anında, göreli
 * dönem o günün tarihine göre ("geçen ay" her ay kayar).
 *
 * Görünürlük: sahibi her zaman; paylaşılan rapor rapor yetkisi olan herkese. Düzeltme / silme yalnız sahibinde.
 */

/** @param {any} row @param {string} me */
const toSavedDto = (row, me) => ({
  id: row.id,
  title: row.title,
  question: row.question,
  spec: row.spec,
  chart: row.chart,
  shared: row.shared,
  owner: row.owner,
  isMine: row.owner === me,
  lastRunAt: row.lastRunAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** Görülebilen kayıtlı rapor. @param {string} hotelId @param {string} id */
async function visibleReport(hotelId, id) {
  const me = currentActor();
  const row = await prisma.savedReport.findFirst({ where: { id, hotelId, OR: [{ owner: me }, { shared: true }] } });
  if (!row) throw new NotFoundError('Kayıtlı rapor bulunamadı');
  return { row, me };
}

/**
 * @param {string} hotelId @param {{ scope: 'MINE' | 'SHARED' }} query
 */
export async function listSavedReports(hotelId, { scope }) {
  const me = currentActor();
  const where = scope === 'MINE' ? { hotelId, owner: me } : { hotelId, shared: true };
  const rows = await prisma.savedReport.findMany({ where, orderBy: [{ updatedAt: 'desc' }] });
  return { items: rows.map((row) => toSavedDto(row, me)) };
}

/**
 * Cevaplanmış sorunun raporunu kaydet.
 * @param {string} hotelId @param {{ questionId: string, title: string, shared: boolean }} input
 */
export async function saveReport(hotelId, { questionId, title, shared }) {
  const me = currentActor();
  const question = await prisma.reportQuestion.findFirst({ where: { id: questionId, hotelId, askedBy: me } });
  if (!question) throw new NotFoundError('Soru bulunamadı');
  if (question.status !== 'READY' || !question.spec) throw new ValidationError('Yalnız tablo içeren bir cevap kaydedilebilir');
  const count = await prisma.savedReport.count({ where: { hotelId, owner: me } });
  if (count >= MAX_SAVED_REPORTS_PER_USER) throw new ConflictError(`En fazla ${MAX_SAVED_REPORTS_PER_USER} rapor kaydedebilirsiniz; eskilerden silin`, 'TOO_MANY_SAVED');
  const row = await writeWithEvents(async (tx, stage) => {
    const created = await tx.savedReport.create({ data: { hotelId, owner: me, title, question: question.question, spec: question.spec, chart: question.chart, shared } });
    await stage('report.saved.changed', { hotelId, savedReportId: created.id, change: 'CREATED' });
    return created;
  });
  return toSavedDto(row, me);
}

/** Sahibi olunan rapor. @param {string} hotelId @param {string} id */
async function ownedReport(hotelId, id) {
  const { row, me } = await visibleReport(hotelId, id);
  if (row.owner !== me) throw new ForbiddenError('Bu raporu yalnız sahibi değiştirebilir');
  return { row, me };
}

/**
 * Başlık / paylaşım.
 * @param {string} hotelId @param {string} id @param {{ expectedUpdatedAt: Date, title?: string, shared?: boolean }} input
 */
export async function updateSavedReport(hotelId, id, { expectedUpdatedAt, ...data }) {
  const { me } = await ownedReport(hotelId, id);
  await writeWithEvents(async (tx, stage) => {
    await updateWithVersionCheck(tx, 'savedReport', { id, hotelId }, expectedUpdatedAt, data, 'Kayıtlı rapor bulunamadı');
    await stage('report.saved.changed', { hotelId, savedReportId: id, change: 'UPDATED' });
  });
  return toSavedDto(await prisma.savedReport.findFirst({ where: { id, hotelId } }), me);
}

/** @param {string} hotelId @param {string} id */
export async function deleteSavedReport(hotelId, id) {
  await ownedReport(hotelId, id);
  await writeWithEvents(async (tx, stage) => {
    await tx.savedReport.delete({ where: { id } });
    await stage('report.saved.changed', { hotelId, savedReportId: id, change: 'DELETED' });
  });
}

/**
 * Kayıtlı raporu çalıştır (AI'sız): tanım bugünün tarihine göre çözülür, rapor MCP aracıyla üretilir.
 * @param {string} hotelId @param {string} id
 */
export async function runSavedReport(hotelId, id) {
  const { row, me } = await visibleReport(hotelId, id);
  const run = await runReportSpec(hotelId, row.spec, { chart: row.chart });
  // Son çalıştırma bilgisi sürüm damgasını değiştirmesin (açık düzeltme formu bayatlamasın): ham güncelleme.
  await prisma.$executeRaw`UPDATE "SavedReport" SET "lastRunAt" = now() WHERE "id" = ${id}`;
  return { report: toSavedDto({ ...row, lastRunAt: new Date() }, me), periodLabel: run.periodLabel, dataset: run.dataset, chart: run.chart };
}
