import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api } from '../../lib/api.js';
import { eventPath } from '../../lib/banquet.js';

/**
 * Onay ekranının "aç" bağlantısı etkinlik ödemesinin kimliğini taşır (modül 37):
 * ödemenin etkinliği sorulup dosyanın Ödemeler sekmesine geçilir.
 */
export function EventPaymentRedirect() {
  const { paymentId } = useParams();
  const query = useQuery({ queryKey: ['banquet', 'payment-event', paymentId], queryFn: () => api(`/banquet/payments/${paymentId}`) });
  if (query.data) return <Navigate to={eventPath(query.data.eventId, 'odemeler')} replace />;
  return <QueryFallback query={query} errorTitle="Etkinlik ödemesi bulunamadı" />;
}
