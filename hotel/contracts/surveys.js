import { z } from './locale.js';
import { expectedUpdatedAt, isoDayField, paginationQuerySchema } from './fields.js';
import { GUEST_PORTAL_LANGUAGES } from './guest-portal.js';

/**
 * Anket ve memnuniyet (modül 55).
 *
 * İki anket: **çıkış sonrası** (çıkış gününden `postStayDelayDays` gün sonra; NPS, bölüm puanları, açık uçlu) ve
 * **ara anket** (girişin ertesi günü, 1–2 soru: konaklama bitmeden düzeltilebilsin). Misafir imzalı bağlantıyla
 * (`/misafir/a/<belirteç>`) oturumsuz, kendi dilinde cevaplar. Düşük puan (NPS ≤ eşik ya da puan ≤ eşik) personelin
 * ziline düşer ve **takip kaydı** açar (kim aradı, ne yapıldı, nasıl kapandı). Anketi bitiren her misafire puanından
 * bağımsız yorum bağlantıları gösterilir (yalnız memnunlara göstermek Google kurallarına aykırı).
 *
 * Açık uçlu cevaplar `insight-agent` ile duygu ve konu etiketi alır; dönem için tema özeti istenir. AI kapalıysa
 * anket, NPS ve rapor eksiksiz çalışır; yalnız etiket / özet olmaz.
 */

const uuid = (message) => z.string().uuid({ message });

/* ─────────────── Türler ─────────────── */

export const SURVEY_KINDS = Object.freeze(['POST_STAY', 'MID_STAY']);
export const SURVEY_KIND_LABELS = Object.freeze({ POST_STAY: 'Çıkış sonrası anket', MID_STAY: 'Ara anket (konaklama içi)' });
export const SURVEY_PATH = '/misafir/a';
export const SURVEY_LANGUAGES = GUEST_PORTAL_LANGUAGES;

export const SURVEY_QUESTION_TYPES = Object.freeze(['NPS', 'RATING', 'CHOICE', 'TEXT']);
export const SURVEY_QUESTION_TYPE_LABELS = Object.freeze({ NPS: 'Tavsiye (0–10)', RATING: 'Puan (1–5)', CHOICE: 'Seçenekli', TEXT: 'Açık uçlu' });

/** Sorunun ve AI etiketinin konusu (bölüm raporu bununla gruplanır). */
export const SURVEY_TOPICS = Object.freeze(['OVERALL', 'ROOM', 'CLEANLINESS', 'STAFF', 'CHECK_IN_OUT', 'FOOD_BEVERAGE', 'FACILITIES', 'SPA', 'WIFI', 'NOISE', 'VALUE', 'LOCATION', 'OTHER']);
export const SURVEY_TOPIC_LABELS = Object.freeze({
  OVERALL: 'Genel',
  ROOM: 'Oda',
  CLEANLINESS: 'Temizlik',
  STAFF: 'Personel',
  CHECK_IN_OUT: 'Giriş / çıkış',
  FOOD_BEVERAGE: 'Yiyecek-içecek',
  FACILITIES: 'Tesis',
  SPA: 'Spa',
  WIFI: 'İnternet',
  NOISE: 'Gürültü',
  VALUE: 'Fiyat / kalite',
  LOCATION: 'Konum',
  OTHER: 'Diğer',
});

