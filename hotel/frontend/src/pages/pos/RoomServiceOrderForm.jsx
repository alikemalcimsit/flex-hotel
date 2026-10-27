import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_COVERS, MAX_ROOM_SERVICE_LINES, MAX_ROOM_SERVICE_NOTE_LENGTH, MIN_ROOM_SERVICE_LEAD_MINUTES, createRoomServiceOrderSchema, utcToZonedWallTime } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, EmptyState, Icon, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { Switch } from '../../components/Switch.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { requestKeys } from '../../lib/frontOffice.js';
import { posKeys, useDebounced, usePosTerminal } from '../../lib/pos.js';
import { cartPayload } from '../../lib/posCart.js';
import { ROOM_SERVICE_PATH, clockText, deliverAtShortcuts, orderPath, rsKeys } from '../../lib/roomService.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { useNow } from '../../lib/useNow.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { MenuPicker } from './MenuPicker.jsx';
import { ShiftBar } from './ShiftBar.jsx';

/** Kahvaltı kartı kısayolları (yarın sabah; misafirin kartındaki saatler). */
const BREAKFAST_TIMES = Object.freeze(['07:00', '07:30', '08:00', '08:30', '09:00']);
const TIMING_OPTIONS = Object.freeze([
  { value: 'NOW', label: 'Hemen' },
  { value: 'LATER', label: 'İleri saat (kahvaltı kartı)' },
]);

/**
 * Oda servisi sipariş formu (modül 41): içerideki konaklama (oda numarası ya da soyadı), oda servisi noktası, menüden
 * kalemler (adet, not), misafirin notu, kişi, teslim zamanı (hemen ya da otelin saatiyle ileri saat), tepsi bırakılacak
 * mı. Misafir isteğinden (`?istek=`) açılırsa konaklama ve not istekten gelir; teslimde istek tamamlanır.
 * "Hemen" sipariş vardiyanızda mutfağa düşer (vardiya çubuğu üstte); ileri saatli vardiya istemez.
 */
