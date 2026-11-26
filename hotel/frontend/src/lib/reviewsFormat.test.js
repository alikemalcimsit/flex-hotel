import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  anomalyText,
  formatReviewRating,
  hasReviewTextColumn,
  missingReviewFields,
  negativeShare,
  parseCsv,
  ratingPctTone,
  reviewImportRows,
  reviewReplyTone,
  reviewSourceTone,
  reviewStars,
  sentimentScoreView,
  sortTopicsByNegative,
  splitReviewSheet,
  weeklyChartData,
} from './reviewsFormat.js';

describe('yorum puanı', () => {
  it('puan metni kaynağın ölçeğiyle', () => {
    assert.equal(formatReviewRating(8.4, 10), '8,4 / 10');
    assert.equal(formatReviewRating(4, 5), '4 / 5');
    assert.equal(formatReviewRating(null, 5), '—');
    assert.equal(formatReviewRating(3, null), '—');
  });

  it('yıldız sayısı yüzdeden', () => {
    assert.equal(reviewStars(84), 4);
    assert.equal(reviewStars(100), 5);
    assert.equal(reviewStars(0), 0);
    assert.equal(reviewStars(null), 0);
    assert.equal(reviewStars(130), 5);
  });

  it('ortalama yüzdenin rengi', () => {
    assert.equal(ratingPctTone(86), 'success');
    assert.equal(ratingPctTone(70), 'warning');
    assert.equal(ratingPctTone(40), 'danger');
    assert.equal(ratingPctTone(null), 'neutral');
  });
});

describe('duygu puanı ve rozetler', () => {
  it('puan bandı, etiket ve işaret', () => {
    assert.deepEqual(sentimentScoreView(62), { tone: 'success', label: 'Çok olumlu', text: '+62' });
    assert.deepEqual(sentimentScoreView(0), { tone: 'neutral', label: 'Nötr', text: '0' });
    assert.deepEqual(sentimentScoreView(-30), { tone: 'warning', label: 'Olumsuz', text: '-30' });
    assert.deepEqual(sentimentScoreView(-80), { tone: 'danger', label: 'Çok olumsuz', text: '-80' });
    assert.equal(sentimentScoreView(null).text, '—');
  });

  it('kaynak ve cevap tonları', () => {
    assert.equal(reviewSourceTone('GOOGLE'), 'info');
    assert.equal(reviewSourceTone('XYZ'), 'neutral');
    assert.equal(reviewReplyTone('REPLIED'), 'success');
    assert.equal(reviewReplyTone('NONE'), 'warning');
  });
});

describe('dosya', () => {
  it('CSV: noktalı virgül, tırnak, satır içi satır sonu, BOM', () => {
    const rows = parseCsv('﻿Tarih;Yorum;Puan\r\n01.11.2026;"Güzel; temiz ""oda""";9\n02.11.2026;"iki\nsatır";8\n');
    assert.deepEqual(rows, [
      ['Tarih', 'Yorum', 'Puan'],
      ['01.11.2026', 'Güzel; temiz "oda"', '9'],
      ['02.11.2026', 'iki\nsatır', '8'],
    ]);
    assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  });

  it('sayfa başlık + dolu satırlar', () => {
    const result = splitReviewSheet([['Tarih', null], ['2026-11-01', 'x'], ['', '']]);
    assert.deepEqual(result.headers, ['Tarih', 'Sütun 2']);
    assert.equal(result.rows.length, 1);
    assert.deepEqual(splitReviewSheet([]).errors, ['Dosya boş.']);
    assert.equal(splitReviewSheet([['Tarih']]).errors.length, 1);
  });

  it('hücre → alan satırı eşleştirmeye göre', () => {
    const rows = [[new Date(Date.UTC(2026, 10, 1)), 8.4, ' Harika ', 'yok']];
    assert.deepEqual(reviewImportRows(rows, { reviewedAt: 0, rating: 1, text: 2, title: null }), [{ reviewedAt: '2026-11-01', rating: '8.4', text: 'Harika' }]);
  });

  it('zorunlu ve metin sütunu denetimi', () => {
    assert.deepEqual(missingReviewFields({ reviewedAt: null }), ['Tarih']);
    assert.deepEqual(missingReviewFields({ reviewedAt: 0 }), []);
    assert.equal(hasReviewTextColumn({ reviewedAt: 0 }), false);
    assert.equal(hasReviewTextColumn({ reviewedAt: 0, negative: 3 }), true);
  });
});

describe('trend', () => {
  it('haftalık grafik verisi', () => {
    const data = weeklyChartData([
      { week: '2026-11-16', count: 4, averagePct: 80, positive: 2, neutral: 0, negative: 1, mixed: 1 },
      { week: '2026-11-23', count: 2, averagePct: null, positive: 0, neutral: 0, negative: 0, mixed: 0 },
    ]);
    assert.equal(data.maxCount, 4);
    assert.equal(data.bars[0].label, '16.11');
    assert.equal(data.bars[0].countPct, 100);
    assert.equal(data.bars[1].countPct, 50);
    assert.deepEqual(data.bars[0].parts.map((part) => part.pct), [50, 0, 25, 25]);
    assert.equal(data.bars[1].tagged, 0);
    assert.equal(weeklyChartData([]).maxCount, 1);
  });

  it('konular olumsuz paya göre', () => {
    const sorted = sortTopicsByNegative([
      { topic: 'ROOM', count: 10, negative: 2 },
      { topic: 'CLEANLINESS', count: 4, negative: 3 },
      { topic: 'STAFF', count: 5, negative: 0 },
    ]);
    assert.deepEqual(sorted.map((row) => row.topic), ['CLEANLINESS', 'ROOM', 'STAFF']);
    assert.equal(negativeShare({ count: 0, negative: 0 }), 0);
  });

  it('anomali cümlesi', () => {
    assert.equal(anomalyText({ topic: 'CLEANLINESS', count: 6, baseline: 2, factor: 3 }), 'Temizlik şikâyeti bu hafta 3 kat arttı — 6 yorum, önceki ortalama 2');
    assert.equal(anomalyText({ topic: 'WIFI', count: 3, baseline: 0.5, factor: 3 }), 'İnternet şikâyeti bu hafta 3 kat arttı — 3 yorum, önceki ortalama 0,5');
  });
});
