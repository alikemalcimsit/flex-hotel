import { REVIEWS_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';
import { parseCsv, splitReviewSheet } from './reviewsFormat.js';
import { toastError, toastSuccess } from '../store/toast.js';

export * from './reviewsFormat.js';

/**
 * Misafir yorumları (modül 54): sorgu anahtarları, canlı tazeleme, dosya okuma, panoya kopyalama. Hepsi `reviews` kökünde:
 * yeni yorum, yükleme, AI etiketi tek haberle listeyi, ayrıntıyı ve trendi yeniler.
 */
export const reviewKeys = Object.freeze({
  all: ['reviews'],
  /** @param {object} filters */
  list: (filters) => ['reviews', 'list', filters],
  /** @param {string} reviewId */
  review: (reviewId) => ['reviews', 'review', reviewId],
  /** @param {object} params */
  trends: (params) => ['reviews', 'trends', params],
});

export const REVIEWS_PAGE_SIZE = 20;
export const REVIEWS_BASE_PATH = '/yorumlar';
/** @param {string} reviewId */
export const reviewPath = (reviewId) => `${REVIEWS_BASE_PATH}/liste/${reviewId}`;

/** Yükleme ajanı art arda haber verebilir: iki tazeleme arası en kısa süre. */
const LIVE_MIN_REFRESH_MS = 1_500;

export function useReviewsLive() {
  return useLiveChannel(REVIEWS_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [reviewKeys.all] });
}

/** Okunan dosyanın üst sınırı. */
export const REVIEW_FILE_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Yüklenen Excel (.xlsx, ilk sayfa) ya da CSV dosyasını okur.
 * @param {File} file @returns {Promise<{ headers: string[], rows: unknown[][], errors: string[] }>}
 */
export async function readReviewFile(file) {
  if (file.size > REVIEW_FILE_MAX_BYTES) return { headers: [], rows: [], errors: [`Dosya çok büyük (en fazla ${REVIEW_FILE_MAX_BYTES / 1024 / 1024} MB).`] };
  if (/\.(csv|txt)$/i.test(file.name)) return splitReviewSheet(parseCsv(await file.text()));
  const { readSheet } = await import('read-excel-file/browser');
  return splitReviewSheet(await readSheet(file));
}

/** Metni panoya kopyalar; olmazsa uyarır. @param {string | null | undefined} text @param {string} [okMessage] */
export async function copyText(text, okMessage = 'Kopyalandı') {
  if (!text) {
    toastError('Kopyalanacak metin yok');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toastSuccess(okMessage);
  } catch {
    toastError('Kopyalanamadı; metni seçip elle kopyalayın');
  }
}
