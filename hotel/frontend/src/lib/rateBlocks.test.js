import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BLOCKS_EXPANDED_UP_TO, blocksToRates, filledCells, newBlock, rateCellKey, rateSignature, ratesToBlocks, validateBlocks } from './rateBlocks.js';

const STD = '11111111-1111-4111-8111-111111111111';
const DLX = '22222222-2222-4222-8222-222222222222';
const PERIOD = { startDate: '2027-06-01', endDate: '2027-09-30' };

const rate = (roomTypeId, boardType, startDate, endDate, price) => ({ roomTypeId, boardType, startDate, endDate, price });

describe('kontrat fiyat satırları → dönem blokları', () => {
  it('aynı dönemi paylaşan satırları tek bloğa toplar; pansiyonlar katalog sırasında, fiyatlar Türkçe biçimde', () => {
    const blocks = ratesToBlocks([
      rate(STD, 'AI', '2027-06-01', '2027-06-30', '2600.00'),
      rate(STD, 'BB', '2027-06-01', '2027-06-30', '1800.00'),
      rate(DLX, 'BB', '2027-06-01', '2027-06-30', '2900.50'),
      rate(STD, 'BB', '2027-07-01', '2027-07-31', '2100.00'),
    ]);
    assert.equal(blocks.length, 2);
    assert.deepEqual(blocks[0].boards, ['BB', 'AI'], 'BB, AI sırası (katalog sırası)');
    assert.deepEqual([blocks[0].startDate, blocks[0].endDate], ['2027-06-01', '2027-06-30']);
    assert.equal(blocks[0].cells[STD].BB, '1.800');
    assert.equal(blocks[0].cells[STD].AI, '2.600');
    assert.equal(blocks[0].cells[DLX].BB, '2.900,5');
    assert.equal(blocks[0].cells[DLX].AI, undefined, 'satılmayan kombinasyon boş');
    assert.deepEqual(blocks[1].boards, ['BB']);
  });

  it('dönemler başlangıca göre sıralı gelir; az dönem açık, çok dönem kapalı başlar', () => {
    const shuffled = [rate(STD, 'BB', '2027-08-01', '2027-08-31', '3'), rate(STD, 'BB', '2027-06-01', '2027-06-30', '1'), rate(STD, 'BB', '2027-07-01', '2027-07-31', '2')];
    const few = ratesToBlocks(shuffled);
    assert.deepEqual(few.map((block) => block.startDate), ['2027-06-01', '2027-07-01', '2027-08-01']);
    assert.ok(few.every((block) => block.collapsed === false));
    const many = ratesToBlocks(Array.from({ length: BLOCKS_EXPANDED_UP_TO + 1 }, (_, index) => rate(STD, 'BB', `2027-0${index + 1}-01`, `2027-0${index + 1}-28`, '1')));
    assert.ok(many.every((block) => block.collapsed === true));
    assert.deepEqual(ratesToBlocks([]), []);
  });

  it('blok anahtarları benzersiz', () => {
    const keys = new Set([newBlock().key, newBlock().key, ...ratesToBlocks([rate(STD, 'BB', '2027-06-01', '2027-06-30', '1')]).map((block) => block.key)]);
    assert.equal(keys.size, 3);
  });
});

describe('dönem blokları → sunucu satırları', () => {
  it('Türkçe yazılan fiyatı sunucu biçimine çevirir; boş hücre, seçili olmayan pansiyon ve tarihsiz blok satır üretmez', () => {
    const complete = newBlock({ startDate: '2027-06-01', endDate: '2027-06-30', boards: ['BB', 'AI'], cells: { [STD]: { BB: '1.800', AI: '' }, [DLX]: { BB: '2.900,5', HB: '777' } } });
    const noDates = newBlock({ startDate: '', endDate: '2027-07-31', boards: ['BB'], cells: { [STD]: { BB: '5' } } });
    const { rates, meta } = blocksToRates([complete, noDates]);
    assert.deepEqual(rates, [
      rate(STD, 'BB', '2027-06-01', '2027-06-30', '1800'),
      rate(DLX, 'BB', '2027-06-01', '2027-06-30', '2900.5'),
    ]);
    assert.deepEqual(meta.map((entry) => [entry.blockKey, entry.roomTypeId, entry.boardType]), [
      [complete.key, STD, 'BB'],
      [complete.key, DLX, 'BB'],
    ]);
  });

  it('gidiş-dönüş: sunucudan gelen satırlar değişmeden geri çıkar (imza eşit)', () => {
    const server = [
      rate(STD, 'BB', '2027-06-01', '2027-06-30', '1800.00'),
      rate(STD, 'AI', '2027-06-01', '2027-06-30', '2600.00'),
      rate(DLX, 'BB', '2027-07-01', '2027-07-31', '2900.50'),
    ];
    const { rates } = blocksToRates(ratesToBlocks(server));
    assert.equal(rateSignature(rates), rateSignature(server));
  });
});

