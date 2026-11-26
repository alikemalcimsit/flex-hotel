import { CASH_ORIGIN_LABELS, PAYMENT_KIND_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_SOURCE_LABELS, PAYMENT_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { fromLabels } from '../keys.js';

/**
 * Ödeme etiketleri (kasa ve folyo ortak). Türkçesi sözleşmeden; `lib/payments.js` yardımcıları (`methodLabel`, `kindLabel`,
 * `sourceLabel`, `paymentStatusLabel`) bunlarla etkin dilde döner. Anahtarlar `payments.` ile başlar.
 */
export default Object.freeze({
  ...fromLabels('payments.method.', PAYMENT_METHOD_LABELS),
  ...fromLabels('payments.kind.', PAYMENT_KIND_LABELS),
  ...fromLabels('payments.source.', PAYMENT_SOURCE_LABELS),
  ...fromLabels('payments.status.', PAYMENT_STATUS_LABELS),
  ...fromLabels('payments.origin.', CASH_ORIGIN_LABELS),
});
