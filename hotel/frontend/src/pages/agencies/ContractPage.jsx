import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BOARD_TYPE_LABELS, CONTRACT_STATUS_LABELS, MAX_CONTRACT_NAME_LENGTH, updateContractSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Icon, Input, Textarea } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { apiDelete, apiPatch, apiPost, apiPut } from '../../lib/api.js';
import { CONTRACT_STATUS_TONES, agencyKeys, useAgencyLive, useContract } from '../../lib/agencies.js';
import { rateSignature, ratesToBlocks, validateBlocks } from '../../lib/rateBlocks.js';
import { formatDate } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useHotelSettings } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { useRoomTypes } from '../rooms/useRoomTypes.js';
import { EndContractDialog, StopSaleDialog } from './AgencyDialogs.jsx';
import { RateGrid } from './RateGrid.jsx';

const STALE_TEXT = 'Kontrat bu arada başkası tarafından değiştirildi. Kaydedilmemiş değişikliklerinizi not alıp sunucudaki hali yükleyin.';

/**
 * Kontrat sayfası (modül 29): başlık (ad, dönem), fiyat tablosu (dönem blokları ×
 * oda tipi × pansiyon) ve stop-sale. Taslak satışa kapalıdır; "Satışa aç" ile
 * acente adına açılan rezervasyonlar bu fiyatları alır. Satıştaki kontratın
 * fiyatı değişebilir: yalnızca sonradan açılan rezervasyonlar etkilenir.
 * Düzenleme `agencies.manage` ister; sonlandırılmış kontrat salt okunurdur.
 */
export function ContractPage() {
  const { contractId } = useParams();
  const query = useContract(contractId);
  useAgencyLive();
  const fallback = <QueryFallback query={query} errorTitle="Kontrat yüklenemedi" />;
  if (query.isPending || query.isError) return <div className="flex flex-col gap-6">{fallback}</div>;
  return <ContractView key={contractId} contract={query.data} />;
}

