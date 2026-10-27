import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MAX_ORDER_LINES } from '@hotelos/hotel-contracts';
import { Button, Card } from '@hotelos/ui';
import { apiPost } from '../../lib/api.js';
import { posKeys } from '../../lib/pos.js';
import { cartPayload } from '../../lib/posCart.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { MenuPicker } from './MenuPicker.jsx';

/**
 * Sipariş ekranı (modül 39): menüden sepet (`MenuPicker`) ve "Gönder" — tur mutfağa gider, kalemler adisyona
 * yazılır. İstek kimliği sepet dolunca üretilir: çift dokunuş ya da ağ tekrarı ikinci tur açmaz. Oda servisi
 * adisyonunda (modül 41) tur siparişe de eklenir (hazır sipariş mutfağa döner; yoldakine eklenmez — sunucu söyler).
 *
 * @param {{ check: any, terminal: any }} props
 */
export function MenuPanel({ check, terminal }) {
  const queryClient = useQueryClient();
  const [cart, setCart] = useState([]);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const send = useMutation({
    mutationFn: () => apiPost(`/pos/checks/${check.id}/orders`, cartPayload(cart, requestId)),
    onSuccess: (updated) => {
      queryClient.setQueryData(posKeys.check(check.id), updated);
      queryClient.invalidateQueries({ queryKey: posKeys.all });
      setCart([]);
      setRequestId(crypto.randomUUID());
      toastSuccess(`${updated.orders.length}. tur gönderildi`);
    },
    onError: (error) => {
      // Tükenen / satıştan kalkan ürün: menü tazelenir, sepet garsonda kalır.
      if (error.code === 'VALIDATION') queryClient.invalidateQueries({ queryKey: posKeys.terminal });
      toastError(error.message);
    },
  });

  const busy = send.isPending;
  return (
    <Card title="Sipariş" description="Ürüne dokunun, adet ve notu sepette düzeltin; “Gönder” turu mutfağa yollar.">
      <MenuPicker
        terminal={terminal}
        outletId={check.outletId}
        cart={cart}
        onCart={setCart}
        maxLines={MAX_ORDER_LINES}
        busy={busy}
        actions={
          <Button type="button" icon="send" onClick={() => send.mutate()} disabled={busy || cart.length === 0}>
            {busy ? 'Gönderiliyor…' : 'Gönder'}
          </Button>
        }
      />
    </Card>
  );
}
