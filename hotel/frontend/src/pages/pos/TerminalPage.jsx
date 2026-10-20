import { useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_COVERS, POS_TABLE_STATE_LABELS, openPosCheckSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Icon, Input, Spinner } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { TABLE_STATE_CLASSES, checkPath, elapsedText, posKeys, useCurrentShift, usePosTerminal } from '../../lib/pos.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useNow } from '../../lib/useNow.js';
import { validateWith } from '../../lib/validate.js';
import { toastError } from '../../store/toast.js';
import { ShiftBar } from './ShiftBar.jsx';

/** Canlı bağlantı yokken masa planının yenilenme aralığı. */
const OFFLINE_REFRESH_MS = 15_000;
/** Masadaki süre metni dakikada bir ilerler. */
const CLOCK_TICK_MS = 60_000;
/** Kişi sayısı hızlı seçimi. */
const COVER_CHOICES = ['1', '2', '3', '4', '5', '6', '8', '10'];

/**
 * Masa planı (modül 39): satış noktası seçimi (`?nokta=`), bölüm bölüm masa kutuları
 * (boş / dolu / hesap istiyor; adisyon no, kişi, süre, tutar), masasız adisyonlar ve
 * garsonun vardiya çubuğu. Boş masaya dokunmak adisyon açar; dolu masaya dokunmak
 * adisyonuna gider (birden çoksa seçtirir).
 */
export function TerminalPage() {
  const terminal = usePosTerminal();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  if (terminal.isPending || terminal.isError) return <QueryFallback query={terminal} errorTitle="Masa planı yüklenemedi" />;
  const { outlets, currency } = terminal.data;
  if (outlets.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="utensils"
          title="Satış noktası yok"
          description="Restoran, lobi bar gibi satış noktalarını ve masalarını tanımlayın; menüyü ekleyin."
          action={can(PERMISSIONS.POS_SETUP) && <Link to="/pos/tanimlar"><Button icon="settings">Tanımlara git</Button></Link>}
        />
      </Card>
    );
  }
  const outletId = outlets.some((outlet) => outlet.id === params.get('nokta')) ? params.get('nokta') : outlets[0].id;
  return (
    <div className="flex flex-col gap-4">
      <ShiftBar outlets={outlets} currency={currency} />
      {outlets.length > 1 && (
        <ChoiceChips
          label="Satış noktası"
          required
          options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))}
          value={outletId}
          onChange={(value) => setParams(value === outlets[0].id ? {} : { nokta: value }, { replace: true })}
        />
      )}
      <Floor key={outletId} outletId={outletId} currency={currency} />
    </div>
  );
}

