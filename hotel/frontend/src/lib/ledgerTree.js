/**
 * Genel muhasebe ağaç yardımcıları (modül 48): mizan ve hesap planı satırları kod sırasında, üst önce gelir
 * (`depth`, `parentId`). Daralt / genişlet ekranda yerel durumdur; sunucu düz liste verir, görünür satırlar
 * burada süzülür. Saf fonksiyonlar: test edilir, React'e bağlı değil.
 */

/**
 * Çocuğu olan hesapların kimlikleri (daralt / genişlet oku yalnız bunlarda çizilir).
 * @param {Array<{ id: string, parentId: string | null }>} rows
 * @returns {Set<string>}
 */
export function parentIdsOf(rows) {
  return new Set(rows.map((row) => row.parentId).filter(Boolean));
}

/**
 * Daraltılmış hesapların altındakileri gizler. Satırlar üst önce sıralı olduğundan tek geçiş yeter: üstü
 * daraltılmış ya da zaten gizli olan satır gizlenir (torunlar da).
 * @template {{ id: string, parentId: string | null }} T
 * @param {T[]} rows
 * @param {Set<string>} collapsed
 * @returns {T[]}
 */
export function visibleTreeRows(rows, collapsed) {
  const hidden = new Set();
  return rows.filter((row) => {
    if (row.parentId && (collapsed.has(row.parentId) || hidden.has(row.parentId))) {
      hidden.add(row.id);
      return false;
    }
    return true;
  });
}

/**
 * Kümeyi değiştirmeden bir kimliği ekler ya da çıkarır (daralt / genişlet).
 * @param {Set<string>} collapsed @param {string} id
 * @returns {Set<string>}
 */
export function toggleCollapsed(collapsed, id) {
  const next = new Set(collapsed);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Hareketsiz hesapları süzer; hareketli bir alt hesabın üstü de kalır (sunucu üst toplamları çocuklardan
 * türettiği için üstün `hasActivity` değeri çocuklarınkini kapsar; yine de güvene almak için üstler korunur).
 * @template {{ id: string, parentId: string | null, hasActivity?: boolean }} T
 * @param {T[]} rows
 * @returns {T[]}
 */
export function onlyActiveRows(rows) {
  const keep = new Set();
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const row of rows) {
    if (!row.hasActivity) continue;
    let cursor = row;
    while (cursor && !keep.has(cursor.id)) {
      keep.add(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
  }
  return rows.filter((row) => keep.has(row.id));
}

/**
 * İşaretli kapanış (borç − alacak) → mizanın iki kalan sütunu. Sıfır iki sütunda da boş.
 * @param {string | null | undefined} closing
 * @returns {{ debit: string, credit: string }}
 */
export function closingSides(closing) {
  const value = Number(closing ?? 0);
  if (value > 0) return { debit: String(closing), credit: '' };
  if (value < 0) return { debit: '', credit: String(closing).replace(/^-/, '') };
  return { debit: '', credit: '' };
}

/**
 * İşaretli bakiyenin okunuşu: "1.250,00 B" / "300,00 A"; sıfır "—". Biçimlendirme dışarıdan verilir.
 * @param {string | null | undefined} value
 * @param {(amount: string) => string} format
 */
export function signedBalanceText(value, format) {
  const number = Number(value ?? 0);
  if (number === 0) return '—';
  return number > 0 ? `${format(String(value))} B` : `${format(String(value).replace(/^-/, ''))} A`;
}
