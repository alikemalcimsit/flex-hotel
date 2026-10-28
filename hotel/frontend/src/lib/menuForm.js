import { courseGuests } from '@hotelos/hotel-contracts';

/**
 * Menü formlarının saf dönüşümleri (modül 43): set menü ve etkinlik menüsü kayıt ↔ form,
 * form → istek gövdesi, seçmeli kursun "kalan" önizlemesi, kurs / yemek ekleme ve sıralama.
 *
 * Doğrulama sözleşmenin şemasıyla (`validateWith`); hata yolları "courses.0.dishes.1.recipeId"
 * biçiminde gelir, editör satırları bu yolla eşler.
 */

let sequence = 0;
const nextKey = () => {
  sequence += 1;
  return `m${sequence}`;
};

/** @param {string} [name] @param {'ALL' | 'CHOICE'} [mode] */
export const emptyCourse = (name = '', mode = 'ALL') => ({ key: nextKey(), name, mode, dishes: [] });

/** Seçicinin yemeğinden satır. @param {{ id: string, name: string, allergens?: string[] }} recipe */
export const dishOf = (recipe) => ({ key: nextKey(), recipeId: recipe.id, recipeName: recipe.name, allergens: recipe.allergens ?? [], label: '', portionsPerGuest: '1', guestCount: '' });

/**
 * Katalog / etkinlik menüsünün kursları → form.
 * @param {Array<{ name: string, mode: string, dishes: any[] }>} courses
 */
export function coursesFormOf(courses) {
  return courses.map((course) => ({
    key: nextKey(),
    name: course.name,
    mode: course.mode,
    dishes: course.dishes.map((dish) => ({
      key: nextKey(),
      recipeId: dish.recipeId,
      recipeName: dish.recipe?.name ?? dish.recipeName ?? '',
      allergens: dish.allergens ?? [],
      label: dish.label ?? '',
      portionsPerGuest: dish.portionsPerGuest ?? '1',
      guestCount: dish.guestCount === null || dish.guestCount === undefined ? '' : String(dish.guestCount),
    })),
  }));
}

/**
 * Form → kurs gövdesi. Katalogda seçmeli kursun kişisi yoktur; etkinlikte boş kişi "kalan"dır.
 * @param {any[]} courses @param {{ withCounts: boolean }} options
 */
export function coursesPayloadOf(courses, { withCounts }) {
  return courses.map((course) => ({
    name: course.name.trim(),
    mode: course.mode,
    dishes: course.dishes.map((dish) => ({
      recipeId: dish.recipeId,
      label: dish.label.trim() || null,
      portionsPerGuest: String(dish.portionsPerGuest).trim() || '1',
      ...(withCounts ? { guestCount: course.mode === 'CHOICE' && String(dish.guestCount).trim() !== '' ? String(dish.guestCount).trim() : null } : {}),
    })),
  }));
}

/* ── Set menü ── */

export const EMPTY_CATALOG_FORM = Object.freeze({ code: '', name: '', description: '', pricePerPerson: '', taxCategory: 'FNB', minGuests: '', isActive: true, courses: [] });

/** @param {any} menu */
export function catalogFormOf(menu) {
  if (!menu) return { ...EMPTY_CATALOG_FORM, courses: [emptyCourse('Çorba'), emptyCourse('Ana yemek'), emptyCourse('Tatlı')] };
  return {
    code: menu.code ?? '',
    name: menu.name,
    description: menu.description ?? '',
    pricePerPerson: menu.pricePerPerson,
    taxCategory: menu.taxCategory,
    minGuests: menu.minGuests === null || menu.minGuests === undefined ? '' : String(menu.minGuests),
    isActive: menu.isActive,
    courses: coursesFormOf(menu.courses ?? []),
  };
}

/** @param {any} form @param {string | null} expectedUpdatedAt yeni menüde null */
export function catalogPayloadOf(form, expectedUpdatedAt) {
  return {
    ...(expectedUpdatedAt ? { expectedUpdatedAt, isActive: form.isActive } : {}),
    code: form.code.trim() || null,
    name: form.name.trim(),
    description: form.description.trim() || null,
    pricePerPerson: String(form.pricePerPerson).trim(),
    taxCategory: form.taxCategory,
    minGuests: String(form.minGuests).trim() || null,
    courses: coursesPayloadOf(form.courses, { withCounts: false }),
  };
}

/* ── Etkinlik menüsü ── */

/**
 * Yeni etkinlik menüsü: katalogdan (kopyası) ya da boş; servis anı oturumun başlangıcı.
 * @param {{ id: string, startLocal: string }} session @param {any | null} catalog
 */
export function eventMenuFromCatalog(session, catalog) {
  return {
    sessionId: session.id,
    sourceMenuId: catalog?.id ?? null,
    name: catalog?.name ?? '',
    serveAt: session.startLocal,
    guests: '',
    pricePerPerson: catalog?.pricePerPerson ?? '',
    discountPct: '0',
    taxCategory: catalog?.taxCategory ?? 'FNB',
    notes: '',
    courses: catalog ? coursesFormOf(catalog.courses) : [emptyCourse('Ana yemek')],
  };
}

/** Kayıtlı etkinlik menüsü → form. @param {any} menu */
export function eventMenuFormOf(menu) {
  return {
    sessionId: menu.session.id,
    sourceMenuId: menu.sourceMenu?.id ?? null,
    name: menu.name,
    serveAt: menu.serveLocal,
    guests: menu.guestsFixed === null || menu.guestsFixed === undefined ? '' : String(menu.guestsFixed),
    pricePerPerson: menu.pricePerPerson,
    discountPct: menu.discountPct,
    taxCategory: menu.taxCategory,
    notes: menu.notes ?? '',
    courses: coursesFormOf(menu.courses),
  };
}

/** @param {any} form @param {string} expectedUpdatedAt dosyanın sürüm damgası */
export function eventMenuPayloadOf(form, expectedUpdatedAt) {
  return {
    expectedUpdatedAt,
    sessionId: form.sessionId,
    sourceMenuId: form.sourceMenuId,
    name: form.name.trim(),
    serveAt: form.serveAt,
    guests: String(form.guests).trim() || null,
    pricePerPerson: String(form.pricePerPerson).trim(),
    discountPct: String(form.discountPct).trim() || '0',
    taxCategory: form.taxCategory,
    notes: form.notes.trim() || null,
    courses: coursesPayloadOf(form.courses, { withCounts: true }),
  };
}

/**
 * Seçmeli kursun önizlemesi: yemeklere düşen kişi ve sorun (sözleşmenin kuralıyla). Geçersiz
 * kişi metni 0 sayılır (şema ayrıca reddeder).
 * @param {{ mode: string, dishes: Array<{ guestCount: string }> }} course @param {number} guests
 */
export function coursePreview(course, guests) {
  const dishes = course.dishes.map((dish) => {
    const text = String(dish.guestCount ?? '').trim();
    if (text === '') return { guestCount: null };
    const value = Number(text);
    return { guestCount: Number.isInteger(value) && value > 0 ? value : 0 };
  });
  return courseGuests(course.mode, dishes, guests);
}

/** Listede öğeyi bir yukarı / aşağı taşır (sınırda değişmez). @template T @param {T[]} list @param {number} index @param {-1 | 1} delta */
export function moveItem(list, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
