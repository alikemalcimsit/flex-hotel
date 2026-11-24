import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SURVEY_DEFAULT_QUESTIONS,
  SURVEY_LANGUAGES,
  midStaySurveyDue,
  npsCategory,
  npsFromCounts,
  postStaySurveyDue,
  scoreSurveyResponse,
  surveyAnswerProblems,
  surveyMissingLanguages,
  surveyQuestionInputSchema,
  surveyReportQuerySchema,
  surveySettingsSchema,
  surveyText,
} from './surveys.js';

const Q = (id, type, extra = {}) => ({ id, type, required: false, multiple: false, options: null, ...extra });

describe('NPS', () => {
  it('kategori: 9–10 destekçi, 7–8 pasif, 0–6 eleştiren; boş cevap kategorisiz', () => {
    assert.deepEqual([10, 9, 8, 7, 6, 0].map(npsCategory), ['PROMOTER', 'PROMOTER', 'PASSIVE', 'PASSIVE', 'DETRACTOR', 'DETRACTOR']);
    assert.equal(npsCategory(null), null);
  });

  it('skor = (destekçi − eleştiren) / toplam × 100, yuvarlanır; cevap yoksa boş', () => {
    assert.equal(npsFromCounts({ promoters: 50, passives: 30, detractors: 20 }), 30);
    assert.equal(npsFromCounts({ promoters: 1, passives: 1, detractors: 1 }), 0);
    assert.equal(npsFromCounts({ promoters: 0, passives: 0, detractors: 3 }), -100);
    assert.equal(npsFromCounts({ promoters: 2, passives: 1, detractors: 0 }), 67);
    assert.equal(npsFromCounts({ promoters: 0, passives: 0, detractors: 0 }), null);
  });
});

describe('cevap denetimi', () => {
  const questions = [
    Q('nps', 'NPS', { required: true }),
    Q('room', 'RATING', { required: true }),
    Q('fb', 'RATING'),
    Q('trip', 'CHOICE', { options: [{ id: 'business' }, { id: 'leisure' }] }),
    Q('extras', 'CHOICE', { multiple: true, options: [{ id: 'spa' }, { id: 'pool' }] }),
    Q('note', 'TEXT'),
  ];

  it('zorunlu boş, aralık dışı puan, yabancı / çift seçenek, tekli soruda iki seçenek reddedilir; isteğe bağlı boş kalabilir', () => {
    const { problems, unknown } = surveyAnswerProblems(questions, [
      { questionId: 'nps', score: 11 },
      { questionId: 'fb', score: 0 },
      { questionId: 'trip', choiceIds: ['business', 'leisure'] },
      { questionId: 'extras', choiceIds: ['spa', 'spa'] },
      { questionId: 'note', text: 'x'.repeat(2001) },
    ]);
    assert.deepEqual(Object.keys(problems).sort(), ['extras', 'fb', 'note', 'nps', 'room', 'trip']);
    assert.equal(problems.room, 'Bu soru zorunlu');
    assert.deepEqual(unknown, []);
  });

  it('geçerli cevap sorunsuz; bilinmeyen soru (anket değişti) ayrı döner; boşluktan ibaret metin boştur', () => {
    const { problems, unknown } = surveyAnswerProblems(questions, [
      { questionId: 'nps', score: 0 },
      { questionId: 'room', score: 5 },
      { questionId: 'extras', choiceIds: ['spa', 'pool'] },
      { questionId: 'note', text: '   ' },
      { questionId: 'eski-soru', score: 3 },
    ]);
    assert.deepEqual(problems, {});
    assert.deepEqual(unknown, ['eski-soru']);
  });
});

describe('cevabın özeti', () => {
  const questions = [Q('nps', 'NPS'), Q('a', 'RATING'), Q('b', 'RATING'), Q('t1', 'TEXT'), Q('t2', 'TEXT')];
  const thresholds = { lowNpsThreshold: 6, lowRatingThreshold: 2 };

  it('NPS, kategori, puan ortalaması ve yorumların birleşimi', () => {
    const result = scoreSurveyResponse(questions, [{ questionId: 'nps', score: 9 }, { questionId: 'a', score: 5 }, { questionId: 'b', score: 4 }, { questionId: 't1', text: ' Harika kahvaltı ' }, { questionId: 't2', text: 'Asansör yavaş' }], thresholds);
    assert.deepEqual(result, { npsScore: 9, npsCategory: 'PROMOTER', ratingAverage: 4.5, lowScore: false, commentText: 'Harika kahvaltı\n\nAsansör yavaş' });
  });

  it('düşük: NPS eşikte ya da altında, ya da herhangi bir puan eşikte; NPS sorusu yoksa yalnız puana bakılır', () => {
    assert.equal(scoreSurveyResponse(questions, [{ questionId: 'nps', score: 6 }], thresholds).lowScore, true);
    assert.equal(scoreSurveyResponse(questions, [{ questionId: 'nps', score: 7 }], thresholds).lowScore, false);
    assert.equal(scoreSurveyResponse(questions, [{ questionId: 'nps', score: 10 }, { questionId: 'a', score: 2 }], thresholds).lowScore, true, 'NPS yüksek ama bir bölüm kötü');
    const mid = scoreSurveyResponse([Q('overall', 'RATING')], [{ questionId: 'overall', score: 1 }], thresholds);
    assert.deepEqual([mid.npsScore, mid.npsCategory, mid.ratingAverage, mid.lowScore, mid.commentText], [null, null, 1, true, null]);
  });
});

