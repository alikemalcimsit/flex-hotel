import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';
import { formatDateTime } from './format.js';
import { useHotelContext } from './useHotel.js';

/**
 * Entegrasyon ekranlarının ortak parçaları (modül 61): sorgu anahtarları, rozet tonları, otel saatiyle zaman.
 */

export const integrationKeys = Object.freeze({
  all: ['integrations'],
  clients: () => ['integrations', 'clients'],
  client: (id) => ['integrations', 'client', id],
  deliveries: (filters) => ['integrations', 'deliveries', filters],
  delivery: (id) => ['integrations', 'delivery', id],
});

export const CLIENT_STATUS_TONES = Object.freeze({ ACTIVE: 'success', DISABLED: 'neutral' });
export const KEY_STATE_TONES = Object.freeze({ ACTIVE: 'success', EXPIRED: 'warning', REVOKED: 'neutral' });
export const KEY_STATE_LABELS = Object.freeze({ ACTIVE: 'Geçerli', EXPIRED: 'Süresi doldu', REVOKED: 'İptal edildi' });
export const WEBHOOK_STATUS_TONES = Object.freeze({ ACTIVE: 'success', PAUSED: 'neutral', DISABLED: 'danger' });
export const DELIVERY_STATUS_TONES = Object.freeze({ PENDING: 'info', SENDING: 'info', RETRYING: 'warning', SUCCEEDED: 'success', FAILED: 'danger' });

/** Açık API dokümanı (Swagger UI; derlemede `dist/api-docs`, geliştirmede Vite ara katmanı). */
export const API_DOCS_PATH = '/api-docs/';

/** Zamanı otelin diliminde yazar. */
export function useIntegrationTime() {
  const timeZone = useHotelContext().data?.timezone;
  return useCallback((value) => (value ? formatDateTime(value, timeZone) : '—'), [timeZone]);
}

/** @param {string} clientId */
export function useApiClient(clientId) {
  return useQuery({ queryKey: integrationKeys.client(clientId), queryFn: () => api(`/integrations/clients/${clientId}`) });
}

/** @param {number | null} ms */
export const durationText = (ms) => (ms === null || ms === undefined ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} sn`);
