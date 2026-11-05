import { payrollPeriodLabel } from '@hotelos/hotel-contracts';

/** Bordro dönem seçicisinin saf yardımcıları (modül 51; api bilmez, Node testinde koşar). */

/** Son 24 ay + gelecek ay: dönem seçicisi. @param {string} today "YYYY-AA-GG" */
export function periodOptions(today) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const options = [];
  for (let offset = 1; offset >= -24; offset -= 1) {
    const index = year * 12 + (month - 1) + offset;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    options.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: payrollPeriodLabel(y, m), year: y, month: m });
  }
  return options;
}

/** "2026-03" → { year, month }. @param {string} value */
export const parsePeriod = (value) => ({ year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) });
