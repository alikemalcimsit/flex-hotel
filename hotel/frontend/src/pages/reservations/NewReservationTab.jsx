import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BOARD_TYPES,
  BOARD_TYPE_LABELS,
  MAX_GROUP_LINES,
  RESERVATION_CREATE_STATUSES,
  RESERVATION_CREATE_STATUS_LABELS,
  RESERVATION_MANUAL_SOURCES,
  RESERVATION_SOURCE_LABELS,
  createGroupReservationSchema,
  createReservationSchema,
  createWaitlistSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, Icon, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { api, apiPost } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { addDaysIso, newRequestId, reservationKeys } from '../../lib/reservations.js';
import { useHotelSettings, useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { useRoomTypes } from '../rooms/useRoomTypes.js';
import { EMPTY_GUEST_DRAFT, GuestPicker } from './GuestPicker.jsx';

const QUOTE_DEBOUNCE_MS = 250;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const BOARD_OPTIONS = BOARD_TYPES.map((value) => ({ value, label: BOARD_TYPE_LABELS[value] }));
const SOURCE_OPTIONS = RESERVATION_MANUAL_SOURCES.map((value) => ({ value, label: RESERVATION_SOURCE_LABELS[value] }));
const STATUS_OPTIONS = RESERVATION_CREATE_STATUSES.map((value) => ({ value, label: RESERVATION_CREATE_STATUS_LABELS[value] }));

let lineKey = 0;
const newLine = (boardType, roomTypeId = '') => ({ key: (lineKey += 1), roomTypeId, adults: '2', children: '0', boardType, quantity: '1' });

/** @param {string} value */
const validDay = (value) => DAY_PATTERN.test(value ?? '');

/**
 * Yeni rezervasyon formu (modül 4).
 *
 * - **Misafir:** kayıtlı kart aranır ya da yeni bilgi girilir. Aynı telefon /
 *   e-posta başka ada kayıtlıysa sunucu sorar; personel kartı seçer ya da
 *   "farklı kişi" der.
 * - **Oda:** tarihler seçilince her tipin bu tarihlerde kaç boş odası olduğu
 *   ve toplam fiyatı görünür (canlı). Grup modunda birden fazla satır.
 * - **Fiyat:** gece gece döküm, vergiler, iptal koşulu. Yetkili personel
 *   toplamı elle girebilir (gerekçesiyle).
 * - **Tekrar gönderim:** form açılırken bir istek kimliği üretilir; çift tık
 *   ya da ağ tekrarı ikinci rezervasyon açmaz.
 * - **Yer yoksa:** otelin politikasına göre ya reddedilir (misafiri bekleme
 *   listesine almak tek tıkla) ya da yönetici onayına gider.
 *
 * Adresten ön doldurma: `?giris=&cikis=&tip=&oda=` (oda planı), `?bekleme=` (bekleme listesi).
 */
export function NewReservationTab() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useCan();
  const canOverridePrice = can(PERMISSIONS.RESERVATIONS_PRICE_OVERRIDE);
  const canSeeApprovals = can(PERMISSIONS.APPROVALS_VIEW);
  const { today } = useHotelToday();
  const hotel = useHotelSettings().data;
  const defaultBoard = hotel?.defaultBoardType ?? 'BB';
  const { roomTypes } = useRoomTypes();
  const [params] = useSearchParams();

  const prefillRoomId = params.get('oda');
  const waitlistId = params.get('bekleme');

  const [requestId, setRequestId] = useState(newRequestId);
  const [guest, setGuest] = useState({ mode: 'search', guest: null, draft: EMPTY_GUEST_DRAFT });
  const [forceNewGuest, setForceNewGuest] = useState(false);
  const [mode, setMode] = useState('single');
  const [checkIn, setCheckIn] = useState(() => (validDay(params.get('giris')) ? params.get('giris') : today));
  const [checkOut, setCheckOut] = useState(() => (validDay(params.get('cikis')) ? params.get('cikis') : addDaysIso(validDay(params.get('giris')) ? params.get('giris') : today, 1)));
  const [single, setSingle] = useState({ roomTypeId: params.get('tip') ?? '', adults: '2', children: '0', boardType: '' });
  const [groupName, setGroupName] = useState('');
  const [lines, setLines] = useState(() => [newLine('')]);
  const [status, setStatus] = useState('CONFIRMED');
  const [source, setSource] = useState('UI');
  const [notes, setNotes] = useState('');
  const [manual, setManual] = useState({ enabled: false, total: '', note: '' });
  const [errors, setErrors] = useState({});
  const [guestMatch, setGuestMatch] = useState(null);
  const [shortfall, setShortfall] = useState(null);
  const [approval, setApproval] = useState(null);

  const board = (value) => value || defaultBoard;

  // Bekleme listesinden çevriliyorsa kaydın bilgileriyle doldur.
  const waitlistQuery = useQuery({
    queryKey: reservationKeys.waitlistEntry(waitlistId ?? ''),
    queryFn: () => api(`/reservations/waitlist/${waitlistId}`),
    enabled: Boolean(waitlistId),
  });
  useEffect(() => {
    const entry = waitlistQuery.data;
    if (!entry) return;
    setGuest({ mode: 'new', guest: null, draft: { firstName: entry.firstName, lastName: entry.lastName, phone: entry.phone ?? '', email: entry.email ?? '', nationality: '' } });
    setCheckIn(entry.checkIn);
    setCheckOut(entry.checkOut);
    setMode('single');
    setSingle({ roomTypeId: entry.roomType.id, adults: String(entry.adults), children: String(entry.children), boardType: entry.boardType });
    if (entry.notes) setNotes(entry.notes);
  }, [waitlistQuery.data]);

  const stayValid = validDay(checkIn) && validDay(checkOut) && checkOut > checkIn;
  const quoteLines = useMemo(
    () =>
      mode === 'single'
        ? single.roomTypeId
          ? [{ roomTypeId: single.roomTypeId, quantity: 1, adults: Number(single.adults) || 1, children: Number(single.children) || 0 }]
          : []
        : lines
            .filter((line) => line.roomTypeId)
            .map((line) => ({ roomTypeId: line.roomTypeId, quantity: Number(line.quantity) || 1, adults: Number(line.adults) || 1, children: Number(line.children) || 0 })),
    [mode, single, lines],
  );
  const [quoteInput, setQuoteInput] = useState(null);
  useEffect(() => {
    if (!stayValid) {
      setQuoteInput(null);
      return undefined;
    }
    const timer = setTimeout(() => setQuoteInput({ checkIn, checkOut, lines: quoteLines }), QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [stayValid, checkIn, checkOut, quoteLines]);

  const quote = useQuery({
    queryKey: reservationKeys.quote(quoteInput ?? {}),
    queryFn: () => apiPost('/reservations/quote', quoteInput),
    enabled: Boolean(quoteInput),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const quoteData = quote.data;
  const typeQuotes = quoteData?.roomTypes ?? [];
  const selectedQuote = typeQuotes.find((type) => type.id === single.roomTypeId);

  const buildPayload = (overrides = {}) => {
    const guestPart =
      guest.mode === 'existing' && guest.guest
        ? { guestId: guest.guest.id, guest: null }
        : guest.mode === 'new'
          ? { guestId: null, guest: { ...guest.draft } }
          : { guestId: null, guest: null };
    const common = {
      ...guestPart,
      forceNewGuest,
      checkIn,
      checkOut,
      status,
      source,
      notes: notes || null,
      requestId,
      waitlistId: waitlistId ?? null,
      ...overrides,
    };
    if (mode === 'group') {
      return {
        ...common,
        groupName,
        lines: lines.map((line) => ({
          roomTypeId: line.roomTypeId,
          adults: line.adults,
          children: line.children,
          boardType: board(line.boardType),
          quantity: line.quantity,
        })),
      };
    }
    return {
      ...common,
      roomTypeId: single.roomTypeId,
      adults: single.adults,
      children: single.children,
      boardType: board(single.boardType),
      roomId: prefillRoomId ?? null,
      manualTotal: manual.enabled ? manual.total : null,
      priceNote: manual.enabled ? manual.note : null,
    };
  };

  const mutation = useMutation({
    mutationFn: (payload) => apiPost(mode === 'group' ? '/reservations/groups' : '/reservations', payload),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: reservationKeys.lists });
      queryClient.invalidateQueries({ queryKey: reservationKeys.waitlists });
      if (result.outcome === 'APPROVAL_REQUESTED' || result.outcome === 'APPROVAL_PENDING') {
        setApproval({ approvalId: result.approvalId, pending: result.outcome === 'APPROVAL_PENDING' });
        return;
      }
      const code = result.reservation?.confirmationCode;
      toastSuccess(
        result.outcome === 'EXISTING'
          ? `Bu rezervasyon zaten açılmıştı (${code})`
          : mode === 'group'
            ? `Grup rezervasyonu açıldı (${result.reservation?.groupMembers?.length ?? ''} oda)`
            : `${code} numaralı rezervasyon açıldı`,
      );
      navigate(`/rezervasyonlar/${result.reservation.id}`);
    },
    onError: (error) => {
      if (error.code === 'GUEST_MATCH') {
        setGuestMatch(error.details?.candidates ?? []);
        return;
      }
      if (error.code === 'NO_AVAILABILITY') {
        setShortfall({ message: error.message, nights: error.details?.shortfall ?? [] });
        return;
      }
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      toastError(error.message);
    },
  });

  const waitlistMutation = useMutation({
    mutationFn: (payload) => apiPost('/reservations/waitlist', payload),
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: reservationKeys.waitlists });
      toastSuccess(entry.status === 'AVAILABLE' ? 'Bekleme listesine alındı — bu arada yer açılmış görünüyor' : 'Bekleme listesine alındı; yer açılınca zil haber verecek');
      navigate(`/rezervasyonlar/bekleme-listesi?kayit=${entry.id}`);
    },
    onError: (error) => toastError(error.message),
  });

  function submit(event, overrides = {}) {
    event?.preventDefault();
    setGuestMatch(null);
    setShortfall(null);
    const payload = buildPayload(overrides);
    const result = validateWith(mode === 'group' ? createGroupReservationSchema : createReservationSchema, payload);
    if (!result.ok) {
      setErrors(result.errors);
      toastError('Formda düzeltilmesi gereken alanlar var');
      return;
    }
    setErrors({});
    mutation.mutate(payload);
  }

  function addToWaitlist() {
    const person =
      guest.mode === 'existing' && guest.guest
        ? { guestId: guest.guest.id, firstName: guest.guest.firstName, lastName: guest.guest.lastName, phone: guest.guest.phone ?? '', email: guest.guest.email ?? '' }
        : { guestId: null, firstName: guest.draft.firstName, lastName: guest.draft.lastName, phone: guest.draft.phone, email: guest.draft.email };
    const payload = {
      ...person,
      roomTypeId: single.roomTypeId,
      adults: single.adults,
      children: single.children,
      boardType: board(single.boardType),
      checkIn,
      checkOut,
      notes: notes || null,
    };
    const result = validateWith(createWaitlistSchema, payload);
    if (!result.ok) {
      toastError(Object.values(result.errors)[0] ?? 'Bekleme listesi için bilgiler eksik');
      return;
    }
    waitlistMutation.mutate(payload);
  }

  function resetForm() {
    setRequestId(newRequestId());
    setGuest({ mode: 'search', guest: null, draft: EMPTY_GUEST_DRAFT });
    setForceNewGuest(false);
    setApproval(null);
    setShortfall(null);
    setGuestMatch(null);
    setNotes('');
    setManual({ enabled: false, total: '', note: '' });
  }

  const busy = mutation.isPending;
  const typeName = (id) => roomTypes.find((type) => type.id === id)?.name ?? '';

  if (approval) {
    return (
      <Card>
        <div className="flex flex-col gap-4 p-2">
          <Alert tone="warning" title={approval.pending ? 'Bu istek zaten onay bekliyor' : 'Yer yok — yönetici onayına gönderildi'}>
            Otelin politikası gereği kapasite aşımı yönetici onayı ister. Onaylanırsa rezervasyon otomatik açılır ve zilinize haber
            düşer; reddedilirse gerekçesiyle bildirilir.
          </Alert>
          <div className="flex flex-wrap gap-2">
            {canSeeApprovals && (
              <Link to={`/onaylar/bekleyen?onay=${approval.approvalId}`}>
                <Button variant="outline" icon="checkCheck">Onayı görüntüle</Button>
              </Link>
            )}
            <Button icon="plus" onClick={resetForm}>Yeni rezervasyon</Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]" noValidate>
      <div className="flex flex-col gap-5">
        {waitlistId && (
          <Alert tone="info" title="Bekleme listesinden çevriliyor">
            {waitlistQuery.isPending ? 'Kayıt yükleniyor…' : waitlistQuery.isError ? waitlistQuery.error.message : 'Rezervasyon açılınca bekleme kaydı kapanır.'}
          </Alert>
        )}
        {prefillRoomId && (
          <Alert tone="info" title="Oda planından açılıyor">
            Rezervasyon açılırken seçilen oda da atanır (uygunluk yeniden denetlenir).
          </Alert>
        )}

        <Card>
          <Section title="Misafir" icon="user">
            <GuestPicker value={guest} onChange={(value) => { setGuest(value); setForceNewGuest(false); setGuestMatch(null); }} errors={errors} disabled={busy} />
            {guestMatch && (
              <Alert tone="warning" title="Bu iletişim bilgisi başka bir misafir kartında kayıtlı">
                <p className="mb-2">Aynı kişiyse kartı seçin; farklı kişiyse (aile, şirket telefonu) yeni kart açın.</p>
                <div className="flex flex-col gap-1.5">
                  {guestMatch.map((candidate) => (
                    <div key={candidate.id} className="flex flex-wrap items-center justify-between gap-2 rounded-item bg-surface px-3 py-2">
                      <span>
                        <span className="font-semibold">{candidate.name}</span>
                        <span className="ml-2 text-xs text-ink-muted">{[candidate.phone, candidate.email].filter(Boolean).join(' · ')}</span>
                      </span>
                      <Button size="sm" variant="outline" onClick={() => { setGuest({ mode: 'existing', guest: candidate, draft: guest.draft }); setGuestMatch(null); }}>
                        Bu misafir
                      </Button>
                    </div>
                  ))}
                </div>
                <Button className="mt-3" size="sm" onClick={() => { setForceNewGuest(true); submit(null, { forceNewGuest: true }); }}>
                  Farklı kişi — yeni kart aç
                </Button>
              </Alert>
            )}
          </Section>
        </Card>

        <Card>
          <Section title="Konaklama" icon="calendar">
            <div className="flex flex-wrap items-end gap-3">
              <Input label="Giriş" name="checkIn" type="date" min={today} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} error={errors.checkIn} disabled={busy} className="w-full sm:w-44" required />
              <Input label="Çıkış" name="checkOut" type="date" min={validDay(checkIn) ? addDaysIso(checkIn, 1) : today} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} error={errors.checkOut} disabled={busy} className="w-full sm:w-44" required />
              {stayValid && <Badge tone="neutral">{quoteData?.nights ?? Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000)} gece</Badge>}
              {!prefillRoomId && (
                <div className="ml-auto flex gap-1" role="group" aria-label="Rezervasyon türü">
                  {[['single', 'Tek oda'], ['group', 'Grup']].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={mode === value}
                      onClick={() => setMode(value)}
                      disabled={busy}
                      className={`rounded-full border px-3 py-1 text-sm font-semibold ${mode === value ? 'border-ink bg-ink text-white' : 'border-line-strong text-ink-soft'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Section>
        </Card>

        <Card>
          <Section title={mode === 'group' ? 'Odalar' : 'Oda'} icon={mode === 'group' ? 'users' : 'bed'}>
            {!stayValid && <p className="text-sm text-ink-muted">Müsaitliği görmek için önce tarihleri seçin.</p>}
            {stayValid && quote.isPending && <Spinner label="Müsaitlik hesaplanıyor…" />}
            {quote.isError && (
              <Alert tone="danger" title="Müsaitlik alınamadı" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => quote.refetch()}>Tekrar dene</Button>}>
                {quote.error.message}
              </Alert>
            )}

            {mode === 'single' ? (
              <div className="flex flex-col gap-4">
                {typeQuotes.length > 0 && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Oda tipi">
                    {typeQuotes.map((type) => {
                      const selected = type.id === single.roomTypeId;
                      return (
                        <button
                          key={type.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={busy}
                          onClick={() => setSingle((current) => ({ ...current, roomTypeId: type.id }))}
                          className={`flex items-center justify-between gap-3 rounded-item border p-3 text-left transition-colors ${
                            selected ? 'border-ink bg-canvas' : 'border-line hover:border-line-strong'
                          }`}
                        >
                          <span className="flex flex-col">
                            <span className="font-semibold text-ink">{type.name}</span>
                            <span className="text-xs text-ink-muted">en fazla {type.capacityAdults} yetişkin, {type.capacityChildren} çocuk</span>
                          </span>
                          <span className="text-right">
                            <span className="block font-semibold">{formatMoney(type.total, quoteData?.currency)}</span>
                            <Badge tone={type.available > 0 ? 'success' : 'danger'}>{type.available > 0 ? `${type.available} boş` : 'Yer yok'}</Badge>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {errors.roomTypeId && <p className="text-xs text-sec-strong">{errors.roomTypeId}</p>}
                <div className="flex flex-wrap gap-3">
                  <Input label="Yetişkin" name="adults" type="number" min={1} max={20} value={single.adults} onChange={(e) => setSingle((c) => ({ ...c, adults: e.target.value }))} error={errors.adults} disabled={busy} className="w-28" />
                  <Input label="Çocuk" name="children" type="number" min={0} max={20} value={single.children} onChange={(e) => setSingle((c) => ({ ...c, children: e.target.value }))} error={errors.children} disabled={busy} className="w-28" />
                  <Select label="Pansiyon" name="boardType" value={board(single.boardType)} onChange={(e) => setSingle((c) => ({ ...c, boardType: e.target.value }))} options={BOARD_OPTIONS} disabled={busy} className="w-full sm:w-64" />
                </div>
                {selectedQuote && single.adults && Number(single.adults) > selectedQuote.capacityAdults && (
                  <Alert tone="warning" title="Kişi sayısı bu tipe sığmıyor">
                    {selectedQuote.name} en fazla {selectedQuote.capacityAdults} yetişkin alır. Başka tip seçin ya da grup olarak birden fazla oda açın.
                  </Alert>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <Input label="Grup adı" name="groupName" placeholder="Ör. Demir Ailesi, ABC Kongre" value={groupName} onChange={(e) => setGroupName(e.target.value)} error={errors.groupName} disabled={busy} className="w-full sm:w-96" />
                {lines.map((line, index) => {
                  const typeQuote = typeQuotes.find((type) => type.id === line.roomTypeId);
                  const update = (field, value) => setLines((current) => current.map((row) => (row.key === line.key ? { ...row, [field]: value } : row)));
                  return (
                    <div key={line.key} className="flex flex-wrap items-end gap-2 rounded-item border border-line p-3">
                      <Select
                        label="Oda tipi"
                        name={`lines.${index}.roomTypeId`}
                        value={line.roomTypeId}
                        onChange={(e) => update('roomTypeId', e.target.value)}
                        options={[{ value: '', label: 'Seçin' }, ...roomTypes.map((type) => {
                          const q = typeQuotes.find((row) => row.id === type.id);
                          return { value: type.id, label: `${type.code} — ${type.name}${q ? ` (${q.available} boş)` : ''}` };
                        })]}
                        error={errors[`lines.${index}.roomTypeId`]}
                        disabled={busy}
                        className="w-full sm:w-64"
                      />
                      <Input label="Oda sayısı" type="number" min={1} max={50} value={line.quantity} onChange={(e) => update('quantity', e.target.value)} error={errors[`lines.${index}.quantity`]} disabled={busy} className="w-28" />
                      <Input label="Yetişkin / oda" type="number" min={1} max={20} value={line.adults} onChange={(e) => update('adults', e.target.value)} error={errors[`lines.${index}.adults`]} disabled={busy} className="w-32" />
                      <Input label="Çocuk / oda" type="number" min={0} max={20} value={line.children} onChange={(e) => update('children', e.target.value)} disabled={busy} className="w-28" />
                      <Select label="Pansiyon" value={board(line.boardType)} onChange={(e) => update('boardType', e.target.value)} options={BOARD_OPTIONS} disabled={busy} className="w-full sm:w-56" />
                      {typeQuote && (
                        <span className="self-center text-sm">
                          {formatMoney(typeQuote.total, quoteData?.currency)} / oda
                          {typeQuote.available < Number(line.quantity) && <Badge tone="danger" className="ml-2">{Math.max(0, typeQuote.available)} boş</Badge>}
                        </span>
                      )}
                      {lines.length > 1 && (
                        <Button variant="ghost" size="sm" icon="trash" aria-label={`${index + 1}. satırı sil`} disabled={busy} onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))} />
                      )}
                    </div>
                  );
                })}
                {errors.lines && <p className="text-xs text-sec-strong">{errors.lines}</p>}
                {lines.length < MAX_GROUP_LINES && (
                  <div>
                    <Button variant="outline" size="sm" icon="plus" disabled={busy} onClick={() => setLines((current) => [...current, newLine('')])}>
                      Satır ekle
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Section>
        </Card>

        <Card>
          <Section title="Durum ve not" icon="fileText">
            <div className="flex flex-wrap gap-3">
              <Select label="Durum" name="status" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTIONS} disabled={busy} className="w-full sm:w-64" />
              <Select label="Kaynak" name="source" value={source} onChange={(e) => setSource(e.target.value)} options={SOURCE_OPTIONS} disabled={busy} className="w-full sm:w-56" />
            </div>
            {status === 'PENDING' && <p className="text-xs text-ink-muted">Opsiyonlu rezervasyon yer tutar ama misafire onay bildirimi, onaylandığında gider.</p>}
            <Textarea label="Not" name="notes" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} error={errors.notes} disabled={busy} />
          </Section>
        </Card>
      </div>

      <aside className="flex flex-col gap-5 xl:sticky xl:top-28 xl:self-start">
        <Card>
          <Section title="Fiyat" icon="percent">
            {!quoteData || quoteLines.length === 0 ? (
              <p className="text-sm text-ink-muted">Tarih ve oda tipi seçilince fiyat burada görünür.</p>
            ) : (
              <PriceSummary quote={quoteData} selectedQuote={mode === 'single' ? selectedQuote : null} manual={manual} typeName={typeName} />
            )}
            {mode === 'single' && canOverridePrice && (
              <div className="flex flex-col gap-2 border-t border-line pt-3">
                <Checkbox label="Fiyatı elle gir" checked={manual.enabled} onChange={(e) => setManual((c) => ({ ...c, enabled: e.target.checked }))} disabled={busy} />
                {manual.enabled && (
                  <>
                    <Input label={`Toplam (${quoteData?.currency ?? hotel?.currency ?? ''})`} name="manualTotal" inputMode="decimal" placeholder="1250,00" value={manual.total} onChange={(e) => setManual((c) => ({ ...c, total: e.target.value }))} error={errors.manualTotal} disabled={busy} />
                    <Input label="Gerekçe" name="priceNote" placeholder="Ör. kurumsal anlaşma" value={manual.note} onChange={(e) => setManual((c) => ({ ...c, note: e.target.value }))} error={errors.priceNote} disabled={busy} />
                  </>
                )}
              </div>
            )}
          </Section>
        </Card>

        {shortfall && (
          <Alert tone="danger" title="Yer yok">
            <p>{shortfall.message}</p>
            {mode === 'single' && (
              <Button className="mt-3" size="sm" variant="outline" icon="clock" disabled={waitlistMutation.isPending} onClick={addToWaitlist}>
                {waitlistMutation.isPending ? 'Ekleniyor…' : 'Misafiri bekleme listesine al'}
              </Button>
            )}
          </Alert>
        )}

        <Button type="submit" icon="check" disabled={busy} className="w-full">
          {busy ? 'Açılıyor…' : mode === 'group' ? 'Grup rezervasyonunu aç' : 'Rezervasyonu aç'}
        </Button>
        {quoteData?.overbookingPolicy === 'APPROVAL' && (
          <p className="text-xs text-ink-muted">Yer yoksa istek yönetici onayına gider (otel ayarı).</p>
        )}
      </aside>
    </form>
  );
}

/**
 * @param {{ title: string, icon: string, children: React.ReactNode }} props
 */
function Section({ title, icon, children }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 p-1">
      <h2 className="flex items-center gap-2 text-base font-bold text-ink">
        <Icon name={icon} className="size-[18px] text-ink-muted" />
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * @param {{ quote: object, selectedQuote: object | null, manual: { enabled: boolean, total: string }, typeName: (id: string) => string }} props
 */
function PriceSummary({ quote, selectedQuote, manual, typeName }) {
  const currency = quote.currency;
  return (
    <div className="flex flex-col gap-3 text-sm">
      {selectedQuote ? (
        <table className="w-full text-xs">
          <caption className="sr-only">Gece gece fiyat</caption>
          <tbody className="divide-y divide-line">
            {selectedQuote.nights.slice(0, 14).map((night) => (
              <tr key={night.date}>
                <td className="py-1">{formatDate(night.date)}</td>
                <td className="py-1 text-ink-muted">{night.seasonName ? `${night.seasonName} ×${night.multiplier.replace('.', ',')}` : ''}</td>
                <td className="py-1 text-right font-semibold">{formatMoney(night.amount, currency)}</td>
              </tr>
            ))}
            {selectedQuote.nights.length > 14 && (
              <tr>
                <td colSpan={3} className="py-1 text-ink-muted">+{selectedQuote.nights.length - 14} gece daha</td>
              </tr>
            )}
          </tbody>
        </table>
      ) : (
        <ul className="flex flex-col gap-1 text-xs">
          {quote.lines.map((line) => (
            <li key={line.roomTypeId} className="flex justify-between">
              <span>{typeName(line.roomTypeId)} × {line.quantity}</span>
              <span className="font-semibold">{formatMoney(line.total, currency)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-baseline justify-between border-t border-line pt-2">
        <span className="font-semibold">Toplam</span>
        <span className="text-lg font-bold">{manual.enabled && manual.total ? formatMoney(manual.total.replace(',', '.'), currency) : formatMoney(quote.total, currency)}</span>
      </div>
      {manual.enabled && <p className="text-xs text-ink-muted">Sistem fiyatı: {formatMoney(quote.total, currency)}</p>}
      {quote.taxes.included.map((tax) => (
        <p key={tax.name} className="text-xs text-ink-muted">%{tax.rate} {tax.name} dahil ({formatMoney(tax.amount, currency)})</p>
      ))}
      {quote.taxes.added.map((tax) => (
        <p key={tax.name} className="text-xs text-ink-muted">+ %{tax.rate} {tax.name}: {formatMoney(tax.amount, currency)} (folyoda eklenir)</p>
      ))}
      {quote.shortages.length > 0 && (
        <Alert tone="warning" title="Bu tarihlerde yer yetmiyor">
          {quote.shortages.map((row) => `${typeName(row.roomTypeId)}: ${row.requested} istendi, ${row.available} boş`).join('; ')}
        </Alert>
      )}
      <p className="text-xs text-ink-muted">
        {quote.cancellation.freeUntil
          ? quote.cancellation.penaltyApplies
            ? `İptal politikası: şu an iptal edilirse ${formatMoney(quote.cancellation.fee, currency)} ceza uygulanır.`
            : `${formatDate(quote.cancellation.freeUntil)} tarihine kadar ücretsiz iptal.`
          : 'İptal cezası yok (otel politikası tanımlı değil).'}
      </p>
    </div>
  );
}
