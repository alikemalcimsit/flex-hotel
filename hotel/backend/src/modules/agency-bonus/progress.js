import { toIsoDay } from '@hotelos/core';
import { formatBonusQuantity } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { SQL_NOW } from '../../lib/sql-time.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { loadProductionTotals } from './queries.js';
import { achievedOf, reachedTier, scorePct } from './rules.js';
import { dateOnly, nonNegativeMoney, specOf, termsOf } from './shared.js';

/**
 * Acente hedef ilerlemesinin özeti ve kademe uyarısı (modül 35).
 *
 * Liste ekranı yüzlerce kuralı hedefe ulaşmaya göre sıralar; her açılışta
 * hepsinin üretimini canlı hesaplamak yerine zamanlanmış iş kural başına
 * gerçekleşen gece / vergisiz ciro / puan / ulaşılan kademeyi yazar (kural
 * ekranı ayrıca canlı hesaplar). Gerçekleşen üretim gece kapanışı, giriş /
 * çıkış ve folyo düzeltmeleriyle değişir; yarım saatlik tazeleme yeterlidir.
 *
 * - Yazım **ham SQL**'dir ve `updatedAt`'e dokunmaz: formda açık kuralın sürüm
 *   kontrolü özet yazımıyla bozulmaz.
 * - Okuma ile yazma arasında kural düzenlendiyse (sürüm değişti) o satır bu
 *   turda yazılmaz (eski hedefle hesaplanmış puan yeni hedefin üstüne düşmesin).
 * - Ulaşılan kademe **yükselirse** (gerçekleşen üretimle) yetkililere bir kez uyarı
 *   düşer (`agency.bonus.tier_reached`); düşerse (iptal, düzeltme) sessizce yazılır.
 * - Hak edişi onaya gitmiş / onaylı / ödenmiş kural tazelenmez (dönem kapandı).
 *
 * Kurallar paketler hâlinde okunur (imleç: id); her paket tek üretim
 * sorgusudur (N+1 yok).
 */

/** Bir pakette okunan kural (tek üretim sorgusuna giden). */
const PROGRESS_BATCH = 500;
/** Bir turda otomatik hesaplanan en fazla hak ediş (kalanı sonraki turda). */
const SETTLE_BATCH = 20;

/**
 * @param {string} hotelId
 * @param {{ ruleIds?: string[] | null, announce?: boolean, businessDate?: string }} [options]
 * @returns {Promise<{ rules: number, changed: number, tierUps: number }>}
 */
