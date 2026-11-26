import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectReviewAnomalies, parseReviewImportRow, reviewCreateSchema, reviewDedupeBasis, reviewRatingPct, reviewReplySchema, reviewWeekStart, suggestReviewMapping } from './reviews.js';

const TODAY = '2026-11-26';

describe('yorum puanı ve anahtar', () => {
  it('puan yüzdeye çevrilir (Booking 10, Google 5)', () => {
    assert.deepEqual([reviewRatingPct(8.4, 10), reviewRatingPct(4, 5), reviewRatingPct(null, 5), reviewRatingPct('', 5)], [84, 80, null, null]);
  });

  it('dış kimlik varsa yalnız o; yoksa gün + yazar + metin (büyük / küçük harf ve boşluk duyarsız)', () => {
    assert.equal(reviewDedupeBasis({ source: 'BOOKING', externalId: ' 123 ', reviewedAt: TODAY, text: 'x' }), 'BOOKING|id|123');
    assert.equal(reviewDedupeBasis({ source: 'GOOGLE', reviewedAt: TODAY, authorName: 'Ayşe  K.', text: 'Çok  güzel' }), reviewDedupeBasis({ source: 'GOOGLE', reviewedAt: TODAY, authorName: 'ayşe k.', text: 'çok güzel' }));
  });

  it('haftanın pazartesisi', () => {
    assert.deepEqual([reviewWeekStart('2026-11-26'), reviewWeekStart('2026-11-23'), reviewWeekStart('2026-11-29')], ['2026-11-23', '2026-11-23', '2026-11-23']);
  });
});

describe('anomali', () => {
  it('olumsuz konu en az 3 ve tabanın 2 katı; "Diğer" sayılmaz', () => {
    const found = detectReviewAnomalies({ CLEANLINESS: 6, NOISE: 3, STAFF: 4, OTHER: 9 }, { CLEANLINESS: [2, 2, 1, 3], NOISE: [], STAFF: [3, 4, 3, 4] });
    assert.deepEqual(found, [
      { topic: 'CLEANLINESS', count: 6, baseline: 2, factor: 3 },
      { topic: 'NOISE', count: 3, baseline: 0, factor: 3 },
    ]);
    assert.deepEqual(detectReviewAnomalies({ ROOM: 2 }, {}), [], '3\'ün altı');
  });
});

describe('içe aktarma', () => {
  it('Booking dışa aktarım başlıkları eşleşir', () => {
    const mapping = suggestReviewMapping(['Review date', 'Guest name', 'Review title', 'Positive review', 'Negative review', 'Review score', 'Property reply']);
    assert.deepEqual([mapping.reviewedAt, mapping.authorName, mapping.title, mapping.positive, mapping.negative, mapping.rating, mapping.existingReply, mapping.text], [0, 1, 2, 3, 4, 5, 6, null]);
  });

  it('Google başlıkları eşleşir', () => {
    const mapping = suggestReviewMapping(['Reviewer', 'Star rating', 'Comment', 'Create time']);
    assert.deepEqual([mapping.authorName, mapping.rating, mapping.text, mapping.reviewedAt], [0, 1, 2, 3]);
  });

  it('satır: olumlu / olumsuz birleşir, yerel tarih, virgüllü puan; hatalar', () => {
    const ok = parseReviewImportRow({ reviewedAt: '24.11.2026', rating: '8,5', positive: 'Kahvaltı harika', negative: 'Oda soğuktu' }, { source: 'BOOKING', scale: 10, today: TODAY });
    assert.equal(ok.ok, true);
    assert.deepEqual([ok.value.reviewedAt, ok.value.rating, ok.value.text], ['2026-11-24', 8.5, 'Olumlu: Kahvaltı harika\nOlumsuz: Oda soğuktu']);
    const iso = parseReviewImportRow({ reviewedAt: '2026-11-20T09:31:00Z', rating: '4', text: 'Güzel' }, { source: 'GOOGLE', scale: 5, today: TODAY });
    assert.deepEqual([iso.value.reviewedAt, iso.value.rating], ['2026-11-20', 4]);
    const serial = parseReviewImportRow({ reviewedAt: '46350', rating: 9 }, { source: 'BOOKING', scale: 10, today: TODAY });
    assert.equal(serial.value.reviewedAt, '2026-11-24', 'Excel seri günü');
    const bad = parseReviewImportRow({ reviewedAt: 'dün', rating: '12' }, { source: 'BOOKING', scale: 10, today: TODAY });
    assert.deepEqual(bad.errors, ['Tarih okunamadı (GG.AA.YYYY ya da YYYY-AA-GG)', 'Puan 0–10 arasında olmalı']);
    assert.deepEqual(parseReviewImportRow({ reviewedAt: '30.11.2026', text: 'x' }, { source: 'GOOGLE', scale: 5, today: TODAY }).errors, ['Tarih gelecekte olamaz']);
  });
});

