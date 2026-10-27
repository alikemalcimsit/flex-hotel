import { Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { api } from '../../lib/api.js';
import { banquetKeys, useBanquetLive } from '../../lib/banquet.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';

const OFFLINE_REFRESH_MS = 60_000;

/**
 * Etkinlikler sayfasının kabuğu (modül 37): başlık, özet kutuları (açık dosyalar,
 * opsiyonu dolmak üzere olanlar, önümüzdeki hafta, gecikmiş ödeme, faturaya hazır)
 * ve sekmeler (dosyalar, salon takvimi, tanımlar). Etkinlik açmak `banquet.manage`.
 */
export function BanquetLayout() {
  const can = useCan();
  const navigate = useNavigate();
  const { isLive } = useBanquetLive();
  const summary = useQuery({
    queryKey: banquetKeys.summary,
    queryFn: () => api('/banquet/summary'),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });
  const data = summary.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Etkinlikler"
        description="Düğün, toplantı, gala: salon takvimi, sıralı opsiyon, teklif → sözleşme → proforma ve etkinlik ödemeleri."
        actions={
          can(PERMISSIONS.BANQUET_MANAGE) && (
            <Button icon="plus" onClick={() => navigate('/etkinlikler/yeni')}>
              Yeni etkinlik
            </Button>
          )
        }
      />
      <section aria-label="Özet" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile
          label="Açık dosya"
          value={data ? data.open.inquiry + data.open.tentative + data.open.definite : undefined}
          hint={data ? `${data.open.inquiry} talep · ${data.open.tentative} opsiyon · ${data.open.definite} kesin` : 'Yükleniyor…'}
          icon="calendar"
        />
        <SummaryTile
          label="Opsiyonu doluyor"
          value={data?.optionsExpiringSoon}
          hint={data ? `${data.optionWarningDays} gün içinde son günü gelen opsiyonlar` : 'Yükleniyor…'}
          icon="clock"
          tone={data?.optionsExpiringSoon ? 'warning' : 'neutral'}
        />
        <SummaryTile
          label="Gecikmiş ödeme"
          value={data?.overdue.events}
          hint={data ? `${formatMoney(data.overdue.amount, data.currency)} vadesi geçti` : 'Yükleniyor…'}
          icon="alertTriangle"
          tone={data?.overdue.events ? 'danger' : 'neutral'}
        />
        <SummaryTile
          label="Önümüzdeki hafta"
          value={data?.upcoming.events}
          hint={data ? `${data.upcoming.pax.toLocaleString('tr-TR')} kişi · faturaya hazır ${data.invoiceReady}` : 'Yükleniyor…'}
          icon="users"
        />
      </section>
      {summary.isError && <p className="text-sm text-sec-strong">Özet yüklenemedi: {summary.error.message}</p>}
      <TabNav
        label="Etkinlik sayfaları"
        tabs={[
          { to: '/etkinlikler', label: 'Dosyalar', icon: 'list', end: true },
          { to: '/etkinlikler/takvim', label: 'Salon takvimi', icon: 'calendar' },
          { to: '/etkinlikler/menuler', label: 'Set menüler', icon: 'utensils' },
          { to: '/etkinlikler/malzeme', label: 'Malzeme ihtiyacı', icon: 'package' },
          { to: '/etkinlikler/mutfak-plani', label: 'Mutfak planı', icon: 'clock' },
          { to: '/etkinlikler/tanimlar', label: 'Salon ve tanımlar', icon: 'settings' },
        ]}
      />
      <Outlet context={{ isLive }} />
    </div>
  );
}
