import { currentActor, toIsoDay, toMoneyString } from '@hotelos/core';
import { BONUS_PACE_TOLERANCE_PCT, formatBonusPeriod } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockAgencyBonusRules } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { containsText } from '../../lib/search.js';
import { writeWithEvents } from '../../lib/write.js';
import { getHotelSettings } from '../settings/service.js';
import { refreshProgress } from './progress.js';
import { RULE_SELECT, day, dateOnly, liveProgress, roomTypeNames, ruleSnapshot, specOf, termsOf, toRuleDto } from './shared.js';

/**
 * Acente prim kuralları servisi (modül 35).
 *
 * ### Kuralın ömrü
 *
 * Taslak → yürürlükte → (gerekçeyle) iptal. Taslak silinebilir; yürürlükteki
 * kural düzenlenebilir (sözleşme yeniden konuşuldu): ilerleme yeni koşullarla
 * hesaplanır, hesaplanmış ama onaya gitmemiş hak ediş "bayat" görünür ve
 * yeniden hesaplanmadan onaya gönderilemez. Hak edişi onaya gitmiş / onaylanmış
 * / ödenmiş kural değiştirilemez ve iptal edilemez (önce hak ediş yeniden açılır).
 *
 * ### Çakışma
 *
 * Aynı acentenin aynı ölçütte (gece / ciro) aynı günü kapsayan iki yürürlükteki
 * kuralı olamaz: önce burada anlamlı mesajla denetlenir, yarışta veritabanı
 * kısıtı (`AgencyBonusRule_one_active_*`) son savunmadır.
 *
 * ### İlerleme
 *
 * Listedeki puan ve kademe zamanlanmış işin özetidir (`progress.js`); kural
 * ekranı canlı hesaplar. Kural değişince özet hemen (uyarısız) tazelenir.
 */

/** Arama: acente adı / kodu eşleşen en fazla bu kadar acentenin kuralları. */
const SEARCH_AGENCY_LIMIT = 500;

/**
 * Sıralama → Prisma `orderBy` (son anahtar her zaman id: sayfalar kararlı).
 * @type {Record<string, object[]>}
 */
const RULE_ORDER = Object.freeze({
  END_DATE: [{ endDate: 'asc' }, { id: 'asc' }],
  SCORE_DESC: [{ progressScore: 'desc' }, { id: 'asc' }],
  SCORE_ASC: [{ progressScore: 'asc' }, { id: 'asc' }],
  AGENCY: [{ agency: { name: 'asc' } }, { startDate: 'desc' }, { id: 'asc' }],
});

/** @param {string} hotelId */
async function businessDay(hotelId) {
  return toIsoDay(await getBusinessDate(hotelId));
}

/**
 * Arama metni: kural adı ya da acente adı / kodu. Acenteler önce kendi trigram
 * index'leriyle bulunur (ilişki üzerinden `OR` tabloyu birleştirip süzerdi).
 * @param {string} hotelId
 * @param {string | undefined} search
 */
async function searchWhere(hotelId, search) {
  const text = search?.trim();
  if (!text) return null;
  const agencies = await prisma.agency.findMany({
    where: { hotelId, OR: [{ name: containsText(text) }, { code: containsText(text) }] },
    select: { id: true },
    take: SEARCH_AGENCY_LIMIT,
  });
  return { OR: [{ name: containsText(text) }, ...(agencies.length ? [{ agencyId: { in: agencies.map((row) => row.id) } }] : [])] };
}

/**
 * Evre süzgeci (iş gününe göre; saklanmaz).
 * @param {'UPCOMING' | 'RUNNING' | 'ENDED' | undefined} phase
 * @param {string} businessDate
 */
function phaseWhere(phase, businessDate) {
  const today = dateOnly(businessDate);
  if (phase === 'UPCOMING') return { startDate: { gt: today } };
  if (phase === 'RUNNING') return { startDate: { lte: today }, endDate: { gte: today } };
  if (phase === 'ENDED') return { endDate: { lt: today } };
  return null;
}

