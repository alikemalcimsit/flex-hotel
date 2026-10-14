import { Outlet, useNavigate } from 'react-router-dom';
import { Button } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';

/**
 * Promosyonlar sayfasının kabuğu (modül 31): başlık ve sekmeler (liste,
 * kullanım raporu). Promosyon açmak `promotions.manage` ister.
 */
export function PromotionsLayout() {
  const can = useCan();
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Promosyonlar"
        description="Erken rezervasyon, uzun konaklama, kampanya ve kupon kodları. Uygun promosyon doğrudan satışta kendiliğinden düşer; bir rezervasyona tek indirim (en avantajlısı) uygulanır."
        actions={
          can(PERMISSIONS.PROMOTIONS_MANAGE) && (
            <Button icon="plus" onClick={() => navigate('/promosyonlar/yeni')}>
              Yeni promosyon
            </Button>
          )
        }
      />
      <TabNav
        label="Promosyon sayfaları"
        tabs={[
          { to: '/promosyonlar', label: 'Promosyonlar', icon: 'percent', end: true },
          { to: '/promosyonlar/rapor', label: 'Kullanım raporu', icon: 'chart' },
        ]}
      />
      <Outlet />
    </div>
  );
}
