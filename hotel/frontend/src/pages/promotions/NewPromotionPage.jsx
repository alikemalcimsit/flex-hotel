import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { PromotionForm } from './PromotionForm.jsx';

/**
 * Yeni promosyon (modül 31): taslak olarak açılır, kartında kontrol edilip
 * yayına alınır (kuponla uygulanacaksa önce kupon üretilir).
 */
export function NewPromotionPage() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-6">
      <Link to="/promosyonlar" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
        <Icon name="arrowLeft" className="size-4" />
        Promosyonlar
      </Link>
      <PageHeader title="Yeni promosyon" description="Taslak olarak kaydedilir; kartında kontrol edip yayına alınca satışa uygulanır." />
      <PromotionForm onSaved={(promotion) => navigate(`/promosyonlar/${promotion.id}`)} onCancel={() => navigate('/promosyonlar')} />
    </div>
  );
}