describe('imza (kaydedilmemiş değişiklik)', () => {
  it('sıradan ve "1800" / "1800.00" yazımından bağımsız; fiyat, dönem ya da satır değişince farklı', () => {
    const a = [rate(STD, 'BB', '2027-06-01', '2027-06-30', '1800'), rate(DLX, 'BB', '2027-06-01', '2027-06-30', '2900.5')];
    const b = [rate(DLX, 'BB', '2027-06-01', '2027-06-30', '2900.50'), rate(STD, 'BB', '2027-06-01', '2027-06-30', '1800.00')];
    assert.equal(rateSignature(a), rateSignature(b));
    assert.notEqual(rateSignature(a), rateSignature([rate(STD, 'BB', '2027-06-01', '2027-06-30', '1801'), a[1]]));
    assert.notEqual(rateSignature(a), rateSignature([rate(STD, 'BB', '2027-06-02', '2027-06-30', '1800'), a[1]]));
    assert.notEqual(rateSignature(a), rateSignature([a[0]]));
    assert.equal(rateSignature([]), '');
  });

  it('dolu hücre sayısı yalnızca seçili pansiyonları sayar', () => {
    const block = newBlock({ boards: ['BB'], cells: { [STD]: { BB: '10', AI: '20' }, [DLX]: { BB: ' ' } } });
    assert.equal(filledCells(block), 1);
  });
});

describe('doğrulama', () => {
  it('geçerli tablo hatasızdır', () => {
    const block = newBlock({ startDate: '2027-06-01', endDate: '2027-06-30', boards: ['BB'], cells: { [STD]: { BB: '1.800' } } });
    const result = validateBlocks([block], PERIOD);
    assert.deepEqual(result.blockErrors, {});
    assert.deepEqual(result.cellErrors, {});
    assert.equal(result.rates.length, 1);
  });

  it('geçersiz, sıfır ve eksi fiyat ilgili hücreye bağlanır', () => {
    const block = newBlock({ startDate: '2027-06-01', endDate: '2027-06-30', boards: ['BB', 'AI'], cells: { [STD]: { BB: 'abc', AI: '0' }, [DLX]: { BB: '-5' } } });
    const { cellErrors, blockErrors } = validateBlocks([block], PERIOD);
    assert.ok(cellErrors[rateCellKey(block.key, STD, 'BB')], 'metin');
    assert.ok(cellErrors[rateCellKey(block.key, STD, 'AI')], 'sıfır');
    assert.ok(cellErrors[rateCellKey(block.key, DLX, 'BB')], 'eksi');
    assert.deepEqual(blockErrors, {});
  });

  it('eksik tarih, ters aralık ve kontrat dönemi dışı blok hatası', () => {
    const missing = newBlock({ startDate: '', endDate: '2027-06-30', boards: ['BB'], cells: { [STD]: { BB: '1' } } });
    const reversed = newBlock({ startDate: '2027-07-10', endDate: '2027-07-01', boards: ['BB'], cells: { [STD]: { BB: '1' } } });
    const early = newBlock({ startDate: '2027-05-01', endDate: '2027-05-31', boards: ['BB'], cells: { [STD]: { BB: '1' } } });
    const late = newBlock({ startDate: '2027-09-01', endDate: '2027-10-05', boards: ['BB'], cells: { [STD]: { BB: '1' } } });
    const { blockErrors } = validateBlocks([missing, reversed, early, late], PERIOD);
    assert.match(blockErrors[missing.key], /başlangıç ve bitiş/);
    assert.match(blockErrors[reversed.key], /Bitiş tarihi başlangıçtan önce/);
    assert.match(blockErrors[early.key], /kontrat tarihlerinin içinde/);
    assert.match(blockErrors[late.key], /kontrat tarihlerinin içinde/);
  });

  it('aynı oda tipi + pansiyon için çakışan dönemler: sonraki blok işaretlenir; başka pansiyon çakışmaz', () => {
    const first = newBlock({ startDate: '2027-06-01', endDate: '2027-06-30', boards: ['BB'], cells: { [STD]: { BB: '1' } } });
    const overlapping = newBlock({ startDate: '2027-06-30', endDate: '2027-07-15', boards: ['BB'], cells: { [STD]: { BB: '2' } } });
    const otherBoard = newBlock({ startDate: '2027-06-10', endDate: '2027-06-20', boards: ['AI'], cells: { [STD]: { AI: '3' } } });
    const { blockErrors } = validateBlocks([first, overlapping, otherBoard], PERIOD);
    assert.match(blockErrors[overlapping.key], /çakışıyor/);
    assert.equal(blockErrors[first.key], undefined);
    assert.equal(blockErrors[otherBoard.key], undefined);
  });
});
