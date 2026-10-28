import { currentActor } from '@hotelos/core';
import { MAX_EVENT_ITEMS, MAX_EVENT_MENUS, menuGuests, utcToZonedWallTime, zonedWallTimeToUtc } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';
import { quantityText } from '../recipes/graph.js';
import { assertProgramEditable, lockedEvent } from './events.js';
import { getEventFnb } from './fnb-read.js';
import { menuPortions } from './fnb-rules.js';
import { assertDishes, coursesSummary, kitchenAlert, writeCourses } from './fnb-shared.js';
import { hotelContext, loadEventSettings, money, prisma, recomputeEventTotals } from './shared.js';

/**
 * Etkinlik menüsü yazımları (modül 43). Hepsi **etkinlik kilidi** ve dosyanın sürüm damgasıyla
 * (`expectedUpdatedAt`) yapılır: menü, dosyanın kişi başı fiyat kalemini yazar ve toplamları
 * yeniden hesaplar (aynı transaction); kalem / oturum / kişi değiştiren işlemle yarışmaz.
 *
 * - **Kalem:** menü başına tek kalem (`EventItem.eventMenuId` tekil): Yiyecek, birim kişi; kişi
 *   sabit değilse "kişi başı" (faturalanacak kişiyle), sabitse o kadar kişi. Kalem tablosunda
 *   salt okunur; menü kaldırılınca kalem de gider.
 * - **Servis anı** oturumun içinde (duvar saatiyle girilir).
 * - **Kesinleştirme:** yalnızca kesin etkinlikte, sorunsuz menü (seçmeli sayıları tutuyor);
 *   kesin menü değişmez / kaldırılmaz, gerekçeyle yeniden açılır — mutfağa haber gider.
 */

/** Menü kalemlerinin sıra numarası serbest kalemlerin önünde (kalem tablosu 0'dan başlar). */
const MENU_ITEM_SORT_BASE = -1000;

/** @param {any} row */
const menuView = (row) => ({
  sessionId: row.sessionId,
  name: row.name,
  serveAt: row.serveAt instanceof Date ? row.serveAt.toISOString() : row.serveAt,
  guests: row.guests ?? null,
  pricePerPerson: money(row.pricePerPerson),
  discountPct: quantityText(row.discountPct ?? 0),
  taxCategory: row.taxCategory,
  courses: coursesSummary(row.courses),
});

/**
 * Menünün fiyat kalemi (yoksa açılır). Toplamlar çağıranın `recomputeEventTotals`'ında.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {{ hotelId: string, eventId: string, menu: any }} input
 */
async function upsertMenuItem(tx, { hotelId, eventId, menu }) {
  const perPerson = menu.guests === null;
  const data = {
    sessionId: menu.sessionId,
    category: 'FNB',
    description: menu.name,
    perPerson,
    quantity: String(menu.guests ?? 1),
    billedQuantity: String(menu.guests ?? 1),
    unit: 'PERSON',
    unitPrice: menu.pricePerPerson,
    discountPct: menu.discountPct,
    taxCategory: menu.taxCategory,
    sortOrder: MENU_ITEM_SORT_BASE + menu.sortOrder,
  };
  await tx.eventItem.upsert({
    where: { eventMenuId: menu.id },
    create: { hotelId, eventId, eventMenuId: menu.id, netAmount: '0', taxAmount: '0', total: '0', ...data },
    update: data,
  });
}

/**
 * Menü kilitli etkinlikte; kesinse değişmez.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} eventId @param {string} menuId
 */
async function existingMenu(tx, eventId, menuId) {
  const menu = await tx.eventMenu.findFirst({
    where: { id: menuId, eventId },
    select: {
      id: true,
      sessionId: true,
      name: true,
      serveAt: true,
      guests: true,
      pricePerPerson: true,
      discountPct: true,
      taxCategory: true,
      sortOrder: true,
      finalizedAt: true,
      finalizedBy: true,
      courses: { orderBy: { sortOrder: 'asc' }, select: { name: true, mode: true, dishes: { orderBy: { sortOrder: 'asc' }, select: { recipeId: true, portionsPerGuest: true, guestCount: true } } } },
    },
  });
  if (!menu) throw new NotFoundError('Menü bulunamadı');
  return menu;
}

/**
 * Menü ekler (`menuId` null) ya da değiştirir (içerik bütün olarak).
 *
 * @param {string} hotelId
 * @param {string} eventId
 * @param {string | null} menuId
 * @param {any} input `saveEventMenuSchema`
 * @param {{ withCost: boolean }} options
 */