export const SURVEY_SENTIMENTS = Object.freeze(['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'MIXED']);
export const SURVEY_SENTIMENT_LABELS = Object.freeze({ POSITIVE: 'Olumlu', NEUTRAL: 'Nötr', NEGATIVE: 'Olumsuz', MIXED: 'Karışık' });
export const SURVEY_SENTIMENT_TONES = Object.freeze({ POSITIVE: 'success', NEUTRAL: 'neutral', NEGATIVE: 'danger', MIXED: 'warning' });

export const NPS_CATEGORIES = Object.freeze(['PROMOTER', 'PASSIVE', 'DETRACTOR']);
export const NPS_CATEGORY_LABELS = Object.freeze({ PROMOTER: 'Destekçi (9–10)', PASSIVE: 'Pasif (7–8)', DETRACTOR: 'Eleştiren (0–6)' });
export const NPS_CATEGORY_TONES = Object.freeze({ PROMOTER: 'success', PASSIVE: 'neutral', DETRACTOR: 'danger' });

export const SURVEY_INVITATION_STATUSES = Object.freeze(['SENT', 'OPENED', 'RESPONDED']);

export const SURVEY_FOLLOW_UP_STATUSES = Object.freeze(['OPEN', 'IN_PROGRESS', 'RESOLVED']);
export const SURVEY_FOLLOW_UP_STATUS_LABELS = Object.freeze({ OPEN: 'Açık', IN_PROGRESS: 'İlgileniliyor', RESOLVED: 'Kapandı' });
export const SURVEY_FOLLOW_UP_STATUS_TONES = Object.freeze({ OPEN: 'danger', IN_PROGRESS: 'warning', RESOLVED: 'success' });
export const SURVEY_FOLLOW_UP_OUTCOMES = Object.freeze(['APOLOGIZED', 'COMPENSATED', 'ISSUE_FIXED', 'EXPLAINED', 'NO_CONTACT', 'OTHER']);
export const SURVEY_FOLLOW_UP_OUTCOME_LABELS = Object.freeze({
  APOLOGIZED: 'Özür dilendi',
  COMPENSATED: 'Telafi edildi (indirim, ikram, hediye)',
  ISSUE_FIXED: 'Sorun giderildi',
  EXPLAINED: 'Açıklama yapıldı',
  NO_CONTACT: 'Ulaşılamadı',
  OTHER: 'Diğer',
});
export const SURVEY_FOLLOW_UP_NOTE_KINDS = Object.freeze(['NOTE', 'CONTACT']);
export const SURVEY_FOLLOW_UP_NOTE_KIND_LABELS = Object.freeze({ NOTE: 'Not', CONTACT: 'Misafirle görüşme' });

/** Takibin hedef süresi (saat): içerideki misafir (ara anket) beklemez, çıkmış misafire iki gün içinde dönülür. */
export const SURVEY_FOLLOW_UP_DUE_HOURS = Object.freeze({ MID_STAY: 2, POST_STAY: 48 });

export const SURVEY_INSIGHT_STATUSES = Object.freeze(['PENDING', 'READY', 'FAILED']);

/* ─────────────── Sınırlar ─────────────── */

export const SURVEY_MAX_QUESTIONS = 20;
export const SURVEY_MAX_OPTIONS = 10;
export const SURVEY_QUESTION_TEXT_MAX = 300;
export const SURVEY_OPTION_TEXT_MAX = 120;
export const SURVEY_ANSWER_TEXT_MAX = 2000;
/** Personele tek cevapta gösterilen / AI'a giden yorum metni (açık uçluların birleşimi) üst sınırı. */
export const SURVEY_COMMENT_MAX = 6000;
/** Rapor ve özetin en uzun dönemi (gün). */
export const SURVEY_REPORT_MAX_DAYS = 366;
/** Dönem özetine giren en fazla yorum (en yeni; her biri kısaltılır). */
export const SURVEY_INSIGHT_MAX_COMMENTS = 150;
export const SURVEY_INSIGHT_COMMENT_CHARS = 400;
/** Gecikmiş zamanlanmış iş (sunucu kapalıydı) çıkış sonrası anketi en fazla bu kadar gün geç yollar. */
export const SURVEY_SEND_GRACE_DAYS = 2;

export const SURVEY_SETTING_LIMITS = Object.freeze({
  postStayDelayDays: { min: 0, max: 7 },
  postStaySendHour: { min: 6, max: 21 },
  midStaySendHour: { min: 9, max: 21 },
  midStayMinNights: { min: 2, max: 14 },
  minDaysBetweenSurveys: { min: 0, max: 365 },
  linkValidDays: { min: 3, max: 60 },
  lowNpsThreshold: { min: 0, max: 8 },
  lowRatingThreshold: { min: 1, max: 3 },
});

export const SURVEY_DEFAULT_SETTINGS = Object.freeze({
  postStayEnabled: false,
  postStayDelayDays: 1,
  postStaySendHour: 11,
  midStayEnabled: false,
  midStaySendHour: 18,
  midStayMinNights: 2,
  minDaysBetweenSurveys: 30,
  linkValidDays: 14,
  lowNpsThreshold: 6,
  lowRatingThreshold: 2,
  googleReviewUrl: null,
  tripadvisorReviewUrl: null,
});

/* ─────────────── Varsayılan anketler (dört dil) ─────────────── */

const t = (tr, en, de, ru) => Object.freeze({ tr, en, de, ru });

/** Kurulumda yüklenen sorular (müdür değiştirir). Seçenek kimlikleri sabit: raporda dil değişse de aynı seçenek. */
export const SURVEY_DEFAULT_QUESTIONS = Object.freeze({
  POST_STAY: Object.freeze([
    {
      type: 'NPS',
      topic: 'OVERALL',
      required: true,
      text: t(
        'Bizi bir arkadaşınıza ya da iş arkadaşınıza tavsiye etme olasılığınız nedir?',
        'How likely are you to recommend us to a friend or colleague?',
        'Wie wahrscheinlich ist es, dass Sie uns einem Freund oder Kollegen empfehlen?',
        'Насколько вероятно, что вы порекомендуете нас другу или коллеге?',
      ),
    },
    { type: 'RATING', topic: 'ROOM', required: true, text: t('Odanızın konforu', 'Comfort of your room', 'Komfort Ihres Zimmers', 'Комфорт номера') },
    { type: 'RATING', topic: 'CLEANLINESS', required: true, text: t('Temizlik', 'Cleanliness', 'Sauberkeit', 'Чистота') },
    {
      type: 'RATING',
      topic: 'STAFF',
      required: true,
      text: t('Personelimizin ilgisi ve güler yüzü', 'Friendliness and helpfulness of our staff', 'Freundlichkeit und Hilfsbereitschaft des Personals', 'Доброжелательность и внимание персонала'),
    },
    { type: 'RATING', topic: 'CHECK_IN_OUT', required: true, text: t('Giriş ve çıkış işlemleri', 'Check-in and check-out', 'Check-in und Check-out', 'Заселение и выезд') },
    { type: 'RATING', topic: 'FOOD_BEVERAGE', required: false, text: t('Yiyecek ve içecek', 'Food and beverages', 'Speisen und Getränke', 'Еда и напитки') },
    { type: 'RATING', topic: 'VALUE', required: true, text: t('Fiyat / kalite dengesi', 'Value for money', 'Preis-Leistungs-Verhältnis', 'Соотношение цены и качества') },
    {
      type: 'CHOICE',
      topic: 'OVERALL',
      required: false,
      multiple: false,
      text: t('Seyahatinizin amacı neydi?', 'What was the purpose of your trip?', 'Was war der Zweck Ihrer Reise?', 'Какова была цель вашей поездки?'),
      options: [
        { id: 'business', label: t('İş', 'Business', 'Geschäftlich', 'Деловая поездка') },
        { id: 'leisure', label: t('Tatil', 'Leisure', 'Urlaub', 'Отдых') },
        { id: 'event', label: t('Toplantı / etkinlik', 'Meeting or event', 'Tagung oder Veranstaltung', 'Конференция или мероприятие') },
        { id: 'other', label: t('Diğer', 'Other', 'Sonstiges', 'Другое') },
      ],
    },
    { type: 'TEXT', topic: 'OVERALL', required: false, text: t('En çok neyi beğendiniz?', 'What did you like most?', 'Was hat Ihnen am besten gefallen?', 'Что вам понравилось больше всего?') },
    { type: 'TEXT', topic: 'OVERALL', required: false, text: t('Neyi daha iyi yapabilirdik?', 'What could we have done better?', 'Was hätten wir besser machen können?', 'Что мы могли бы сделать лучше?') },
  ]),
  MID_STAY: Object.freeze([
    { type: 'RATING', topic: 'OVERALL', required: true, text: t('Konaklamanız şu ana kadar nasıl gidiyor?', 'How is your stay going so far?', 'Wie gefällt Ihnen Ihr Aufenthalt bisher?', 'Как проходит ваше пребывание?') },
    {
      type: 'TEXT',
      topic: 'OVERALL',
      required: false,
      text: t(
        'Sizin için düzeltebileceğimiz ya da yapabileceğimiz bir şey var mı?',
        'Is there anything we can fix or do for you?',
        'Gibt es etwas, das wir für Sie verbessern oder tun können?',
        'Можем ли мы что-то исправить или сделать для вас?',
      ),
    },
  ]),
});

/* ─────────────── Saf kurallar ─────────────── */

/** @param {number | null | undefined} score 0–10 */
export function npsCategory(score) {
  if (score === null || score === undefined) return null;
  if (score >= 9) return 'PROMOTER';
  if (score >= 7) return 'PASSIVE';
  return 'DETRACTOR';
}

/**
 * NPS = (destekçi − eleştiren) / toplam × 100, tam sayıya yuvarlanır; cevap yoksa `null`.
 * @param {{ promoters: number, passives: number, detractors: number }} counts
 */
export function npsFromCounts({ promoters, passives, detractors }) {
  const total = promoters + passives + detractors;
  if (!total) return null;
  return Math.round(((promoters - detractors) / total) * 100);
}

/**
 * Yerelleştirilmiş metin: istenen dil, yoksa Türkçe.
 * @param {Record<string, string | null | undefined> | null | undefined} text @param {string} language
 */
export function surveyText(text, language) {
  const value = text?.[language]?.trim();
  return value || text?.tr?.trim() || '';
}

/**
 * Soruların eksik dilleri (Türkçeye düşer): ayar ekranında uyarı.
 * @param {Array<{ text: Record<string, string>, options?: Array<{ label: Record<string, string> }> | null }>} questions
 * @returns {string[]} eksik dil kodları
 */
export function surveyMissingLanguages(questions) {
  return SURVEY_LANGUAGES.filter(
    (language) => language !== 'tr' && questions.some((question) => !question.text?.[language]?.trim() || (question.options ?? []).some((option) => !option.label?.[language]?.trim())),
  );
}

/**
 * Cevapların sorulara uygunluğu: soru kimliği → ileti. Boşsa geçerli.
 * - Zorunlu soru boş bırakılamaz; NPS 0–10, puan 1–5 tam sayı; seçenek sorunun seçeneklerinden (tekli soruda tek);
 *   açık uçlu en fazla `SURVEY_ANSWER_TEXT_MAX`.
 * - Bilinmeyen soru kimliği (anket bu arada değişti) ayrı döner.
 *
 * @param {Array<{ id: string, type: string, required: boolean, multiple?: boolean, options?: Array<{ id: string }> | null }>} questions etkin sorular
 * @param {Array<{ questionId: string, score?: number | null, choiceIds?: string[] | null, text?: string | null }>} answers
 * @returns {{ problems: Record<string, string>, unknown: string[] }}
 */
export function surveyAnswerProblems(questions, answers) {
  /** @type {Record<string, string>} */
  const problems = {};
  const byId = new Map(questions.map((question) => [question.id, question]));
  const unknown = answers.filter((answer) => !byId.has(answer.questionId)).map((answer) => answer.questionId);
  const given = new Map(answers.filter((answer) => byId.has(answer.questionId)).map((answer) => [answer.questionId, answer]));
  for (const question of questions) {
    const answer = given.get(question.id);
    const empty = !answer || isEmptyAnswer(question.type, answer);
    if (empty) {
      if (question.required) problems[question.id] = 'Bu soru zorunlu';
      continue;
    }
    if (question.type === 'NPS' && !(Number.isInteger(answer.score) && answer.score >= 0 && answer.score <= 10)) problems[question.id] = 'Puan 0–10 olmalı';
    else if (question.type === 'RATING' && !(Number.isInteger(answer.score) && answer.score >= 1 && answer.score <= 5)) problems[question.id] = 'Puan 1–5 olmalı';
    else if (question.type === 'CHOICE') {
      const allowed = new Set((question.options ?? []).map((option) => option.id));
      const picked = answer.choiceIds ?? [];
      if (picked.some((id) => !allowed.has(id))) problems[question.id] = 'Geçersiz seçenek';
      else if (!question.multiple && picked.length > 1) problems[question.id] = 'Tek seçenek seçilir';
      else if (new Set(picked).size !== picked.length) problems[question.id] = 'Aynı seçenek iki kez seçilmiş';
    } else if (question.type === 'TEXT' && String(answer.text ?? '').trim().length > SURVEY_ANSWER_TEXT_MAX) problems[question.id] = `En fazla ${SURVEY_ANSWER_TEXT_MAX} karakter`;
  }
  return { problems, unknown };
}

/** @param {string} type @param {{ score?: number | null, choiceIds?: string[] | null, text?: string | null }} answer */
function isEmptyAnswer(type, answer) {
  if (type === 'NPS' || type === 'RATING') return answer.score === null || answer.score === undefined;
  if (type === 'CHOICE') return !(answer.choiceIds?.length > 0);
  return !String(answer.text ?? '').trim();
}

/**
 * Cevabın özeti: NPS ve kategorisi, puan ortalaması (1–5), düşük puan, açık uçluların birleşimi.
 * Düşük: NPS ≤ `lowNpsThreshold` ya da herhangi bir puan ≤ `lowRatingThreshold`.
 *
 * @param {Array<{ id: string, type: string }>} questions
 * @param {Array<{ questionId: string, score?: number | null, choiceIds?: string[] | null, text?: string | null }>} answers geçerli cevaplar
 * @param {{ lowNpsThreshold: number, lowRatingThreshold: number }} thresholds
 */
export function scoreSurveyResponse(questions, answers, { lowNpsThreshold, lowRatingThreshold }) {
  const types = new Map(questions.map((question) => [question.id, question.type]));
  let npsScore = null;
  const ratings = [];
  const texts = [];
  for (const answer of answers) {
    const type = types.get(answer.questionId);
    if (type === 'NPS' && Number.isInteger(answer.score)) npsScore = answer.score;
    else if (type === 'RATING' && Number.isInteger(answer.score)) ratings.push(/** @type {number} */ (answer.score));
    else if (type === 'TEXT' && String(answer.text ?? '').trim()) texts.push(String(answer.text).trim());
  }
  const ratingAverage = ratings.length ? Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 100) / 100 : null;
  const lowRatings = ratings.filter((value) => value <= lowRatingThreshold).length;
  const lowScore = (npsScore !== null && npsScore <= lowNpsThreshold) || lowRatings > 0;
  const commentText = texts.length ? texts.join('\n\n').slice(0, SURVEY_COMMENT_MAX) : null;
  return { npsScore, npsCategory: npsCategory(npsScore), ratingAverage, lowScore, commentText };
}

/** "YYYY-MM-DD" + gün. @param {string} day @param {number} days */
export function addSurveyDays(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Çıkış sonrası anketin bugün (otel saatiyle) gidip gitmeyeceği: çıkış gününden `postStayDelayDays` gün sonra,
 * saat `postStaySendHour`'dan itibaren; zamanlanmış iş gecikmişse en fazla `SURVEY_SEND_GRACE_DAYS` gün geç.
 * @param {{ departureDay: string, today: string, hour: number, settings: { postStayDelayDays: number, postStaySendHour: number } }} input
 */
export function postStaySurveyDue({ departureDay, today, hour, settings }) {
  const sendDay = addSurveyDays(departureDay, settings.postStayDelayDays);
  if (today < sendDay) return false;
  if (today > addSurveyDays(sendDay, SURVEY_SEND_GRACE_DAYS)) return false;
  return today > sendDay || hour >= settings.postStaySendHour;
}

/**
 * Ara anketin bugün gidip gitmeyeceği: girişin ertesi günü (bir gün gecikmeyle de), saat `midStaySendHour`'dan
 * itibaren; konaklama en az `midStayMinNights` gece ve misafir bugün ayrılmıyor.
 * @param {{ arrivalDay: string, departureDay: string, today: string, hour: number, settings: { midStaySendHour: number, midStayMinNights: number } }} input
 */
export function midStaySurveyDue({ arrivalDay, departureDay, today, hour, settings }) {
  const nights = Math.round((Date.parse(`${departureDay}T00:00:00Z`) - Date.parse(`${arrivalDay}T00:00:00Z`)) / 86_400_000);
  if (nights < settings.midStayMinNights) return false;
  if (today >= departureDay) return false;
  const sendDay = addSurveyDays(arrivalDay, 1);
  if (today < sendDay || today > addSurveyDays(sendDay, 1)) return false;
  return today > sendDay || hour >= settings.midStaySendHour;
}

/* ─────────────── Şemalar ─────────────── */

/** Yerelleştirilmiş metin: Türkçe zorunlu, diğerleri boş kalabilir (Türkçeye düşer). */
const localized = (max, label) =>
  z.object(
    Object.fromEntries(
      SURVEY_LANGUAGES.map((language) => [
        language,
        language === 'tr'
          ? z.string().trim().min(1, `${label} (Türkçe) zorunlu`).max(max, `${label} en fazla ${max} karakter`)
          : z.string().trim().max(max, `${label} en fazla ${max} karakter`).default(''),
      ]),
    ),
  );

const optionIdField = z.string().trim().regex(/^[a-z0-9-]{1,40}$/, 'Geçersiz seçenek kimliği');

export const surveyQuestionInputSchema = z
  .object({
    type: z.enum(SURVEY_QUESTION_TYPES, { error: 'Soru tipi seçin' }),
    text: localized(SURVEY_QUESTION_TEXT_MAX, 'Soru'),
    topic: z.enum(SURVEY_TOPICS, { error: 'Konu seçin' }).default('OVERALL'),
    required: z.boolean().default(false),
    multiple: z.boolean().default(false),
    options: z
      .array(z.object({ id: optionIdField.optional(), label: localized(SURVEY_OPTION_TEXT_MAX, 'Seçenek') }))
      .max(SURVEY_MAX_OPTIONS, `En fazla ${SURVEY_MAX_OPTIONS} seçenek`)
      .default([]),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'CHOICE' && value.options.length < 2) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Seçenekli soruda en az iki seçenek olmalı' });
    if (value.type !== 'CHOICE' && value.options.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Seçenek yalnız seçenekli soruda olur' });
    const ids = value.options.map((option) => option.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Seçenek kimlikleri tekil olmalı' });
  });

export const surveyQuestionCreateSchema = z.object({ expectedVersion: z.number().int().min(0), question: surveyQuestionInputSchema });
export const surveyQuestionUpdateSchema = surveyQuestionCreateSchema;
export const surveyQuestionOrderSchema = z.object({
  expectedVersion: z.number().int().min(0),
  questionIds: z.array(uuid('Geçersiz soru')).min(1, 'Soru yok').max(SURVEY_MAX_QUESTIONS, `En fazla ${SURVEY_MAX_QUESTIONS} soru`),
});
export const surveyVersionSchema = z.object({ expectedVersion: z.number().int().min(0) });
export const surveyKindParamSchema = z.object({ kind: z.enum(SURVEY_KINDS, { error: 'Geçersiz anket' }) });
export const surveyQuestionParamSchema = surveyKindParamSchema.extend({ questionId: uuid('Geçersiz soru') });

const limitField = (key, label) =>
  z.coerce
    .number({ error: `${label} sayı olmalı` })
    .int(`${label} tam sayı olmalı`)
    .min(SURVEY_SETTING_LIMITS[key].min, `${label} en az ${SURVEY_SETTING_LIMITS[key].min}`)
    .max(SURVEY_SETTING_LIMITS[key].max, `${label} en fazla ${SURVEY_SETTING_LIMITS[key].max}`);

/** Yorum sitesinin bağlantısı (https). */
const reviewUrl = (label) =>
  z
    .string()
    .trim()
    .max(500, `${label} en fazla 500 karakter`)
    .refine((value) => value === '' || /^https:\/\/[^\s]+$/.test(value), { message: `${label} "https://" ile başlamalı` })
    .transform((value) => value || null)
    .nullish();

export const surveySettingsSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAt.nullish(),
  postStayEnabled: z.boolean(),
  postStayDelayDays: limitField('postStayDelayDays', 'Gönderim günü'),
  postStaySendHour: limitField('postStaySendHour', 'Gönderim saati'),
  midStayEnabled: z.boolean(),
  midStaySendHour: limitField('midStaySendHour', 'Ara anket saati'),
  midStayMinNights: limitField('midStayMinNights', 'En kısa konaklama'),
  minDaysBetweenSurveys: limitField('minDaysBetweenSurveys', 'Aynı misafire ara'),
  linkValidDays: limitField('linkValidDays', 'Bağlantı süresi'),
  lowNpsThreshold: limitField('lowNpsThreshold', 'NPS eşiği'),
  lowRatingThreshold: limitField('lowRatingThreshold', 'Puan eşiği'),
  googleReviewUrl: reviewUrl('Google yorum bağlantısı'),
  tripadvisorReviewUrl: reviewUrl('TripAdvisor bağlantısı'),
});

/** `<davet kimliği>.<imza>` (imza base64url, 43 karakter). */
export const surveyTokenSchema = z.object({ token: z.string().regex(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/, 'Bağlantı geçersiz') });

export const surveySubmitSchema = z.object({
  language: z.enum(SURVEY_LANGUAGES).default('tr'),
  answers: z
    .array(
      z.object({
        questionId: uuid('Geçersiz soru'),
        score: z.number().int('Puan tam sayı olmalı').min(0).max(10).nullish(),
        choiceIds: z.array(optionIdField).max(SURVEY_MAX_OPTIONS).nullish(),
        text: z.string().max(SURVEY_ANSWER_TEXT_MAX, `En fazla ${SURVEY_ANSWER_TEXT_MAX} karakter`).nullish(),
      }),
    )
    .max(SURVEY_MAX_QUESTIONS, 'Fazla cevap'),
});

const dayRange = { from: isoDayField.optional(), to: isoDayField.optional() };
const booleanQuery = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true')
  .default(false);

export const surveyResponseListQuerySchema = paginationQuerySchema.extend({
  kind: z.enum(SURVEY_KINDS).optional(),
  ...dayRange,
  category: z.enum(NPS_CATEGORIES).optional(),
  lowOnly: booleanQuery,
  withComment: booleanQuery,
  sentiment: z.enum(SURVEY_SENTIMENTS).optional(),
  topic: z.enum(SURVEY_TOPICS).optional(),
  search: z.string().trim().max(100, 'Arama en fazla 100 karakter').optional(),
});
export const surveyResponseParamSchema = z.object({ responseId: uuid('Geçersiz cevap') });

export const surveyReportQuerySchema = z
  .object({ kind: z.enum(SURVEY_KINDS).default('POST_STAY'), from: isoDayField, to: isoDayField })
  .refine((value) => value.from <= value.to, { path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' })
  .refine((value) => Date.parse(value.to) - Date.parse(value.from) <= (SURVEY_REPORT_MAX_DAYS - 1) * 86_400_000, { path: ['to'], message: `Dönem en fazla ${SURVEY_REPORT_MAX_DAYS} gün` });

export const surveyInsightRequestSchema = surveyReportQuerySchema;

export const surveyFollowUpListQuerySchema = paginationQuerySchema.extend({
  view: z.enum(['ACTIVE', 'RESOLVED', 'ALL']).default('ACTIVE'),
  mine: booleanQuery,
});
export const surveyFollowUpParamSchema = z.object({ followUpId: uuid('Geçersiz takip') });
export const surveyFollowUpAssignSchema = z.object({ expectedUpdatedAt, assignedTo: z.string().trim().email('Geçersiz kişi').nullable() });
export const surveyFollowUpNoteSchema = z.object({
  kind: z.enum(SURVEY_FOLLOW_UP_NOTE_KINDS).default('NOTE'),
  text: z.string().trim().min(3, 'Not en az 3 karakter').max(1000, 'Not en fazla 1000 karakter'),
});
export const surveyFollowUpResolveSchema = z.object({
  expectedUpdatedAt,
  outcome: z.enum(SURVEY_FOLLOW_UP_OUTCOMES, { error: 'Sonuç seçin' }),
  resolution: z.string().trim().min(5, 'Nasıl kapandığını yazın (en az 5 karakter)').max(1000, 'En fazla 1000 karakter'),
});
export const surveyFollowUpReopenSchema = z.object({ expectedUpdatedAt });
