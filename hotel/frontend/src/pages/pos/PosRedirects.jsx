import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api } from '../../lib/api.js';
import { checkPath } from '../../lib/pos.js';

/**
 * Onay ekranının "aç" bağlantısı restoran ödemesinin ya da düzeltmesinin kimliğini taşır
 * (modül 39): kaydın adisyonu sorulup adisyon ekranına geçilir.
 */
export function PosPaymentRedirect() {
  const { paymentId } = useParams();
  const query = useQuery({ queryKey: ['pos', 'payment-check', paymentId], queryFn: () => api(`/pos/payments/${paymentId}`) });
  if (query.data) return <Navigate to={checkPath(query.data.checkId)} replace />;
  return <QueryFallback query={query} errorTitle="Restoran ödemesi bulunamadı" />;
}

export function PosAdjustmentRedirect() {
  const { adjustmentId } = useParams();
  const query = useQuery({ queryKey: ['pos', 'adjustment-check', adjustmentId], queryFn: () => api(`/pos/adjustments/${adjustmentId}`) });
  if (query.data) return <Navigate to={checkPath(query.data.checkId)} replace />;
  return <QueryFallback query={query} errorTitle="Düzeltme bulunamadı" />;
}