/** @param {{ outletId: string, currency: string }} props */
function Floor({ outletId, currency }) {
  const navigate = useNavigate();
  const { isLive } = useOutletContext();
  const now = useNow(CLOCK_TICK_MS);
  const shift = useCurrentShift();
  const hasShift = Boolean(shift.data?.shift);
  const [opening, setOpening] = useState(null);
  const [choosing, setChoosing] = useState(null);
  const floor = useQuery({
    queryKey: posKeys.floor(outletId),
    queryFn: () => api(withQuery('/pos/floor', { outletId })),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });
  const zones = useMemo(() => {
    const groups = new Map();
    for (const table of floor.data?.tables ?? []) {
      const zone = table.zone ?? 'Masalar';
      if (!groups.has(zone)) groups.set(zone, []);
      groups.get(zone).push(table);
    }
    return [...groups.entries()];
  }, [floor.data]);

  if (floor.isPending) return <Spinner className="py-10" />;
  if (floor.isError) {
    return (
      <Alert tone="danger" title="Masa planı yüklenemedi" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => floor.refetch()}>Tekrar dene</Button>}>
        {floor.error.message}
      </Alert>
    );
  }
  const { outlet, tables, tableless } = floor.data;
  const counts = tables.reduce((acc, table) => ({ ...acc, [table.state]: (acc[table.state] ?? 0) + 1 }), {});

  function pick(table) {
    if (table.checks.length === 1) return navigate(checkPath(table.checks[0].id));
    if (table.checks.length > 1) return setChoosing(table);
    if (!hasShift) return toastError('Önce vardiya açın');
    return setOpening({ table });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {['FREE', 'OCCUPIED', 'BILL'].map((state) => (
          <span key={state} className="flex items-center gap-1.5 text-ink-soft">
            <span aria-hidden="true" className={`size-3 rounded-full border ${TABLE_STATE_CLASSES[state]}`} />
            {POS_TABLE_STATE_LABELS[state]} <strong className="tabular-nums text-ink">{counts[state] ?? 0}</strong>
          </span>
        ))}
        <Button type="button" size="sm" variant="outline" icon="plus" className="ml-auto" onClick={() => (hasShift ? setOpening({ table: null }) : toastError('Önce vardiya açın'))}>
          Masasız adisyon
        </Button>
      </div>

      {tables.length === 0 ? (
        <Card>
          <EmptyState icon="layers" title="Masa tanımlı değil" description={`${outlet.name} için masa yok. Masasız adisyon açabilir ya da tanımlardan masa ekleyebilirsiniz.`} />
        </Card>
      ) : (
        zones.map(([zone, rows]) => (
          <section key={zone} aria-label={zone} className="flex flex-col gap-2">
            <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-ink-muted">{zone}</h3>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
              {rows.map((table) => (
                <li key={table.id}>
                  <TableTile table={table} currency={currency} now={now} onPick={() => pick(table)} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {tableless.length > 0 && (
        <Card title="Masasız adisyonlar" description="Bar tezgâhı, paket servis; masaya bağlı olmayan açık adisyonlar.">
          <ul className="divide-y divide-line">
            {tableless.map((check) => (
              <li key={check.id}>
                <Link to={checkPath(check.id)} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-2.5 text-sm hover:bg-surface-muted">
                  <span className="font-semibold text-ink">{check.number}</span>
                  <span className="text-ink-soft">{check.covers} kişi · {elapsedText(check.openedAt, now)}</span>
                  {check.billRequestedAt && <Badge tone="warning">Hesap istiyor</Badge>}
                  <span className="ml-auto font-bold tabular-nums">{formatMoney(check.grandTotal, currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {opening && <OpenCheckDialog outletId={outletId} table={opening.table} onClose={() => setOpening(null)} />}
      {choosing && (
        <Modal open size="sm" title={`Masa ${choosing.name}`} onClose={() => setChoosing(null)}>
          <ul className="flex flex-col gap-2">
            {choosing.checks.map((check) => (
              <li key={check.id}>
                <Link to={checkPath(check.id)} className="flex items-center justify-between gap-3 rounded-item border border-line px-3 py-2.5 text-sm hover:border-ink">
                  <span className="font-semibold">{check.number}</span>
                  <span className="text-ink-soft">{check.covers} kişi · {check.waiterEmail}</span>
                  <span className="font-bold tabular-nums">{formatMoney(check.grandTotal, currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {hasShift && (
            <Button
              type="button"
              variant="outline"
              icon="plus"
              className="mt-4 w-full"
              onClick={() => {
                setOpening({ table: choosing });
                setChoosing(null);
              }}
            >
              Bu masaya yeni adisyon
            </Button>
          )}
        </Modal>
      )}
    </div>
  );
}

/**
 * Masa kutusu: dokunmatik ekranda rahat basılacak büyüklükte.
 * @param {{ table: any, currency: string, now: number, onPick: () => void }} props
 */
function TableTile({ table, currency, now, onPick }) {
  const first = table.checks[0];
  const total = table.checks.reduce((sum, check) => sum + Number(check.grandTotal), 0);
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex h-28 w-full flex-col justify-between rounded-panel border-2 p-3 text-left transition-colors duration-150 ${TABLE_STATE_CLASSES[table.state]}`}
      aria-label={`Masa ${table.name}: ${POS_TABLE_STATE_LABELS[table.state]}${first ? `, ${first.number}` : ''}`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-xl font-bold leading-none">{table.name}</span>
        <span className="flex items-center gap-1 text-xs font-semibold opacity-80">
          <Icon name="users" className="size-3.5" />
          {first ? table.checks.reduce((sum, check) => sum + check.covers, 0) : table.seats}
        </span>
      </span>
      {first ? (
        <span className="flex flex-col text-xs">
          <span className="font-semibold">
            {table.checks.length > 1 ? `${table.checks.length} adisyon` : first.number.replace(/^ADS-\d{4}-0*/, '#')} · {elapsedText(first.openedAt, now)}
          </span>
          <span className="text-sm font-bold tabular-nums">{formatMoney(total.toFixed(2), currency)}</span>
        </span>
      ) : (
        <span className="text-xs font-semibold opacity-70">{POS_TABLE_STATE_LABELS.FREE}</span>
      )}
    </button>
  );
}

/**
 * Adisyon aç: kişi sayısı ve not. İstek kimliği diyalogla bir kez üretilir (çift dokunuş
 * tek adisyon açar); açılınca adisyon ekranına geçilir.
 * @param {{ outletId: string, table: { id: string, name: string } | null, onClose: () => void }} props
 */
function OpenCheckDialog({ outletId, table, onClose }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [requestId] = useState(() => crypto.randomUUID());
  const [values, setValues] = useState({ covers: '2', note: '' });
  const [errors, setErrors] = useState({});
  const open = useMutation({
    mutationFn: (body) => apiPost('/pos/checks', body),
    onSuccess: (check) => {
      queryClient.setQueryData(posKeys.check(check.id), check);
      queryClient.invalidateQueries({ queryKey: posKeys.floor(outletId) });
      navigate(checkPath(check.id));
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      toastError(error.message);
    },
  });

  function submit(submitEvent) {
    submitEvent.preventDefault();
    const body = { requestId, outletId, tableId: table?.id ?? null, covers: values.covers, note: values.note };
    const checked = validateWith(openPosCheckSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    open.mutate(checked.data);
  }

  const busy = open.isPending;
  return (
    <Modal
      open
      size="sm"
      title={table ? `Masa ${table.name}: adisyon aç` : 'Masasız adisyon'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="pos-open-check" icon="check" disabled={busy}>
            {busy ? 'Açılıyor…' : 'Aç'}
          </Button>
        </>
      }
    >
      <form id="pos-open-check" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <ChoiceChips label="Kişi sayısı" required options={COVER_CHOICES.map((value) => ({ value, label: value }))} value={values.covers} onChange={(covers) => setValues((current) => ({ ...current, covers }))} disabled={busy} />
        <Input
          label="Kişi"
          name="pos-covers"
          type="number"
          min={1}
          max={MAX_COVERS}
          value={values.covers}
          onChange={(event) => setValues((current) => ({ ...current, covers: event.target.value }))}
          error={errors.covers}
          disabled={busy}
        />
        <Input label="Not (isteğe bağlı)" name="pos-check-note" value={values.note} onChange={(event) => setValues((current) => ({ ...current, note: event.target.value }))} error={errors.note} disabled={busy} placeholder="Doğum günü, alerji, VIP…" />
      </form>
    </Modal>
  );
}
