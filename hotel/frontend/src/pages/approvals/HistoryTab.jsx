import { ApprovalList } from './ApprovalList.jsx';

/**
 * Geçmiş onaylar: onaylanan, reddedilen, süresi dolan; yeni karar önce.
 * Satır yalnızca dökümü açar; karar değiştirilemez.
 */
export function HistoryTab() {
  return <ApprovalList view="HISTORY" />;
}