export function RoomServiceOrderForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const guestRequestId = params.get('istek');
  const terminal = usePosTerminal();
  const { timeZone } = useHotelToday();
  const now = useNow(60_000);
  const request = useQuery({ queryKey: requestKeys.detail(guestRequestId ?? ''), queryFn: () => api(`/guest-requests/${guestRequestId}`), enabled: Boolean(guestRequestId) });
  const [requestId] = useState(() => crypto.randomUUID());
  const [outletId, setOutletId] = useState('');
  const [stay, setStay] = useState(null);
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [cart, setCart] = useState([]);
  const [values, setValues] = useState({ note: '', covers: '1', timing: 'NOW', deliverAt: '', trayExpected: true });
  const [errors, setErrors] = useState({});

  const outlets = (terminal.data?.outlets ?? []).filter((outlet) => outlet.kind === 'ROOM_SERVICE');
  const outlet = outlets.find((entry) => entry.id === outletId) ?? outlets[0] ?? null;

  // İstekten açıldıysa konaklama ve not istekten (bir kez).
  const prefill = request.data;
  useEffect(() => {
    if (!prefill) return;
    if (prefill.reservation?.status === 'CHECKED_IN' && prefill.room) setStay({ id: prefill.reservation.id, roomNumber: prefill.room.number, guestName: prefill.guest?.name ?? '', confirmationCode: prefill.reservation.confirmationCode });
    else if (prefill.room) setSearchText(prefill.room.number);
    setValues((current) => ({ ...current, note: [prefill.title, prefill.description].filter(Boolean).join(' — ').slice(0, MAX_ROOM_SERVICE_NOTE_LENGTH) }));
  }, [prefill]);

  const stays = useQuery({ queryKey: posKeys.inHouse(search), queryFn: () => api(withQuery('/pos/in-house', { search })), enabled: search.length > 0 && !stay });

  const create = useMutation({
    mutationFn: (body) => apiPost('/pos/room-service/orders', body),
    onSuccess: (order) => {
      queryClient.setQueryData(rsKeys.order(order.id), order);
      queryClient.invalidateQueries({ queryKey: ['pos'] });
      if (guestRequestId) queryClient.invalidateQueries({ queryKey: requestKeys.all });
      toastSuccess(order.status === 'SCHEDULED' ? `${order.number} planlandı; ${clockText(order.releaseAt, timeZone)}’de mutfağa düşer` : `${order.number} mutfağa düştü`);
      navigate(orderPath(order.id));
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      if (error.code === 'VALIDATION') queryClient.invalidateQueries({ queryKey: posKeys.terminal });
      toastError(error.message);
    },
  });

  if (terminal.isPending || terminal.isError) return <QueryFallback query={terminal} errorTitle="Menü yüklenemedi" />;
  if (!outlet) {
    return (
      <Card>
        <EmptyState icon="utensils" title="Oda servisi noktası yok" description="Menü ve tanımlardan türü “Oda servisi” olan bir satış noktası ekleyin." />
      </Card>
    );
  }

  const later = values.timing === 'LATER';
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const minWall = utcToZonedWallTime(new Date(now + MIN_ROOM_SERVICE_LEAD_MINUTES * 60_000), timeZone);

  function submit(event) {
    event.preventDefault();
    const body = {
      requestId,
      outletId: outlet.id,
      reservationId: stay?.id ?? '',
      lines: cartPayload(cart, requestId).lines,
      note: values.note,
      covers: values.covers,
      deliverAt: later ? values.deliverAt : null,
      trayExpected: values.trayExpected,
      guestRequestId: guestRequestId ?? null,
    };
    const checked = validateWith(createRoomServiceOrderSchema, body);
    if (!checked.ok) {
      setErrors(checked.errors);
      toastError(Object.values(checked.errors)[0]);
      return;
    }
    if (later && values.deliverAt < minWall) return setErrors({ deliverAt: `En erken ${minWall.replace('T', ' ')} (otelin saati)` });
    setErrors({});
    create.mutate(checked.data);
  }

  const busy = create.isPending;
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={ROOM_SERVICE_PATH} className="flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">
          <Icon name="arrowLeft" className="size-4" /> Oda servisi panosu
        </Link>
        <h1 className="text-2xl font-bold text-ink">Yeni oda servisi siparişi</h1>
      </div>
      {!later && <ShiftBar outlets={terminal.data.outlets} currency={terminal.data.currency} />}
      {guestRequestId && request.isPending && <Spinner label="Misafir isteği okunuyor…" className="py-2" />}
      {guestRequestId && request.isError && <Alert tone="danger" title="Misafir isteği okunamadı">{request.error.message}</Alert>}
      {prefill && (
        <Alert tone="info" title={`Misafir isteğinden: ${prefill.title}`}>
          Sipariş teslim edilince istek tamamlanır; iptal edilirse istek yeniden açılır.
          {prefill.reservation?.status !== 'CHECKED_IN' && ' İsteğin konaklaması içeride değil; konaklamayı arayıp seçin.'}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex flex-col gap-4">
          <Card title="Oda / misafir" description="İçerideki konaklama: oda numarası ya da soyadı.">
            {stay ? (
              <div className="flex items-center justify-between gap-3 rounded-item border border-ink bg-surface-muted px-3 py-2 text-sm">
                <span>
                  <strong className="text-lg">Oda {stay.roomNumber}</strong> · {stay.guestName}
                  {stay.confirmationCode && <span className="ml-2 text-xs text-ink-muted">{stay.confirmationCode}</span>}
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setStay(null)} disabled={busy}>
                  Değiştir
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Input label="Oda numarası ya da soyadı" name="rs-stay-search" value={searchText} onChange={(event) => setSearchText(event.target.value)} disabled={busy} placeholder="ör. 412 ya da Yılmaz" error={errors.reservationId} />
                {search.length > 0 && (
                  <div role="radiogroup" aria-label="İçerideki konaklamalar" className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                    {stays.isPending && <Spinner className="py-3" />}
                    {stays.isError && <Alert tone="danger" title="Arama yapılamadı">{stays.error.message}</Alert>}
                    {stays.isSuccess && stays.data.stays.length === 0 && <EmptyState icon="bed" title="İçeride bu oda / misafir yok" description="Giriş yapmamış ya da çıkmış misafire sipariş girilmez." />}
                    {stays.data?.stays.map((row) => (
                      <button key={row.id} type="button" role="radio" aria-checked={false} onClick={() => setStay(row)} className="flex items-center justify-between gap-3 rounded-item border border-line px-3 py-2 text-left text-sm hover:border-ink">
                        <span>
                          <strong>Oda {row.roomNumber}</strong> · {row.guestName}
                        </span>
                        <span className="text-xs text-ink-muted">
                          {row.guests} kişi · çıkış {row.checkOut}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card title="Teslim">
            <div className="flex flex-col gap-3">
              {outlets.length > 1 && <Select label="Oda servisi noktası" value={outlet.id} onChange={(event) => setOutletId(event.target.value)} options={outlets.map((entry) => ({ value: entry.id, label: entry.name }))} disabled={busy} />}
              <ChoiceChips label="Zaman" required options={TIMING_OPTIONS} value={values.timing} onChange={(timing) => setValues((current) => ({ ...current, timing }))} disabled={busy} />
              {later && (
                <>
                  <ChoiceChips label="Kısayol" options={deliverAtShortcuts(now, timeZone, BREAKFAST_TIMES)} value={values.deliverAt} onChange={(deliverAt) => setValues((current) => ({ ...current, deliverAt }))} disabled={busy} />
                  <Input
                    label={`Teslim saati (otelin saati, ${timeZone})`}
                    name="rs-deliver-at"
                    type="datetime-local"
                    min={minWall}
                    value={values.deliverAt}
                    onChange={set('deliverAt')}
                    error={errors.deliverAt}
                    required
                    disabled={busy}
                  />
                  <p className="text-xs text-ink-muted">Sipariş teslimden hazırlık payı kadar önce mutfağa düşer; vardiyası açık oda servisi personeline yazılır.</p>
                </>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_1fr] sm:items-end">
                <Input label="Kişi" name="rs-covers" type="number" inputMode="numeric" min={1} max={MAX_COVERS} value={values.covers} onChange={set('covers')} error={errors.covers} disabled={busy} />
                <Switch label="Tepsi bırakılacak (toplama takibi)" showLabel checked={values.trayExpected} onChange={(trayExpected) => setValues((current) => ({ ...current, trayExpected }))} disabled={busy} />
              </div>
              <Textarea label="Not (kapıda, alerji, misafirin isteği)" name="rs-note" rows={2} maxLength={MAX_ROOM_SERVICE_NOTE_LENGTH} value={values.note} onChange={set('note')} error={errors.note} disabled={busy} />
            </div>
          </Card>
        </div>

        <Card title="Kalemler" description="Menüden ürüne dokunun; adet ve notu sepette düzeltin.">
          <MenuPicker
            terminal={terminal.data}
            outletId={outlet.id}
            cart={cart}
            onCart={setCart}
            maxLines={MAX_ROOM_SERVICE_LINES}
            busy={busy}
            actions={
              <Button type="submit" icon={later ? 'calendar' : 'send'} disabled={busy || cart.length === 0}>
                {busy ? 'Kaydediliyor…' : later ? 'Planla' : 'Mutfağa gönder'}
              </Button>
            }
          />
          {Number(terminal.data.settings.trayCharge) > 0 && <p className="mt-2 text-xs text-ink-muted">Siparişe oda servisi ücreti ({terminal.data.settings.trayCharge}) ayrıca eklenir.</p>}
          {errors.lines && <p className="mt-2 text-xs font-semibold text-danger-ink">{errors.lines}</p>}
        </Card>
      </div>
    </form>
  );
}
