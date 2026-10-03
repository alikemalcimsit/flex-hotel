import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LOST_ITEM_PHOTO_MAX_BYTES } from '@hotelos/hotel-contracts';
import { decodePhoto, photoKeys, rankCandidates, roomIntervals, sniffImageType } from './rules.js';

const at = (text) => new Date(text);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('rankCandidates', () => {
  const found = at('2026-10-10T11:00:00Z');

  it('odadaki misafir önce, sonra en son ayrılan; bulunduktan sonra gelen ve süresi geçen aday değil', () => {
    const ranked = rankCandidates(
      [
        { reservationId: 'eski', from: at('2026-09-20T14:00:00Z'), to: at('2026-09-25T10:00:00Z') }, // 15 gün önce çıktı
        { reservationId: 'dun', from: at('2026-10-07T14:00:00Z'), to: at('2026-10-09T10:30:00Z') },
        { reservationId: 'bu-sabah', from: at('2026-10-08T14:00:00Z'), to: at('2026-10-10T09:15:00Z') },
        { reservationId: 'icerde', from: at('2026-10-10T10:00:00Z'), to: null },
        { reservationId: 'sonra-geldi', from: at('2026-10-10T15:00:00Z'), to: null },
      ],
      found,
    );
    assert.deepEqual(
      ranked.map((entry) => [entry.reservationId, entry.relation]),
      [
        ['icerde', 'IN_ROOM'],
        ['bu-sabah', 'DEPARTED'],
        ['dun', 'DEPARTED'],
      ],
    );
    assert.equal(ranked[1].gapMs, 105 * 60 * 1000);
  });

  it('çıkışı bulunmadan sonra olan (eşya bulunduğunda odadaydı) IN_ROOM sayılır', () => {
    const [entry] = rankCandidates([{ reservationId: 'r', from: at('2026-10-08T14:00:00Z'), to: at('2026-10-10T12:00:00Z') }], found);
    assert.equal(entry.relation, 'IN_ROOM');
    assert.equal(entry.gapMs, 0);
  });

  it('aynı konaklamanın iki aralığından en yakını sayılır (gidip geri döndü)', () => {
    const ranked = rankCandidates(
      [
        { reservationId: 'r', from: at('2026-10-01T14:00:00Z'), to: at('2026-10-04T09:00:00Z') },
        { reservationId: 'r', from: at('2026-10-06T14:00:00Z'), to: at('2026-10-09T09:00:00Z') },
      ],
      found,
    );
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].leftAt.toISOString(), '2026-10-09T09:00:00.000Z');
  });

  it('geriye bakma süresi ve aday sınırı uygulanır', () => {
    const stays = Array.from({ length: 6 }, (_, index) => ({
      reservationId: `r${index}`,
      from: at('2026-10-01T00:00:00Z'),
      to: new Date(found.getTime() - (index + 1) * 60 * 60 * 1000),
    }));
    assert.deepEqual(
      rankCandidates(stays, found, { limit: 3 }).map((entry) => entry.reservationId),
      ['r0', 'r1', 'r2'],
    );
    assert.equal(rankCandidates([{ reservationId: 'x', from: at('2026-10-01T00:00:00Z'), to: at('2026-10-08T10:00:00Z') }], found, { lookbackDays: 1 }).length, 0);
  });
});

describe('roomIntervals', () => {
  it('şimdiki oda: taşındıysa taşınma günü, değilse giriş anı; çıkmamışsa açık uçlu; eski dilim taşıma anında biter', () => {
    const intervals = roomIntervals({
      current: [
        {
          id: 'a',
          status: 'CHECKED_IN',
          checkIn: at('2026-10-05T00:00:00Z'),
          checkOut: at('2026-10-12T00:00:00Z'),
          roomSince: at('2026-10-08T00:00:00Z'),
          checkedInAt: at('2026-10-05T15:00:00Z'),
          checkedOutAt: null,
        },
        {
          id: 'b',
          status: 'CHECKED_OUT',
          checkIn: at('2026-10-01T00:00:00Z'),
          checkOut: at('2026-10-05T00:00:00Z'),
          roomSince: null,
          checkedInAt: at('2026-10-01T16:00:00Z'),
          checkedOutAt: at('2026-10-05T09:40:00Z'),
        },
      ],
      segments: [{ reservationId: 'c', startDate: at('2026-10-03T00:00:00Z'), endDate: at('2026-10-06T00:00:00Z'), createdAt: at('2026-10-06T11:20:00Z') }],
    });
    assert.deepEqual(
      intervals.map((entry) => [entry.reservationId, entry.from.toISOString(), entry.to?.toISOString() ?? null]),
      [
        ['a', '2026-10-08T00:00:00.000Z', null],
        ['b', '2026-10-01T16:00:00.000Z', '2026-10-05T09:40:00.000Z'],
        ['c', '2026-10-03T00:00:00.000Z', '2026-10-06T11:20:00.000Z'],
      ],
    );
  });
});

describe('fotoğraf doğrulama', () => {
  it('türü imzadan tanır', () => {
    assert.equal(sniffImageType(JPEG), 'image/jpeg');
    assert.equal(sniffImageType(WEBP), 'image/webp');
    assert.equal(sniffImageType(PNG), null);
    assert.equal(sniffImageType(Buffer.from('<svg onload=alert(1)>')), null);
    assert.equal(sniffImageType(Buffer.alloc(0)), null);
  });

  it('geçerli fotoğrafı ve önizlemeyi çözer', () => {
    const result = decodePhoto({ contentType: 'image/jpeg', image: JPEG.toString('base64'), thumbnail: JPEG.toString('base64') });
    assert.ok(!('error' in result));
    assert.deepEqual(result.image, JPEG);
  });

  it('bozuk veriyi, yanlış türü, uyuşmayan türü ve büyük dosyayı reddeder', () => {
    const b64 = (buffer) => buffer.toString('base64');
    assert.match(decodePhoto({ contentType: 'image/jpeg', image: 'not base64!', thumbnail: b64(JPEG) }).error, /okunamadı/);
    assert.match(decodePhoto({ contentType: 'image/jpeg', image: b64(PNG), thumbnail: b64(JPEG) }).error, /JPEG ya da WebP değil/);
    assert.match(decodePhoto({ contentType: 'image/jpeg', image: b64(WEBP), thumbnail: b64(JPEG) }).error, /uyuşmuyor/);
    assert.match(decodePhoto({ contentType: 'image/jpeg', image: b64(JPEG), thumbnail: b64(PNG) }).error, /Önizleme JPEG ya da WebP değil/);
    const big = Buffer.concat([JPEG, Buffer.alloc(LOST_ITEM_PHOTO_MAX_BYTES)]);
    assert.match(decodePhoto({ contentType: 'image/jpeg', image: b64(big), thumbnail: b64(JPEG) }).error, /çok büyük/);
  });

  it('disk anahtarı otel klasöründe, türe göre uzantılı', () => {
    assert.deepEqual(photoKeys({ id: 'p1', hotelId: 'h1', contentType: 'image/webp' }), {
      full: 'lost-items/h1/p1.webp',
      thumb: 'lost-items/h1/p1.thumb.webp',
    });
    assert.throws(() => photoKeys({ id: 'p1', hotelId: 'h1', contentType: 'image/png' }), /Bilinmeyen/);
  });
});
