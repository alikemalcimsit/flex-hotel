import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { closingSides, onlyActiveRows, parentIdsOf, signedBalanceText, toggleCollapsed, visibleTreeRows } from './ledgerTree.js';

/** Mizan / hesap planı ağacı (modül 48): daralt / genişlet, hareketli süzgeci, kalan sütunları. */

const ROWS = [
  { id: 'a', parentId: null, hasActivity: true },
  { id: 'a1', parentId: 'a', hasActivity: true },
  { id: 'a1x', parentId: 'a1', hasActivity: true },
  { id: 'a2', parentId: 'a', hasActivity: false },
  { id: 'b', parentId: null, hasActivity: false },
];

describe('ağaç', () => {
  it('çocuğu olan hesaplar bulunur', () => {
    assert.deepEqual([...parentIdsOf(ROWS)].sort(), ['a', 'a1']);
  });

  it('daraltılan hesabın torunları da gizlenir', () => {
    const visible = visibleTreeRows(ROWS, new Set(['a'])).map((row) => row.id);
    assert.deepEqual(visible, ['a', 'b']);
  });

  it('alt seviyede daraltma yalnız o dalı kapatır', () => {
    const visible = visibleTreeRows(ROWS, new Set(['a1'])).map((row) => row.id);
    assert.deepEqual(visible, ['a', 'a1', 'a2', 'b']);
  });

  it('toggle kümeyi değiştirmeden yeni küme döner', () => {
    const start = new Set(['a']);
    const next = toggleCollapsed(start, 'b');
    assert.deepEqual([...next].sort(), ['a', 'b']);
    assert.deepEqual([...start], ['a']);
    assert.deepEqual([...toggleCollapsed(next, 'a')], ['b']);
  });

  it('yalnız hareketliler: hareketsiz yaprak düşer, hareketli yaprağın üstleri kalır', () => {
    assert.deepEqual(onlyActiveRows(ROWS).map((row) => row.id), ['a', 'a1', 'a1x']);
  });
});

describe('kalan sütunları', () => {
  it('artı kapanış borç kalanı, eksi kapanış alacak kalanı, sıfır boş', () => {
    assert.deepEqual(closingSides('125.50'), { debit: '125.50', credit: '' });
    assert.deepEqual(closingSides('-40.00'), { debit: '', credit: '40.00' });
    assert.deepEqual(closingSides('0.00'), { debit: '', credit: '' });
    assert.deepEqual(closingSides(null), { debit: '', credit: '' });
  });

  it('işaretli bakiye B / A ile okunur', () => {
    const format = (value) => value;
    assert.equal(signedBalanceText('10.00', format), '10.00 B');
    assert.equal(signedBalanceText('-10.00', format), '10.00 A');
    assert.equal(signedBalanceText('0.00', format), '—');
  });
});
