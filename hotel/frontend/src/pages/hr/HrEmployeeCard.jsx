import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, Spinner } from '@hotelos/ui';
import { api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { daysText, hrKeys } from '../../lib/hr.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';

/**
 * Personel kartındaki "İK" kartı (modül 52, yalnız `hr.view`): yıllık izin bakiyesi (hak / kullanılan / bekleyen /
 * kalan) ve personelin izinleri ile belgelerine bağlantı.
 * @param {{ employeeId: string }} props
 */
export function HrEmployeeCard({ employeeId }) {
  const can = useCan();
  const enabled = can(PERMISSIONS.HR_VIEW);
  const query = useQuery({ queryKey: hrKeys.balance(employeeId, undefined), queryFn: () => api(`/hr/employees/${employeeId}/leave-balance`), enabled });
  if (!enabled) return null;
  const data = query.data;
  return (
    <Card
      title="İK"
      actions={
        <span className="flex flex-wrap gap-3 text-sm">
          <Link to={`/ik/izinler?employeeId=${employeeId}`} className="font-semibold text-ink hover:underline">
            İzinleri →
          </Link>
          <Link to={`/ik/belgeler?employeeId=${employeeId}`} className="font-semibold text-ink hover:underline">
            Belgeleri →
          </Link>
        </span>
      }
    >
      {query.isPending && <Spinner className="py-4" />}
      {query.isError && <p className="text-sm text-sec-strong">Bakiye okunamadı: {query.error.message}</p>}
      {data && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-ink-muted">Yıllık izin hakkı</dt>
            <dd className="font-medium tabular-nums text-ink">{daysText(data.earned)} gün{Number(data.adjusted) ? ` (${Number(data.adjusted) > 0 ? '+' : ''}${daysText(data.adjusted)} düzeltme)` : ''}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Kullanılan</dt>
            <dd className="font-medium tabular-nums text-ink">{daysText(data.used)} gün</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Onay bekleyen</dt>
            <dd className="font-medium tabular-nums text-ink">{daysText(data.pendingDays)} gün</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Kalan ({formatDate(data.asOf)})</dt>
            <dd className={`text-lg font-bold tabular-nums ${Number(data.balance) < 0 ? 'text-sec-strong' : 'text-ink'}`}>{daysText(data.balance)} gün</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}
