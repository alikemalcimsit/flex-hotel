import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { REPORT_CHAT_PATH, REVENUE_REPORT_PATH, SAVED_REPORTS_PATH } from '../../lib/reportChat.js';
import { useReportChatLive } from '../../lib/reportChatQueries.js';

/**
 * Rapor asistanı ve kayıtlı raporların kabuğu (modül 24). Soru sormak AI bütçesi harcar (`reports.ask`); kayıtlı
 * raporu görmek / çalıştırmak harcamaz (`reports.view`).
 */
export function ReportChatLayout() {
  useReportChatLive();
  const can = useCan();
  const tabs = [
    can(PERMISSIONS.REPORTS_ASK) && { to: REPORT_CHAT_PATH, label: 'Rapor asistanı', icon: 'sparkles' },
    can(PERMISSIONS.REPORTS_VIEW) && { to: SAVED_REPORTS_PATH, label: 'Kayıtlı raporlar', icon: 'fileText' },
    can(PERMISSIONS.REPORTS_VIEW) && { to: REVENUE_REPORT_PATH, label: 'Gelir raporları', icon: 'chart' },
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Rapor asistanı"
        description="Sorunuzu yazın; asistan doğru raporu seçer, sistem çalıştırır: tablo, grafik ve kısa yorum. Beğendiğiniz raporu kaydedin, sonra AI'sız tek tıkla güncel veriyle çalıştırın."
      />
      <TabNav label="Rapor sayfaları" tabs={tabs} />
      <Outlet />
    </div>
  );
}