describe('şemalar', () => {
  it('kaynağın ölçeği aşılamaz; metin ya da puan şart', () => {
    assert.match(reviewCreateSchema.safeParse({ source: 'GOOGLE', reviewedAt: TODAY, rating: 7 }).error.issues[0].message, /en çok 5/);
    assert.equal(reviewCreateSchema.safeParse({ source: 'GOOGLE', reviewedAt: TODAY }).success, false);
    assert.equal(reviewCreateSchema.safeParse({ source: 'BOOKING', reviewedAt: TODAY, rating: 9.2, text: 'İyi' }).success, true);
  });

  it('cevap: "gerekmiyor" dışında metin zorunlu', () => {
    assert.equal(reviewReplySchema.safeParse({ status: 'REPLIED', replyText: '' }).success, false);
    assert.equal(reviewReplySchema.safeParse({ status: 'NOT_NEEDED' }).success, true);
  });
});

describe('inceleme düzeltmeleri', () => {
  it('30 Şubat okunmaz; elle eklemede de', async () => {
    const { isRealDay, parseReviewImportRow: parse, reviewCreateSchema: schema } = await import('./reviews.js');
    assert.equal(isRealDay('2026-02-30'), false);
    assert.equal(parse({ reviewedAt: '30.02.2026', rating: '8' }, { source: 'BOOKING', scale: 10, today: TODAY }).ok, false);
    assert.equal(schema.safeParse({ source: 'BOOKING', reviewedAt: '2026-02-30', rating: 8 }).success, false);
  });

  it('puan: "4/5" ölçeğe çevrilir, "FIVE" okunur, "/5" hata; saatli ISO otel saatinde güne; dil adı kod değilse boş', async () => {
    const { parseReviewImportRow: parse, readRating } = await import('./reviews.js');
    assert.deepEqual([readRating('4/5', 10), readRating('FIVE', 5), readRating('8,4', 10)], [8, 5, 8.4]);
    assert.equal(parse({ reviewedAt: TODAY, rating: '/5' }, { source: 'BOOKING', scale: 10, today: TODAY }).ok, false);
    const late = parse({ reviewedAt: '2026-11-20T22:30:00Z', rating: '4', language: 'German' }, { source: 'GOOGLE', scale: 5, today: TODAY, timeZone: 'Europe/Istanbul' });
    assert.deepEqual([late.value.reviewedAt, late.value.language], ['2026-11-21', null]);
    assert.equal(parse({ reviewedAt: TODAY, rating: '4', language: 'en-GB' }, { source: 'GOOGLE', scale: 5, today: TODAY }).value.language, 'en');
  });

  it('anahtar puanı içerir; bağlantı yalnız http(s)', async () => {
    const { reviewDedupeBasis: basis, reviewCreateSchema: schema } = await import('./reviews.js');
    assert.notEqual(basis({ source: 'GOOGLE', reviewedAt: TODAY, rating: 5 }), basis({ source: 'GOOGLE', reviewedAt: TODAY, rating: 1 }));
    assert.equal(schema.safeParse({ source: 'GOOGLE', reviewedAt: TODAY, rating: 4, url: 'javascript:alert(1)' }).success, false);
  });
});
