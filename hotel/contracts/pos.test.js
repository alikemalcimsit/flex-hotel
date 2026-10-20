import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  MAX_ORDER_LINES,
  closePosShiftSchema,
  createMenuItemSchema,
  equalShares,
  openPosShiftSchema,
  posAdjustmentSchema,
  posPaymentSchema,
  posSalesQuerySchema,
  sendPosOrderSchema,
  splitPosCheckSchema,
  tableState,
  updatePosSettingsSchema,
} from './pos.js';
import * as pos from './pos.js';
import * as contracts from './index.js';

/**
 * Restoran POS sözleşmesi (modül 39): düzeltme biçimi (indirimde yüzde ya da tutar, kalemde
 * adet, zayi yalnızca iptalde), kart ödemesinde slip zorunlu ve kart numarası yasak, kasa
 * tutarları, sipariş turu sınırları, bölmede tekrar eden kalem, rapor aralığı, hesap bölüşme.
 */

const id = () => randomUUID();
const issuesOf = (result) => Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]));

describe('dışa aktarım', () => {
  it('her POS adı paket kökünden erişilebilir (başka modülle ad çakışması yok)', () => {
    const missing = Object.keys(pos).filter((name) => contracts[name] !== pos[name]);
    assert.deepEqual(missing, []);
  });
});

describe('düzeltme', () => {
  it('indirim: yüzde ya da tutar (yalnızca biri), kaleme bağlanmaz; %100 üstü yok', () => {
    assert.equal(posAdjustmentSchema.safeParse({ kind: 'DISCOUNT', discountPct: '10', reason: 'Sadakat' }).success, true);
    assert.equal(posAdjustmentSchema.safeParse({ kind: 'DISCOUNT', discountAmount: '50,5', reason: 'Jest' }).success, true);
    assert.match(issuesOf(posAdjustmentSchema.safeParse({ kind: 'DISCOUNT', reason: 'Boş' })).discountPct, /yalnızca biri/);
    assert.match(issuesOf(posAdjustmentSchema.safeParse({ kind: 'DISCOUNT', discountPct: '10', discountAmount: '5', reason: 'İkisi' })).discountPct, /yalnızca biri/);
    assert.match(issuesOf(posAdjustmentSchema.safeParse({ kind: 'DISCOUNT', discountPct: '101', reason: 'Fazla' })).discountPct, /en fazla %100/);
    assert.match(issuesOf(posAdjustmentSchema.safeParse({ kind: 'DISCOUNT', discountPct: '5', lineId: id(), reason: 'Kalem' })).lineId, /adisyona/);
  });

  it('ikram / iptal: kalem ve adet zorunlu; zayi yalnızca iptalde; gerekçe kısa olamaz, kart numarası içeremez', () => {
    assert.equal(posAdjustmentSchema.safeParse({ kind: 'VOID', lineId: id(), quantity: 2, waste: true, reason: 'Yere düştü' }).success, true);
    const missing = issuesOf(posAdjustmentSchema.safeParse({ kind: 'COMP', reason: 'İkram' }));
    assert.ok(missing.lineId && missing.quantity);
    assert.match(issuesOf(posAdjustmentSchema.safeParse({ kind: 'COMP', lineId: id(), quantity: 1, waste: true, reason: 'İkram' })).waste, /yalnızca iptalde/);
    assert.match(issuesOf(posAdjustmentSchema.safeParse({ kind: 'COMP', lineId: id(), quantity: 1, reason: 'ab' })).reason, /en az 3/);
    assert.match(issuesOf(posAdjustmentSchema.safeParse({ kind: 'COMP', lineId: id(), quantity: 1, reason: 'Kart 4111 1111 1111 1111' })).reason, /Kart numarası/);
    assert.match(issuesOf(posAdjustmentSchema.safeParse({ kind: 'COMP', lineId: id(), quantity: 1, discountPct: '5', reason: 'Karışık' })).discountPct, /yalnızca adisyona/);
  });
});