describe('gönderim zamanı', () => {
  const post = { postStayDelayDays: 1, postStaySendHour: 11 };
  it('çıkış sonrası: ertesi gün saat 11’den itibaren; öncesi değil; iki günden geç değil', () => {
    const due = (today, hour) => postStaySurveyDue({ departureDay: '2026-11-10', today, hour, settings: post });
    assert.deepEqual([due('2026-11-10', 20), due('2026-11-11', 10), due('2026-11-11', 11), due('2026-11-12', 3), due('2026-11-13', 23), due('2026-11-14', 12)], [false, false, true, true, true, false]);
    assert.equal(postStaySurveyDue({ departureDay: '2026-11-10', today: '2026-11-10', hour: 11, settings: { ...post, postStayDelayDays: 0 } }), true, 'aynı gün de seçilebilir');
  });

  it('ara anket: girişin ertesi günü saat 18’den, bir gün gecikmeyle de; kısa konaklamaya ve ayrılış gününe gitmez', () => {
    const settings = { midStaySendHour: 18, midStayMinNights: 2 };
    const due = (today, hour, departureDay = '2026-11-14') => midStaySurveyDue({ arrivalDay: '2026-11-10', departureDay, today, hour, settings });
    assert.deepEqual([due('2026-11-10', 20), due('2026-11-11', 17), due('2026-11-11', 18), due('2026-11-12', 9), due('2026-11-13', 19)], [false, false, true, true, false]);
    assert.equal(due('2026-11-11', 19, '2026-11-11'), false, 'bir gece: kısa');
    assert.equal(due('2026-11-12', 19, '2026-11-12'), false, 'ayrılış günü');
  });
});

describe('şemalar ve diller', () => {
  it('varsayılan sorular şemadan geçer, dört dili tam; tek NPS', () => {
    for (const questions of Object.values(SURVEY_DEFAULT_QUESTIONS)) {
      for (const question of questions) surveyQuestionInputSchema.parse(question);
      assert.deepEqual(surveyMissingLanguages(questions), []);
      assert.ok(questions.filter((question) => question.type === 'NPS').length <= 1);
    }
    assert.deepEqual(SURVEY_LANGUAGES, ['tr', 'en', 'de', 'ru']);
  });

  it('seçenekli soruda en az iki seçenek; seçenek yalnız seçenekli soruda; Türkçe metin zorunlu, eksik dil Türkçeye düşer', () => {
    assert.throws(() => surveyQuestionInputSchema.parse({ type: 'CHOICE', text: { tr: 'Neden?' }, options: [{ label: { tr: 'A' } }] }));
    assert.throws(() => surveyQuestionInputSchema.parse({ type: 'RATING', text: { tr: 'Oda' }, options: [{ label: { tr: 'A' } }, { label: { tr: 'B' } }] }));
    assert.throws(() => surveyQuestionInputSchema.parse({ type: 'RATING', text: { tr: ' ', en: 'Room' } }));
    const parsed = surveyQuestionInputSchema.parse({ type: 'RATING', text: { tr: 'Oda' } });
    assert.equal(surveyText(parsed.text, 'de'), 'Oda');
    assert.deepEqual(surveyMissingLanguages([parsed]), ['en', 'de', 'ru']);
  });

  it('ayar: yorum bağlantısı https, boşsa yok; rapor dönemi en fazla bir yıl, bitiş başlangıçtan önce olamaz', () => {
    const base = { postStayEnabled: true, postStayDelayDays: 1, postStaySendHour: 11, midStayEnabled: false, midStaySendHour: 18, midStayMinNights: 2, minDaysBetweenSurveys: 30, linkValidDays: 14, lowNpsThreshold: 6, lowRatingThreshold: 2 };
    assert.equal(surveySettingsSchema.parse({ ...base, googleReviewUrl: '' }).googleReviewUrl, null);
    assert.throws(() => surveySettingsSchema.parse({ ...base, googleReviewUrl: 'http://g.page/x' }));
    assert.equal(surveyReportQuerySchema.parse({ from: '2026-01-01', to: '2026-12-31' }).kind, 'POST_STAY');
    assert.throws(() => surveyReportQuerySchema.parse({ from: '2026-01-01', to: '2027-01-02' }));
    assert.throws(() => surveyReportQuerySchema.parse({ from: '2026-02-01', to: '2026-01-01' }));
  });
});
