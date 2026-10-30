import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { INSTRUMENT_KIND_LABELS, VOUCHER_LINE_KIND_LABELS, VOUCHER_STATUSES, VOUCHER_STATUS_LABELS, VOUCHER_TYPES, VOUCHER_TYPE_LABELS, voucherVoidSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Input, Select, Textarea } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { accountingKeys, signedMoney, useAccountingLive } from '../../lib/accounting.js';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { VoucherDialog } from './VoucherDialog.jsx';

const PAGE_SIZE = 25;
const STATUS_TONES = { POSTED: 'success', PENDING_APPROVAL: 'warning', DECLINED: 'danger', VOIDED: 'neutral' };

/** Fişin karşı tarafı: cari ya da kasa / banka (virmanda kaynak → hedef). @param {any} row */
const partyOf = (row) =>
  row.ledgerAccount ? (
    <Link to={`/muhasebe/cariler/${row.ledgerAccount.id}`} className="hover:underline">
      {row.ledgerAccount.name}
    </Link>
  ) : (
    [row.treasuryAccount?.name, row.targetTreasury?.name].filter(Boolean).join(' → ')
  );

/**
 * Fişler (modül 47): tahsilat, ödeme, virman, giriş / çıkış ve açılış fişleri; tür, durum, dönem ve arama süzgeci.
 * Onay bekleyen ödeme fişi onay kuyruğundan karara bağlanır.
 */
