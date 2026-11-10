import { randomBytes, randomUUID } from 'node:crypto';
import { runWithContext, toIsoDay } from '@hotelos/core';
import { addSurveyDays, guestPortalLanguageFor, midStaySurveyDue, postStaySurveyDue, SURVEY_SEND_GRACE_DAYS } from '@hotelos/hotel-contracts';
import { writeWithEvents } from '../../lib/write.js';
import { enqueueTriggerNotifications, ensureTriggerTemplates, triggerReachability } from '../notifications/service.js';
import { ensureSurvey } from './design.js';
import { SURVEY_SYSTEM_ACTOR, absoluteUrl, dayStart, loadSurveySettings, localDay, prisma, publicBaseUrl, surveyClock, surveyPath } from './shared.js';

/**
 * Anket davetleri (modül 55): zamanlanmış iş (30 dakikada bir), modül 9'un kanallarıyla.
 *
 * - **Çıkış sonrası:** çıkış yapmış konaklamaya, çıkış gününden `postStayDelayDays` gün sonra saat `postStaySendHour`'dan
 *   itibaren (iş gecikmişse en fazla iki gün geç).
 * - **Ara anket:** içerideki, en az `midStayMinNights` gecelik konaklamaya girişin ertesi günü `midStaySendHour`'dan
 *   itibaren; ayrılış gününe gitmez.
 * - Aynı misafire aynı tür anket `minDaysBetweenSurveys` günden sık gitmez (sık gelen kurumsal misafir); aynı turda
 *   aynı misafirin iki odası tek anket alır.
 * - Davet bir kanala satır açılınca "gitti" sayılır: misafir kartında iletişim yoksa ya da kuyruğa yazılamazsa davet
 *   silinir, pencere sürüyorsa sonraki turda yeniden denenir. Açık kanal + etkin şablon yoksa ya da otelin herkese açık
 *   adresi (portal ayarı) yoksa tur başlamaz.
 * - Adaylar `[hotelId, checkedOutAt]` / `[hotelId, checkedInAt]` indeksleriyle dar zaman aralığından seçilir;
 *   ayıklama parça içinde `IN` ile. Tur zaman bütçelidir.
 */

const BATCH = 200;
const BUDGET_MS = 60_000;
const TRIGGERS = Object.freeze({ POST_STAY: 'SURVEY_POST_STAY', MID_STAY: 'SURVEY_MID_STAY' });
const DAY_MS = 86_400_000;

/**
 * Daveti açar ve bildirimi kuyruğa koyar; hiçbir kanala satır açılmazsa davet silinir (sonraki turda yeniden).
 * @param {string} hotelId @param {{ id: string }} survey @param {'POST_STAY' | 'MID_STAY'} kind
 * @param {{ id: string, guestId: string, guest: { nationality: string | null } }} reservation
 * @param {{ baseUrl: string, linkValidDays: number, now: Date }} options
 * @returns {Promise<boolean>} gönderildi mi
 */
async function inviteOne(hotelId, survey, kind, reservation, { baseUrl, linkValidDays, now }) {
  let invitation;
  try {
    invitation = await writeWithEvents(async (tx) =>
      tx.surveyInvitation.create({
        data: {
          hotelId,
          surveyId: survey.id,
          kind,
          reservationId: reservation.id,
          guestId: reservation.guestId,
          nonce: randomBytes(24).toString('base64url'),
          language: guestPortalLanguageFor(reservation.guest?.nationality),
          sentAt: now,
          expiresAt: new Date(now.getTime() + linkValidDays * DAY_MS),
        },
        select: { id: true, nonce: true },
      }),
    );
  } catch (error) {
    // Aynı rezervasyona aynı tür davet zaten var (eşzamanlı iki tur): dokunma.
    if (error?.code === 'P2002') return false;
    throw error;
  }
  const release = () => prisma.surveyInvitation.deleteMany({ where: { id: invitation.id, status: 'SENT', openedAt: null } });
  let result;
  try {
    result = await enqueueTriggerNotifications(hotelId, TRIGGERS[kind], { reservationId: reservation.id, extraValues: { anketLinki: absoluteUrl(baseUrl, surveyPath(invitation)) } });
  } catch (error) {
    await release();
    throw error;
  }
  if (!result.queued.length && !result.duplicates) {
    await release();
    return false;
  }
  return true;
}

/**
 * Bir türün turu.
 * @param {string} hotelId @param {'POST_STAY' | 'MID_STAY'} kind @param {any} settings @param {{ timezone: string, today: string, hour: number, now: Date }} clock
 * @param {string} baseUrl @param {Set<string>} invitedGuests bu turda anket alan misafirler @param {number} deadline
 */
