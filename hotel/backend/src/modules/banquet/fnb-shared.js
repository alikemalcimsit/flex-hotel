import { randomUUID } from 'node:crypto';
import { ValidationError } from '../../lib/errors.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { quantityText } from '../recipes/graph.js';

/**
 * Banket F&B'nin (modül 43) set menü ile etkinlik menüsünün ortak parçaları: yemeklerin
 * doğrulanması, kursların yazımı, kurs biçimi ve mutfağa uyarı.
 */

/** Kursların okunduğu seçim (katalog ve etkinlik aynı şekil). */
export const COURSES_SELECT = Object.freeze({
  orderBy: { sortOrder: 'asc' },
  select: {
    id: true,
    name: true,
    mode: true,
    sortOrder: true,
    dishes: {
      orderBy: { sortOrder: 'asc' },
      select: { id: true, recipeId: true, label: true, portionsPerGuest: true, sortOrder: true, recipe: { select: { name: true, code: true, kind: true, station: true, isActive: true } } },
    },
  },
});

/**
 * Menünün yemekleri: reçete otelde, yemek (porsiyon verir), yeni eklenen aktif. Hatalar
 * `courses.i.dishes.j.recipeId` alanına bağlanır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {Array<{ dishes: Array<{ recipeId: string }> }>} courses
 * @param {Set<string>} previous menüde zaten olan reçeteler (pasife alınmış olsa da kalabilir)
 */
export async function assertDishes(tx, hotelId, courses, previous) {
  const ids = [...new Set(courses.flatMap((course) => course.dishes.map((dish) => dish.recipeId)))];
  const rows = await tx.recipe.findMany({ where: { hotelId, id: { in: ids } }, select: { id: true, name: true, kind: true, isActive: true } });
  const recipes = new Map(rows.map((row) => [row.id, row]));
  /** @type {Record<string, string>} */
  const fields = {};
  courses.forEach((course, i) =>
    course.dishes.forEach((dish, j) => {
      const recipe = recipes.get(dish.recipeId);
      const path = `courses.${i}.dishes.${j}.recipeId`;
      if (!recipe) fields[path] = 'Yemek bulunamadı';
      else if (recipe.kind !== 'DISH') fields[path] = `${recipe.name} ara ürün; menüye yemek (porsiyon veren reçete) girer`;
      else if (!recipe.isActive && !previous.has(recipe.id)) fields[path] = `${recipe.name} pasif; menüye eklenmez`;
    }),
  );
  const messages = Object.values(fields);
  if (messages.length) throw new ValidationError(`Menüde düzeltilmesi gereken yemekler var: ${messages[0]}${messages.length > 1 ? ` (+${messages.length - 1})` : ''}`, { fields });
  return recipes;
}

/**
 * Kursları ve yemekleri yazar (önceki kurslar silinmiş olmalı). İki toplu ekleme: kurs
 * kimlikleri burada üretilir, yemekler onlara bağlanır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ hotelId: string, kind: 'CATALOG' | 'EVENT', parentId: string, courses: any[] }} input
 */
export async function writeCourses(tx, { hotelId, kind, parentId, courses }) {
  const rows = courses.map((course, index) => ({ id: randomUUID(), hotelId, name: course.name, mode: course.mode, sortOrder: index }));
  const dishes = courses.flatMap((course, i) =>
    course.dishes.map((dish, j) => ({
      hotelId,
      courseId: rows[i].id,
      recipeId: dish.recipeId,
      label: dish.label ?? null,
      portionsPerGuest: dish.portionsPerGuest,
      sortOrder: j,
      ...(kind === 'EVENT' ? { eventMenuId: parentId, guestCount: dish.guestCount ?? null } : {}),
    })),
  );
  if (kind === 'CATALOG') {
    await tx.banquetMenuCourse.createMany({ data: rows.map((row) => ({ ...row, menuId: parentId })) });
    await tx.banquetMenuDish.createMany({ data: dishes });
  } else {
    await tx.eventMenuCourse.createMany({ data: rows.map((row) => ({ ...row, eventMenuId: parentId })) });
    await tx.eventMenuDish.createMany({ data: dishes });
  }
}

/** Denetim izinin menü özeti: "Ana yemek [CHOICE]: incik(kalan), levrek(85)". @param {any[]} courses */
export const coursesSummary = (courses) =>
  courses.map(
    (course) =>
      `${course.name} [${course.mode}]: ${course.dishes
        .map((dish) => `${dish.recipeId}${dish.guestCount ? `(${dish.guestCount})` : ''}${quantityText(dish.portionsPerGuest) === '1' ? '' : `×${quantityText(dish.portionsPerGuest)}`}`)
        .join(', ')}`,
  );

/**
 * Mutfağa (satın alma talebi açabilenlere) uyarı: kesin menü değişti, kişi / saat değişti,
 * iptal edilen etkinliğin açık talebi var. Aynı konu aynı anahtarla tek satırda toplanır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Function} stage
 * @param {{ hotelId: string, event: { id: string }, title: string, body: string, severity?: 'INFO' | 'WARNING', dedupeKey: string }} input
 */
export function kitchenAlert(tx, stage, { hotelId, event, title, body, severity = 'WARNING', dedupeKey }) {
  return raiseStaffAlert(tx, stage, {
    hotelId,
    kind: 'BANQUET',
    severity,
    title,
    body,
    link: `/etkinlikler/${event.id}?sekme=menu`,
    permission: PERMISSIONS.PURCHASING_REQUEST,
    entityType: 'Event',
    entityId: event.id,
    dedupeKey,
  });
}
