import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '../../lib/api.js';
import { gatewayKeys } from '../../lib/paymentGateway.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/**
 * Linkin "Gönder" ve "İptal et" istekleri (modül 50, `payment_gateway.send`). Cevap ayrıntıdır; önbelleğe yazılır ve
 * `payment-gateway` sorguları tazelenir. Gönderilemezse (iletişim / kanal yok) sunucunun "kopyalayıp elle iletin" mesajı
 * hata bildirimi olarak çıkar.
 */
export function useLinkActions() {
  const queryClient = useQueryClient();
  const settle = (result) => {
    if (result?.link?.id) queryClient.setQueryData(gatewayKeys.link(result.link.id), result);
    queryClient.invalidateQueries({ queryKey: gatewayKeys.all });
  };
  const send = useMutation({
    mutationFn: (linkId) => apiPost(`/payment-gateway/links/${linkId}/send`, {}),
    onSuccess: (result) => {
      settle(result);
      toastSuccess(result.link.sentVia?.length ? `Misafire gönderildi (${result.link.sentVia.join(', ')})` : 'Misafire gönderildi');
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: gatewayKeys.all });
      toastError(error.message);
    },
  });
  const cancel = useMutation({
    mutationFn: (linkId) => apiPost(`/payment-gateway/links/${linkId}/cancel`, {}),
    onSuccess: (result) => {
      settle(result);
      toastSuccess('Link iptal edildi');
    },
  });
  return { send, cancel };
}
