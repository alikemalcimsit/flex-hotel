import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_COUPON_BATCH, MAX_COUPON_PREFIX_LENGTH, MAX_COUPON_USES, createCouponsSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input, Select } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { promotionKeys } from '../../lib/promotions.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { usePromotionOutlet } from './PromotionPage.jsx';

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

const USAGE_OPTIONS = [
  { value: '', label: 'Hepsi' },
  { value: 'UNUSED', label: 'Kullanılmamış' },
  { value: 'USED', label: 'Kullanılmış' },
];
const ACTIVE_OPTIONS = [
  { value: '', label: 'Açık ve kapalı' },
  { value: 'true', label: 'Açık' },
  { value: 'false', label: 'Kapalı' },
];

/** @param {number | null} maxUses */
const usesText = (maxUses) => (maxUses === null ? 'sınırsız' : maxUses === 1 ? 'tek kullanımlık' : `${maxUses} kullanım`);

/**
 * Bir üretimin kodlarını Excel'e yazar (dağıtım için: e-posta, baskı).
 * @param {{ promotion: { name: string }, items: Array<{ code: string, maxUses: number | null, used: number, isActive: boolean }> }} data
 * @param {string} fileName
 */
async function downloadCoupons(data, fileName) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const header = ['Kupon kodu', 'Kullanım hakkı', 'Kullanılan', 'Durum'].map((value) => ({ value, fontWeight: 'bold', backgroundColor: '#eef2f7' }));
  const rows = data.items.map((item) => [
    { value: item.code, type: String },
    { value: item.maxUses === null ? 'Sınırsız' : String(item.maxUses), type: String },
    { value: item.used, type: Number },
    { value: item.isActive ? 'Açık' : 'Kapalı', type: String },
  ]);
  await writeXlsxFile([header, ...rows], { sheet: 'Kuponlar', columns: [{ width: 24 }, { width: 16 }, { width: 12 }, { width: 10 }], stickyRowsCount: 1 }).toFile(fileName);
}

/**
 * Promosyonun kuponları (modül 31): üretim (toplu rastgele kod ya da tek
 * elle kod), üretimlerin Excel'e aktarılması, kod listesi (arama, kullanılmış /
 * kullanılmamış) ve kuponu kapatma / açma. Kullanım = kuponla açılmış geçerli
 * rezervasyon (iptalde hak geri açılır); her oda bir kullanım.
 */
