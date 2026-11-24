import { BOARD_TYPES, BOARD_TYPE_LABELS } from '@hotelos/hotel-contracts';

/**
 * Rooming list (modül 30): tur operatörünün gönderdiği misafir listesini
 * Excel'den okuyup grup rezervasyon satırlarına çevirir. Tarihler formun ortak
 * giriş / çıkışıdır (satır başına tarih bilinçli olarak yok); her satır bir
 * oda + bir misafir adıdır. Saf dönüşümler burada (test edilir), dosya
 * okuma/yazma dinamik import ile.
 */

export const ROOMING_LIST_HEADER = Object.freeze(['Ad', 'Soyad', 'Oda tipi kodu', 'Pansiyon', 'Yetişkin', 'Çocuk']);
export const ROOMING_LIST_MAX_BYTES = 2 * 1024 * 1024;
export const ROOMING_LIST_MAX_ROWS = 50;

/** Hücre metni: boşluk kırpılır, boş hücre "" olur. */
const cellText = (value) => String(value ?? '').trim();

/** Tam sayı hücresi; boş → varsayılan, bozuk → null (hata). */
function cellInt(value, fallback) {
  const text = cellText(value);
  if (text === '') return fallback;
  const parsed = Number(text);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Başlık satırı şablonla uyuşuyor mu? (sıra önemli; büyük/küçük harf duyarsız)
 * @param {Array<unknown>} headerRow
 */
export function headerMatches(headerRow) {
  return ROOMING_LIST_HEADER.every(
    (label, index) => cellText(headerRow?.[index]).toLocaleLowerCase('tr') === label.toLocaleLowerCase('tr'),
  );
}

/**
 * Excel satırlarını grup satırlarına çevirir. Hatalı satırlar satır numarasıyla
 * (Excel'deki görünen numara: başlık 1. satır) listelenir; geçerliler döner.
 *
 * @param {Array<Array<unknown>>} rows başlık dahil ham satırlar
 * @param {{ roomTypes: Array<{ id: string, code: string }>, defaultBoardType?: string }} context
 * @returns {{ lines: Array<{ roomTypeId: string, adults: number, children: number, boardType: string, quantity: 1, guest: { firstName: string, lastName: string } }>, errors: string[] }}
 */
export function parseRoomingRows(rows, { roomTypes, defaultBoardType = 'BB' }) {
  const errors = [];
  if (!rows?.length) return { lines: [], errors: ['Dosya boş.'] };
  if (!headerMatches(rows[0])) {
    return { lines: [], errors: [`Başlık satırı tanınmadı: ekrandan indirilen şablonu kullanın (${ROOMING_LIST_HEADER.join(', ')}).`] };
  }

  const typeByCode = new Map(roomTypes.map((type) => [type.code.toLocaleUpperCase('tr'), type]));
  const lines = [];

  rows.slice(1).forEach((row, index) => {
    const rowNo = index + 2;
    const firstName = cellText(row[0]);
    const lastName = cellText(row[1]);
    const typeCode = cellText(row[2]).toLocaleUpperCase('tr');
    const boardText = cellText(row[3]).toLocaleUpperCase('tr');

    // Tamamen boş satır sessizce atlanır (Excel'in altındaki boşluklar).
    if (!firstName && !lastName && !typeCode && !boardText) return;

    if (!firstName || !lastName) {
      errors.push(`${rowNo}. satır: ad ve soyad zorunlu.`);
      return;
    }
    const type = typeByCode.get(typeCode);
    if (!type) {
      errors.push(`${rowNo}. satır: "${typeCode || '—'}" kodlu oda tipi bu otelde yok.`);
      return;
    }
    const boardType = boardText === '' ? defaultBoardType : BOARD_TYPES.includes(boardText) ? boardText : null;
    if (!boardType) {
      errors.push(`${rowNo}. satır: "${boardText}" pansiyonu tanınmadı (${BOARD_TYPES.join(', ')}).`);
      return;
    }
    const adults = cellInt(row[4], 2);
    const children = cellInt(row[5], 0);
    if (adults === null || adults < 1 || children === null) {
      errors.push(`${rowNo}. satır: yetişkin / çocuk sayısı geçersiz.`);
      return;
    }
    lines.push({ roomTypeId: type.id, adults, children, boardType, quantity: 1, guest: { firstName, lastName } });
  });

  if (lines.length > ROOMING_LIST_MAX_ROWS) {
    return { lines: [], errors: [`Tek grupta en fazla ${ROOMING_LIST_MAX_ROWS} oda açılabilir (listede ${lines.length} satır var).`] };
  }
  if (lines.length === 0 && errors.length === 0) errors.push('Dosyada misafir satırı yok.');
  return { lines, errors };
}

/** Boş şablonu indirir: başlık + oda tipi kodları açıklama satırı. */
export async function downloadRoomingTemplate({ roomTypes }) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const header = ROOMING_LIST_HEADER.map((value) => ({ value, fontWeight: 'bold', backgroundColor: '#eef2f7' }));
  const example = [
    { value: 'Ayşe', type: String },
    { value: 'Yılmaz', type: String },
    { value: roomTypes[0]?.code ?? 'STD', type: String },
    { value: 'BB', type: String },
    { value: 2, type: Number },
    { value: 0, type: Number },
  ];
  await writeXlsxFile([header, example], {
    sheet: 'Rooming list',
    columns: [{ width: 16 }, { width: 16 }, { width: 14 }, { width: 10 }, { width: 10 }, { width: 10 }],
    stickyRowsCount: 1,
  }).toFile('rooming-list.xlsx');
}

/**
 * Yüklenen rooming list dosyasını okuyup satırlara çevirir.
 * @param {File} file
 * @param {{ roomTypes: Array<{ id: string, code: string }>, defaultBoardType?: string }} context
 */
export async function readRoomingList(file, context) {
  if (file.size > ROOMING_LIST_MAX_BYTES) {
    return { lines: [], errors: [`Dosya çok büyük (en fazla ${ROOMING_LIST_MAX_BYTES / 1024 / 1024} MB).`] };
  }
  const { readSheet } = await import('read-excel-file/browser');
  const rows = await readSheet(file);
  return parseRoomingRows(rows, context);
}

/** Pansiyon sütununun ekranda gösterilen açıklaması (şablon yardım metni). */
export function boardHelpText() {
  return BOARD_TYPES.map((code) => `${code} = ${BOARD_TYPE_LABELS[code].split('— ')[1] ?? code}`).join(', ');
}
