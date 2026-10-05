import { BOARD_TYPES, contractRateIssues, saveContractRatesSchema } from '@hotelos/hotel-contracts';
import { cellText, parseCell } from './moneyInput.js';

/**
 * Kontrat fiyat tablosunun saf dönüşümleri (modül 29): sunucudaki düz satırlar ↔
 * ekrandaki dönem blokları, doğrulama ve değişiklik imzası. Tarayıcıya bağlı
 * bir şey içermez (birim test edilir): kaydedilen fiyatların doğru çıkması buna bağlı.
 */

/**
 * Tablo, aynı dönemi paylaşan fiyat satırlarının **bloğu**dur: her blokta oda
 * tipi satırları × pansiyon sütunları. Sunucuya düz satır listesi gider
 * (oda tipi × pansiyon × dönem × fiyat); ekran onu bloklara toplar.
 *
 * Blok ekran durumu da taşır (`collapsed`): çok dönemli kontratta (aylık fiyat) sayfa uzamasın
 * diye ilk açılışta kapalıdır. Satıra dönüşürken yok sayılır.
 *
 * @typedef {{ key: string, startDate: string, endDate: string, boards: string[], cells: Record<string, Record<string, string>>, collapsed: boolean }} RateBlock
 */

/** Bu kadar dönemden fazlası ilk açılışta kapalı gelir. */
export const BLOCKS_EXPANDED_UP_TO = 3;

let blockCounter = 0;

/**
 * @param {{ startDate?: string, endDate?: string, boards?: string[], cells?: RateBlock['cells'], collapsed?: boolean }} [seed]
 * @returns {RateBlock}
 */
export function newBlock({ startDate = '', endDate = '', boards = [], cells = {}, collapsed = false } = {}) {
  blockCounter += 1;
  return { key: `blok-${blockCounter}`, startDate, endDate, boards, cells, collapsed };
}

/** Pansiyon sütunları katalog sırasında. @param {string[]} boards */
const inBoardOrder = (boards) => [...boards].sort((a, b) => BOARD_TYPES.indexOf(a) - BOARD_TYPES.indexOf(b));

/**
 * Sunucudaki satırlar → bloklar (başlangıca göre sıralı).
 * @param {Array<{ roomTypeId: string, boardType: string, startDate: string, endDate: string, price: string }>} rates
 * @returns {RateBlock[]}
 */
export function ratesToBlocks(rates) {
  /** @type {Map<string, RateBlock>} */
  const blocks = new Map();
  for (const rate of rates) {
    const key = `${rate.startDate}|${rate.endDate}`;
    let block = blocks.get(key);
    if (!block) {
      block = newBlock({ startDate: rate.startDate, endDate: rate.endDate });
      blocks.set(key, block);
    }
    if (!block.boards.includes(rate.boardType)) block.boards.push(rate.boardType);
    block.cells[rate.roomTypeId] = { ...(block.cells[rate.roomTypeId] ?? {}), [rate.boardType]: cellText(rate.price) };
  }
  const sorted = [...blocks.values()]
    .map((block) => ({ ...block, boards: inBoardOrder(block.boards) }))
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.endDate < b.endDate ? -1 : 1));
  const collapsed = sorted.length > BLOCKS_EXPANDED_UP_TO;
  return sorted.map((block) => ({ ...block, collapsed }));
}

/** Bloktaki dolu hücre sayısı (kapalı blokta özet). @param {RateBlock} block */
export function filledCells(block) {
  let count = 0;
  for (const byBoard of Object.values(block.cells)) {
    for (const board of block.boards) if (parseCell(byBoard[board] ?? '') !== null) count += 1;
  }
  return count;
}

/**
 * Bloklar → sunucu satırları. Boş hücre fiyat yok demektir (satılmaz); tarihi
 * eksik blok satır üretmez (blok hatası ayrıca gösterilir). `meta` her satırın
 * hangi blok / hücreden geldiğini taşır (doğrulama hatasını hücreye bağlamak için).
 *
 * @param {RateBlock[]} blocks
 */
export function blocksToRates(blocks) {
  const rates = [];
  const meta = [];
  for (const block of blocks) {
    if (!block.startDate || !block.endDate) continue;
    for (const [roomTypeId, byBoard] of Object.entries(block.cells)) {
      for (const boardType of block.boards) {
        const price = parseCell(byBoard[boardType] ?? '');
        if (price === null) continue;
        rates.push({ roomTypeId, boardType, startDate: block.startDate, endDate: block.endDate, price });
        meta.push({ blockKey: block.key, roomTypeId, boardType });
      }
    }
  }
  return { rates, meta };
}

/**
 * Kaydedilebilir mi? Blokları sunucunun şemasıyla (ve kontrat dönemiyle)
 * doğrular; hatalar hücreye ya da bloğa bağlanır.
 *
 * @param {RateBlock[]} blocks
 * @param {{ startDate: string, endDate: string }} period kontrat dönemi
 * @returns {{ rates: ReturnType<typeof blocksToRates>['rates'], blockErrors: Record<string, string>, cellErrors: Record<string, string> }}
 */
export function validateBlocks(blocks, period) {
  const { rates, meta } = blocksToRates(blocks);
  /** @type {Record<string, string>} */
  const blockErrors = {};
  /** @type {Record<string, string>} */
  const cellErrors = {};
  const cellKey = (blockKey, roomTypeId, boardType) => `${blockKey}|${roomTypeId}|${boardType}`;

  for (const block of blocks) {
    if (!block.startDate || !block.endDate) blockErrors[block.key] = 'Dönemin başlangıç ve bitiş tarihini seçin';
    else if (block.endDate < block.startDate) blockErrors[block.key] = 'Bitiş tarihi başlangıçtan önce olamaz';
    else if (block.startDate < period.startDate || block.endDate > period.endDate) {
      blockErrors[block.key] = 'Dönem kontrat tarihlerinin içinde olmalı';
    }
  }

  const blame = (index, field, message) => {
    const source = meta[index];
    if (!source) return;
    if (field === 'price') cellErrors[cellKey(source.blockKey, source.roomTypeId, source.boardType)] = message;
    else blockErrors[source.blockKey] ??= message;
  };

  const parsed = saveContractRatesSchema.safeParse({ expectedUpdatedAt: new Date(), rates });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === 'rates' && typeof issue.path[1] === 'number') blame(issue.path[1], String(issue.path[2] ?? ''), issue.message);
    }
  } else {
    for (const issue of contractRateIssues(rates, period)) blame(issue.index, issue.field, issue.message);
  }
  return { rates, blockErrors, cellErrors };
}

/** Hücre anahtarı (doğrulama hatası eşlemesi). */
export const rateCellKey = (blockKey, roomTypeId, boardType) => `${blockKey}|${roomTypeId}|${boardType}`;

/**
 * Satır kümesinin karşılaştırılabilir imzası (sıradan bağımsız): kaydedilmemiş
 * değişiklik var mı?
 * @param {Array<{ roomTypeId: string, boardType: string, startDate: string, endDate: string, price: string }>} rates
 */
export function rateSignature(rates) {
  return rates
    .map((rate) => `${rate.roomTypeId}|${rate.boardType}|${rate.startDate}|${rate.endDate}|${Number(rate.price)}`)
    .sort()
    .join(';');
}