async function sendKind(hotelId, kind, settings, clock, baseUrl, invitedGuests, deadline) {
  const trigger = TRIGGERS[kind];
  await ensureTriggerTemplates(hotelId, trigger);
  const reachable = await triggerReachability(hotelId, trigger);
  if (!reachable) return 0;
  const survey = await ensureSurvey(hotelId, kind);
  if (!(await prisma.surveyQuestion.count({ where: { surveyId: survey.id, archivedAt: null } }))) return 0;

  const { timezone, today, hour, now } = clock;
  // Penceredeki konaklamalar: çıkış sonrası için çıkış anı, ara anket için giriş anı (otel gününe göre dar aralık).
  const window =
    kind === 'POST_STAY'
      ? {
          status: 'CHECKED_OUT',
          checkedOutAt: { gte: dayStart(addSurveyDays(today, -settings.postStayDelayDays - SURVEY_SEND_GRACE_DAYS), timezone), lt: dayStart(addSurveyDays(today, -settings.postStayDelayDays + 1), timezone) },
        }
      : { status: 'CHECKED_IN', checkedInAt: { gte: dayStart(addSurveyDays(today, -2), timezone), lt: dayStart(today, timezone) } };
  const field = kind === 'POST_STAY' ? 'checkedOutAt' : 'checkedInAt';
  const since = new Date(now.getTime() - settings.minDaysBetweenSurveys * DAY_MS);
  let sent = 0;
  /** @type {{ id: string, at: Date } | null} */
  let cursor = null;
  for (;;) {
    const batch = await prisma.reservation.findMany({
      where: {
        hotelId,
        ...window,
        ...(cursor ? { OR: [{ [field]: { gt: cursor.at } }, { [field]: cursor.at, id: { gt: cursor.id } }] } : {}),
      },
      orderBy: [{ [field]: 'asc' }, { id: 'asc' }],
      take: BATCH,
      select: { id: true, guestId: true, checkIn: true, checkOut: true, checkedInAt: true, checkedOutAt: true, guest: { select: { email: true, phone: true, nationality: true } } },
    });
    if (!batch.length) return sent;
    const last = batch[batch.length - 1];
    cursor = { id: last.id, at: /** @type {Date} */ (last[field]) };

    const due = batch.filter((row) => {
      if (!reachable(row.guest)) return false;
      if (kind === 'POST_STAY') return postStaySurveyDue({ departureDay: localDay(/** @type {Date} */ (row.checkedOutAt), timezone), today, hour, settings });
      return midStaySurveyDue({ arrivalDay: localDay(/** @type {Date} */ (row.checkedInAt), timezone), departureDay: toIsoDay(row.checkOut), today, hour, settings });
    });
    if (due.length) {
      const [existing, recent] = await Promise.all([
        prisma.surveyInvitation.findMany({ where: { hotelId, kind, reservationId: { in: due.map((row) => row.id) } }, select: { reservationId: true } }),
        settings.minDaysBetweenSurveys > 0
          ? prisma.surveyInvitation.findMany({ where: { hotelId, kind, guestId: { in: [...new Set(due.map((row) => row.guestId))] }, sentAt: { gte: since } }, select: { guestId: true } })
          : [],
      ]);
      const invited = new Set(existing.map((row) => row.reservationId));
      const recentGuests = new Set(recent.map((row) => row.guestId));
      for (const row of due) {
        if (Date.now() > deadline) return sent;
        if (invited.has(row.id) || recentGuests.has(row.guestId) || invitedGuests.has(`${kind}:${row.guestId}`)) continue;
        if (await inviteOne(hotelId, survey, kind, row, { baseUrl, linkValidDays: settings.linkValidDays, now })) {
          sent += 1;
          invitedGuests.add(`${kind}:${row.guestId}`);
        }
      }
    }
    if (batch.length < BATCH || Date.now() > deadline) return sent;
  }
}

/**
 * Bir otelin anket turu.
 * @param {string} hotelId @param {{ now?: Date, budgetMs?: number }} [options]
 * @returns {Promise<{ postStay: number, midStay: number }>} gönderilen davet
 */
export async function sendDueSurveys(hotelId, { now = new Date(), budgetMs = BUDGET_MS } = {}) {
  const settings = await loadSurveySettings(prisma, hotelId);
  const result = { postStay: 0, midStay: 0 };
  if (!settings.postStayEnabled && !settings.midStayEnabled) return result;
  const baseUrl = await publicBaseUrl(hotelId);
  if (!baseUrl) return result;
  const clock = await surveyClock(hotelId, now);
  const deadline = Date.now() + budgetMs;
  const invitedGuests = new Set();
  // Ara anket önce: içerideki misafir beklemesin.
  if (settings.midStayEnabled) result.midStay = await sendKind(hotelId, 'MID_STAY', settings, clock, baseUrl, invitedGuests, deadline);
  if (settings.postStayEnabled && Date.now() < deadline) result.postStay = await sendKind(hotelId, 'POST_STAY', settings, clock, baseUrl, invitedGuests, deadline);
  return result;
}

/**
 * Bütün otellerin turu (zamanlanmış iş). Bir otelin hatası diğerlerini durdurmaz.
 * @param {{ error?: Function }} [logger]
 */
export async function runSurveyJob(logger = console) {
  const hotels = await prisma.surveySettings.findMany({ where: { OR: [{ postStayEnabled: true }, { midStayEnabled: true }] }, select: { hotelId: true } });
  let total = 0;
  for (const { hotelId } of hotels) {
    try {
      const result = await runWithContext({ correlationId: randomUUID(), actor: SURVEY_SYSTEM_ACTOR }, () => sendDueSurveys(hotelId));
      total += result.postStay + result.midStay;
    } catch (error) {
      logger.error?.({ err: error, hotelId }, 'Anket davetleri gönderilemedi');
    }
  }
  return total;
}
