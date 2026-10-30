import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  INSTRUMENT_ACTION_LABELS,
  INSTRUMENT_DIRECTIONS,
  INSTRUMENT_DIRECTION_LABELS,
  INSTRUMENT_KINDS,
  INSTRUMENT_KIND_LABELS,
  INSTRUMENT_STATUSES,
  INSTRUMENT_STATUS_LABELS,
  TREASURY_KIND_LABELS,
  instrumentActionSchema,
  instrumentTransition,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { accountingKeys } from '../../lib/accounting.js';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

const PAGE_SIZE = 25;
const STATUS_TONES = { PORTFOLIO: 'sky', AT_BANK: 'violet', OUTSTANDING: 'warning', COLLECTED: 'success', PAID: 'success', ENDORSED: 'neutral', BOUNCED: 'danger', RETURNED: 'neutral', CANCELLED: 'neutral' };
const ACTION_HINTS = {
  DEPOSIT: 'Çek tahsil için bankaya verilir; para tahsil edilince girer.',
  WITHDRAW: 'Bankadan geri alınır, portföye döner.',
  COLLECT: 'Tahsil edildi: tutar kasaya / bankaya girer.',
  BOUNCE: 'Karşılıksız: cari yeniden borçlanır (ciro edilmişse ciro edilene borcumuz da geri doğar).',
  RETURN: 'İade: alınan çek müşteriye, verilen çek bize döner; cari bakiyesi geri döner.',
  PAY: 'Vadesinde ödendi: tutar bankadan / kasadan çıkar.',
};

/**
 * Çek / senet portföyü (modül 47): alınan ve verilen, durum ve vade süzgeci, vadesi geçmiş / bu hafta özetleri.
 * Satırdaki işlemler durum makinesinden; her işlem tarihli ve geçmişe yazılır.
 */
