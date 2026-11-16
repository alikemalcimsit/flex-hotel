import { Outlet } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { REPORT_CHAT_PATH, REVENUE_REPORT_PATH, SAVED_REPORTS_PATH } from '../../lib/reportChat.js';
import { useReportChatLive } from '../../lib/reportChatQueries.js';
import { REPORT_DESIGNER_PATH } from '../../lib/reportDesigner.js';

/**
 * Raporların kabuğu: rapor asistanı (modül 24), rapor tasarımcısı (modül 26), kayıtlı raporlar (ikisi birlikte).
 * Soru sormak AI bütçesi harcar (`reports.ask`); tasarlamak, kayıtlı raporu görmek / çalıştırmak harcamaz
 * (`reports.view`; tasarımcıda kaynağın kendi yetkisi de).
 */
export function ReportChatLayout() {
  useReportChatLive();
  const can = useCan();
  const tabs = [
    can(PERMISSIONS.REPORTS_ASK) && { to: REPORT_CHAT_PATH, label: 'Rapor asistanı', icon: 'sparkles' },
    can(PERMISSIONS.REPORTS_VIEW) && { to: REPORT_DESIGNER_PATH, label: 'Rapor tasarımcısı', icon: 'sliders' },
    can(PERMISSIONS.REPORTS_VIEW) && { to: SAVED_REPORTS_PATH, label: 'Kayıtlı raporlar', icon: 'fileText' },
    can(PERMISSIONS.REPORTS_VIEW) && { to: REVENUE_REPORT_PATH, label: 'Gelir raporları', icon: 'chart' },
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Raporlar"
        description="Rapor asistanına sorun ya da kendi raporunuzu sütun seçerek tasarlayın. Kaydettiğiniz raporları sonra tek tıkla güncel veriyle çalıştırın, Excel'e indirin."
      />
      <TabNav label="Rapor sayfaları" tabs={tabs} />
      <Outlet />
    </div>
  );
}
