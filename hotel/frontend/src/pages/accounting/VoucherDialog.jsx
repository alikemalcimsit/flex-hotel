import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  INSTRUMENT_KINDS,
  INSTRUMENT_KIND_LABELS,
  MAX_VOUCHER_LINES,
  TREASURY_KIND_LABELS,
  VOUCHER_LINE_KINDS_BY_TYPE,
  VOUCHER_LINE_KIND_LABELS,
  VOUCHER_TYPE_LABELS,
  fromCents,
  needsPaymentApproval,
  toCents,
  voucherCreateSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Select } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { accountingKeys } from '../../lib/accounting.js';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { newRequestId } from '../../lib/reservations.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { LedgerAccountField } from './LedgerAccountField.jsx';

const CARI_TYPES = Object.freeze(['COLLECTION', 'PAYMENT']);
const TYPE_HINTS = Object.freeze({
  COLLECTION: 'Cari alacaklanır (borcu düşer); para kasaya / bankaya girer ya da alınan çek / senet portföye girer.',
  PAYMENT: 'Cari borçlanır (borcumuz düşer); para kasadan / bankadan çıkar, verilen çek "ödenecek" olur ya da portföydeki çek ciro edilir.',
  TRANSFER: 'Kasa / banka arası aktarma (aynı para birimi). Döviz bozdurma çıkış + giriş fişiyle yapılır.',
  TREASURY_IN: 'Carisiz giriş: banka faizi, diğer gelir…',
  TREASURY_OUT: 'Carisiz çıkış: masraf, banka komisyonu… Kasa eksiye düşmez.',
});

let lineKey = 0;
const emptyLine = (kind) => ({ key: ++lineKey, kind, amount: '', treasuryAccountId: '', instrumentId: '', instrumentKind: 'CHEQUE', number: '', bankName: '', branch: '', drawer: '', dueDate: '' });

/** Satırların kuruş toplamı (geçersiz tutar 0 sayılır; doğrulama gönderimde). @param {Array<{ amount: string }>} lines */
function linesTotal(lines) {
  let cents = 0n;
  for (const line of lines) {
    const text = String(line.amount).trim().replace(',', '.');
    if (/^\d+(\.\d{1,2})?$/.test(text)) cents += toCents(text);
  }
  return fromCents(cents);
}

/**
 * Fiş gir (modül 47): tahsilat, ödeme, virman, kasa / banka giriş-çıkış. Form açılırken üretilen istek kimliği çift
 * gönderimde ikinci fişi engeller. Ödeme fişi toplamı onay eşiğine eşit / üstündeyse onaya gider (form önceden söyler).
 *
 * @param {{
 *   type: 'COLLECTION' | 'PAYMENT' | 'TRANSFER' | 'TREASURY_IN' | 'TREASURY_OUT',
 *   account?: any | null,
 *   treasuryAccountId?: string | null,
 *   onClose: () => void,
 *   onDone?: (result: any) => void,
 * }} props
 */
