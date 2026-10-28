import { MAX_COURSE_DISHES, MAX_MENU_COURSES, MENU_COURSE_MODES, MENU_COURSE_MODE_HINTS, MENU_COURSE_MODE_LABELS, POS_STATION_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Button, Icon } from '@hotelos/ui';
import { SearchPicker } from '../../components/SearchPicker.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { recipeKeys } from '../../lib/kitchen.js';
import { allergenText } from '../../lib/kitchenFormat.js';
import { coursePreview, dishOf, emptyCourse, moveItem } from '../../lib/menuForm.js';

const CELL = 'w-full rounded-item border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-ink disabled:opacity-60';
const cellClass = (error) => `${CELL} ${error ? 'border-sec-strong' : 'border-line-strong'}`;

/**
 * Menünün kursları ve yemekleri (set menü ve etkinlik menüsü ortak): kurs adı, türü (hepsi /
 * seçmeli), yemek seçici (aktif yemek reçeteleri), menüde görünen ad, kişi başı porsiyon; etkinlikte
 * seçmeli kursun kişi sayıları ve "kalan" önizlemesi (sözleşmenin kuralıyla).
 *
 * @param {{
 *   courses: any[],
 *   onChange: (courses: any[]) => void,
 *   withCounts: boolean,
 *   guests?: number | null,
 *   errors: Record<string, string>,
 *   disabled: boolean,
 *   currency?: string,
 * }} props `guests`: önizlemedeki menü kişisi (etkinlikte)
 */