export function PromotionCouponsTab() {
  const { promotion } = usePromotionOutlet();
  const can = useCan();
  const canManage = can(PERMISSIONS.PROMOTIONS_MANAGE);
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [usage, setUsage] = useState('');
  const [active, setActive] = useState('');
  const [batchId, setBatchId] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const filters = { search, usage, active, batchId, page };
  const list = useQuery({
    queryKey: promotionKeys.coupons(promotion.id, filters),
    queryFn: () =>
      api(
        withQuery(`/promotions/${promotion.id}/coupons`, {
          search: search || undefined,
          usage: usage || undefined,
          active: active || undefined,
          batchId: batchId || undefined,
          page,
          pageSize: PAGE_SIZE,
        }),
      ),
    placeholderData: keepPreviousData,
  });

  const toggle = useMutation({
    mutationFn: (coupon) => apiPost(`/promotions/${promotion.id}/coupons/${coupon.id}/status`, { expectedUpdatedAt: coupon.updatedAt, isActive: !coupon.isActive }),
    onSuccess: (coupon) => {
      toastSuccess(coupon.isActive ? `${coupon.code} yeniden açıldı` : `${coupon.code} kapatıldı; yeni rezervasyonda kullanılamaz`);
      queryClient.invalidateQueries({ queryKey: promotionKeys.all });
    },
    onError: (error) => {
      toastError(error.code === 'STALE_WRITE' ? 'Kupon bu arada değişti; liste yenilendi, tekrar deneyin.' : error.message);
      queryClient.invalidateQueries({ queryKey: promotionKeys.all });
    },
  });

  async function exportBatch(batch) {
    setExporting(batch.batchId);
    try {
      const data = await api(withQuery(`/promotions/${promotion.id}/coupons/export`, { batchId: batch.batchId }));
      await downloadCoupons(data, `kuponlar-${(batch.createdAt ?? '').slice(0, 10)}-${batch.count}.xlsx`);
    } catch (error) {
      toastError(error.message ?? 'Kuponlar indirilemedi');
    } finally {
      setExporting(null);
    }
  }

  const columns = [
    { key: 'code', header: 'Kod', render: (row) => <span className="font-mono text-sm font-bold text-ink">{row.code}</span> },
    {
      key: 'used',
      header: 'Kullanım',
      className: 'whitespace-nowrap tabular-nums',
      render: (row) => (
        <span className="text-xs">
          <span className="font-semibold text-ink">{row.used}</span>
          <span className="text-ink-muted"> / {row.maxUses === null ? '∞' : row.maxUses}</span>
          {row.remaining === 0 && <Badge tone="neutral" className="ml-2">Doldu</Badge>}
        </span>
      ),
    },
    { key: 'isActive', header: 'Durum', render: (row) => <Badge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'Açık' : 'Kapalı'}</Badge> },
    { key: 'createdAt', header: 'Üretim', className: 'whitespace-nowrap text-xs text-ink-muted', render: (row) => formatDate(row.createdAt) },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            className: 'text-right',
            render: (row) => (
              <Button size="sm" variant="ghost" onClick={() => toggle.mutate(row)} disabled={toggle.isPending}>
                {row.isActive ? 'Kapat' : 'Aç'}
              </Button>
            ),
          },
        ]
      : []),
  ];

  const batches = promotion.coupons.batches;
  const filtered = Boolean(search || usage || active || batchId);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-ink-soft">
          {promotion.coupons.total} kupon · {promotion.coupons.active} açık. Her oda bir kullanımdır; iptal edilen rezervasyonun hakkı geri açılır.
        </p>
        {canManage && (
          <Button icon="plus" className="sm:ml-auto" onClick={() => setGenerating(true)}>
            Kupon üret
          </Button>
        )}
      </div>
      {promotion.status !== 'ACTIVE' && promotion.coupons.total > 0 && (
        <Alert tone="info" title="Promosyon yayında değil">Kuponlar promosyon yayına alınana kadar kullanılamaz.</Alert>
      )}

      {batches.length > 0 && (
        <section aria-label="Üretimler" className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-ink">Üretimler</h2>
          <ul className="flex flex-col divide-y divide-line rounded-item border border-line bg-surface">
            {batches.map((batch) => (
              <li key={batch.batchId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  <span className="font-semibold text-ink">{batch.count} kod</span>
                  <span className="ml-2 text-xs text-ink-muted">
                    {formatDate(batch.createdAt)} · {usesText(batch.maxUses)} · ör. <span className="font-mono">{batch.sampleCode}</span>
                  </span>
                </span>
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { setBatchId(batchId === batch.batchId ? '' : batch.batchId); setPage(1); }}>
                    {batchId === batch.batchId ? 'Süzgeci kaldır' : 'Listele'}
                  </Button>
                  <Button size="sm" variant="outline" icon="download" onClick={() => exportBatch(batch)} disabled={exporting === batch.batchId}>
                    {exporting === batch.batchId ? 'Hazırlanıyor…' : 'Excel'}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_12rem]">
        <Input label="Kod ara" name="coupon-search" placeholder="Kodun bir kısmı" value={searchText} onChange={(event) => setSearchText(event.target.value)} />
        <Select label="Kullanım" name="coupon-usage" value={usage} onChange={(event) => { setUsage(event.target.value); setPage(1); }} options={USAGE_OPTIONS} />
        <Select label="Durum" name="coupon-active" value={active} onChange={(event) => { setActive(event.target.value); setPage(1); }} options={ACTIVE_OPTIONS} />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={filtered ? 'Süzgece uyan kupon yok' : 'Henüz kupon yok'}
        emptyHint={filtered ? undefined : canManage ? '"Kupon üret" ile toplu rastgele kod ya da tek bir kampanya kodu oluşturun.' : undefined}
      />

      {generating && (
        <GenerateCouponsDialog
          promotion={promotion}
          onClose={() => setGenerating(false)}
          onDone={() => {
            setGenerating(false);
            queryClient.invalidateQueries({ queryKey: promotionKeys.all });
          }}
        />
      )}
    </div>
  );
}

const MODE_OPTIONS = [
  { value: 'GENERATE', label: 'Toplu rastgele kod' },
  { value: 'CUSTOM', label: 'Tek kod (ör. YAZ2027)' },
];
const USE_OPTIONS = [
  { value: 'ONCE', label: 'Tek kullanımlık' },
  { value: 'LIMITED', label: 'Sınırlı' },
  { value: 'UNLIMITED', label: 'Sınırsız' },
];

/**
 * Kupon üretimi: toplu (adet, önek) ya da tek elle kod; kullanım hakkı tek,
 * sınırlı ya da sınırsız.
 * @param {{ promotion: any, onClose: () => void, onDone: () => void }} props
 */
function GenerateCouponsDialog({ promotion, onClose, onDone }) {
  const [values, setValues] = useState({ mode: 'GENERATE', count: '100', prefix: '', code: '', uses: 'ONCE', maxUses: '10' });
  const [errors, setErrors] = useState({});
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));

  const create = useMutation({
    mutationFn: (payload) => apiPost(`/promotions/${promotion.id}/coupons`, payload),
    onSuccess: (result) => {
      toastSuccess(`${result.count} kupon üretildi`);
      onDone();
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      toastError(error.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    const maxUses = values.uses === 'ONCE' ? 1 : values.uses === 'UNLIMITED' ? null : values.maxUses;
    const payload =
      values.mode === 'CUSTOM' ? { mode: 'CUSTOM', code: values.code, maxUses } : { mode: 'GENERATE', count: values.count, prefix: values.prefix, maxUses };
    const checked = validateWith(createCouponsSchema, payload);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    create.mutate(payload);
  }

  const busy = create.isPending;
  return (
    <Modal
      open
      title={`${promotion.name} — kupon üret`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="coupon-form" icon="check" disabled={busy}>{busy ? 'Üretiliyor…' : 'Üret'}</Button>
        </>
      }
    >
      <form id="coupon-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <ChoiceChips label="Üretim" options={MODE_OPTIONS} value={values.mode} onChange={(mode) => setValues((current) => ({ ...current, mode, uses: mode === 'CUSTOM' ? 'UNLIMITED' : 'ONCE' }))} disabled={busy} required />
        {values.mode === 'GENERATE' ? (
          <div className="flex flex-wrap gap-3">
            <Input label="Adet" name="coupon-count" type="number" inputMode="numeric" min={1} max={MAX_COUPON_BATCH} value={values.count} onChange={set('count')} error={errors.count} disabled={busy} className="w-32" />
            <Input label="Önek (isteğe bağlı)" name="coupon-prefix" value={values.prefix} onChange={set('prefix')} error={errors.prefix} maxLength={MAX_COUPON_PREFIX_LENGTH} placeholder="Ör. YAZ" disabled={busy} className="w-full uppercase sm:w-48" />
            <p className="w-full text-xs text-ink-muted">Kodlar karışmayan harflerden üretilir: {values.prefix ? `${values.prefix.toUpperCase()}-` : ''}K7QXNA3P gibi.</p>
          </div>
        ) : (
          <Input label="Kod" name="coupon-code" value={values.code} onChange={set('code')} error={errors.code} placeholder="YAZ2027" disabled={busy} className="w-full uppercase sm:w-64" />
        )}
        <div className="flex flex-col gap-2">
          <ChoiceChips label="Kullanım hakkı" options={USE_OPTIONS} value={values.uses} onChange={(uses) => setValues((current) => ({ ...current, uses }))} disabled={busy} required />
          {values.uses === 'LIMITED' && (
            <Input label="Kod başına kullanım" name="coupon-max-uses" type="number" inputMode="numeric" min={1} max={MAX_COUPON_USES} value={values.maxUses} onChange={set('maxUses')} error={errors.maxUses} disabled={busy} className="w-40" />
          )}
          <p className="text-xs text-ink-muted">Her oda bir kullanımdır (3 odalık grup 3 kullanım). İptal edilen rezervasyonun hakkı geri açılır.</p>
        </div>
        {errors.mode && <Alert tone="danger" title="Üretilemedi">{errors.mode}</Alert>}
      </form>
    </Modal>
  );
}