/**
 * Kural listesi (sayfalı): durum, evre, acente, arama; dönem sonu, hedefe ulaşma
 * ya da acente adına göre. Puan ve kademe ilerleme özetinden (tazelenme anı
 * satırda).
 *
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string, status?: string, phase?: 'UPCOMING' | 'RUNNING' | 'ENDED', agencyId?: string, sort: string }} query
 */
export async function listRules(hotelId, query) {
  const [businessDate, hotel] = await Promise.all([businessDay(hotelId), getHotelSettings(hotelId)]);
  const and = [];
  if (query.status) and.push({ status: query.status });
  if (query.agencyId) and.push({ agencyId: query.agencyId });
  const phase = phaseWhere(query.phase, businessDate);
  if (phase) and.push(phase);
  const search = await searchWhere(hotelId, query.search);
  if (search) and.push(search);
  const where = { hotelId, ...(and.length ? { AND: and } : {}) };

  const [rows, total] = await Promise.all([
    prisma.agencyBonusRule.findMany({ where, orderBy: RULE_ORDER[query.sort] ?? RULE_ORDER.END_DATE, ...toSkipTake(query), select: RULE_SELECT }),
    prisma.agencyBonusRule.count({ where }),
  ]);
  const roomTypes = await roomTypeNames(hotelId, rows.flatMap((row) => row.roomTypeIds));
  const page = buildPage(
    rows.map((row) => toRuleDto(row, { businessDate, roomTypes })),
    total,
    query,
  );
  return { ...page, meta: { ...page.meta, businessDate, currency: hotel.currency } };
}

/**
 * Kural ekranı: kural + canlı ilerleme (gerçekleşen, eldeki, tahmin, şu ana
 * kadarki prim, zamana göre durum, aylık kırılım). Taslak ve iptal kuralda da
 * hesaplanır ("bu koşullarla ne olurdu").
 *
 * @param {string} hotelId
 * @param {string} ruleId
 */
export async function getRule(hotelId, ruleId) {
  const row = await prisma.agencyBonusRule.findFirst({ where: { id: ruleId, hotelId }, select: RULE_SELECT });
  if (!row) throw new NotFoundError('Prim kuralı bulunamadı');
  const [businessDate, roomTypes] = await Promise.all([businessDay(hotelId), roomTypeNames(hotelId, row.roomTypeIds)]);
  const live = await liveProgress(hotelId, specOf(row), termsOf(row), businessDate);
  return { ...toRuleDto(row, { businessDate, roomTypes }), live };
}

/**
 * Formdaki koşullarla önizleme (kaydetmeden): bu acentenin bu dönemdeki
 * üretimi ve bu kademelerle prim.
 *
 * @param {string} hotelId
 * @param {{ agencyId: string, startDate: Date, endDate: Date, metric: 'NIGHTS' | 'REVENUE', mode: 'WHOLE' | 'EXCESS', target: string, tiers: Array<{ threshold: string, ratePct: string }>, roomTypeIds: string[], maxBonus: string | null }} input
 */
export async function previewRule(hotelId, input) {
  await assertAgency(prisma, hotelId, input.agencyId);
  await assertRoomTypes(prisma, hotelId, input.roomTypeIds);
  const businessDate = await businessDay(hotelId);
  const spec = specOf({ id: 'preview', agencyId: input.agencyId, startDate: input.startDate, endDate: input.endDate, roomTypeIds: input.roomTypeIds });
  return liveProgress(hotelId, spec, termsOf(input), businessDate);
}

/* ══════════════════ Yazma ══════════════════ */

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {string} agencyId
 */
