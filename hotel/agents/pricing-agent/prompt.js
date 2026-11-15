/**
 * Fiyat ajanının istemi ve çıktı doğrulaması (saf, birim testli).
 *
 * Model yalnızca sistemin topladığı sayıları görür (doluluk, kalan gün, geçen
 * yıl, eşikler, bekleyen dönemler) — kişisel veri yok. Çıktı katı JSON'dur;
 * her öneri burada doğrulanır: bilinmeyen oda tipi, pencere dışı tarih,
 * emniyet aralığı dışı yüzde ya da bekleyen dönemle çakışma **önerinin
 * tamamını değil yalnız o satırı** düşürür (LLM hatası onay kuyruğuna
 * taşmaz).
 */

/** Tek değerlendirmede en fazla öneri (onay kuyruğu boğulmasın). */
export const MAX_AGENT_SUGGESTIONS = 5;
/** Yüzde emniyet aralığı (çarpan 0.5–3 ile aynı). */
export const MIN_PCT = -50;
export const MAX_PCT = 100;
/** Modelin çıktı üst sınırı (token): 5 öneri + gerekçeler. */
export const MAX_OUTPUT_TOKENS = 700;

export const PRICING_SYSTEM_PROMPT = [
  'Sen bir otelin gelir yönetimi (yield) analistisin. Görevin verilen doluluk verisinden fiyat önerileri üretmek.',
  'Kurallar:',
  "- Yalnızca sana verilen JSON'daki sayıları kullan; tahmin uydurma, yeni rakam hesaplama.",
  '- Mekanik eşik kuralları (settings) sistemde zaten çalışıyor; sen eşiklerin yakalayamadığı örüntülere bak:',
  '  geçen yıla göre belirgin fark, hafta sonu / ardışık yoğun günler, erken dolan dönemler, son dakika boşluklar.',
  '- pendingPeriods içindeki oda tipi + tarih aralıklarıyla çakışan öneri VERME (zaten onay bekliyor).',
  `- En fazla ${MAX_AGENT_SUGGESTIONS} öneri; her biri tek oda tipi ve ardışık bir tarih aralığı.`,
  `- adjustmentPct ${MIN_PCT} ile ${MAX_PCT} arasında tam sayı (artış +, indirim −).`,
  '- reason: Türkçe, 1-2 cümle, verilen sayılara dayanan gerekçe (doluluk yüzdesi, kalan gün, geçen yıl karşılaştırması).',
  '- Öneri yoksa boş liste dön. Çıktı YALNIZCA şu JSON: {"suggestions":[{"roomTypeId":"...","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","adjustmentPct":10,"reason":"..."}]}',
].join('\n');

/**
 * Model mesajları.
 * @param {object} inputs `agentReviewInputs` çıktısı
 */
export function buildPricingMessages(inputs) {
  return [
    { role: 'system', content: PRICING_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(inputs) },
  ];
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * Model çıktısını güvenle ayrıştırır ve satır satır doğrular.
 *
 * @param {string | null | undefined} text model çıktısı
 * @param {{ roomTypes: Array<{ id: string }>, today: string, horizonDays: number, pendingPeriods: Array<{ roomTypeId: string, startDate: string, endDate: string }> }} inputs
 * @returns {{ accepted: Array<{ roomTypeId: string, startDate: string, endDate: string, multiplier: string, reason: string }>, dropped: number }}
 */
export function parseAgentSuggestions(text, inputs) {
  const empty = { accepted: [], dropped: 0 };
  if (typeof text !== 'string') return empty;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return empty;

  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return empty;
  }
  const rows = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
  const typeIds = new Set(inputs.roomTypes.map((type) => type.id));
  const windowStart = Date.parse(`${inputs.today}T00:00:00.000Z`);
  const windowEnd = windowStart + inputs.horizonDays * DAY_MS;

  const accepted = [];
  let dropped = 0;
  for (const row of rows.slice(0, MAX_AGENT_SUGGESTIONS)) {
    const pct = Number(row?.adjustmentPct);
    const valid =
      row &&
      typeIds.has(row.roomTypeId) &&
      ISO_DAY.test(String(row.startDate)) &&
      ISO_DAY.test(String(row.endDate)) &&
      Number.isInteger(pct) &&
      pct !== 0 &&
      pct >= MIN_PCT &&
      pct <= MAX_PCT &&
      typeof row.reason === 'string' &&
      row.reason.trim().length >= 10;
    if (!valid) {
      dropped += 1;
      continue;
    }
    const start = Date.parse(`${row.startDate}T00:00:00.000Z`);
    const end = Date.parse(`${row.endDate}T00:00:00.000Z`);
    const inWindow = start >= windowStart && end >= start && end < windowEnd;
    const clashes = inputs.pendingPeriods.some(
      (period) => period.roomTypeId === row.roomTypeId && row.startDate <= period.endDate && row.endDate >= period.startDate,
    );
    if (!inWindow || clashes) {
      dropped += 1;
      continue;
    }
    accepted.push({
      roomTypeId: row.roomTypeId,
      startDate: row.startDate,
      endDate: row.endDate,
      multiplier: (1 + pct / 100).toFixed(3),
      reason: row.reason.trim().slice(0, 1000),
    });
  }
  return { accepted, dropped: dropped + Math.max(0, rows.length - MAX_AGENT_SUGGESTIONS) };
}