describe('ödeme ve kasa', () => {
  it('kart ödemesinde slip zorunlu, kart numarası yazılamaz; tutar sıfırdan büyük', () => {
    assert.equal(posPaymentSchema.safeParse({ requestId: id(), method: 'CASH', amount: '100' }).success, true);
    assert.match(issuesOf(posPaymentSchema.safeParse({ requestId: id(), method: 'CARD', amount: '100' })).reference, /zorunlu/);
    assert.match(issuesOf(posPaymentSchema.safeParse({ requestId: id(), method: 'CARD', amount: '100', reference: '4111111111111111' })).reference, /Kart numarası/);
    assert.ok(issuesOf(posPaymentSchema.safeParse({ requestId: id(), method: 'CASH', amount: '0' })).amount);
    assert.ok(issuesOf(posPaymentSchema.safeParse({ requestId: id(), method: 'TRANSFER', amount: '10' })).method);
  });

  it('kasa avansı ve sayım sıfır olabilir; 2 ondalık; yazım hatası sınırı', () => {
    assert.equal(openPosShiftSchema.parse({ openingFloat: '0' }).openingFloat, '0');
    assert.equal(openPosShiftSchema.parse({ openingFloat: '250,50' }).openingFloat, '250.5');
    assert.ok(issuesOf(openPosShiftSchema.safeParse({ openingFloat: '1.234' })).openingFloat);
    assert.match(issuesOf(closePosShiftSchema.safeParse({ expectedUpdatedAt: new Date().toISOString(), countedCash: '10000001' })).countedCash, /çok yüksek/);
    assert.equal(updatePosSettingsSchema.safeParse({ adjustmentApprovalAmount: '0', cashVarianceAlert: '0' }).success, true);
  });
});

describe('sipariş, bölme, rapor', () => {
  it('sipariş turu: en az bir, en fazla 60 kalem; adet 1–99', () => {
    const line = { menuItemId: id(), quantity: 1 };
    assert.equal(sendPosOrderSchema.safeParse({ requestId: id(), lines: [line] }).success, true);
    assert.ok(issuesOf(sendPosOrderSchema.safeParse({ requestId: id(), lines: [] })).lines);
    assert.ok(issuesOf(sendPosOrderSchema.safeParse({ requestId: id(), lines: Array.from({ length: MAX_ORDER_LINES + 1 }, () => line) })).lines);
    assert.ok(issuesOf(sendPosOrderSchema.safeParse({ requestId: id(), lines: [{ ...line, quantity: 100 }] }))['lines.0.quantity']);
  });

  it('bölmede aynı kalem iki kez seçilemez', () => {
    const lineId = id();
    const result = splitPosCheckSchema.safeParse({ expectedUpdatedAt: new Date().toISOString(), lines: [{ lineId, quantity: 1 }, { lineId, quantity: 1 }] });
    assert.match(issuesOf(result).lines, /iki kez/);
  });

  it('satış raporu: en fazla 31 gün, bitiş başlangıçtan önce olamaz, geçersiz gün yok', () => {
    assert.equal(posSalesQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success, true);
    assert.match(issuesOf(posSalesQuerySchema.safeParse({ from: '2026-10-01', to: '2026-11-01' })).to, /31 gün/);
    assert.match(issuesOf(posSalesQuerySchema.safeParse({ from: '2026-10-05', to: '2026-10-04' })).to, /önce olamaz/);
    assert.ok(issuesOf(posSalesQuerySchema.safeParse({ from: '2026-02-31', to: '2026-03-01' })).from);
    // Uçlar birlikte ya da hiç (hiç verilmezse sunucu iş gününü alır).
    assert.equal(posSalesQuerySchema.safeParse({}).success, true);
    assert.match(issuesOf(posSalesQuerySchema.safeParse({ from: '2026-10-01' })).to, /birlikte/);
  });

  it('menü ürünü: fiyat sıfırdan büyük; kod büyük harfe; vergi kategorisi ve istasyon varsayılanları', () => {
    const parsed = createMenuItemSchema.parse({ categoryId: id(), code: 'kofte-1', name: 'Izgara köfte', price: '450' });
    assert.equal(parsed.code, 'KOFTE-1');
    assert.equal(parsed.taxCategory, 'FNB');
    assert.equal(parsed.station, 'HOT');
    assert.ok(issuesOf(createMenuItemSchema.safeParse({ categoryId: id(), name: 'Bedava', price: '0' })).price);
  });

  it('hesap bölüşme ve masa durumu', () => {
    assert.deepEqual(equalShares('1250.10', 4), ['312.53', '312.53', '312.52', '312.52']);
    assert.equal(tableState([{ billRequestedAt: null }]), 'OCCUPIED');
  });
});