export async function saveEventMenu(hotelId, eventId, menuId, input, options) {
  const actor = currentActor();
  const { timezone } = await hotelContext(hotelId);
  const { expectedUpdatedAt, courses, ...fields } = input;
  try {
    await writeWithEvents(async (tx, stage) => {
      const event = await lockedEvent(tx, hotelId, eventId, expectedUpdatedAt);
      assertProgramEditable(event, 'menü değişikliği');
      const before = menuId ? await existingMenu(tx, eventId, menuId) : null;
      if (before?.finalizedAt) throw new ConflictError('Menü mutfağa kesinleşti; değiştirmek için önce gerekçeyle yeniden açın', 'MENU_FINALIZED');
      if (!before) {
        const [menus, items] = await Promise.all([tx.eventMenu.count({ where: { eventId } }), tx.eventItem.count({ where: { eventId } })]);
        if (menus >= MAX_EVENT_MENUS) throw new ConflictError(`Bir etkinlikte en fazla ${MAX_EVENT_MENUS} menü olur`, 'LIMIT');
        if (items >= MAX_EVENT_ITEMS) throw new ConflictError(`Etkinlikte en fazla ${MAX_EVENT_ITEMS} kalem olur; menünün kalemi eklenemiyor`, 'LIMIT');
      }

      const session = await tx.eventSession.findFirst({ where: { id: fields.sessionId, eventId }, select: { id: true, startAt: true, endAt: true } });
      if (!session) throw new ValidationError('Oturum bu etkinliğin değil', { field: 'sessionId' });
      const serveAt = zonedWallTimeToUtc(fields.serveAt, timezone);
      if (!serveAt || serveAt < session.startAt || serveAt > session.endAt) {
        const range = `${utcToZonedWallTime(session.startAt, timezone).replace('T', ' ')} – ${utcToZonedWallTime(session.endAt, timezone).replace('T', ' ')}`;
        throw new ValidationError(`Servis saati oturumun içinde olmalı (${range})`, { field: 'serveAt' });
      }
      if (fields.sourceMenuId && !(await tx.banquetMenu.findFirst({ where: { id: fields.sourceMenuId, hotelId }, select: { id: true } }))) {
        throw new ValidationError('Set menü bulunamadı', { field: 'sourceMenuId' });
      }
      const previous = new Set((before?.courses ?? []).flatMap((course) => course.dishes.map((dish) => dish.recipeId)));
      await assertDishes(tx, hotelId, courses, previous);

      const sortOrder = before ? before.sortOrder : ((await tx.eventMenu.aggregate({ where: { eventId }, _max: { sortOrder: true } }))._max.sortOrder ?? -1) + 1;
      const data = {
        sessionId: fields.sessionId,
        sourceMenuId: fields.sourceMenuId ?? null,
        name: fields.name,
        serveAt,
        guests: fields.guests,
        pricePerPerson: fields.pricePerPerson,
        discountPct: fields.discountPct,
        taxCategory: fields.taxCategory,
        notes: fields.notes ?? null,
        sortOrder,
      };
      const menu = before
        ? await tx.eventMenu.update({ where: { id: before.id }, data, select: { id: true } })
        : await tx.eventMenu.create({ data: { hotelId, eventId, ...data, createdBy: actor }, select: { id: true } });
      if (before) await tx.eventMenuCourse.deleteMany({ where: { eventMenuId: before.id } });
      await writeCourses(tx, { hotelId, kind: 'EVENT', parentId: menu.id, courses });
      await upsertMenuItem(tx, { hotelId, eventId, menu: { id: menu.id, ...data } });
      await recomputeEventTotals(tx, hotelId, eventId);

      await recordAudit(tx, {
        hotelId,
        entity: 'EventMenu',
        entityId: menu.id,
        action: before ? 'UPDATE' : 'CREATE',
        before: before ? { event: event.code, ...menuView(before) } : null,
        after: { event: event.code, ...menuView({ ...data, courses }) },
      });
      await stage('banquet.event.changed', { hotelId, eventId, change: 'MENUS' });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getEventFnb(hotelId, eventId, options);
}

/**
 * Menüyü kaldırır (kalemi onunla gider). Kesin menü kaldırılmaz.
 * @param {string} hotelId @param {string} eventId @param {string} menuId @param {{ expectedUpdatedAt: Date }} input @param {{ withCost: boolean }} options
 */
export async function deleteEventMenu(hotelId, eventId, menuId, { expectedUpdatedAt }, options) {
  await writeWithEvents(async (tx, stage) => {
    const event = await lockedEvent(tx, hotelId, eventId, expectedUpdatedAt);
    assertProgramEditable(event, 'menü değişikliği');
    const menu = await existingMenu(tx, eventId, menuId);
    if (menu.finalizedAt) throw new ConflictError('Kesin menü kaldırılmaz; önce gerekçeyle yeniden açın', 'MENU_FINALIZED');
    await tx.eventMenu.delete({ where: { id: menuId } });
    await recomputeEventTotals(tx, hotelId, eventId);
    await recordAudit(tx, { hotelId, entity: 'EventMenu', entityId: menuId, action: 'DELETE', before: { event: event.code, ...menuView(menu) } });
    await stage('banquet.event.changed', { hotelId, eventId, change: 'MENUS' });
  });
  return getEventFnb(hotelId, eventId, options);
}

/**
 * Menüyü mutfağa kesinleştirir: etkinlik kesin, menüde yemek var, seçmeli sayılar tutuyor.
 * Mutfağa (talep açabilenlere) bilgi düşer.
 *
 * @param {string} hotelId @param {string} eventId @param {string} menuId @param {{ expectedUpdatedAt: Date }} input @param {{ withCost: boolean }} options
 */
export async function finalizeEventMenu(hotelId, eventId, menuId, { expectedUpdatedAt }, options) {
  const actor = currentActor();
  const [{ timezone }, settings] = await Promise.all([hotelContext(hotelId), loadEventSettings(prisma, hotelId)]);
  await writeWithEvents(async (tx, stage) => {
    const event = await lockedEvent(tx, hotelId, eventId, expectedUpdatedAt);
    if (event.status !== 'DEFINITE') throw new ConflictError('Menü kesin etkinlikte mutfağa kesinleştirilir', 'EVENT_STATUS');
    const menu = await existingMenu(tx, eventId, menuId);
    if (menu.finalizedAt) throw new ConflictError('Menü zaten kesin', 'MENU_FINALIZED');
    const billable = await tx.event.findFirst({ where: { id: eventId }, select: { billablePax: true } });
    const plan = menuPortions(
      { guests: menu.guests, courses: menu.courses.map((course) => ({ mode: course.mode, dishes: course.dishes.map((dish) => ({ ...dish, portionsPerGuest: String(dish.portionsPerGuest) })) })) },
      billable.billablePax,
      settings.overproductionPct,
    );
    if (plan.issues.length) throw new ValidationError(`Menü kesinleşemez: ${plan.issues.join(' · ')}`);
    await tx.eventMenu.update({ where: { id: menuId }, data: { finalizedAt: new Date(), finalizedBy: actor } });
    await recordAudit(tx, { hotelId, entity: 'EventMenu', entityId: menuId, action: 'UPDATE', before: { finalized: false }, after: { finalized: true, event: event.code, guests: plan.guests, productionGuests: plan.productionGuests } });
    await kitchenAlert(tx, stage, {
      hotelId,
      event,
      severity: 'INFO',
      title: `Menü mutfağa kesinleşti: ${event.code} ${menu.name}`,
      body: `${event.name} · ${utcToZonedWallTime(menu.serveAt, timezone).replace('T', ' ')} · ${menuGuests(menu.guests, billable.billablePax)} kişi (hazırlık ${plan.productionGuests}). Malzeme ihtiyacı talebe çevrilebilir.`,
      dedupeKey: `banquet-menu-final:${menuId}`,
    });
    await stage('banquet.event.changed', { hotelId, eventId, change: 'MENUS' });
  });
  return getEventFnb(hotelId, eventId, options);
}

/**
 * Kesin menüyü gerekçeyle yeniden açar; mutfağa uyarı (talep edilmiş malzeme varsa söylenir).
 * @param {string} hotelId @param {string} eventId @param {string} menuId @param {{ expectedUpdatedAt: Date, reason: string }} input @param {{ withCost: boolean }} options
 */
export async function reopenEventMenu(hotelId, eventId, menuId, { expectedUpdatedAt, reason }, options) {
  await writeWithEvents(async (tx, stage) => {
    const event = await lockedEvent(tx, hotelId, eventId, expectedUpdatedAt);
    assertProgramEditable(event, 'menü değişikliği');
    const menu = await existingMenu(tx, eventId, menuId);
    if (!menu.finalizedAt) throw new ConflictError('Menü kesin değil', 'MENU_NOT_FINALIZED');
    await tx.eventMenu.update({ where: { id: menuId }, data: { finalizedAt: null, finalizedBy: null } });
    const requested = await tx.purchaseRequestLine.count({ where: { hotelId, eventId, request: { status: { not: 'CANCELLED' } } } });
    await recordAudit(tx, { hotelId, entity: 'EventMenu', entityId: menuId, action: 'UPDATE', before: { finalized: true, finalizedBy: menu.finalizedBy }, after: { finalized: false, reason } });
    await kitchenAlert(tx, stage, {
      hotelId,
      event,
      title: `Kesin menü yeniden açıldı: ${event.code} ${menu.name}`,
      body: `Gerekçe: ${reason}.${requested ? ` Bu etkinlik için ${requested} satır malzeme talep edilmiş; menü değişirse eksik / fazla yeniden kontrol edilmeli.` : ''}`,
      dedupeKey: `banquet-menu-reopen:${menuId}`,
    });
    await stage('banquet.event.changed', { hotelId, eventId, change: 'MENUS' });
  });
  return getEventFnb(hotelId, eventId, options);
}
