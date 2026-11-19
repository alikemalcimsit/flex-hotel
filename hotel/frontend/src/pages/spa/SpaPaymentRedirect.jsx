import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api } from '../../lib/api.js';
import { appointmentPath } from '../../lib/spa.js';

/**
 * Onay ekranının "aç" bağlantısı spa ödemesinin kimliğini taşır (modül 57): ödemenin randevusu sorulup randevunun
 * sayfasına geçilir.
 */
export function SpaPaymentRedirect() {
  const { paymentId } = useParams();
  const query = useQuery({ queryKey: ['spa', 'payment-appointment', paymentId], queryFn: () => api(`/spa/payments/${paymentId}/appointment`) });
  if (query.data) return <Navigate to={appointmentPath(query.data.appointmentId)} replace />;
  return <QueryFallback query={query} errorTitle="Spa ödemesi bulunamadı" />;
}