export function InstrumentsPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.ACCOUNTING_MANAGE);
  const { today } = useHotelToday();
  const [params] = useSearchParams();
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState('OPEN');
  const [kind, setKind] = useState('');
  const [due, setDue] = useState({ from: '', to: '' });
  const [page, setPage] = useState(1);
  const [acting, setActing] = useState(null);
  const [history, setHistory] = useState(null);
  const ledgerAccountId = params.get('ledgerAccountId') ?? undefined;
  useEffect(() => setPage(1), [search, direction, status, kind, due.from, due.to, ledgerAccountId]);

  const filters = { search: search || undefined, direction: direction || undefined, status: status || undefined, kind: kind || undefined, dueFrom: due.from || undefined, dueTo: due.to || undefined, ledgerAccountId, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: accountingKeys.instruments(filters), queryFn: () => api(withQuery('/accounting/instruments', filters)), placeholderData: keepPreviousData });
  const currency = list.data?.currency ?? '';
  const summary = Object.fromEntries((list.data?.summary ?? []).map((row) => [row.direction, row]));

  const columns = [
    {
      key: 'number',
      header: 'Çek / senet',
      render: (row) => (
        <button type="button" className="block text-left hover:underline" onClick={() => setHistory(row)}>
          <span className="block font-semibold text-ink">
            {INSTRUMENT_KIND_LABELS[row.kind]} {row.number}
          </span>
          <span className="block text-xs text-ink-muted">{[INSTRUMENT_DIRECTION_LABELS[row.direction], row.bankName, row.branch, row.drawer].filter(Boolean).join(' · ')}</span>
        </button>
      ),
    },
    {
      key: 'account',
      header: 'Cari',
      render: (row) => (
        <Link to={`/muhasebe/cariler/${row.account.id}`} className="hover:underline">
          {row.account.name}
          {row.endorsedTo && <span className="block text-xs text-ink-muted">ciro: {row.endorsedTo.name}</span>}
        </Link>
      ),
    },
    {
      key: 'due',
      header: 'Vade',
      render: (row) => (
        <span className={row.overdue ? 'font-semibold text-sec-strong' : row.dueSoon ? 'font-semibold text-warning-ink' : ''}>
          {formatDate(row.dueDate)}
          {row.overdue && <span className="block text-xs">vadesi geçti</span>}
        </span>
      ),
    },
    { key: 'amount', header: 'Tutar', className: 'text-right tabular-nums font-semibold', render: (row) => formatMoney(row.amount, row.currency) },
    {
      key: 'status',
      header: 'Durum',
      render: (row) => (
        <span className="flex flex-col gap-0.5">
          <Badge tone={STATUS_TONES[row.status]}>{INSTRUMENT_STATUS_LABELS[row.status]}</Badge>
          {row.treasury && <span className="text-xs text-ink-muted">{row.treasury.name}</span>}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label="Alınan (açık)" value={summary.RECEIVED ? formatMoney(summary.RECEIVED.amount, currency) : formatMoney('0', currency)} hint={`${summary.RECEIVED?.count ?? 0} çek / senet portföyde ya da tahsilde`} icon="fileText" />
        <SummaryTile label="Verilen (ödenecek)" value={summary.ISSUED ? formatMoney(summary.ISSUED.amount, currency) : formatMoney('0', currency)} hint={`${summary.ISSUED?.count ?? 0} çek / senet`} icon="coins" tone="warning" />
        <SummaryTile
          label="Vadesi geçmiş"
          value={formatMoney(String(Number(summary.RECEIVED?.overdue.amount ?? 0) + Number(summary.ISSUED?.overdue.amount ?? 0)), currency)}
          hint={`${(summary.RECEIVED?.overdue.count ?? 0) + (summary.ISSUED?.overdue.count ?? 0)} açık kayıt vadesini geçti`}
          icon="alertTriangle"
          tone="danger"
          selected={due.to === today && !due.from}
          onClick={() => setDue(due.to === today && !due.from ? { from: '', to: '' } : { from: '', to: today })}
        />
        <SummaryTile
          label="7 gün içinde vadesi gelen"
          value={formatMoney(String(Number(summary.RECEIVED?.dueSoon.amount ?? 0) + Number(summary.ISSUED?.dueSoon.amount ?? 0)), currency)}
          hint={`${(summary.RECEIVED?.dueSoon.count ?? 0) + (summary.ISSUED?.dueSoon.count ?? 0)} kayıt`}
          icon="clock"
          tone="warning"
        />
      </div>
      <Toolbar>
        <Input label="Ara" name="instrument-search" placeholder="Numara, keşideci, cari" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-56" />
        <Select label="Yön" options={[{ value: '', label: 'Hepsi' }, ...INSTRUMENT_DIRECTIONS.map((value) => ({ value, label: INSTRUMENT_DIRECTION_LABELS[value] }))]} value={direction} onChange={(event) => setDirection(event.target.value)} className="w-full sm:w-32" />
        <Select
          label="Durum"
          options={[{ value: 'OPEN', label: 'Açık (portföy / tahsil / ödenecek)' }, { value: '', label: 'Hepsi' }, ...INSTRUMENT_STATUSES.map((value) => ({ value, label: INSTRUMENT_STATUS_LABELS[value] }))]}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="w-full sm:w-64"
        />
        <Select label="Tür" options={[{ value: '', label: 'Hepsi' }, ...INSTRUMENT_KINDS.map((value) => ({ value, label: INSTRUMENT_KIND_LABELS[value] }))]} value={kind} onChange={(event) => setKind(event.target.value)} className="w-full sm:w-28" />
        <Input label="Vade (başlangıç)" type="date" value={due.from} onChange={(event) => setDue((current) => ({ ...current, from: event.target.value }))} className="w-full sm:w-40" />
        <Input label="Vade (bitiş)" type="date" value={due.to} onChange={(event) => setDue((current) => ({ ...current, to: event.target.value }))} className="w-full sm:w-40" />
      </Toolbar>
      {ledgerAccountId && (
        <Alert tone="info" title="Tek carinin çek / senetleri">
          <Link to="/muhasebe/cek-senet" className="font-semibold hover:underline">
            Süzgeci kaldır
          </Link>
        </Alert>
      )}
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle="Çek / senet yok"
        emptyHint="Alınan çek / senet tahsilat fişiyle, verilen ödeme fişiyle girer."
        rowActions={
          canManage
            ? (row) => (
                <span className="flex flex-wrap justify-end gap-1">
                  {row.actions.map((action) => (
                    <Button key={action} type="button" size="sm" variant={action === 'BOUNCE' ? 'ghost' : 'outline'} onClick={() => setActing({ instrument: row, action })}>
                      {INSTRUMENT_ACTION_LABELS[action].replace(/ edildi| verildi| alındı/, '')}
                    </Button>
                  ))}
                </span>
              )
            : undefined
        }
      />
      {acting && <InstrumentActionDialog instrument={acting.instrument} action={acting.action} onClose={() => setActing(null)} />}
      {history && <InstrumentHistory instrument={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

/** @param {{ instrument: any, action: string, onClose: () => void }} props */
function InstrumentActionDialog({ instrument, action, onClose }) {
  const queryClient = useQueryClient();
  const { today } = useHotelToday();
  const transition = instrumentTransition(instrument.direction, instrument.status, action);
  // Bankadaki çek tahsile verildiği bankaya, verilen çek ödeneceği bankadan: hesap seçilmez.
  const fixedTreasury = (action === 'COLLECT' && instrument.status === 'AT_BANK') || (action === 'PAY' && instrument.treasury);
  const needsTreasury = (transition.treasury !== 0 || transition.needsTreasury) && !fixedTreasury;
  const treasury = useQuery({ queryKey: accountingKeys.treasury({}), queryFn: () => api('/accounting/treasury'), enabled: needsTreasury });
  const [date, setDate] = useState(today);
  const [treasuryAccountId, setTreasuryAccountId] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const save = useMutation({
    mutationFn: (body) => apiPost(`/accounting/instruments/${instrument.id}/actions`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountingKeys.all });
      toastSuccess(`${INSTRUMENT_KIND_LABELS[instrument.kind]} ${instrument.number}: ${INSTRUMENT_ACTION_LABELS[action].toLocaleLowerCase('tr')}`);
      onClose();
    },
    onError: (error) => {
      setServerError(error);
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: accountingKeys.all });
    },
  });
  const options = (treasury.data?.items ?? []).filter((row) => row.currency === instrument.currency && (action !== 'DEPOSIT' || row.kind === 'BANK'));

  function submit(event) {
    event.preventDefault();
    setServerError(null);
    const body = { expectedUpdatedAt: instrument.updatedAt, action, date, treasuryAccountId: needsTreasury ? treasuryAccountId || null : null, note: note || null };
    const checked = validateWith(instrumentActionSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    if (needsTreasury && !treasuryAccountId) return setErrors({ treasuryAccountId: 'Kasa / banka seçin' });
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending;
  return (
    <Modal
      open
      size="md"
      title={`${INSTRUMENT_KIND_LABELS[instrument.kind]} ${instrument.number} · ${INSTRUMENT_ACTION_LABELS[action]}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="instrument-action-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'İşle'}
          </Button>
        </>
      }
    >
      <form id="instrument-action-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {serverError && (
          <Alert tone="danger" title="İşlenmedi">
            {serverError.message}
          </Alert>
        )}
        <p className="text-sm text-ink-soft">
          {formatMoney(instrument.amount, instrument.currency)} · vade {formatDate(instrument.dueDate)} · {instrument.account.name}. {ACTION_HINTS[action]}
        </p>
        {fixedTreasury && instrument.treasury && <p className="text-sm">Hesap: <strong>{instrument.treasury.name}</strong></p>}
        <Input label="İşlem tarihi" type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} error={errors.date} disabled={busy} />
        {needsTreasury && (
          <Select
            label={action === 'DEPOSIT' ? 'Tahsile verilen banka' : action === 'PAY' ? 'Ödendiği kasa / banka' : 'Tahsil edildiği kasa / banka'}
            value={treasuryAccountId}
            onChange={(event) => setTreasuryAccountId(event.target.value)}
            options={[{ value: '', label: treasury.isPending ? 'Yükleniyor…' : 'Seçin' }, ...options.map((row) => ({ value: row.id, label: `${row.name} · ${TREASURY_KIND_LABELS[row.kind]}` }))]}
            error={errors.treasuryAccountId}
            disabled={busy}
          />
        )}
        <Textarea label="Not (isteğe bağlı)" rows={2} value={note} onChange={(event) => setNote(event.target.value)} error={errors.note} disabled={busy} />
      </form>
    </Modal>
  );
}

/** Çek / senedin durum geçmişi. @param {{ instrument: any, onClose: () => void }} props */
function InstrumentHistory({ instrument, onClose }) {
  const detail = useQuery({ queryKey: accountingKeys.instrument(instrument.id), queryFn: () => api(`/accounting/instruments/${instrument.id}`) });
  return (
    <Modal open size="md" title={`${INSTRUMENT_KIND_LABELS[instrument.kind]} ${instrument.number}`} onClose={onClose}>
      {detail.isPending ? (
        <Spinner className="py-6" />
      ) : detail.isError ? (
        <Alert tone="danger" title="Geçmiş yüklenemedi">
          {detail.error.message}
        </Alert>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            {INSTRUMENT_DIRECTION_LABELS[instrument.direction]} · {formatMoney(instrument.amount, instrument.currency)} · vade {formatDate(instrument.dueDate)} ·{' '}
            {instrument.voucher && (
              <Link to={`/muhasebe/fisler/${instrument.voucher.id}`} className="font-semibold hover:underline">
                {instrument.voucher.number}
              </Link>
            )}
          </p>
          <ol className="flex flex-col gap-2 border-l-2 border-line pl-4">
            {detail.data.movements.map((movement) => (
              <li key={movement.id}>
                <span className="font-semibold">{movement.label}</span> · {formatDate(movement.date)}
                <span className="block text-xs text-ink-muted">
                  {movement.fromStatus ? `${INSTRUMENT_STATUS_LABELS[movement.fromStatus]} → ` : ''}
                  {INSTRUMENT_STATUS_LABELS[movement.toStatus]} · {movement.createdBy}
                  {movement.note ? ` · ${movement.note}` : ''}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Modal>
  );
}
