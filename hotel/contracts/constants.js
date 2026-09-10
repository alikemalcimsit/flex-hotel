/**
 * Enum karşılıkları ve etiketler.
 *
 * Tek kaynak olmaları önemli: Prisma şemasındaki `BoardType` ile ekrandaki
 * açılır listenin ayrışması, kullanıcının kaydedemediği bir form demektir.
 */

/** Vergilerin uygulanabileceği kalem tipleri (Prisma `FolioItemType` alt kümesi). */
export const TAX_APPLIES_TO = Object.freeze(['ROOM', 'FNB', 'MINIBAR', 'LAUNDRY', 'SPA', 'OTHER']);

export const TAX_APPLIES_TO_LABELS = Object.freeze({
  ROOM: 'Oda',
  FNB: 'Restoran',
  MINIBAR: 'Minibar',
  LAUNDRY: 'Çamaşırhane',
  SPA: 'SPA',
  OTHER: 'Diğer',
});

/** Pansiyon tipleri (Prisma `BoardType` ile birebir). */
export const BOARD_TYPES = Object.freeze(['RO', 'BB', 'HB', 'FB', 'AI', 'UAI']);

export const BOARD_TYPE_LABELS = Object.freeze({
  RO: 'RO — Sadece oda',
  BB: 'BB — Oda + kahvaltı',
  HB: 'HB — Yarım pansiyon',
  FB: 'FB — Tam pansiyon',
  AI: 'AI — Her şey dahil',
  UAI: 'UAI — Ultra her şey dahil',
});

/** Sayfalama sınırları — istemci "hepsini ver" diyip sunucuyu boğamasın. */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 25;
