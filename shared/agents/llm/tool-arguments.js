/**
 * Modelin ürettiği araç argümanı (JSON metni) → nesne. Katı şema kullanılsa
 * da bozuk JSON gelebilir (kesilmiş cevap); o zaman araç çalıştırılmaz,
 * modele "argümanlar okunamadı" denir.
 *
 * @param {string} text
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, error: string }}
 */
export function parseToolArguments(text) {
  try {
    const value = JSON.parse(text || '{}');
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'Argümanlar bir nesne olmalı' };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, error: 'Argümanlar okunamadı (geçersiz JSON)' };
  }
}