export async function refreshProgress(hotelId, { ruleIds = null, announce = true, businessDate } = {}) {
  const today = businessDate ?? toIsoDay(await getBusinessDate(hotelId));
  let cursor = null;
  const summary = { rules: 0, changed: 0, tierUps: 0 };

  for (;;) {
    const rules = await prisma.agencyBonusRule.findMany({
      where: {
        hotelId,
        status: 'ACTIVE',
        // Tur başlamamış dönemi atlar; tek kural tazelemesi (düzenleme sonrası) atlamaz: başlangıcı
        // ileri alınan kuralın eski puanı sıralamada kalmasın (başlamamış dönemin üretimi sıfırdır).
        ...(ruleIds ? {} : { startDate: { lt: dateOnly(today) } }),
        OR: [{ bonus: { is: null } }, { bonus: { is: { status: 'DRAFT' } } }],
        ...(ruleIds ? { id: { in: ruleIds } } : {}),
        ...(cursor ? { id: { gt: cursor, ...(ruleIds ? { in: ruleIds } : {}) } } : {}),
      },
      orderBy: { id: 'asc' },
      take: PROGRESS_BATCH,
      select: {
        id: true,
        agencyId: true,
        name: true,
        startDate: true,
        endDate: true,
        roomTypeIds: true,
        metric: true,
        mode: true,
        target: true,
        tiers: true,
        maxBonus: true,
        currency: true,
        progressNights: true,
        progressRevenue: true,
        progressScore: true,
        reachedTier: true,
        updatedAt: true,
        agency: { select: { name: true } },
      },
    });
    if (rules.length === 0) break;
    cursor = rules[rules.length - 1].id;
    summary.rules += rules.length;

    const totals = await loadProductionTotals(prisma, hotelId, rules.map(specOf), today);
    const rows = rules.map((rule) => {
      const terms = termsOf(rule);
      const total = totals.get(rule.id) ?? { nights: 0, revenue: '0' };
      const revenue = nonNegativeMoney(total.revenue);
      const achieved = achievedOf(rule.metric, { nights: total.nights, revenue });
      const tier = reachedTier(terms.tiers, achieved);
      return {
        rule,
        terms,
        next: { id: rule.id, version: rule.updatedAt.toISOString(), nights: total.nights, revenue, score: scorePct(achieved, terms.target), tier },
        changed:
          total.nights !== rule.progressNights ||
          revenue !== nonNegativeMoney(String(rule.progressRevenue)) ||
          tier !== rule.reachedTier,
      };
    });
    const tierUps = announce ? rows.filter((row) => row.next.tier > row.rule.reachedTier) : [];
    summary.changed += rows.filter((row) => row.changed).length;

    await writeWithEvents(async (tx, stage) => {
      const written = await tx.$queryRaw`
        UPDATE "AgencyBonusRule" AS r
        SET "progressNights" = v."nights",
            "progressRevenue" = v."revenue",
            "progressScore" = v."score",
            "reachedTier" = v."tier",
            "progressAt" = ${SQL_NOW}
        FROM jsonb_to_recordset(${JSON.stringify(rows.map((row) => row.next))}::jsonb)
             AS v("id" text, "version" timestamp, "nights" int, "revenue" numeric, "score" numeric, "tier" int)
        WHERE r."id" = v."id" AND r."hotelId" = ${hotelId} AND r."updatedAt" = v."version"
        RETURNING r."id"`;
      const writtenIds = new Set(/** @type {Array<{ id: string }>} */ (written).map((row) => row.id));

      for (const { rule, terms, next } of tierUps) {
        if (!writtenIds.has(rule.id)) continue;
        const tier = terms.tiers[next.tier - 1];
        summary.tierUps += 1;
        await stage('agency.bonus.tier_reached', { hotelId, ruleId: rule.id, agencyId: rule.agencyId, tier: next.tier });
        await raiseStaffAlert(tx, stage, {
          hotelId,
          kind: 'AGENCY_BONUS',
          severity: 'INFO',
          title: `${rule.agency.name} ${next.tier}. prim kademesine ulaştı`,
          body: `${rule.name}: gerçekleşen ${formatBonusQuantity(rule.metric, rule.metric === 'NIGHTS' ? next.nights : next.revenue, rule.currency)} (eşik ${formatBonusQuantity(rule.metric, tier.threshold, rule.currency)}, oran %${tier.ratePct.replace('.', ',')}). Hedefe ulaşma %${next.score.replace('.', ',')}.`,
          link: `/acente-primleri/kural/${rule.id}`,
          permission: PERMISSIONS.AGENCY_BONUS_VIEW,
          entityType: 'AgencyBonusRule',
          entityId: rule.id,
          dedupeKey: `agency-bonus-tier:${rule.id}:${next.tier}`,
        });
      }
      const changed = rows.filter((row) => row.changed && writtenIds.has(row.rule.id)).length;
      if (changed > 0) await stage('agency.bonus.progress.refreshed', { hotelId, rules: changed });
    });

    if (rules.length < PROGRESS_BATCH) break;
  }
  return summary;
}

/**
 * Dönemi biten (son gecesi kapanan) yürürlükteki kuralların hak edişini
 * hesaplar. Bir turda en fazla `SETTLE_BATCH`; hesaplanan kural bir daha
 * seçilmez (hak edişi var).
 *
 * @param {string} hotelId
 * @param {{ calculate: (hotelId: string, ruleId: string, options: { automatic: true }) => Promise<unknown>, logger?: { warn: Function }, businessDate?: string }} deps
 * @returns {Promise<number>} hesaplanan hak ediş
 */
export async function settleDueRules(hotelId, { calculate, logger, businessDate }) {
  const today = businessDate ?? toIsoDay(await getBusinessDate(hotelId));
  const due = await prisma.agencyBonusRule.findMany({
    where: { hotelId, status: 'ACTIVE', endDate: { lt: dateOnly(today) }, bonus: { is: null } },
    orderBy: [{ endDate: 'asc' }, { id: 'asc' }],
    take: SETTLE_BATCH,
    select: { id: true },
  });
  let settled = 0;
  for (const rule of due) {
    try {
      if (await calculate(hotelId, rule.id, { automatic: true })) settled += 1;
    } catch (error) {
      logger?.warn?.({ err: error, hotelId, ruleId: rule.id }, 'Acente prim hak edişi hesaplanamadı');
    }
  }
  return settled;
}
