import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_SYNC_DAYS, ledgerSettingsSchema, ledgerSyncSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, Input } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { monthStart } from '../../lib/accounting.js';
import { api, apiPost, apiPut } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { ledgerKeys } from '../../lib/ledger.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/** Dönem kilidi en geç dünü kapsar (bugün kilitlenemez). @param {string} today "YYYY-AA-GG" */
function yesterdayOf(today) {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Genel muhasebe ayarları (modül 48): dönem kilidi (bu güne kadar fiş girilemez / iptal edilemez; `ledger.setup`),
 * fişlenmemiş cari ve kasa / banka hareket sayıları ve "Eşitle" (dönem seçimi, `ledger.manage`; sonuç özeti ve
 * hata listesi), hesap planı yükleme durumu ve "Tek Düzen'i tamamla".
 */
export function LedgerSettingsPage() {
  const can = useCan();
  const canSetup = can(PERMISSIONS.LEDGER_SETUP);
  const canManage = can(PERMISSIONS.LEDGER_MANAGE);
  const query = useQuery({ queryKey: ledgerKeys.settings, queryFn: () => api('/ledger/settings') });
  if (!query.data) return <QueryFallback query={query} errorTitle="Ayarlar yüklenemedi" />;
  const data = query.data;
  return (
    <div className="flex flex-col gap-4">
      <LockCard data={data} canSetup={canSetup} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SummaryTile label="Fişlenmemiş cari hareketi" value={data.unposted.ledgerEntries} hint="Yevmiyeye yazılmayı bekleyen cari kaydı" icon="users" tone={data.unposted.ledgerEntries ? 'warning' : 'neutral'} />
        <SummaryTile label="Fişlenmemiş kasa / banka hareketi" value={data.unposted.treasuryMovements} hint="Yevmiyeye yazılmayı bekleyen kasa / banka kaydı" icon="wallet" tone={data.unposted.treasuryMovements ? 'warning' : 'neutral'} />
      </div>
      {canManage && <SyncCard data={data} />}
      <ChartCard data={data} canSetup={canSetup} />
    </div>
  );
}

/** Dönem kilidi. @param {{ data: any, canSetup: boolean }} props */
function LockCard({ data, canSetup }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [lockedThrough, setLockedThrough] = useState(data.settings.glLockedThrough ?? '');
  const [errors, setErrors] = useState({});
  const save = useMutation({
    mutationFn: (body) => apiPut('/ledger/settings', body),
    onSuccess: (result) => {
      queryClient.setQueryData(ledgerKeys.settings, result);
      queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
      setEditing(false);
      toastSuccess(result.settings.glLockedThrough ? `Dönem ${formatDate(result.settings.glLockedThrough)} gününe kadar kilitlendi` : 'Dönem kilidi kaldırıldı');
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: ledgerKeys.settings });
      toastError(error.message);
    },
  });
  function submit(event) {
    event.preventDefault();
    const body = { expectedUpdatedAt: data.settings.updatedAt ?? null, glLockedThrough: lockedThrough || null };
    const checked = validateWith(ledgerSettingsSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(body);
  }
  return (
    <Card
      title="Dönem kilidi"
      description="Kilit gününe (dahil) kadar elle fiş girilemez ve fiş iptal edilemez; otomatik fiş kilit sonrasındaki ilk güne düşer ve açıklamasında belirtilir. Boş bırakılırsa kilit yok."
      actions={
        canSetup &&
        !editing && (
          <Button type="button" size="sm" variant="outline" icon="pencil" onClick={() => setEditing(true)}>
            Düzenle
          </Button>
        )
      }
    >
      {editing ? (
        <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
          <Input label="Kilit günü (dahil)" type="date" max={yesterdayOf(data.today)} min={data.settings.startDate} value={lockedThrough} onChange={(event) => setLockedThrough(event.target.value)} error={errors.glLockedThrough} disabled={save.isPending} />
          <Button type="button" variant="ghost" onClick={() => setLockedThrough('')} disabled={save.isPending || !lockedThrough}>
            Kilidi kaldır
          </Button>
          <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={save.isPending}>
            Vazgeç
          </Button>
          <Button type="submit" icon="lock" disabled={save.isPending}>
            {save.isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </form>
      ) : (
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <dt className="text-ink-muted">Kilitli dönem</dt>
          <dd className="font-semibold">{data.settings.glLockedThrough ? `${formatDate(data.settings.glLockedThrough)} gününe kadar` : 'Kilit yok'}</dd>
          <dt className="text-ink-muted">Muhasebe başlangıcı</dt>
          <dd className="font-semibold">{formatDate(data.settings.startDate)}</dd>
        </dl>
      )}
    </Card>
  );
}

/** Fişlenmemiş hareketleri ve günlük gelir fişlerini dönem için işler. @param {{ data: any }} props */
function SyncCard({ data }) {
  const queryClient = useQueryClient();
  const startDate = data.settings.startDate;
  const defaultFrom = monthStart(data.today) < startDate ? startDate : monthStart(data.today);
  const [period, setPeriod] = useState({ from: defaultFrom, to: data.today });
  const [errors, setErrors] = useState({});
  const run = useMutation({
    mutationFn: (body) => apiPost('/ledger/sync', body),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
      toastSuccess(`${result.posted} fiş yazıldı${result.failed ? `, ${result.failed} belge işlenemedi` : ''}${result.remaining ? `, ${result.remaining} belge kaldı` : ''}`);
    },
    onError: (error) => toastError(error.message),
  });
  function submit(event) {
    event.preventDefault();
    const checked = validateWith(ledgerSyncSchema, period);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    run.mutate(period);
  }
  const report = run.data;
  const cells = report ? [['İşlendi', report.posted], ['Atlandı', report.skipped], ['Hata', report.failed], ['Kalan', report.remaining]] : [];
  return (
    <Card title="Eşitle" description={`Dönemdeki fişlenmemiş cari ve kasa / banka hareketlerini yevmiyeye yazar, günlerin gelir fişini (yeniden) hesaplar (en fazla ${MAX_SYNC_DAYS} gün). Fişlenmiş kayıt ikinci kez yazılmaz; kuralı eksik kaynak hata listesinde görünür.`}>
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
        <Input label="Başlangıç" type="date" min={startDate} max={period.to} value={period.from} onChange={(event) => setPeriod((current) => ({ ...current, from: event.target.value }))} error={errors.from} disabled={run.isPending} />
        <Input label="Bitiş" type="date" min={period.from} max={data.today} value={period.to} onChange={(event) => setPeriod((current) => ({ ...current, to: event.target.value }))} error={errors.to} disabled={run.isPending} />
        <Button type="submit" icon="refresh" disabled={run.isPending}>
          {run.isPending ? 'Eşitleniyor…' : 'Eşitle'}
        </Button>
      </form>
      {report && (
        <div className="mt-4 flex flex-col gap-3">
          <table className="w-full max-w-md text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                {cells.map(([label]) => (
                  <th key={label} className="py-2 pr-3">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {cells.map(([label, value]) => (
                  <td key={label} className={`py-2 pr-3 text-lg font-bold tabular-nums ${label === 'Hata' && value ? 'text-sec-strong' : ''}`}>
                    {value}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-ink-muted">
            {formatDate(report.from)} – {formatDate(report.to)}
            {report.remaining ? " · bu turda yetişmeyen belgeler için Eşitle'ye yeniden basın, kaldığı yerden sürer." : ''}
          </p>
          {report.errors.length > 0 && (
            <Alert tone="warning" title="İşlenemeyen belgeler">
              <ul className="list-disc pl-5 text-xs">
                {report.errors.map((error, index) => (
                  <li key={`${error.source}-${error.id ?? index}`}>
                    {error.source ? `${error.source}: ` : ''}
                    {error.message}
                    {error.count > 1 ? ` (${error.count} belge)` : ''}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs">
                Kuralı eksik kaynak için{' '}
                <Link to="/genel-muhasebe/kurallar" className="font-semibold hover:underline">
                  Kurallar
                </Link>{' '}
                sayfasından hesap seçip yeniden eşitleyin.
              </p>
            </Alert>
          )}
        </div>
      )}
    </Card>
  );
}

/** Hesap planı durumu ve Tek Düzen yüklemesi. @param {{ data: any, canSetup: boolean }} props */
function ChartCard({ data, canSetup }) {
  const queryClient = useQueryClient();
  const seed = useMutation({
    mutationFn: () => apiPost('/ledger/chart/seed', {}),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
      toastSuccess(`${result.created} hesap ve ${result.rules} kural eklendi`);
    },
    onError: (error) => toastError(error.message),
  });
  const seededAt = data.settings.glChartSeededAt;
  return (
    <Card
      title="Hesap planı"
      description="Tek Düzen hesap planının standart hesapları ve varsayılan fiş kuralları. Yeniden çalıştırmak yalnız eksikleri tamamlar; otelin açtığı hesaplara ve değiştirdiği kurallara dokunmaz."
      actions={
        canSetup && (
          <Button type="button" size="sm" variant={seededAt ? 'outline' : 'primary'} icon="download" onClick={() => seed.mutate()} disabled={seed.isPending}>
            {seed.isPending ? 'Yükleniyor…' : "Tek Düzen'i tamamla"}
          </Button>
        )
      }
    >
      {seededAt ? (
        <p className="text-sm text-ink-soft">
          Tek Düzen hesapları {formatDateTime(seededAt)} yüklendi.{' '}
          <Link to="/genel-muhasebe/hesap-plani" className="font-semibold hover:underline">
            Hesap planına git →
          </Link>
        </p>
      ) : (
        <Alert tone="warning" title="Hesap planı yüklenmedi">
          Otomatik fişler hesap planı olmadan yazılamaz. "Tek Düzen'i tamamla" standart hesapları ve varsayılan kuralları açar.
        </Alert>
      )}
    </Card>
  );
}
