import { isCompanyBuyer } from '@hotelos/hotel-contracts';
import { apiBlob } from './api.js';
import { INVOICES_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';
import { toastError } from '../store/toast.js';

/**
 * Fatura ve e-belge (modül 16 çekirdeği + 49): sorgu anahtarları, canlı tazeleme, durum tonları, PDF açma.
 * Hepsi `invoices` kökünde: canlı haber tek anahtarla bütün fatura ekranlarını yeniler.
 */

export const invoiceKeys = Object.freeze({
  all: ['invoices'],
  /** @param {object} filters */
  list: (filters) => ['invoices', 'list', filters],
  /** @param {object} filters */
  invoiceables: (filters) => ['invoices', 'invoiceables', filters],
  /** @param {string} id */
  detail: (id) => ['invoices', 'detail', id],
  settings: ['invoices', 'settings'],
  /** Folyo / etkinlik ekranındaki fatura kutusu. @param {'folio' | 'event'} kind @param {string} id */
  ofSource: (kind, id) => ['invoices', 'source', kind, id],
});

/** Fatura ekranı açıkken: kesim, e-belge durumu, iptal kararı, ayar değişince tazelenir. */
export function useInvoicesLive() {
  return useLiveChannel(INVOICES_CHANNEL, { minIntervalMs: 1_000, queryKeys: [invoiceKeys.all] });
}

export const INVOICE_STATUS_TONES = Object.freeze({ DRAFT: 'neutral', ISSUED: 'success', CANCEL_PENDING: 'warning', CANCELLED: 'danger' });
export const EDOC_STATE_TONES = Object.freeze({ QUEUED: 'info', SENDING: 'info', SENT: 'info', DELIVERED: 'success', REJECTED: 'danger', FAILED: 'danger', CANCELLED: 'neutral' });

/** Zaman çizelgesi satır adları. */
export const INVOICE_LOG_LABELS = Object.freeze({
  CREATED: 'Taslak açıldı',
  UPDATED: 'Taslak düzenlendi',
  REFRESHED: 'Taslak kaynaktan yenilendi',
  ISSUED: 'Kesildi',
  QUEUED: 'Gönderim sırasına girdi',
  SENT: 'Entegratöre iletildi',
  RETRY: 'Geçici hata · yeniden denenecek',
  DELIVERED: "GİB'de tamamlandı",
  REJECTED: 'Reddedildi',
  FAILED: 'Gönderilemedi',
  RESEND: 'Yeniden sıraya alındı',
  CANCEL_REQUESTED: 'İptal istendi',
  CANCEL_DECLINED: 'İptal yapılmadı',
  CANCELLED: 'İptal edildi',
});

/** PDF'i yeni sekmede aç (sekme tıklamayla açılır: açılır pencere engeline takılmasın). @param {string} invoiceId @param {string} fileName */
export async function openInvoicePdf(invoiceId, fileName) {
  const tab = window.open('', '_blank');
  try {
    const blob = await apiBlob(`/invoices/${invoiceId}/pdf`);
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    else {
      const link = window.document.createElement('a');
      link.href = url;
      link.download = `${fileName}.pdf`;
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    tab?.close();
    toastError(/** @type {Error} */ (error).message);
  }
}

/** Alıcının görünen adı. @param {any} buyer */
export const buyerDisplayName = (buyer) => (isCompanyBuyer(buyer) ? buyer?.name : `${buyer?.firstName ?? ''} ${buyer?.lastName ?? ''}`.trim()) || '—';