async function assertAgency(client, hotelId, agencyId) {
  const agency = await client.agency.findFirst({ where: { id: agencyId, hotelId }, select: { id: true, name: true } });
  if (!agency) throw new ValidationError('Acente bulunamadı', { fields: { agencyId: 'Acente bulunamadı' } });
  return agency;
}

/**
 * Süzgeçteki oda tipleri bu otelin (silinmemiş) oda tipleri olmalı.
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {string[]} ids
 */
async function assertRoomTypes(client, hotelId, ids) {
  if (ids.length === 0) return;
  const found = await client.roomType.count({ where: { hotelId, id: { in: ids } } });
  if (found !== new Set(ids).size) throw new ValidationError('Oda tipi bulunamadı', { fields: { roomTypeIds: 'Seçilen oda tiplerinden biri bulunamadı (silinmiş olabilir)' } });
}

/**
 * Aynı acentenin aynı ölçütte çakışan yürürlükteki kuralı (anlamlı mesaj için;
 * yarışta veritabanı kısıtı).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {{ id: string, agencyId: string, metric: string, startDate: Date, endDate: Date }} rule
 */
async function assertNoOverlap(tx, hotelId, rule) {
  const other = await tx.agencyBonusRule.findFirst({
    where: {
      hotelId,
      agencyId: rule.agencyId,
      metric: rule.metric,
      status: 'ACTIVE',
      id: { not: rule.id },
      startDate: { lte: rule.endDate },
      endDate: { gte: rule.startDate },
    },
    select: { name: true, startDate: true, endDate: true },
  });
  if (other) {
    throw new ConflictError(
      `Bu acentenin aynı ölçütte yürürlükte "${other.name}" kuralı var (${formatBonusPeriod(day(other.startDate), day(other.endDate))}); dönemler çakışamaz.`,
      'BONUS_RULE_OVERLAP',
    );
  }
}

/**
 * Kilitli kural: var, sürümü güncel, durumu bu işe uygun; hak edişi kilitliyse
 * (onayda / onaylı / ödendi) değiştirilemez.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} ruleId
 * @param {Date | null} expectedUpdatedAt
 */
