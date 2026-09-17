import { SummaryTile } from '../../components/SummaryTile.jsx';
import { useApprovalSummary } from '../../lib/approvals.js';
import { formatElapsed } from '../../lib/timeFormat.js';
import { useNow } from '../../lib/useNow.js';
import { ApprovalList } from './ApprovalList.jsx';

/** "En uzun bekleyen" yazısının tazelenmesi. */
const CLOCK_TICK_MS = 60_000;

/**
 * Bekleyen onaylar: özet kutuları ve en uzun bekleyenden başlayan liste.
 * Yetkisi olan satırdan tek tıkla onaylar / reddeder.
 */
export function PendingTab() {
  const summary = useApprovalSummary().data;
  const now = useNow(CLOCK_TICK_MS);
  const oldest = summary?.oldestPendingAt ? formatElapsed(summary.oldestPendingAt, now) : null;

  return (
    <ApprovalList view="PENDING">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryTile label="Bekleyen" value={summary?.pending} hint="Karar bekleyen iş" icon="checkCheck" />
        <SummaryTile
          label="Süresi yaklaşan"
          value={summary?.expiringSoon}
          hint="Bir saat içinde düşecek"
          icon="alarm"
          tone={summary?.expiringSoon > 0 ? 'danger' : 'neutral'}
        />
        <SummaryTile
          label="En uzun bekleyen"
          value={summary ? (oldest ?? 'Yok') : undefined}
          hint={oldest ? 'En eski isteğin bekleme süresi' : 'Bekleyen iş yok'}
          icon="clock"
          tone={summary?.pending > 0 ? 'warning' : 'neutral'}
        />
      </div>
    </ApprovalList>
  );
}