/** @param {{ contract: any }} props */
function ContractView({ contract }) {
  const can = useCan();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { roomTypes } = useRoomTypes();
  const defaultBoard = useHotelSettings().data?.defaultBoardType ?? 'BB';
  const [dialog, setDialog] = useState(null);
  const [removing, setRemoving] = useState(null);
  const editable = can(PERMISSIONS.AGENCIES_MANAGE) && contract.status !== 'ENDED';
  const refresh = () => queryClient.invalidateQueries({ queryKey: agencyKeys.all });

  /* ── Fiyat tablosu: sunucudaki hale göre sıfırlanır, ama yazılanı silmez ── */
  const [blocks, setBlocks] = useState(() => ratesToBlocks(contract.rates));
  const [base, setBase] = useState({ version: contract.updatedAt, signature: rateSignature(contract.rates) });
  const [serverChanged, setServerChanged] = useState(false);
  const [rateError, setRateError] = useState('');
  const validation = useMemo(() => validateBlocks(blocks, contract), [blocks, contract]);
  const dirty = rateSignature(validation.rates) !== base.signature;
  const invalid = Object.keys(validation.blockErrors).length + Object.keys(validation.cellErrors).length > 0;

  const loadServer = (detail) => {
    setBlocks(ratesToBlocks(detail.rates));
    setBase({ version: detail.updatedAt, signature: rateSignature(detail.rates) });
    setServerChanged(false);
    setRateError('');
  };

  // Başkası kaydettiyse (sürüm değişti) ve yerelde yazılmış bir şey yoksa sessizce yenilenir;
  // yazılmışsa silinmez, uyarı gösterilir.
  useEffect(() => {
    if (contract.updatedAt === base.version) return;
    if (dirty) setServerChanged(true);
    else loadServer(contract);
    // `dirty` ve `base` bilerek bağımlılık dışı: yalnızca sunucu sürümü değişince karar verilir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract.updatedAt]);

  const saveRates = useMutation({
    mutationFn: (rates) => apiPut(`/agencies/contracts/${contract.id}/rates`, { expectedUpdatedAt: base.version, rates }),
    onSuccess: (detail) => {
      queryClient.setQueryData(agencyKeys.contract(contract.id), detail);
      refresh();
      loadServer(detail);
      toastSuccess(contract.status === 'ACTIVE' ? 'Fiyatlar kaydedildi; yeni rezervasyonlara uygulanır' : 'Fiyatlar kaydedildi');
    },
    onError: (error) => {
      if (error.code === 'STALE_WRITE') {
        setServerChanged(true);
        refresh();
        toastError(STALE_TEXT);
      } else {
        setRateError(error.message);
        toastError(error.message);
      }
    },
  });

  function submitRates() {
    if (invalid) {
      toastError('Fiyat tablosunda düzeltilmesi gereken yerler var');
      return;
    }
    setRateError('');
    saveRates.mutate(validation.rates);
  }

  /* ── Başlık formu ── */
  const [header, setHeader] = useState({ name: contract.name, startDate: contract.startDate, endDate: contract.endDate, notes: contract.notes ?? '' });
  const [headerBase, setHeaderBase] = useState({ version: contract.updatedAt, values: header });
  const [headerErrors, setHeaderErrors] = useState({});
  const headerDirty = JSON.stringify(header) !== JSON.stringify(headerBase.values);
  const headerFromServer = (detail) => ({ name: detail.name, startDate: detail.startDate, endDate: detail.endDate, notes: detail.notes ?? '' });
  useEffect(() => {
    if (contract.updatedAt === headerBase.version || headerDirty) return;
    const values = headerFromServer(contract);
    setHeader(values);
    setHeaderBase({ version: contract.updatedAt, values });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract.updatedAt]);

  const saveHeader = useMutation({
    mutationFn: (payload) => apiPatch(`/agencies/contracts/${contract.id}`, payload),
    onSuccess: (detail) => {
      queryClient.setQueryData(agencyKeys.contract(contract.id), detail);
      refresh();
      const values = headerFromServer(detail);
      setHeader(values);
      setHeaderBase({ version: detail.updatedAt, values });
      toastSuccess('Kontrat bilgileri kaydedildi');
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setHeaderErrors(error.fields);
      toastError(error.code === 'STALE_WRITE' ? STALE_TEXT : error.message);
      if (error.code === 'STALE_WRITE') refresh();
    },
  });

  function submitHeader(event) {
    event.preventDefault();
    const payload = { ...header, expectedUpdatedAt: headerBase.version };
    const checked = validateWith(updateContractSchema, payload);
    if (!checked.ok) {
      setHeaderErrors(checked.errors);
      return;
    }
    setHeaderErrors({});
    saveHeader.mutate(payload);
  }

  /* ── Durum işlemleri ── */
  const activate = useMutation({
    mutationFn: () => apiPost(`/agencies/contracts/${contract.id}/activate`, { expectedUpdatedAt: contract.updatedAt }),
    onSuccess: (detail) => {
      queryClient.setQueryData(agencyKeys.contract(contract.id), detail);
      refresh();
      toastSuccess('Kontrat satışa açıldı; acente adına açılan rezervasyonlar bu fiyatları alır');
    },
    onError: (error) => {
      toastError(error.code === 'STALE_WRITE' ? STALE_TEXT : error.message);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => apiPost(`/agencies/contracts/${contract.id}/delete`, { expectedUpdatedAt: contract.updatedAt }),
    onSuccess: () => {
      toastSuccess('Taslak kontrat silindi');
      refresh();
      navigate(`/acenteler/${contract.agency.id}/kontratlar`, { replace: true });
    },
    onError: (error) => {
      toastError(error.code === 'STALE_WRITE' ? STALE_TEXT : error.message);
      setDialog(null);
      refresh();
    },
  });
  const removeStopSale = useMutation({
    mutationFn: (stopSaleId) => apiDelete(`/agencies/contracts/${contract.id}/stop-sales/${stopSaleId}`),
    onSuccess: () => {
      toastSuccess('Stop-sale kaldırıldı; satış yeniden açıldı');
      setRemoving(null);
      refresh();
    },
    onError: (error) => {
      toastError(error.message);
      setRemoving(null);
      refresh();
    },
  });

  const unsaved = dirty || headerDirty;
  const typeName = (id) => roomTypes.find((type) => type.id === id)?.name ?? 'Silinmiş oda tipi';

  return (
    <div className="flex flex-col gap-6">
      <Link to={`/acenteler/${contract.agency.id}/kontratlar`} className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
        <Icon name="arrowLeft" className="size-4" />
        {contract.agency.name}
      </Link>
      <PageHeader
        title={contract.name}
        description={`${contract.agency.name} · ${formatDate(contract.startDate)} – ${formatDate(contract.endDate)} · ${contract.currency}`}
        actions={
          <>
            <Badge tone={CONTRACT_STATUS_TONES[contract.status]}>{CONTRACT_STATUS_LABELS[contract.status]}</Badge>
            {editable && contract.status === 'DRAFT' && (
              <>
                <Button variant="dangerSoft" icon="trash" onClick={() => setDialog('delete')}>Taslağı sil</Button>
                <Button icon="check" disabled={contract.blockers.length > 0 || unsaved || activate.isPending} onClick={() => activate.mutate()}>
                  {activate.isPending ? 'Açılıyor…' : 'Satışa aç'}
                </Button>
              </>
            )}
            {editable && contract.status === 'ACTIVE' && (
              <Button variant="dangerSoft" icon="lock" onClick={() => setDialog('end')}>Sonlandır</Button>
            )}
          </>
        }
      />

      {contract.status === 'DRAFT' && contract.blockers.length > 0 && (
        <Alert tone="warning" title="Satışa açmadan önce">
          <ul className="list-disc pl-5">
            {contract.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </Alert>
      )}
      {contract.status === 'DRAFT' && contract.blockers.length === 0 && unsaved && (
        <Alert tone="info" title="Kaydedilmemiş değişiklik var">Satışa açmadan önce değişiklikleri kaydedin.</Alert>
      )}
      {contract.status === 'ACTIVE' && (
        <Alert tone="info" title="Kontrat satışta">
          Fiyat değişikliği yalnızca bundan sonra açılan rezervasyonları etkiler; açılmış rezervasyonlar açıldıkları günkü fiyatı korur. Her değişiklik denetim izine yazılır.
        </Alert>
      )}
      {contract.status === 'ENDED' && (
        <Alert tone="info" title="Kontrat sonlandırıldı">
          {formatDate(contract.endedAt)} · {contract.endedBy}: {contract.endReason}. Salt okunur; devam için yeni kontrat açın.
        </Alert>
      )}

      <Card>
        <form onSubmit={submitHeader} noValidate className="flex flex-col gap-4 p-1">
          <h2 className="text-lg font-bold text-ink">Kontrat bilgileri</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Kontrat adı" name="contract-name" value={header.name} maxLength={MAX_CONTRACT_NAME_LENGTH} onChange={(event) => setHeader({ ...header, name: event.target.value })} error={headerErrors.name} disabled={!editable} className="sm:col-span-1" />
            <Input label="Başlangıç" name="contract-start" type="date" value={header.startDate} onChange={(event) => setHeader({ ...header, startDate: event.target.value })} error={headerErrors.startDate} disabled={!editable} />
            <Input label="Bitiş (dahil)" name="contract-end" type="date" min={header.startDate || undefined} value={header.endDate} onChange={(event) => setHeader({ ...header, endDate: event.target.value })} error={headerErrors.endDate} disabled={!editable} />
          </div>
          <Textarea label="Not" name="contract-notes" rows={2} value={header.notes} onChange={(event) => setHeader({ ...header, notes: event.target.value })} error={headerErrors.notes} disabled={!editable} />
          {editable && (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" icon="check" disabled={!headerDirty || saveHeader.isPending}>{saveHeader.isPending ? 'Kaydediliyor…' : 'Bilgileri kaydet'}</Button>
              {headerDirty && <Button type="button" variant="outline" onClick={() => { setHeader(headerBase.values); setHeaderErrors({}); }}>Değişiklikleri at</Button>}
              <p className="text-xs text-ink-muted">Dönem değişince fiyat ve stop-sale tarihleri yeni dönemin içinde kalmalı.</p>
            </div>
          )}
        </form>
      </Card>

      <section className="flex flex-col gap-4" aria-labelledby="rates-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="rates-title" className="text-lg font-bold text-ink">Fiyatlar</h2>
            <p className="text-sm text-ink-muted">Oda başı gecelik fiyat ({contract.currency}); rezervasyonun oda fiyatı olarak aynen yazılır. Boş hücre satılmaz.</p>
          </div>
        </div>
        {serverChanged && (
          <Alert
            tone="warning"
            title="Kontrat başkası tarafından değiştirildi"
            action={<Button variant="outline" size="sm" icon="refresh" onClick={() => loadServer(contract)}>Sunucudaki hali yükle</Button>}
          >
            Yazdığınız değişiklikler henüz kaydedilmedi. Kaydetmeyi denerseniz başkasının değişikliği ezilmemesi için reddedilir; sunucudaki hali yükleyip değişikliğinizi yeniden girin.
          </Alert>
        )}
        {rateError && <Alert tone="danger" title="Fiyatlar kaydedilemedi">{rateError}</Alert>}
        <RateGrid
          blocks={blocks}
          onChange={setBlocks}
          roomTypes={roomTypes}
          contract={contract}
          defaultBoard={defaultBoard}
          blockErrors={validation.blockErrors}
          cellErrors={validation.cellErrors}
          readOnly={!editable}
        />
        {editable && (
          <div className="flex flex-wrap items-center gap-3 rounded-card bg-surface px-5 py-4 shadow-card">
            <Button icon="check" disabled={!dirty || saveRates.isPending} onClick={submitRates}>{saveRates.isPending ? 'Kaydediliyor…' : 'Fiyatları kaydet'}</Button>
            {dirty && <Button variant="outline" onClick={() => loadServer(contract)} disabled={saveRates.isPending}>Değişiklikleri at</Button>}
            <span className="text-xs text-ink-muted">
              {validation.rates.length} fiyat satırı{dirty ? ' · kaydedilmemiş değişiklik var' : ''}
              {invalid ? ' · düzeltilmesi gereken yerler var' : ''}
            </span>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="stop-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="stop-title" className="text-lg font-bold text-ink">Stop-sale</h2>
            <p className="text-sm text-ink-muted">Bu günlerde acente adına yeni rezervasyon açılamaz (elle fiyatla da). Açılmış rezervasyonlar etkilenmez.</p>
          </div>
          {editable && <Button variant="outline" icon="plus" onClick={() => setDialog('stop')}>Stop-sale ekle</Button>}
        </div>
        {contract.stopSales.length === 0 ? (
          <EmptyState icon="alertTriangle" title="Stop-sale yok" description="Tüm kontrat dönemi satışa açık." />
        ) : (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
            {contract.stopSales.map((stop) => (
              <li key={stop.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold text-ink">{formatDate(stop.startDate)}{stop.endDate !== stop.startDate ? ` – ${formatDate(stop.endDate)}` : ''}</span>
                  <span className="ml-2 text-ink-soft">{stop.roomTypeId ? typeName(stop.roomTypeId) : 'Tüm oda tipleri'}</span>
                  {stop.reason && <span className="block text-xs text-ink-muted">{stop.reason}</span>}
                </span>
                {editable && <Button variant="dangerSoft" size="sm" icon="trash" onClick={() => setRemoving(stop)}>Kaldır</Button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {contract.status !== 'DRAFT' && (
        <p className="text-xs text-ink-muted">
          {contract.activatedAt && `Satışa açıldı: ${formatDate(contract.activatedAt)} · ${contract.activatedBy}. `}
          Pansiyon kodları: {Object.entries(BOARD_TYPE_LABELS).map(([code, label]) => `${code} = ${label.split(' — ')[1]}`).join(', ')}.
        </p>
      )}

      {dialog === 'end' && <EndContractDialog contract={contract} onClose={() => setDialog(null)} onDone={() => setDialog(null)} />}
      {dialog === 'stop' && <StopSaleDialog contract={contract} onClose={() => setDialog(null)} onDone={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog === 'delete'}
        title="Taslak kontratı sil"
        message={`"${contract.name}" taslağı fiyat ve stop-sale satırlarıyla silinir. Bu işlem geri alınamaz.`}
        confirmLabel="Sil"
        isPending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate()}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        title="Stop-sale'i kaldır"
        message={removing ? `${formatDate(removing.startDate)} – ${formatDate(removing.endDate)} stop-sale'i kaldırılınca bu günlerde acente adına yeniden rezervasyon açılabilir.` : ''}
        confirmLabel="Kaldır"
        confirmVariant="primary"
        confirmIcon="check"
        isPending={removeStopSale.isPending}
        onConfirm={() => removeStopSale.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
