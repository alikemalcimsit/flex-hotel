import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  FOLIO_PAYER_NAME_MAX,
  FOLIO_ROUTABLE_TYPES,
  folioRoutesSchema,
  mergeFoliosSchema,
  splitFolioSchema,
  transferItemsSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Checkbox, Input, Select, Spinner } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost, apiPut, withQuery } from '../../lib/api.js';
import { balanceTone, folioKeys, itemTypeLabel } from '../../lib/folios.js';
import { formatMoney } from '../../lib/format.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

const SEARCH_DEBOUNCE_MS = 300;
const PICKER_PAGE_SIZE = 10;

/**
 * Başka konaklamaların açık folyolarını arar (oda no, misafir, onay kodu,
 * şirket). Aktarma hedefi (tek) ya da birleştirme kaynakları (çok) için.
 *
 * @param {{ excludeIds: string[], multiple?: boolean, selected: string[], onChange: (ids: string[], rows: object[]) => void, disabled?: boolean }} props
 */
function FolioPicker({ excludeIds, multiple = false, selected, onChange, disabled = false }) {
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [known, setKnown] = useState(() => new Map());
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const query = useQuery({
    queryKey: folioKeys.search(search),
    queryFn: () => api(withQuery('/folios', { view: 'OPEN', search: search || undefined, page: 1, pageSize: PICKER_PAGE_SIZE })),
    enabled: search.length > 0,
  });
  const rows = (query.data?.items ?? []).filter((row) => !excludeIds.includes(row.id));

  function toggle(row) {
    const nextKnown = new Map(known).set(row.id, row);
    setKnown(nextKnown);
    const next = multiple ? (selected.includes(row.id) ? selected.filter((id) => id !== row.id) : [...selected, row.id]) : [row.id];
    onChange(next, next.map((id) => nextKnown.get(id)).filter(Boolean));
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        label="Folyo ara"
        type="search"
        placeholder="Oda no, misafir, onay kodu, şirket…"
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={disabled}
      />
      {search.length === 0 ? (
        <p className="text-xs text-ink-muted">Aramak için oda numarası ya da misafir adı yazın.</p>
      ) : query.isPending ? (
        <Spinner label="Aranıyor…" className="py-2" />
      ) : query.isError ? (
        <p className="text-xs text-sec-strong">{query.error.message}</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-ink-muted">Uyan açık folyo yok.</p>
      ) : (
        <ul className="flex max-h-64 flex-col divide-y divide-line overflow-y-auto rounded-item border border-line">
          {rows.map((row) => {
            const checked = selected.includes(row.id);
            return (
              <li key={row.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-muted">
                  <input
                    type={multiple ? 'checkbox' : 'radio'}
                    name="folio-picker"
                    checked={checked}
                    onChange={() => toggle(row)}
                    disabled={disabled}
                    className="size-4 accent-[var(--color-ink)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{row.stay.room?.number ?? '—'} · {row.stay.guest.name}</span>
                    <span className="block text-xs text-ink-muted">{row.name} · {row.stay.confirmationCode}</span>
                  </span>
                  <Badge tone={balanceTone(row.balance)}>{formatMoney(row.balance, row.currency)}</Badge>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Seçilen kalemleri başka bir açık folyoya aktar: aynı konaklamanın diğer
 * penceresi ya da başka bir konaklamanın folyosu (ör. arkadaşının odası).
 *
 * @param {{ folio: object, siblings: object[], itemIds: string[], onClose: () => void, onDone: () => void }} props
 */
export function TransferDialog({ folio, siblings, itemIds, onClose, onDone }) {
  const ownTargets = siblings.filter((row) => row.id !== folio.id && row.status === 'OPEN');
  const [mode, setMode] = useState(ownTargets.length ? 'own' : 'other');
  const [target, setTarget] = useState(ownTargets[0]?.id ?? '');
  const [other, setOther] = useState([]);
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/folios/${folio.id}/transfer`, body),
    onSuccess: () => {
      toastSuccess(`${itemIds.length} kalem aktarıldı`);
      onDone();
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });
  const busy = mutation.isPending;
  const targetFolioId = mode === 'own' ? target : other[0];

  function submit(event) {
    event.preventDefault();
    const result = validateWith(transferItemsSchema, { itemIds, targetFolioId });
    if (!result.ok) {
      setError(result.errors.targetFolioId ?? result.errors.itemIds ?? 'Hedef folyo seçin');
      return;
    }
    mutation.mutate(result.data);
  }

  return (
    <Modal
      open
      size="md"
      title={`${itemIds.length} kalemi aktar`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="transfer-form" icon="arrowRight" disabled={busy || !targetFolioId}>
            {busy ? 'Aktarılıyor…' : 'Aktar'}
          </Button>
        </>
      }
    >
      <form id="transfer-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <Alert tone="danger" title="Aktarılmadı">{error}</Alert>}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Hedef">
          {ownTargets.length > 0 && (
            <ModeButton active={mode === 'own'} onClick={() => setMode('own')} disabled={busy}>Bu konaklamanın folyosu</ModeButton>
          )}
          <ModeButton active={mode === 'other'} onClick={() => setMode('other')} disabled={busy}>Başka konaklama</ModeButton>
        </div>
        {mode === 'own' ? (
          <Select
            label="Hedef folyo"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            options={ownTargets.map((row) => ({ value: row.id, label: `${row.name} · bakiye ${formatMoney(row.balance, row.currency)}` }))}
            disabled={busy}
          />
        ) : (
          <FolioPicker excludeIds={[folio.id]} selected={other} onChange={(ids) => setOther(ids)} disabled={busy} />
        )}
        <p className="text-xs text-ink-muted">Kalemin doğduğu konaklama dökümde görünmeye devam eder; aktarma denetim izine yazılır.</p>
      </form>
    </Modal>
  );
}

/** @param {{ active: boolean, onClick: () => void, disabled?: boolean, children: React.ReactNode }} props */
function ModeButton({ active, onClick, disabled, children }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
        active ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-soft hover:border-ink'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Böl: aynı konaklamada yeni folyo (pencere) aç; seçilen kalemler ona taşınır.
 * İstenirse sonraki sistem kalemleri (oda ücreti, restoran…) de yeni folyoya
 * düşer — "oda ücreti şirkete, ekstralar misafire".
 *
 * @param {{ folio: object, itemIds: string[], onClose: () => void, onDone: (folioId: string) => void }} props
 */
export function SplitDialog({ folio, itemIds, onClose, onDone }) {
  const [payerName, setPayerName] = useState('');
  const [routeTypes, setRouteTypes] = useState([]);
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/folios/${folio.id}/split`, body),
    onSuccess: (result) => {
      toastSuccess(itemIds.length ? `Yeni folyo açıldı, ${itemIds.length} kalem taşındı` : 'Yeni folyo açıldı');
      onDone(result.folioId);
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });
  const busy = mutation.isPending;

  function submit(event) {
    event.preventDefault();
    const result = validateWith(splitFolioSchema, { itemIds, payerName, routeTypes });
    if (!result.ok) {
      setError(Object.values(result.errors)[0]);
      return;
    }
    mutation.mutate(result.data);
  }

  const toggleType = (type) =>
    setRouteTypes((current) => (current.includes(type) ? current.filter((value) => value !== type) : [...current, type]));

  return (
    <Modal
      open
      size="md"
      title={itemIds.length ? `${itemIds.length} kalemle yeni folyo` : 'Yeni folyo aç'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="split-form" icon="layers" disabled={busy}>
            {busy ? 'Açılıyor…' : 'Folyoyu aç'}
          </Button>
        </>
      }
    >
      <form id="split-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <Alert tone="danger" title="Açılmadı">{error}</Alert>}
        <Input
          label="Ödeyen (isteğe bağlı)"
          placeholder="ör. ABC Ltd. — boş bırakılırsa misafir"
          maxLength={FOLIO_PAYER_NAME_MAX}
          value={payerName}
          onChange={(event) => setPayerName(event.target.value)}
          disabled={busy}
          autoFocus
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-ink">Bundan sonra bu folyoya düşsün</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {FOLIO_ROUTABLE_TYPES.map((type) => (
              <Checkbox key={type} label={itemTypeLabel(type)} checked={routeTypes.includes(type)} onChange={() => toggleType(type)} disabled={busy} />
            ))}
          </div>
          <p className="text-xs text-ink-muted">Seçilen tiplerin sistem kalemleri (her gecenin oda ücreti, restoran, minibar) bu folyoya işlenir. Sonra “Yönlendirme”den değiştirebilirsiniz.</p>
        </fieldset>
      </form>
    </Modal>
  );
}

/**
 * Birleştir (grup hesabı): seçilen folyoların bütün kalem ve ödemeleri bu
 * folyoya taşınır; o konaklamaların bundan sonraki kalemleri de buraya düşer.
 * Geri alınmaz (kalemler aktarılarak ayrılabilir).
 *
 * @param {{ folio: object, onClose: () => void, onDone: () => void }} props
 */
export function MergeDialog({ folio, onClose, onDone }) {
  const [sources, setSources] = useState([]);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/folios/${folio.id}/merge`, body),
    onSuccess: () => {
      toastSuccess(`${sources.length} folyo bu folyoda birleştirildi`);
      onDone();
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });
  const busy = mutation.isPending;

  function submit(event) {
    event.preventDefault();
    const result = validateWith(mergeFoliosSchema, { sourceFolioIds: sources });
    if (!result.ok) {
      setError(result.errors.sourceFolioIds ?? 'Birleştirilecek folyoyu seçin');
      return;
    }
    mutation.mutate(result.data);
  }

  return (
    <Modal
      open
      size="md"
      title={`${folio.name} folyosunda birleştir`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="merge-form" icon="link" disabled={busy || sources.length === 0}>
            {busy ? 'Birleştiriliyor…' : `${sources.length || ''} folyoyu birleştir`.trim()}
          </Button>
        </>
      }
    >
      <form id="merge-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <Alert tone="danger" title="Birleştirilmedi">{error}</Alert>}
        <Alert tone="warning" title="Grup hesabı">
          Seçilen folyoların kalem ve ödemeleri buraya taşınır; o konaklamaların sonraki oda ücretleri de buraya düşer. İşlem geri alınmaz.
        </Alert>
        <FolioPicker
          excludeIds={[folio.id]}
          multiple
          selected={sources}
          onChange={(ids, picked) => {
            setSources(ids);
            setRows(picked);
          }}
          disabled={busy}
        />
        {rows.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm text-ink-soft" aria-label="Seçilen folyolar">
            {rows.map((row) => (
              <li key={row.id} className="flex justify-between gap-3">
                <span>{row.stay.room?.number ?? '—'} · {row.stay.guest.name} — {row.name}</span>
                <span className="tabular-nums">{formatMoney(row.balance, row.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </form>
    </Modal>
  );
}

const PRIMARY = '';

/**
 * Yönlendirme: hangi tipteki sistem kalemi hangi folyoya düşer. Seçenekler:
 * konaklamanın ilk açık folyosu (varsayılan), konaklamanın diğer açık
 * folyoları ve (varsa) birleştirmeyle gelen başka konaklamanın folyosu.
 *
 * @param {{ reservationId: string, folios: object[], routes: Array<{ type: string, folio: object }>, onClose: () => void, onDone: () => void }} props
 */
export function RoutingDialog({ reservationId, folios, routes, onClose, onDone }) {
  const current = Object.fromEntries(routes.map((route) => [route.type, route.folio.id]));
  const [values, setValues] = useState(() => Object.fromEntries(FOLIO_ROUTABLE_TYPES.map((type) => [type, current[type] ?? PRIMARY])));
  const [error, setError] = useState('');
  const external = routes.filter((route) => route.folio.reservationId !== reservationId).map((route) => route.folio);
  const options = [
    { value: PRIMARY, label: 'İlk açık folyo (varsayılan)' },
    ...folios.filter((row) => row.status === 'OPEN').map((row) => ({ value: row.id, label: row.name })),
    ...[...new Map(external.map((row) => [row.id, row])).values()].map((row) => ({
      value: row.id,
      label: `${row.roomNumber ?? '—'} · ${row.guestName ?? ''} — ${row.name}`,
    })),
  ];
  const mutation = useMutation({
    mutationFn: (body) => apiPut(`/folios/stays/${reservationId}/routes`, body),
    onSuccess: () => {
      toastSuccess('Yönlendirme kaydedildi');
      onDone();
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });
  const busy = mutation.isPending;

  function submit(event) {
    event.preventDefault();
    const body = { routes: FOLIO_ROUTABLE_TYPES.map((type) => ({ type, folioId: values[type] || null })) };
    const result = validateWith(folioRoutesSchema, body);
    if (!result.ok) {
      setError(Object.values(result.errors)[0]);
      return;
    }
    mutation.mutate(result.data);
  }

  return (
    <Modal
      open
      size="md"
      title="Yönlendirme"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="routing-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="routing-form" onSubmit={submit} className="flex flex-col gap-3" noValidate>
        {error && <Alert tone="danger" title="Kaydedilmedi">{error}</Alert>}
        <p className="text-sm text-ink-soft">Sistemin işlediği kalemler (her gecenin oda ücreti, restoran, minibar…) hangi folyoya düşsün? Elle işlenen harcama seçili folyoya gider.</p>
        {FOLIO_ROUTABLE_TYPES.map((type) => (
          <Select
            key={type}
            label={itemTypeLabel(type)}
            value={values[type]}
            onChange={(event) => setValues((current) => ({ ...current, [type]: event.target.value }))}
            options={options}
            disabled={busy}
          />
        ))}
      </form>
    </Modal>
  );
}
