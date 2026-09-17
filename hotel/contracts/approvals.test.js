import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  APPROVAL_EXPIRING_SOON_MS,
  approvalDecisionError,
  approvalListQuerySchema,
  approvalRequestSchema,
  approvalTiming,
  denyApprovalSchema,
  grantApprovalSchema,
} from './approvals.js';

const NOW = Date.parse('2026-09-17T10:00:00.000Z');
const at = (ms) => new Date(NOW + ms).toISOString();

describe('approvalTiming', () => {
  it('süresiz bekleyen onay: kalan süre yok, yaklaşmıyor', () => {
    assert.deepEqual(approvalTiming({ status: 'PENDING', expiresAt: null }, NOW), {
      active: true,
      expired: false,
      minutesLeft: null,
      expiringSoon: false,
    });
  });

  it('kalan süre yukarı yuvarlanır; son saat "yaklaşıyor"', () => {
    const timing = approvalTiming({ status: 'PENDING', expiresAt: at(APPROVAL_EXPIRING_SOON_MS - 30_000) }, NOW);
    assert.equal(timing.minutesLeft, 60);
    assert.equal(timing.expiringSoon, true);
    assert.equal(approvalTiming({ status: 'PENDING', expiresAt: at(2 * 60 * 60_000) }, NOW).expiringSoon, false);
  });

  it('süresi geçmiş ama tarayıcı henüz düşürmemiş onay "dolmuş" sayılır', () => {
    const timing = approvalTiming({ status: 'PENDING', expiresAt: at(-1) }, NOW);
    assert.equal(timing.expired, true);
    assert.equal(timing.minutesLeft, 0);
    assert.equal(timing.expiringSoon, false);
  });

  it('karara bağlanmış onay etkin değildir', () => {
    assert.equal(approvalTiming({ status: 'GRANTED', expiresAt: at(60_000) }, NOW).active, false);
    assert.equal(approvalTiming({ status: 'EXPIRED', expiresAt: at(-60_000) }, NOW).expired, true);
  });
});

describe('approvalDecisionError', () => {
  it('bekleyen ve süresi geçmemiş onaya karar verilir', () => {
    assert.equal(approvalDecisionError({ status: 'PENDING', expiresAt: at(60_000) }, NOW), null);
    assert.equal(approvalDecisionError({ status: 'PENDING', expiresAt: null }, NOW), null);
  });

  it('karara bağlanmış ya da süresi dolmuş onay reddedilir', () => {
    assert.match(approvalDecisionError({ status: 'DENIED' }, NOW), /zaten karara bağlanmış \(Reddedildi\)/);
    assert.match(approvalDecisionError({ status: 'PENDING', expiresAt: at(-1) }, NOW), /süresi dolmuş/);
  });
});

describe('şemalar', () => {
  it('liste sorgusu varsayılanları: bekleyen görünüm, sayfa boyu', () => {
    const parsed = approvalListQuerySchema.parse({});
    assert.equal(parsed.view, 'PENDING');
    assert.equal(parsed.limit, 20);
    assert.equal(approvalListQuerySchema.safeParse({ status: 'PENDING' }).success, false, 'bekleyen durum süzgeç değil');
    assert.equal(approvalListQuerySchema.safeParse({ limit: 500 }).success, false);
  });

  it('ret gerekçe ister, onayda not isteğe bağlı', () => {
    assert.equal(denyApprovalSchema.safeParse({ note: '  ' }).success, false);
    assert.equal(denyApprovalSchema.safeParse({ note: 'Bütçe yok' }).success, true);
    assert.equal(grantApprovalSchema.safeParse({}).success, true);
    assert.equal(grantApprovalSchema.safeParse({ note: 'x'.repeat(501) }).success, false);
  });

  it('onay isteği: tutar metne çevrilir, para birimi büyük harf, süre sınırlı', () => {
    const parsed = approvalRequestSchema.parse({
      type: 'REFUND',
      summary: ' 1.250 TL iade ',
      amount: 1250,
      currency: 'try',
    });
    assert.equal(parsed.summary, '1.250 TL iade');
    assert.equal(parsed.amount, '1250');
    assert.equal(parsed.currency, 'TRY');
    assert.deepEqual(parsed.data, {});
    assert.equal(parsed.expiresInMs, undefined, 'süre verilmedi: varsayılan uygulanır');
    assert.equal(approvalRequestSchema.parse({ type: 'OTHER', summary: 'x', expiresInMs: null }).expiresInMs, null);
    assert.equal(approvalRequestSchema.safeParse({ type: 'OTHER', summary: 'x', expiresInMs: 1000 }).success, false);
    assert.equal(approvalRequestSchema.safeParse({ type: 'OTHER', summary: 'x', amount: '12.345' }).success, false);
    assert.equal(approvalRequestSchema.safeParse({ type: 'UYDURMA', summary: 'x' }).success, false);
  });
});