export function VouchersPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.ACCOUNTING_MANAGE);
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState({ from: '', to: '' });
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(null);
  useEffect(() => setPage(1), [search, type, status, period.from, period.to]);

  const filters = { search: search || undefined, type: type || undefined, status: status || undefined, from: period.from || undefined, to: period.to || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: accountingKeys.vouchers(filters), queryFn: () => api(withQuery('/accounting/vouchers', filters)), placeholderData: keepPreviousData });
  const currency = list.data?.currency ?? '';

  const columns = [
    {
      key: 'number',
      header: 'Fiş',
      render: (row) => (
        <Link to={`/muhasebe/fisler/${row.id}`} className="block hover:underline">
          <span className="block font-semibold text-ink">{row.number}</span>
          <span className="block text-xs text-ink-muted">{VOUCHER_TYPE_LABELS[row.type]}</span>
        </Link>
      ),
    },
    { key: 'date', header: 'Tarih', render: (row) => formatDate(row.date) },
    { key: 'party', header: 'Cari / hesap', render: partyOf },
    { key: 'description', header: 'Açıklama', render: (row) => <span className="line-clamp-2 text-ink-soft">{row.description}</span> },
    { key: 'amount', header: 'Tutar', className: 'text-right tabular-nums font-semibold', render: (row) => formatMoney(row.amount, row.treasuryAccount?.currency ?? currency) },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={STATUS_TONES[row.status]}>{VOUCHER_STATUS_LABELS[row.status]}</Badge> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        actions={
          canManage && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" icon="wallet" onClick={() => setCreating('COLLECTION')}>
                Tahsilat
              </Button>
              <Button type="button" variant="outline" icon="coins" onClick={() => setCreating('PAYMENT')}>
                Ödeme
              </Button>
              <Button type="button" variant="outline" icon="refresh" onClick={() => setCreating('TRANSFER')}>
                Virman
              </Button>
            </div>
          )
        }
      >
        <Input label="Ara" name="voucher-search" placeholder="Fiş no, açıklama, belge no" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-56" />
        <Select label="Tür" options={[{ value: '', label: 'Hepsi' }, ...VOUCHER_TYPES.map((value) => ({ value, label: VOUCHER_TYPE_LABELS[value] }))]} value={type} onChange={(event) => setType(event.target.value)} className="w-full sm:w-44" />
        <Select label="Durum" options={[{ value: '', label: 'Hepsi' }, ...VOUCHER_STATUSES.map((value) => ({ value, label: VOUCHER_STATUS_LABELS[value] }))]} value={status} onChange={(event) => setStatus(event.target.value)} className="w-full sm:w-40" />
        <Input label="Başlangıç" type="date" value={period.from} onChange={(event) => setPeriod((current) => ({ ...current, from: event.target.value }))} className="w-full sm:w-40" />
        <Input label="Bitiş" type="date" value={period.to} onChange={(event) => setPeriod((current) => ({ ...current, to: event.target.value }))} className="w-full sm:w-40" />
      </Toolbar>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={search || type || status ? 'Eşleşen fiş yok' : 'Fiş yok'}
        emptyHint={!search && !type && !status ? 'Tahsilat, ödeme ve virman fişleri burada; otomatik kayıtlar (ön büro, etkinlik, restoran, mal kabul) fişsiz doğrudan cari / kasaya işlenir.' : undefined}
      />
      {creating && <VoucherDialog type={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}

/** Fiş ayrıntısı: satırlar, cari / kasa kayıtları, onay ve iptal. */
export function VoucherPage() {
  useAccountingLive();
  const { voucherId } = useParams();
  const can = useCan();
  const canSetup = can(PERMISSIONS.ACCOUNTING_SETUP);
  const [voiding, setVoiding] = useState(false);
  const query = useQuery({ queryKey: accountingKeys.voucher(voucherId), queryFn: () => api(`/accounting/vouchers/${voucherId}`) });
  if (!query.data) return <QueryFallback query={query} errorTitle="Fiş yüklenemedi" />;
  const { voucher, lines, entries, movements, approval, currency } = query.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${voucher.number} · ${VOUCHER_TYPE_LABELS[voucher.type]}`}
        description={`${formatDate(voucher.date)} · ${voucher.description}${voucher.reference ? ` · belge ${voucher.reference}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/muhasebe/fisler" className="text-sm font-semibold text-ink-soft hover:underline">
              ← Fişler
            </Link>
            <Badge tone={STATUS_TONES[voucher.status]}>{VOUCHER_STATUS_LABELS[voucher.status]}</Badge>
            {canSetup && voucher.status === 'POSTED' && (
              <Button type="button" variant="outline" icon="rotateCcw" onClick={() => setVoiding(true)}>
                İptal et
              </Button>
            )}
          </div>
        }
      />
      {voucher.status === 'PENDING_APPROVAL' && (
        <Alert tone="warning" title="Onay bekliyor">
          Eşik üstü ödeme: başka bir yetkili{' '}
          <Link to={`/onaylar/bekleyen?onay=${voucher.approvalId}`} className="font-semibold hover:underline">
            onay kuyruğundan
          </Link>{' '}
          onaylayınca işlenir{approval?.expiresAt ? ` (son ${formatDate(approval.expiresAt)})` : ''}.
        </Alert>
      )}
      {voucher.status === 'DECLINED' && <Alert tone="danger" title="İşlenmedi">{approval?.note ? `Karar notu: ${approval.note}. ` : ''}Fiş hiçbir kayıt yazmadı; gerekirse yeniden girin.</Alert>}
      {voucher.status === 'VOIDED' && (
        <Alert tone="info" title="İptal edildi">
          {formatDate(voucher.voidedAt)} · {voucher.voidedBy}: {voucher.voidReason}. Kayıtlar fiş tarihli ters kayıtla düşüldü.
        </Alert>
      )}

      <Card title="Fiş" description={`${voucher.createdBy} girdi${voucher.approvedBy ? ` · ${voucher.approvedBy} onayladı` : ''}`}>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <dt className="text-ink-muted">Cari / hesap</dt>
          <dd>{partyOf(voucher)}</dd>
          <dt className="text-ink-muted">Tutar</dt>
          <dd className="font-semibold tabular-nums">{formatMoney(voucher.amount, voucher.treasuryAccount?.currency ?? currency)}</dd>
        </dl>
        {lines.length > 0 && (
          <table className="mt-4 w-full text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th className="py-2">Satır</th>
                <th className="py-2">Ayrıntı</th>
                <th className="py-2 text-right">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-line">
                  <td className="py-2">{VOUCHER_LINE_KIND_LABELS[line.kind]}</td>
                  <td className="py-2 text-ink-soft">
                    {line.kind === 'TREASURY'
                      ? line.treasury?.name
                      : line.instrument
                        ? `${INSTRUMENT_KIND_LABELS[line.instrument.kind]} ${line.instrument.number}${line.instrument.bankName ? ` · ${line.instrument.bankName}` : ''} · vade ${formatDate(line.instrument.dueDate)}`
                        : `${INSTRUMENT_KIND_LABELS[line.instrumentKind] ?? ''} ${line.number ?? ''}${line.bankName ? ` · ${line.bankName}` : ''}${line.dueDate ? ` · vade ${formatDate(line.dueDate)}` : ''}`}
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(line.amount, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {(entries.length > 0 || movements.length > 0) && (
        <Card title="Yazılan kayıtlar" description="Cari hareketleri (borç / alacak) ve kasa / banka hareketleri; iptal satırları ters kayıttır.">
          <ul className="flex flex-col gap-1.5 text-sm">
            {entries.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-3">
                <span>
                  <Link to={`/muhasebe/cariler/${entry.account.id}`} className="font-semibold hover:underline">
                    {entry.account.name}
                  </Link>{' '}
                  · {formatDate(entry.date)}
                  {entry.reversalOfId ? ' · iptal kaydı' : ''}
                </span>
                <span className="tabular-nums">{Number(entry.debit) ? `${formatMoney(entry.debit)} B` : `${formatMoney(entry.credit)} A`}</span>
              </li>
            ))}
            {movements.map((movement) => (
              <li key={movement.id} className="flex justify-between gap-3">
                <span>
                  <span className="font-semibold">{movement.account.name}</span> · {formatDate(movement.date)}
                  {movement.reversalOfId ? ' · iptal kaydı' : ''}
                </span>
                <span className="tabular-nums">{signedMoney(movement.amount, movement.account.currency)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {voiding && <VoidDialog voucher={voucher} onClose={() => setVoiding(false)} />}
    </div>
  );
}

/** Fiş iptali (gerekçeli, ters kayıt). @param {{ voucher: any, onClose: () => void }} props */
function VoidDialog({ voucher, onClose }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const save = useMutation({
    mutationFn: (body) => apiPost(`/accounting/vouchers/${voucher.id}/void`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountingKeys.all });
      toastSuccess(`${voucher.number} iptal edildi`);
      onClose();
    },
    onError: (error) => setServerError(error),
  });
  function submit(event) {
    event.preventDefault();
    const checked = validateWith(voucherVoidSchema, { reason });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate({ reason });
  }
  const busy = save.isPending;
  return (
    <Modal
      open
      size="md"
      title={`${voucher.number} iptali`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="voucher-void-form" icon="rotateCcw" disabled={busy}>
            {busy ? 'İptal ediliyor…' : 'İptal et'}
          </Button>
        </>
      }
    >
      <form id="voucher-void-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {serverError && (
          <Alert tone="danger" title="İptal edilmedi">
            {serverError.message}
          </Alert>
        )}
        <p className="text-sm text-ink-soft">Fişin bütün cari ve kasa / banka kayıtları fiş tarihli ters kayıtla düşülür; fişin açtığı çek / senet iptal olur, ciro geri alınır. İşlem görmüş çekin fişi iptal edilemez.</p>
        <Textarea label="Gerekçe" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} error={errors.reason} disabled={busy} />
      </form>
    </Modal>
  );
}
