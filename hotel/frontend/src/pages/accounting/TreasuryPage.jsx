import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TREASURY_KINDS, TREASURY_KIND_LABELS, TREASURY_SOURCES, TREASURY_SOURCE_LABELS, treasuryAccountCreateSchema, treasuryAccountUpdateSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { accountingKeys, monthStart, signedMoney } from '../../lib/accounting.js';
import { api, apiPost, apiPut, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { OpeningDialog } from './OpeningDialog.jsx';
import { VoucherDialog } from './VoucherDialog.jsx';

const MOVEMENT_PAGE = 100;
const SOURCE_OPTIONS = [{ value: '', label: 'Bütün kaynaklar' }, ...TREASURY_SOURCES.map((value) => ({ value, label: TREASURY_SOURCE_LABELS[value] }))];

/**
 * Kasa / banka (modül 47): hesaplar ve bakiyeleri; seçili hesabın hareketleri (dönem başı devir, yürüyen
 * bakiye, kaynak süzgeci). Giriş / çıkış / virman fişleri ve tanımlar buradan.
 */
export function TreasuryPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.ACCOUNTING_MANAGE);
  const canSetup = can(PERMISSIONS.ACCOUNTING_SETUP);
  const { today } = useHotelToday();
  const [showAll, setShowAll] = useState(false);
  const accounts = useQuery({ queryKey: accountingKeys.treasury({ active: showAll ? 'all' : 'true' }), queryFn: () => api(withQuery('/accounting/treasury', { active: showAll ? 'all' : 'true' })) });
  const [selectedId, setSelectedId] = useState(null);
  const [period, setPeriod] = useState(() => ({ from: monthStart(today), to: today }));
  const [source, setSource] = useState('');
  const [dialog, setDialog] = useState(null);
  const items = accounts.data?.items ?? [];
  // İlk açılışta otelin para birimindeki ilk hesap (döviz kasası değil).
  const selected = items.find((row) => row.id === selectedId) ?? items.find((row) => row.currency === accounts.data?.currency) ?? items[0] ?? null;
  const filters = { ...period, source: source || undefined };
  const movements = useInfiniteQuery({
    queryKey: accountingKeys.movements(selected?.id ?? 'none', filters),
    queryFn: ({ pageParam }) => api(withQuery(`/accounting/treasury/${selected.id}/movements`, { ...filters, limit: MOVEMENT_PAGE, cursor: pageParam ?? undefined })),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(selected && period.from && period.to && period.from <= period.to),
  });

  if (accounts.isPending) return <Spinner className="py-8" />;
  if (accounts.isError) {
    return (
      <Alert tone="danger" title="Hesaplar yüklenemedi" action={<Button size="sm" variant="outline" onClick={() => accounts.refetch()}>Tekrar dene</Button>}>
        {accounts.error.message}
      </Alert>
    );
  }
  const first = movements.data?.pages[0];
  const rows = movements.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {canManage && (
          <>
            <Button type="button" icon="plus" onClick={() => setDialog({ voucher: 'TREASURY_IN' })}>
              Giriş
            </Button>
            <Button type="button" variant="outline" icon="arrowDown" onClick={() => setDialog({ voucher: 'TREASURY_OUT' })}>
              Çıkış
            </Button>
            <Button type="button" variant="outline" icon="refresh" onClick={() => setDialog({ voucher: 'TRANSFER' })}>
              Virman
            </Button>
          </>
        )}
        {canSetup && (
          <Button type="button" variant="ghost" icon="building" onClick={() => setDialog({ edit: 'new' })}>
            Hesap ekle
          </Button>
        )}
        <Checkbox label="Kullanımdan kalkanları da göster" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} className="ml-auto" />
      </div>

      {items.length === 0 ? (
        <Card title="Kasa / banka hesabı yok" description="Ön büro kasası, restoran kasası, döviz kasası ve banka hesaplarınızı ekleyin; ardından Ayarlar → Eşleme'den hangi tahsilatın hangi hesaba gireceğini seçin.">
          {canSetup && (
            <Button type="button" icon="plus" onClick={() => setDialog({ edit: 'new' })}>
              İlk hesabı ekle
            </Button>
          )}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {items.map((row) => (
              <button
                key={row.id}
                type="button"
                aria-pressed={selected?.id === row.id}
                onClick={() => setSelectedId(row.id)}
                className={`rounded-card border bg-surface p-4 text-left shadow-soft transition-colors ${selected?.id === row.id ? 'border-ink' : 'border-transparent hover:border-line-strong'}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-ink">{row.name}</span>
                  <Badge tone={row.kind === 'CASH' ? 'success' : 'sky'}>{TREASURY_KIND_LABELS[row.kind]}</Badge>
                </span>
                <span className={`mt-1 block text-2xl font-bold tabular-nums ${Number(row.balance) < 0 ? 'text-sec-strong' : ''}`}>{formatMoney(row.balance, row.currency)}</span>
                <span className="block truncate text-xs text-ink-muted">{row.kind === 'BANK' ? [row.bankName, row.ibanText].filter(Boolean).join(' · ') : row.code}{!row.isActive ? ' · kullanımdan kalkmış' : ''}</span>
              </button>
            ))}
          </div>
          {accounts.data.totals.length > 0 && (
            <p className="text-xs text-ink-muted">
              Toplam:{' '}
              {accounts.data.totals.map((total) => `${TREASURY_KIND_LABELS[total.kind]} ${formatMoney(total.balance, total.currency)}`).join(' · ')}
            </p>
          )}
        </>
      )}

      {selected && (
        <Card
          title={`${selected.name} hareketleri`}
          description={selected.kind === 'BANK' ? [selected.bankName, selected.branch, selected.ibanText].filter(Boolean).join(' · ') : `${selected.code} · ${selected.currency}`}
          actions={
            <div className="flex flex-wrap items-end gap-2">
              <Input label="Başlangıç" type="date" value={period.from} max={period.to} onChange={(event) => setPeriod((current) => ({ ...current, from: event.target.value }))} />
              <Input label="Bitiş" type="date" value={period.to} min={period.from} onChange={(event) => setPeriod((current) => ({ ...current, to: event.target.value }))} />
              <Select label="Kaynak" options={SOURCE_OPTIONS} value={source} onChange={(event) => setSource(event.target.value)} />
              {canSetup && (
                <Button type="button" size="sm" variant="ghost" icon="pencil" onClick={() => setDialog({ edit: selected })}>
                  Düzenle
                </Button>
              )}
              {canSetup && (
                <Button type="button" size="sm" variant="ghost" icon="layers" onClick={() => setDialog({ opening: selected })}>
                  Açılış
                </Button>
              )}
            </div>
          }
        >
          {movements.isPending ? (
            <Spinner className="py-8" />
          ) : movements.isError ? (
            <Alert tone="danger" title="Hareketler yüklenemedi" action={<Button size="sm" variant="outline" onClick={() => movements.refetch()}>Tekrar dene</Button>}>
              {movements.error.message}
            </Alert>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                  <tr>
                    <th className="px-3 py-2">Tarih</th>
                    <th className="px-3 py-2">Açıklama</th>
                    <th className="px-3 py-2 text-right">Tutar</th>
                    <th className="px-3 py-2 text-right">Bakiye</th>
                  </tr>
                </thead>
                <tbody>
                  {!source && (
                    <tr className="border-b border-line bg-surface-muted">
                      <td className="px-3 py-2">{formatDate(first.from)}</td>
                      <td className="px-3 py-2 font-semibold" colSpan={2}>
                        Devir
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(first.opening, selected.currency)}</td>
                    </tr>
                  )}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-ink-muted">
                        Bu dönemde hareket yok.
                      </td>
                    </tr>
                  )}
                  {rows.map((row) => (
                    <tr key={row.id} className={`border-b border-line ${row.reversed || row.reversalOfId ? 'text-ink-muted' : ''}`}>
                      <td className="whitespace-nowrap px-3 py-2">{formatDate(row.date)}</td>
                      <td className="px-3 py-2">
                        <span className="block">{row.description}</span>
                        <span className="block text-xs text-ink-muted">
                          {TREASURY_SOURCE_LABELS[row.sourceType]}
                          {row.voucherNumber && (
                            <>
                              {' · '}
                              <Link to={`/muhasebe/fisler/${row.voucherId}`} className="hover:underline">
                                {row.voucherNumber}
                              </Link>
                            </>
                          )}
                          {row.ledgerAccount && (
                            <>
                              {' · '}
                              <Link to={`/muhasebe/cariler/${row.ledgerAccount.id}`} className="hover:underline">
                                {row.ledgerAccount.name}
                              </Link>
                            </>
                          )}
                          {row.original ? ` · ${formatMoney(row.original.amount, row.original.currency)} × ${row.original.rate}` : ''}
                          {row.reversed && <Badge tone="neutral" className="ml-1">İptal edildi</Badge>}
                        </span>
                      </td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${Number(row.amount) < 0 ? 'text-sec-strong' : 'text-success-ink'}`}>{signedMoney(row.amount, '')}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.balance === null ? '' : formatMoney(row.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-line-strong font-semibold">
                  <tr>
                    <td className="px-3 py-2" colSpan={2}>
                      Giriş {formatMoney(first.totals.inflow)} · Çıkış {formatMoney(first.totals.outflow)} ({first.totals.count} hareket)
                    </td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right tabular-nums">{first.closing === null ? '' : formatMoney(first.closing, selected.currency)}</td>
                  </tr>
                </tfoot>
              </table>
              {movements.hasNextPage && (
                <div className="mt-3 flex justify-center">
                  <Button type="button" variant="outline" onClick={() => movements.fetchNextPage()} disabled={movements.isFetchingNextPage}>
                    {movements.isFetchingNextPage ? 'Yükleniyor…' : 'Daha fazla göster'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {dialog?.voucher && <VoucherDialog type={dialog.voucher} treasuryAccountId={selected?.id ?? null} onClose={() => setDialog(null)} />}
      {dialog?.edit && <TreasuryDialog account={dialog.edit === 'new' ? null : dialog.edit} onClose={() => setDialog(null)} />}
      {dialog?.opening && <OpeningDialog target={{ kind: 'treasury', id: dialog.opening.id, name: dialog.opening.name }} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Kasa / banka hesabı tanımı (`accounting.setup`). @param {{ account: any | null, onClose: () => void }} props */
function TreasuryDialog({ account, onClose }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() => ({
    kind: account?.kind ?? 'CASH',
    code: account?.code ?? '',
    name: account?.name ?? '',
    currency: account?.currency ?? 'TRY',
    bankName: account?.bankName ?? '',
    branch: account?.branch ?? '',
    iban: account?.iban ?? '',
    accountNumber: account?.accountNumber ?? '',
    notes: account?.notes ?? '',
    isActive: account?.isActive ?? true,
  }));
  const [errors, setErrors] = useState({});
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const save = useMutation({
    mutationFn: (body) => (account ? apiPut(`/accounting/treasury/${account.id}`, body) : apiPost('/accounting/treasury', body)),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: accountingKeys.all });
      toastSuccess(account ? `${result.account.name} güncellendi` : `${result.account.name} eklendi`);
      onClose();
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      toastError(error.code === 'STALE_WRITE' ? 'Hesap bu arada değişti; yenileyip tekrar açın.' : error.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    const bank = values.kind === 'BANK';
    const base = { ...values, bankName: bank ? values.bankName : null, branch: bank ? values.branch : null, iban: bank ? values.iban : null, accountNumber: bank ? values.accountNumber : null };
    const { isActive, ...create } = base;
    const body = account ? { ...base, expectedUpdatedAt: account.updatedAt } : create;
    const checked = validateWith(account ? treasuryAccountUpdateSchema : treasuryAccountCreateSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending;
  return (
    <Modal
      open
      size="lg"
      title={account ? account.name : 'Yeni kasa / banka hesabı'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="treasury-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="treasury-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select label="Tür" value={values.kind} onChange={set('kind')} options={TREASURY_KINDS.map((value) => ({ value, label: TREASURY_KIND_LABELS[value] }))} error={errors.kind} disabled={busy} />
        <Input label="Para birimi" value={values.currency} onChange={set('currency')} maxLength={3} error={errors.currency} disabled={busy} />
        <Input label="Ad" value={values.name} onChange={set('name')} error={errors.name} disabled={busy} className="sm:col-span-2" />
        <Input label="Kod (boşsa otomatik)" value={values.code} onChange={set('code')} error={errors.code} disabled={busy} />
        {values.kind === 'BANK' && (
          <>
            <Input label="Banka" value={values.bankName} onChange={set('bankName')} error={errors.bankName} disabled={busy} />
            <Input label="Şube" value={values.branch} onChange={set('branch')} error={errors.branch} disabled={busy} />
            <Input label="Hesap no" value={values.accountNumber} onChange={set('accountNumber')} error={errors.accountNumber} disabled={busy} />
            <Input label="IBAN" value={values.iban} onChange={set('iban')} placeholder="TR00 0000 0000 0000 0000 0000 00" error={errors.iban} disabled={busy} className="sm:col-span-2" />
          </>
        )}
        <Textarea label="Not" rows={2} value={values.notes} onChange={set('notes')} error={errors.notes} disabled={busy} className="sm:col-span-2" />
        {account && (
          <Checkbox
            label="Kullanımda"
            hint="Bakiyesi olan, eşlemede kullanılan ya da tahsilde çeki olan hesap kaldırılamaz."
            checked={values.isActive}
            onChange={(event) => setValues((current) => ({ ...current, isActive: event.target.checked }))}
            disabled={busy}
            className="sm:col-span-2"
          />
        )}
      </form>
    </Modal>
  );
}