export function CoursesEditor({ courses, onChange, withCounts, guests = null, errors, disabled, currency }) {
  const patchCourse = (key, changes) => onChange(courses.map((course) => (course.key === key ? { ...course, ...changes } : course)));
  const patchDish = (courseKey, dishKey, changes) =>
    onChange(courses.map((course) => (course.key === courseKey ? { ...course, dishes: course.dishes.map((dish) => (dish.key === dishKey ? { ...dish, ...changes } : dish)) } : course)));
  const totalDishes = courses.reduce((total, course) => total + course.dishes.length, 0);

  return (
    <div className="flex flex-col gap-4">
      {errors.courses && <Alert tone="danger">{errors.courses}</Alert>}
      {courses.map((course, i) => {
        const preview = withCounts && guests ? coursePreview(course, guests) : null;
        const usedIds = new Set(course.dishes.map((dish) => dish.recipeId));
        return (
          <section key={course.key} aria-label={course.name || `Kurs ${i + 1}`} className="rounded-panel border border-line p-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-48 flex-1 flex-col gap-1.5">
                <span className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Kurs</span>
                <input value={course.name} placeholder="Çorba, ara sıcak, ana yemek…" onChange={(event) => patchCourse(course.key, { name: event.target.value })} disabled={disabled} className={cellClass(errors[`courses.${i}.name`])} />
                {errors[`courses.${i}.name`] && <span className="text-xs text-sec-strong">{errors[`courses.${i}.name`]}</span>}
              </label>
              <label className="flex w-48 flex-col gap-1.5">
                <span className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Tür</span>
                <select value={course.mode} onChange={(event) => patchCourse(course.key, { mode: event.target.value })} disabled={disabled} className={cellClass(errors[`courses.${i}.mode`])}>
                  {MENU_COURSE_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {MENU_COURSE_MODE_LABELS[mode]}
                    </option>
                  ))}
                </select>
              </label>
              {!disabled && (
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant="ghost" icon="chevronDown" className="rotate-180" aria-label="Kursu yukarı al" onClick={() => onChange(moveItem(courses, i, -1))} disabled={i === 0} />
                  <Button type="button" size="sm" variant="ghost" icon="chevronDown" aria-label="Kursu aşağı al" onClick={() => onChange(moveItem(courses, i, 1))} disabled={i === courses.length - 1} />
                  <Button type="button" size="sm" variant="ghost" icon="trash" aria-label="Kursu kaldır" onClick={() => onChange(courses.filter((entry) => entry.key !== course.key))} />
                </div>
              )}
            </div>
            <p className="mt-1 text-xs text-ink-muted">{MENU_COURSE_MODE_HINTS[course.mode]}</p>
            {errors[`courses.${i}.dishes`] && <p className="mt-1 text-xs font-semibold text-sec-strong">{errors[`courses.${i}.dishes`]}</p>}
            {preview?.issue && <p className="mt-1 text-xs font-semibold text-warning-ink">{preview.issue}</p>}

            {course.dishes.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                    <tr>
                      <th className="py-1.5 pr-2">Yemek</th>
                      <th className="py-1.5 pr-2">Menüde görünen ad</th>
                      <th className="w-28 py-1.5 pr-2">Kişi başı porsiyon</th>
                      {withCounts && course.mode === 'CHOICE' && <th className="w-28 py-1.5 pr-2">Kişi</th>}
                      {preview && <th className="w-20 py-1.5 pr-2 text-right">Servis</th>}
                      {!disabled && <th className="w-24 py-1.5" />}
                    </tr>
                  </thead>
                  <tbody>
                    {course.dishes.map((dish, j) => {
                      const path = `courses.${i}.dishes.${j}`;
                      return (
                        <tr key={dish.key} className="border-t border-line align-top">
                          <td className="py-2 pr-2">
                            <span className="block font-semibold text-ink">{dish.recipeName}</span>
                            <span className="block text-xs text-ink-muted">{allergenText(dish.allergens)}</span>
                            {errors[`${path}.recipeId`] && <span className="block text-xs font-semibold text-sec-strong">{errors[`${path}.recipeId`]}</span>}
                          </td>
                          <td className="py-2 pr-2">
                            <input aria-label="Menüde görünen ad" value={dish.label} placeholder={dish.recipeName} onChange={(event) => patchDish(course.key, dish.key, { label: event.target.value })} disabled={disabled} className={cellClass(errors[`${path}.label`])} />
                          </td>
                          <td className="py-2 pr-2">
                            <input aria-label="Kişi başı porsiyon" inputMode="decimal" value={dish.portionsPerGuest} onChange={(event) => patchDish(course.key, dish.key, { portionsPerGuest: event.target.value })} disabled={disabled} className={cellClass(errors[`${path}.portionsPerGuest`])} />
                            {errors[`${path}.portionsPerGuest`] && <span className="block text-xs text-sec-strong">{errors[`${path}.portionsPerGuest`]}</span>}
                          </td>
                          {withCounts && course.mode === 'CHOICE' && (
                            <td className="py-2 pr-2">
                              <input aria-label="Bu yemeği alacak kişi" inputMode="numeric" value={dish.guestCount} placeholder="kalan" onChange={(event) => patchDish(course.key, dish.key, { guestCount: event.target.value })} disabled={disabled} className={cellClass(errors[`${path}.guestCount`])} />
                              {errors[`${path}.guestCount`] && <span className="block text-xs text-sec-strong">{errors[`${path}.guestCount`]}</span>}
                            </td>
                          )}
                          {preview && <td className="py-2 pr-2 text-right tabular-nums text-ink-soft">{preview.counts[j]} kişi</td>}
                          {!disabled && (
                            <td className="py-2">
                              <div className="flex justify-end gap-1">
                                <Button type="button" size="sm" variant="ghost" icon="chevronDown" className="rotate-180" aria-label="Yukarı" onClick={() => patchCourse(course.key, { dishes: moveItem(course.dishes, j, -1) })} disabled={j === 0} />
                                <Button type="button" size="sm" variant="ghost" icon="chevronDown" aria-label="Aşağı" onClick={() => patchCourse(course.key, { dishes: moveItem(course.dishes, j, 1) })} disabled={j === course.dishes.length - 1} />
                                <Button type="button" size="sm" variant="ghost" icon="trash" aria-label="Yemeği kaldır" onClick={() => patchCourse(course.key, { dishes: course.dishes.filter((entry) => entry.key !== dish.key) })} />
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!disabled && course.dishes.length < MAX_COURSE_DISHES && (
              <div className="mt-3 max-w-xl">
                <SearchPicker
                  label="Yemek ekle"
                  placeholder="Yemek reçetesi ara"
                  queryOf={(search) => ({ queryKey: recipeKeys.picker({ search, kind: 'DISH' }), queryFn: () => api(withQuery('/recipes/picker', { search: search || undefined, kind: 'DISH' })) })}
                  renderItem={(recipe) => (
                    <span>
                      <span className="font-semibold">{recipe.name}</span>{' '}
                      <span className="text-xs text-ink-muted">
                        · {POS_STATION_LABELS[recipe.station]}
                        {recipe.costPerUnit ? ` · porsiyon ${formatMoney(recipe.costPerUnit, currency)}` : ''}
                        {recipe.allergens.length ? ` · ${allergenText(recipe.allergens)}` : ''}
                      </span>
                    </span>
                  )}
                  isDisabled={(recipe) => (usedIds.has(recipe.id) ? 'kursta var' : null)}
                  onPick={(recipe) => patchCourse(course.key, { dishes: [...course.dishes, dishOf(recipe)] })}
                  emptyText="Aktif yemek reçetesi bulunamadı"
                />
              </div>
            )}
          </section>
        );
      })}
      {!disabled && courses.length < MAX_MENU_COURSES && (
        <div>
          <Button type="button" variant="outline" icon="plus" onClick={() => onChange([...courses, emptyCourse()])}>
            Kurs ekle
          </Button>
          <span className="ml-3 text-xs text-ink-muted">
            <Icon name="info" className="mr-1 inline size-3.5" />
            {totalDishes} yemek
          </span>
        </div>
      )}
    </div>
  );
}
