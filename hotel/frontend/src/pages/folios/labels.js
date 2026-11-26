import { RESERVATION_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { tNow } from '../../i18n/translate.js';
import { folioStatusLabel, itemSourceLabel, itemTypeLabel } from '../../lib/folios.js';

/**
 * Folyo ekranlarının etiketleri etkin dilde (modül 60). Türkçesi sözleşmeden (`i18n/tr/folio.js` → `fromLabels`);
 * sözlükte olmayan kod `lib/folios.js` yedeğine düşer.
 */
export const folioStatusText = (status) => tNow(`folio.status.${status}`, folioStatusLabel(status));
export const itemTypeText = (type) => tNow(`folio.itemType.${type}`, itemTypeLabel(type));
export const itemSourceText = (source) => tNow(`folio.itemSource.${source}`, itemSourceLabel(source));
export const reservationStatusText = (status) => tNow(`folio.reservationStatus.${status}`, RESERVATION_STATUS_LABELS[status] ?? status);
