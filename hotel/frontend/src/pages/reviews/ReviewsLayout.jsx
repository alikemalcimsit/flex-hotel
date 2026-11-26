import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { api, withQuery } from '../../lib/api.js';
import { reviewKeys, useReviewsLive } from '../../lib/reviews.js';

const SUMMARY_PARAMS = Object.freeze({ page: 1, pageSize: 1 });

/**
 * Misafir yorumları kabuğu (modül 54): liste ve trend. `reviews.view` ile görünür; yazma düğmeleri (`reviews.reply`,
 * `reviews.manage`) sayfalarda gizlenir. AI etiketi bekleyen yorum varsa her sekmede bilgi şeridi.
 */
export function ReviewsLayout() {
  useReviewsLive();
  const summary = useQuery({ queryKey: reviewKeys.list(SUMMARY_PARAMS), queryFn: () => api(withQuery('/reviews', SUMMARY_PARAMS)) });
  const pending = summary.data?.summary?.pendingAnalysis ?? 0;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Misafir yorumları"
        description="Google, Booking.com, Tripadvisor ve diğer platformlardaki yorumlar: elle ya da dosyadan girilir, AI duygu / konu etiketi koyar ve cevap önerir."
      />
      {pending > 0 && (
        <Alert tone="info">
          {pending} yorum AI analizini bekliyor — ajan kapalıysa Yönetim → Aktörler'den açın. Beklerken etiketi ayrıntıdan elle koyabilirsiniz.
        </Alert>
      )}
      <TabNav
        label="Yorum sayfaları"
        tabs={[
          { to: '/yorumlar/liste', label: 'Yorumlar', icon: 'message' },
          { to: '/yorumlar/trend', label: 'Trend', icon: 'chart' },
        ]}
      />
      <Outlet />
    </div>
  );
}
