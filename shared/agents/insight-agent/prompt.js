/**
 * Geri bildirim ajanının istemleri ve çıktı kuralları (saf, birim testli).
 *
 * Model yalnız puanları ve yorum metnini görür: misafirin adı, onay kodu, iletişim bilgisi gitmez. Çıktı yapılandırılmış
 * JSON'dur (sağlayıcının şema zorlaması); yine de ayrıştırırken listeyle sınırlanır, uzunluklar kesilir, bozuksa `null`.
 */

export const ANALYSIS_MAX_OUTPUT_TOKENS = 220;
export const INSIGHT_MAX_OUTPUT_TOKENS = 1400;
export const ANALYSIS_SUMMARY_MAX = 200;
export const INSIGHT_SUMMARY_MAX = 1200;
export const INSIGHT_MAX_THEMES = 6;
export const INSIGHT_MAX_ACTIONS = 3;
const MAX_TOPICS = 5;
const THEME_TITLE_MAX = 80;
const QUOTE_MAX = 200;
const ACTION_MAX = 220;

export const ANALYSIS_SYSTEM_PROMPT = [
  'Sen bir otelin misafir geri bildirimi analistisin. Görevin misafirin anket yorumunu etiketlemek.',
  'Kurallar:',
  '- sentiment: yorumun genel tonu (POSITIVE, NEUTRAL, NEGATIVE; hem övgü hem şikâyet belirginse MIXED).',
  '- topics: yorumun gerçekten değindiği konular, verilen listeden, en fazla 5; değinmediğini ekleme. Liste dışı konu OTHER.',
  '- summary: yorumun Türkçe, tek cümlelik, en fazla 160 karakterlik özeti; misafirin dili ne olursa olsun Türkçe yaz.',
  '- Kişi adı, oda numarası, telefon ya da e-posta yazma. Yorumda olmayanı ekleme.',
].join('\n');

export const INSIGHT_SYSTEM_PROMPT = [
  'Sen bir otelin misafir deneyimi analistisin. Görevin bir dönemin anket yorumlarından otel müdürü için özet çıkarmak.',
  'Kurallar:',
  '- Yalnızca verilen JSON\'daki sayıları ve yorumları kullan; yeni rakam hesaplama, uydurma.',
  '- summary: Türkçe tek paragraf, en fazla 6 cümle: genel tablo (NPS, puan), en çok övülen ve en çok şikâyet edilen konular.',
  '- themes: en fazla 6 ana tema, en sık görülenden; her biri için kısa başlık, ton, yorumların yaklaşık yüzde kaçında geçtiği (share, 0–100 tam sayı) ve yorumlardan kısa, kelimesi kelimesine bir alıntı (quote; misafirin dilinde bırak).',
  '- actions: veriyle desteklenen en fazla 3 somut öneri (Türkçe, kısa).',
  '- Kişi adı, oda numarası, telefon ya da e-posta yazma; alıntıda geçiyorsa çıkar. Suçlama yapma.',
].join('\n');

/** @param {string[]} topics @param {string[]} sentiments */
export function analysisSchema(topics, sentiments) {
  return {
    name: 'feedback_analysis',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['sentiment', 'topics', 'summary'],
      properties: {
        sentiment: { type: 'string', enum: sentiments },
        topics: { type: 'array', items: { type: 'string', enum: topics } },
        summary: { type: 'string' },
      },
    },
  };
}

/** @param {string[]} sentiments */
export function insightSchema(sentiments) {
  return {
    name: 'feedback_insight',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'themes', 'actions'],
      properties: {
        summary: { type: 'string' },
        themes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'sentiment', 'share', 'quote'],
            properties: { title: { type: 'string' }, sentiment: { type: 'string', enum: sentiments }, share: { type: 'integer' }, quote: { type: 'string' } },
          },
        },
        actions: { type: 'array', items: { type: 'string' } },
      },
    },
  };
}

/**
 * Etiket isteğinin mesajları.
 * @param {{ kind: string, language: string, npsScore: number | null, ratingAverage: number | null, comment: string, topics: string[] }} input
 */
export function buildAnalysisMessages(input) {
  return [
    { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify({ survey: input.kind, language: input.language, nps: input.npsScore, rating: input.ratingAverage, allowedTopics: input.topics, comment: input.comment }) },
  ];
}

/**
 * Dönem özetinin mesajları.
 * @param {{ kind: string, period: object, stats: object, comments: object[] }} input
 */
export function buildInsightMessages(input) {
  return [
    { role: 'system', content: INSIGHT_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify({ survey: input.kind, period: input.period, stats: input.stats, comments: input.comments }) },
  ];
}

/** Boşlukları sadeleştirir, markdown işaretlerini ayıklar, uzunluğu sınırlar. @param {unknown} value @param {number} max */
export function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** @param {string | null | undefined} text */
function parseJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Etiket çıktısı → doğrulanmış sonuç; bozuksa `null`.
 * @param {string | null | undefined} text @param {{ topics: string[], sentiments: string[] }} allowed
 */
export function parseAnalysis(text, { topics, sentiments }) {
  const value = parseJson(text);
  if (!value || !sentiments.includes(value.sentiment)) return null;
  const picked = Array.isArray(value.topics) ? [...new Set(value.topics.filter((topic) => topics.includes(topic)))].slice(0, MAX_TOPICS) : [];
  return { sentiment: value.sentiment, topics: picked, summary: cleanText(value.summary, ANALYSIS_SUMMARY_MAX) || null };
}

/**
 * Dönem özeti çıktısı → doğrulanmış sonuç; özet boşsa `null`.
 * @param {string | null | undefined} text @param {{ sentiments: string[] }} allowed
 */
export function parseInsight(text, { sentiments }) {
  const value = parseJson(text);
  const summary = cleanText(value?.summary, INSIGHT_SUMMARY_MAX);
  if (!summary) return null;
  const themes = (Array.isArray(value.themes) ? value.themes : [])
    .map((theme) => ({
      title: cleanText(theme?.title, THEME_TITLE_MAX),
      sentiment: sentiments.includes(theme?.sentiment) ? theme.sentiment : 'NEUTRAL',
      share: Number.isFinite(theme?.share) ? Math.min(100, Math.max(0, Math.round(theme.share))) : null,
      quote: cleanText(theme?.quote, QUOTE_MAX) || null,
    }))
    .filter((theme) => theme.title)
    .slice(0, INSIGHT_MAX_THEMES);
  const actions = (Array.isArray(value.actions) ? value.actions : []).map((action) => cleanText(action, ACTION_MAX)).filter(Boolean).slice(0, INSIGHT_MAX_ACTIONS);
  return { summary, themes, actions };
}