export function VoucherDialog({ type: initialType, account = null, treasuryAccountId = null, onClose, onDone }) {
  const queryClient = useQueryClient();
  const { today } = useHotelToday();
  const [requestId] = useState(newRequestId);
  const [type, setType] = useState(initialType);
  const [date, setDate] = useState(today);
  const [ledgerAccount, setLedgerAccount] = useState(account);
  const [lines, setLines] = useState(() => (CARI_TYPES.includes(initialType) ? [{ ...emptyLine('TREASURY'), treasuryAccountId: treasuryAccountId ?? '' }] : []));
  const [header, setHeader] = useState({ treasuryAccountId: treasuryAccountId ?? '', targetTreasuryAccountId: '', amount: '' });
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);

  const treasury = useQuery({ queryKey: accountingKeys.treasury({}), queryFn: () => api('/accounting/treasury') });
  const settings = useQuery({ queryKey: accountingKeys.settings, queryFn: () => api('/accounting/settings') });
  const portfolioFilters = { direction: 'RECEIVED', status: 'PORTFOLIO', pageSize: 100 };
  const portfolio = useQuery({
    queryKey: accountingKeys.instruments(portfolioFilters),
    queryFn: () => api(withQuery('/accounting/instruments', portfolioFilters)),
    enabled: type === 'PAYMENT',
  });
  const currency = treasury.data?.currency ?? '';
  const accounts = treasury.data?.items ?? [];
  const accountOptions = (filter = () => true) => [
    { value: '', label: 'Seçin' },
    ...accounts.filter(filter).map((row) => ({ value: row.id, label: `${row.name} · ${TREASURY_KIND_LABELS[row.kind]} · ${formatMoney(row.balance, row.currency)}` })),
  ];
  const cari = CARI_TYPES.includes(type);
  const total = cari ? linesTotal(lines) : linesTotal([{ amount: header.amount }]);
  const approval = type === 'PAYMENT' && settings.data && needsPaymentApproval(total, settings.data.settings.paymentApprovalAmount);
  const usedCheques = useMemo(() => new Set(lines.filter((line) => line.kind === 'ENDORSE').map((line) => line.instrumentId)), [lines]);

  const save = useMutation({
    mutationFn: (body) => apiPost('/accounting/vouchers', body),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: accountingKeys.all });
      if (!result.created) toastSuccess('Bu fiş zaten kaydedilmişti; ikinci kez yazılmadı');
      else if (result.voucher.status === 'PENDING_APPROVAL') toastSuccess(`${result.voucher.number} onaya gönderildi; başka bir yetkili onaylayınca işlenir`);
      else toastSuccess(`${result.voucher.number} işlendi`);
      onDone?.(result);
      onClose();
    },
    onError: (error) => {
      setServerError(error);
      if (error.fields) setErrors(error.fields);
    },
  });

  function changeType(next) {
    setType(next);
    setErrors({});
    setServerError(null);
    if (CARI_TYPES.includes(next)) {
      setLines((current) => {
        const kept = current.filter((line) => VOUCHER_LINE_KINDS_BY_TYPE[next].includes(line.kind));
        return kept.length ? kept : [emptyLine('TREASURY')];
      });
    } else setLines([]);
  }
  const setLine = (key, patch) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  function submit(event) {
    event.preventDefault();
    setServerError(null);
    const body = {
      requestId,
      type,
      date,
      description,
      reference: reference || null,
      ...(cari
        ? {
            ledgerAccountId: ledgerAccount?.id ?? null,
            lines: lines.map((line) => ({
              kind: line.kind,
              amount: String(line.amount).trim().replace(',', '.'),
              treasuryAccountId: line.kind === 'TREASURY' || line.kind === 'CHEQUE_OUT' ? line.treasuryAccountId || null : null,
              ...(line.kind === 'ENDORSE' ? { instrumentId: line.instrumentId || null } : {}),
              ...(line.kind === 'CHEQUE_IN' || line.kind === 'CHEQUE_OUT'
                ? { instrumentKind: line.instrumentKind, number: line.number, bankName: line.bankName, branch: line.branch, drawer: line.drawer, dueDate: line.dueDate || null }
                : {}),
            })),
          }
        : {
            treasuryAccountId: header.treasuryAccountId || null,
            targetTreasuryAccountId: type === 'TRANSFER' ? header.targetTreasuryAccountId || null : null,
            amount: String(header.amount).trim().replace(',', '.'),
          }),
    };
    const checked = validateWith(voucherCreateSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending;
  const kinds = VOUCHER_LINE_KINDS_BY_TYPE[type] ?? [];
  return (
    <Modal
      open
      size="xl"
      title={VOUCHER_TYPE_LABELS[type]}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <span className="mr-auto text-sm tabular-nums text-ink-soft">
            Toplam <strong className="text-ink">{formatMoney(total, cari ? currency : (accounts.find((row) => row.id === header.treasuryAccountId)?.currency ?? currency))}</strong>
          </span>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="voucher-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : approval ? 'Onaya gönder' : 'Fişi işle'}
          </Button>
        </>
      }
    >
      <form id="voucher-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {serverError && (
          <Alert tone="danger" title="Fiş işlenmedi">
            {serverError.message}
          </Alert>
        )}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Fiş türü">
          {['COLLECTION', 'PAYMENT', 'TRANSFER', 'TREASURY_IN', 'TREASURY_OUT'].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={type === value}
              disabled={busy}
              onClick={() => changeType(value)}
              className={`rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${type === value ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-soft hover:border-ink'}`}
            >
              {VOUCHER_TYPE_LABELS[value]}
            </button>
          ))}
        </div>
        <p className="-mt-2 text-xs text-ink-muted">{TYPE_HINTS[type]}</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input label="Fiş tarihi" type="date" name="voucher-date" value={date} max={today} min={settings.data?.settings.startDate} onChange={(event) => setDate(event.target.value)} error={errors.date} disabled={busy} />
          <Input label="Açıklama" name="voucher-description" value={description} onChange={(event) => setDescription(event.target.value)} error={errors.description} disabled={busy} className="sm:col-span-2" />
          <Input label="Belge no (isteğe bağlı)" name="voucher-reference" value={reference} onChange={(event) => setReference(event.target.value)} error={errors.reference} disabled={busy} />
          {cari && (
            <div className="sm:col-span-2">
              <LedgerAccountField value={ledgerAccount} onChange={setLedgerAccount} currency={currency} error={errors.ledgerAccountId} disabled={busy} />
            </div>
          )}
        </div>

        {cari ? (
          <div className="flex flex-col gap-3">
            {lines.map((line, index) => (
              <div key={line.key} className="grid grid-cols-1 gap-3 rounded-item border border-line bg-surface-muted p-3 sm:grid-cols-6">
                <Select
                  label={`Satır ${index + 1}`}
                  value={line.kind}
                  onChange={(event) => setLine(line.key, { kind: event.target.value, instrumentId: '', amount: event.target.value === 'ENDORSE' ? '' : line.amount })}
                  options={kinds.map((value) => ({ value, label: VOUCHER_LINE_KIND_LABELS[value] }))}
                  disabled={busy}
                  className="sm:col-span-2"
                />
                {line.kind === 'ENDORSE' ? (
                  <Select
                    label="Portföydeki çek / senet"
                    value={line.instrumentId}
                    onChange={(event) => {
                      const picked = portfolio.data?.items.find((row) => row.id === event.target.value);
                      setLine(line.key, { instrumentId: event.target.value, amount: picked?.amount ?? '' });
                    }}
                    options={[
                      { value: '', label: portfolio.isPending ? 'Yükleniyor…' : portfolio.data?.items.length ? 'Seçin' : 'Portföyde çek / senet yok' },
                      ...(portfolio.data?.items ?? [])
                        .filter((row) => row.id === line.instrumentId || !usedCheques.has(row.id))
                        .map((row) => ({ value: row.id, label: `${INSTRUMENT_KIND_LABELS[row.kind]} ${row.number}${row.bankName ? ` · ${row.bankName}` : ''} · vade ${formatDate(row.dueDate)} · ${formatMoney(row.amount, row.currency)} · ${row.account.name}` })),
                    ]}
                    error={errors[`lines.${index}.instrumentId`]}
                    disabled={busy}
                    className="sm:col-span-3"
                  />
                ) : line.kind === 'TREASURY' ? (
                  <Select
                    label="Kasa / banka"
                    value={line.treasuryAccountId}
                    onChange={(event) => setLine(line.key, { treasuryAccountId: event.target.value })}
                    options={accountOptions((row) => row.currency === currency)}
                    error={errors[`lines.${index}.treasuryAccountId`]}
                    disabled={busy}
                    className="sm:col-span-3"
                  />
                ) : (
                  <Select
                    label="Tür"
                    value={line.instrumentKind}
                    onChange={(event) => setLine(line.key, { instrumentKind: event.target.value })}
                    options={INSTRUMENT_KINDS.map((value) => ({ value, label: INSTRUMENT_KIND_LABELS[value] }))}
                    disabled={busy}
                    className="sm:col-span-1"
                  />
                )}
                {(line.kind === 'CHEQUE_IN' || line.kind === 'CHEQUE_OUT') && (
                  <>
                    <Input label="Numara" value={line.number} onChange={(event) => setLine(line.key, { number: event.target.value })} error={errors[`lines.${index}.number`]} disabled={busy} className="sm:col-span-2" />
                    <Input label="Vade" type="date" value={line.dueDate} onChange={(event) => setLine(line.key, { dueDate: event.target.value })} error={errors[`lines.${index}.dueDate`]} disabled={busy} />
                    <Input label="Banka" value={line.bankName} onChange={(event) => setLine(line.key, { bankName: event.target.value })} error={errors[`lines.${index}.bankName`]} disabled={busy} className="sm:col-span-2" />
                    <Input label="Şube" value={line.branch} onChange={(event) => setLine(line.key, { branch: event.target.value })} disabled={busy} />
                    {line.kind === 'CHEQUE_IN' ? (
                      <Input label="Keşideci / borçlu" value={line.drawer} onChange={(event) => setLine(line.key, { drawer: event.target.value })} disabled={busy} className="sm:col-span-3" />
                    ) : (
                      <Select
                        label="Ödeneceği banka hesabı"
                        value={line.treasuryAccountId}
                        onChange={(event) => setLine(line.key, { treasuryAccountId: event.target.value })}
                        options={accountOptions((row) => row.kind === 'BANK' && row.currency === currency)}
                        error={errors[`lines.${index}.treasuryAccountId`]}
                        disabled={busy}
                        className="sm:col-span-3"
                      />
                    )}
                  </>
                )}
                <Input
                  label="Tutar"
                  inputMode="decimal"
                  value={line.amount}
                  onChange={(event) => setLine(line.key, { amount: event.target.value })}
                  error={errors[`lines.${index}.amount`]}
                  disabled={busy || line.kind === 'ENDORSE'}
                  className="sm:col-span-2"
                />
                <div className="flex items-end justify-end sm:col-span-1">
                  <Button type="button" size="sm" variant="ghost" icon="trash" onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))} disabled={busy || lines.length === 1}>
                    Sil
                  </Button>
                </div>
              </div>
            ))}
            {errors.lines && <p className="text-xs font-semibold text-sec-strong">{errors.lines}</p>}
            <div className="flex flex-wrap gap-2">
              {kinds.map((value) => (
                <Button key={value} type="button" size="sm" variant="outline" icon="plus" onClick={() => setLines((current) => [...current, emptyLine(value)])} disabled={busy || lines.length >= MAX_VOUCHER_LINES}>
                  {VOUCHER_LINE_KIND_LABELS[value]}
                </Button>
              ))}
            </div>
            {approval && (
              <Alert tone="warning" title="Onaya gidecek">
                Toplam onay eşiğine ({formatMoney(settings.data.settings.paymentApprovalAmount, currency)}) eşit ya da üstünde: başka bir yetkili onaylayınca işlenir; kasa yeterliliğine onay anında bakılır.
              </Alert>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select
              label={type === 'TRANSFER' ? 'Kaynak hesap' : 'Kasa / banka'}
              value={header.treasuryAccountId}
              onChange={(event) => setHeader((current) => ({ ...current, treasuryAccountId: event.target.value }))}
              options={accountOptions()}
              error={errors.treasuryAccountId}
              disabled={busy}
            />
            {type === 'TRANSFER' && (
              <Select
                label="Hedef hesap"
                value={header.targetTreasuryAccountId}
                onChange={(event) => setHeader((current) => ({ ...current, targetTreasuryAccountId: event.target.value }))}
                options={accountOptions((row) => row.id !== header.treasuryAccountId)}
                error={errors.targetTreasuryAccountId}
                disabled={busy}
              />
            )}
            <Input label="Tutar" inputMode="decimal" value={header.amount} onChange={(event) => setHeader((current) => ({ ...current, amount: event.target.value }))} error={errors.amount} disabled={busy} />
          </div>
        )}
      </form>
    </Modal>
  );
}
