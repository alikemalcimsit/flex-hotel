import { apiBlob } from './api.js';
import { toastError } from '../store/toast.js';

/** Satış CRM (modül 36) sorgu anahtarları. */
export const salesKeys = Object.freeze({
  all: ['sales'],
  summary: ['sales', 'summary'],
  leadList: (filters) => ['sales', 'leads', filters],
  lead: (leadId) => ['sales', 'lead', leadId],
});

/**
 * Teklif PDF'ini yeni sekmede açar (fatura PDF kalıbı: sekme tıklamayla
 * açılır ki açılır pencere engeline takılmasın).
 * @param {string} quoteId
 * @param {string} code dosya adı için teklif kodu
 */
export async function openQuotePdf(quoteId, code) {
  const tab = window.open('', '_blank');
  try {
    const blob = await apiBlob(`/sales/quotes/${quoteId}/pdf`);
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    else {
      const link = window.document.createElement('a');
      link.href = url;
      link.download = `teklif-${code}.pdf`;
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    tab?.close();
    toastError(/** @type {Error} */ (error).message);
  }
}
