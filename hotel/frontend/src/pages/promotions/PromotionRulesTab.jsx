import { useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { promotionKeys } from '../../lib/promotions.js';
import { PromotionForm } from './PromotionForm.jsx';
import { usePromotionOutlet } from './PromotionPage.jsx';

/**
 * Promosyonun kuralları (modül 31): düzenleme formu; yetkisi olmayan (muhasebe)
 * kuralı salt okunur görür.
 */
export function PromotionRulesTab() {
  const { promotion } = usePromotionOutlet();
  const can = useCan();
  const queryClient = useQueryClient();
  return (
    <PromotionForm
      key={promotion.id}
      promotion={promotion}
      readOnly={!can(PERMISSIONS.PROMOTIONS_MANAGE)}
      onSaved={(saved) => queryClient.setQueryData(promotionKeys.detail(saved.id), saved)}
    />
  );
}
