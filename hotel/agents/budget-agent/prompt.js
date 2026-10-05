/**
 * Bütçe yorum ajanının istemi ve çıktı kuralları (saf, birim testli).
 *
 * Model yalnızca sistemin hesapladığı açıklamayı görür (dönem, toplamlar, en
 * büyük sapmalar, oda gelirinin doluluk / fiyat etkisi, hedefler, notlar):
 * kişisel veri yok. Rakam uydurmaması için istem açık: yalnızca verilen
 * rakamlar, yeni hesap yok, tahmin / tavsiye sınırlı.
 */

/** Yorumun en uzun hali (karakter): ekranda bir paragraf. */
export const COMMENTARY_MAX_CHARS = 1200;
/** Modelin çıktı üst sınırı (token): paragraf + pay; maliyeti tutar. */
export const MAX_OUTPUT_TOKENS = 450;

export const BUDGET_SYSTEM_PROMPT = [
  'Sen bir otelin gelir ve maliyet analistisin. Görevin bütçe sapmasını otel müdürü için yorumlamak.',
  'Kurallar:',
  '- Yalnızca sana verilen JSON\'daki rakamları kullan; yeni rakam hesaplama, tahmin etme, uydurma.',
  '- Türkçe, tek paragraf, en fazla 6 cümle. Başlık, madde işareti, markdown kullanma.',
  '- Önce genel tabloyu söyle (gelir, gider, brüt faaliyet kârı plana göre), sonra sapmayı en çok sürükleyen 2-3 kalemi.',
  '- Oda geliri sapması varsa doluluk etkisi ile fiyat (ADR) etkisini ayır (roomDrivers).',
  '- "tone": GOOD olumlu, BAD olumsuz sapmadır; giderde fazlası olumsuzdur.',
  '- notes alanındaki eksik veri ve ay içi uyarılarını mutlaka belirt.',
  '- Para birimini rakamın yanına yaz. Kesin olmayan konuda "olabilir" de; suçlama ya da kişi adı yok.',
  '- En sonda tek cümlelik, veriyle desteklenen bir dikkat noktası öner.',
].join('\n');

/**
 * Model mesajları.
 * @param {object} explanation `explainVariance` çıktısı
 */
export function buildBudgetMessages(explanation) {
  return [
    { role: 'system', content: BUDGET_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(explanation) },
  ];
}

/**
 * Model çıktısı → ekrana yazılacak yorum: boşluklar sadeleşir, markdown
 * işaretleri ayıklanır, uzunluk sınırlanır (cümle sonunda kesilir). Boşsa `null`.
 *
 * @param {string | null | undefined} text
 * @returns {string | null}
 */
export function cleanCommentary(text) {
  if (typeof text !== 'string') return null;
  let value = text
    .replace(/[*_`#>]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return null;
  if (value.length > COMMENTARY_MAX_CHARS) {
    const cut = value.slice(0, COMMENTARY_MAX_CHARS);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.'));
    value = end > COMMENTARY_MAX_CHARS / 2 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
  }
  return value;
}