async function lockedRule(tx, hotelId, ruleId, expectedUpdatedAt) {
  await lockAgencyBonusRules(tx, hotelId, [ruleId]);
  const row = await tx.agencyBonusRule.findFirst({ where: { id: ruleId, hotelId }, select: RULE_SELECT });
  if (!row) throw new NotFoundError('Prim kuralı bulunamadı');
  if (expectedUpdatedAt && row.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
  return row;
}

/** @param {any} row */
function assertBonusOpen(row) {
  if (row.bonus && row.bonus.status !== 'DRAFT') {
    throw new ConflictError(
      'Bu kuralın hak edişi onaya gönderilmiş ya da onaylanmış; kural değiştirilemez. Gerekirse önce hak edişi yeniden açın.',
      'BONUS_LOCKED',
    );
  }
}

/**
 * Onaya gitmemiş (hesaplandı) hak edişi siler; döküm satırları onunla gider.
 * Denetim izine son rakamlar ve sebep yazılır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} bonusId
 * @param {string} reason
 */
async function dropDraftBonus(tx, hotelId, bonusId, reason) {
  const dropped = await tx.agencyBonus.delete({ where: { id: bonusId }, select: { id: true, status: true, amount: true, revision: true } });
  await recordAudit(tx, {
    hotelId,
    entity: 'AgencyBonus',
    entityId: dropped.id,
    action: 'DELETE',
    before: { status: dropped.status, amount: String(dropped.amount), revision: dropped.revision },
    after: { reason },
  });
}

/**
 * Kayıttan sonra ilerleme özeti hemen (uyarısız) tazelenir. Başarısız olursa
 * zamanlanmış iş tazeler; değişiklik zaten kalıcı, kullanıcıya hata dönmez.
 *
 * Bilinçli sonuç: kural düzenlenirken gerçekleşen üretimle yeni bir kademeye
 * ulaşılmışsa o kademenin uyarısı düşmez (özet sessizce yazılır; kural ekranı ve
 * liste kademeyi gösterir). Yürürlüğe almada da zaten ulaşılmış kademeler için
 * uyarı düşmez — kuralı açan kişi ekranda görüyor.
 * @param {string} hotelId
 * @param {string} ruleId
 */
async function refreshQuietly(hotelId, ruleId) {
  try {
    await refreshProgress(hotelId, { ruleIds: [ruleId], announce: false });
  } catch {
    // Zamanlanmış iş bir sonraki turda tazeler.
  }
}

/** @param {any} input */
const ruleData = (input) => ({
  name: input.name,
  startDate: input.startDate,
  endDate: input.endDate,
  metric: input.metric,
  mode: input.mode,
  target: input.target,
  tiers: input.tiers.map((tier) => ({ threshold: tier.threshold, ratePct: tier.ratePct })),
  roomTypeIds: input.roomTypeIds,
  maxBonus: input.maxBonus,
  notes: input.notes ?? null,
});

/**
 * Yeni kural (taslak). Para birimi otelin para birimidir.
 * @param {string} hotelId
 * @param {any} input `createAgencyBonusRuleSchema`
 */
export async function createRule(hotelId, input) {
  const actor = currentActor();
  const hotel = await getHotelSettings(hotelId);
  let ruleId;
  try {
    ruleId = await writeWithEvents(async (tx, stage) => {
      await assertAgency(tx, hotelId, input.agencyId);
      await assertRoomTypes(tx, hotelId, input.roomTypeIds);
      const row = await tx.agencyBonusRule.create({
        data: { hotelId, agencyId: input.agencyId, ...ruleData(input), currency: hotel.currency, createdBy: actor },
        select: RULE_SELECT,
      });
      await recordAudit(tx, { hotelId, entity: 'AgencyBonusRule', entityId: row.id, action: 'CREATE', after: ruleSnapshot(row) });
      await stage('agency.bonus.rule.changed', { hotelId, ruleId: row.id, agencyId: row.agencyId, change: 'CREATED' });
      return row.id;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getRule(hotelId, ruleId);
}

/**
 * Kuralı günceller (taslak ya da yürürlükte). Yürürlükteki kuralın dönemi
 * değişirse çakışma yeniden denetlenir.
 *
 * @param {string} hotelId
 * @param {string} ruleId
 * @param {any} input `updateAgencyBonusRuleSchema`
 */
export async function updateRule(hotelId, ruleId, input) {
  try {
    const today = await businessDay(hotelId);
    await writeWithEvents(async (tx, stage) => {
      const before = await lockedRule(tx, hotelId, ruleId, input.expectedUpdatedAt);
      if (before.status === 'CANCELLED') throw new ConflictError('İptal edilmiş kural değiştirilemez', 'RULE_CANCELLED');
      assertBonusOpen(before);
      await assertRoomTypes(tx, hotelId, input.roomTypeIds);
      if (before.status === 'ACTIVE') {
        await assertNoOverlap(tx, hotelId, { id: ruleId, agencyId: before.agencyId, metric: input.metric, startDate: input.startDate, endDate: input.endDate });
      }
      // Dönem uzatılıp yeniden "sürüyor"a döndüyse hesaplanmış hak ediş anlamını yitirir: silinir
      // (dönem bitince yeniden hesaplanır). Aynı dönemde kalan hak ediş "bayat" görünür.
      if (before.bonus && day(input.endDate) >= today) {
        await dropDraftBonus(tx, hotelId, before.bonus.id, 'Kural dönemi uzatıldı; dönem bitince yeniden hesaplanacak');
      }
      const after = await tx.agencyBonusRule.update({ where: { id: ruleId }, data: ruleData(input), select: RULE_SELECT });
      await recordAudit(tx, { hotelId, entity: 'AgencyBonusRule', entityId: ruleId, action: 'UPDATE', before: ruleSnapshot(before), after: ruleSnapshot(after) });
      await stage('agency.bonus.rule.changed', { hotelId, ruleId, agencyId: after.agencyId, change: 'UPDATED' });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  await refreshQuietly(hotelId, ruleId);
  return getRule(hotelId, ruleId);
}

/**
 * Taslağı yürürlüğe alır: ilerleme izlenir, dönem bitince hak ediş hesaplanır.
 * @param {string} hotelId
 * @param {string} ruleId
 * @param {{ expectedUpdatedAt: Date }} input
 */
export async function activateRule(hotelId, ruleId, { expectedUpdatedAt }) {
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      const before = await lockedRule(tx, hotelId, ruleId, expectedUpdatedAt);
      if (before.status !== 'DRAFT') throw new ConflictError('Yalnızca taslak kural yürürlüğe alınır', 'RULE_NOT_DRAFT');
      await assertNoOverlap(tx, hotelId, before);
      const after = await tx.agencyBonusRule.update({
        where: { id: ruleId },
        data: { status: 'ACTIVE', activatedAt: new Date(), activatedBy: actor },
        select: RULE_SELECT,
      });
      await recordAudit(tx, { hotelId, entity: 'AgencyBonusRule', entityId: ruleId, action: 'UPDATE', before: ruleSnapshot(before), after: ruleSnapshot(after) });
      await stage('agency.bonus.rule.changed', { hotelId, ruleId, agencyId: after.agencyId, change: 'ACTIVATED' });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  await refreshQuietly(hotelId, ruleId);
  return getRule(hotelId, ruleId);
}

/**
 * Yürürlükteki kuralı gerekçeyle iptal eder. Hesaplanmış (onaya gitmemiş) hak
 * ediş de silinir; onaya gitmiş / onaylı / ödenmiş hak edişi olan kural iptal
 * edilemez.
 *
 * @param {string} hotelId
 * @param {string} ruleId
 * @param {{ expectedUpdatedAt: Date, reason: string }} input
 */
export async function cancelRule(hotelId, ruleId, { expectedUpdatedAt, reason }) {
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      const before = await lockedRule(tx, hotelId, ruleId, expectedUpdatedAt);
      if (before.status === 'DRAFT') throw new ConflictError('Taslak kural iptal edilmez, silinir', 'RULE_NOT_ACTIVE');
      if (before.status === 'CANCELLED') throw new ConflictError('Kural zaten iptal edilmiş', 'RULE_CANCELLED');
      assertBonusOpen(before);
      if (before.bonus) await dropDraftBonus(tx, hotelId, before.bonus.id, `Kural iptal edildi: ${reason}`);
      const after = await tx.agencyBonusRule.update({
        where: { id: ruleId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: actor, cancelReason: reason },
        select: RULE_SELECT,
      });
      await recordAudit(tx, { hotelId, entity: 'AgencyBonusRule', entityId: ruleId, action: 'UPDATE', before: ruleSnapshot(before), after: ruleSnapshot(after) });
      await stage('agency.bonus.rule.changed', { hotelId, ruleId, agencyId: after.agencyId, change: 'CANCELLED' });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getRule(hotelId, ruleId);
}

/**
 * Taslak kuralı siler (yürürlüğe girmemiş kuralın hak edişi olmaz).
 * @param {string} hotelId
 * @param {string} ruleId
 * @param {{ expectedUpdatedAt: Date }} input
 */
export async function deleteRule(hotelId, ruleId, { expectedUpdatedAt }) {
  await writeWithEvents(async (tx, stage) => {
    const before = await lockedRule(tx, hotelId, ruleId, expectedUpdatedAt);
    if (before.status !== 'DRAFT') throw new ConflictError('Yalnızca taslak kural silinir; yürürlükteki kural iptal edilir', 'RULE_NOT_DRAFT');
    await tx.agencyBonusRule.delete({ where: { id: ruleId } });
    await recordAudit(tx, { hotelId, entity: 'AgencyBonusRule', entityId: ruleId, action: 'DELETE', before: ruleSnapshot(before) });
    await stage('agency.bonus.rule.changed', { hotelId, ruleId, agencyId: before.agencyId, change: 'DELETED' });
  });
  return { id: ruleId, deleted: true };
}

/* ══════════════════ Özet (panel başlığı) ══════════════════ */

/**
 * Panel başlığı: sürmekte olan kural, gerisinde kalan, dönemi bitip hak edişi
 * bekleyen, onay bekleyen / onaylı ödenmemiş tutar ve bu yıl ödenen. Tek kural
 * sorgusu + tek hak ediş gruplaması.
 *
 * "Gerisinde" kayıtlı ilerleme özetinden (zamanlanmış iş) ve doğrusal
 * beklentiden hesaplanır (kural ekranıyla aynı tolerans).
 *
 * @param {string} hotelId
 */
export async function getBonusSummary(hotelId) {
  const [businessDate, hotel] = await Promise.all([businessDay(hotelId), getHotelSettings(hotelId)]);
  const yearStart = `${businessDate.slice(0, 4)}-01-01`;
  const [[rules], bonuses, [paid]] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        count(*) FILTER (WHERE r."startDate" <= ${businessDate}::date AND r."endDate" >= ${businessDate}::date)::int AS "running",
        count(*) FILTER (WHERE r."startDate" > ${businessDate}::date)::int AS "upcoming",
        count(*) FILTER (
          WHERE r."startDate" < ${businessDate}::date AND r."endDate" >= ${businessDate}::date
            AND (CASE WHEN r."metric" = 'NIGHTS' THEN r."progressNights"::numeric ELSE r."progressRevenue" END)
              < r."target" * (${businessDate}::date - r."startDate")::numeric / (r."endDate" - r."startDate" + 1)
                * (100 - ${BONUS_PACE_TOLERANCE_PCT}::numeric) / 100
        )::int AS "behind",
        count(*) FILTER (WHERE r."endDate" < ${businessDate}::date AND (b."id" IS NULL OR b."status" = 'DRAFT'))::int AS "awaitingSettlement"
      FROM "AgencyBonusRule" r
      LEFT JOIN "AgencyBonus" b ON b."ruleId" = r."id"
      WHERE r."hotelId" = ${hotelId} AND r."status" = 'ACTIVE'`,
    // Prim doğmadan kapanan (onaylı, tutarı sıfır) hak ediş "ödenecek" sayılmaz.
    prisma.agencyBonus.groupBy({
      by: ['status'],
      where: { hotelId, OR: [{ status: { in: ['DRAFT', 'PENDING_APPROVAL'] } }, { status: 'APPROVED', amount: { gt: 0 } }] },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.$queryRaw`
      SELECT count(*)::int AS "count", COALESCE(sum("amount"), 0)::text AS "amount"
      FROM "AgencyBonus"
      WHERE "hotelId" = ${hotelId} AND "status" = 'PAID' AND "paidAt" >= ${yearStart}::date`,
  ]);
  const byStatus = Object.fromEntries(bonuses.map((row) => [row.status, { count: row._count._all, amount: String(row._sum.amount ?? '0') }]));
  const of = (status) => ({ count: byStatus[status]?.count ?? 0, amount: toMoneyString(byStatus[status]?.amount ?? '0') });
  return {
    businessDate,
    currency: hotel.currency,
    rules: { running: rules.running, upcoming: rules.upcoming, behind: rules.behind, awaitingSettlement: rules.awaitingSettlement },
    bonuses: { draft: of('DRAFT'), pending: of('PENDING_APPROVAL'), approvedUnpaid: of('APPROVED'), paidThisYear: { count: paid.count, amount: toMoneyString(paid.amount) } },
  };
}
