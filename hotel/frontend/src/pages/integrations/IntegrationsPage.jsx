import { Outlet } from 'react-router-dom';
import { Icon } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { API_DOCS_PATH } from '../../lib/integrations.js';

/**
 * Entegrasyon (modül 61): otele bağlanan dış sistemler (uygulamalar, API anahtarları, webhook abonelikleri) ve
 * webhook teslimat logu. API dokümanı (Swagger UI) yeni sekmede açılır.
 */
export function IntegrationsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Entegrasyon"
        description="CRM, kurumsal seyahat aracı ya da acente yazılımı gibi dış sistemler API anahtarıyla bağlanır: müsaitliği ve rezervasyonları okur, rezervasyon açar; seçtikleri olayları kendi adreslerine webhook olarak alır."
        actions={
          <a
            href={API_DOCS_PATH}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-2 rounded-control border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink hover:border-ink"
          >
            <Icon name="bookOpen" className="size-4" />
            API dokümanı
          </a>
        }
      />
      <TabNav
        label="Entegrasyon sayfaları"
        tabs={[
          { to: '/entegrasyonlar/uygulamalar', label: 'Uygulamalar', icon: 'server' },
          { to: '/entegrasyonlar/teslimatlar', label: 'Webhook teslimatları', icon: 'send' },
        ]}
      />
      <Outlet />
    </div>
  );
}
